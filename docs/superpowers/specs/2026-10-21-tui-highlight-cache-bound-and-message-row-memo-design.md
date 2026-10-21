# TUI Highlight Cache Bound And Message Row Memo Design

## Feature/change summary

2026-10-21 内存泄露调查（diary/2026-10-21.mac.md 08:56 / 09:08 条目）在 CLI TUI 定位两个
独立缺陷，合计解释「会话越用越卡、打字与吐 token 延迟递增」的体感。GB 级堆外泄漏是另一
条线（待活体取证），不在本设计范围。

1. **highlightCache 无界泄漏**（`packages/tui/src/app-shiki-highlighter.ts`）：模块级
   `Map<string, ShikiHighlightSegment[][] | undefined>` 没有任何淘汰路径（唯一清空点是
   `resetShikiHighlighterForTest`）。cache key 内嵌完整代码内容
   （`${theme}\0${language}\0${lines.join("\n")}`），值是分词放大的 segment 数组。会话里
   每个渲染过的 diff 代码块永久驻留；同一代码块内容一旦变化（编辑迭代）旧条目也不释放。
2. **转录全量 reconcile**（`packages/tui/src/app-transcript-components.tsx`）：`ContentPane`
   对全部消息 `messages.map` 渲染 `MessageRow`；流式期间每个 text/thought delta 触发
   `setMessages`，所有行（含未变化行）全部重建元素并走 React 协调。`viewportCulling` 只
   裁剪 OpenTUI 绘制，不裁剪元素构建与协调。转录越长，每个 delta 成本越高 → 渐进式卡顿。

## Goals

- highlightCache 加**容量上限 + LRU**：
  - 常量 `SHIKI_HIGHLIGHT_CACHE_LIMIT = 200`（导出，供测试断言）；
  - 命中即 `delete + set` 挪到 Map 尾部（Map 迭代序 = 插入序），热代码块不被冷条目挤出；
  - 插入后 `size > LIMIT` 时淘汰队首（最旧）条目；
  - 行为不变：命中仍返回同一引用，未命中仍走 `tokenizeLines`。
- `MessageRow` **memo 化**：
  - 导出 `messageRowPropsAreEqual(prev, next)` 比较器：比较 `message / copy /
    terminalWidth / expandedWorkflowRunIds / workflowCardsByToolCallId` 的引用相等；
    **刻意不比较 `index`**——`MessageRow` 不消费该 prop，消息数组位移（如插行）不应引发
    全量重渲染；
  - 导出 `MemoizedMessageRow = React.memo(MessageRow, messageRowPropsAreEqual)`，
    `ContentPane` 改用 memo 版本；`MessageRow` 本体保持可函数调用（现有测试直接以函数
    方式渲染它，保持兼容）。
- props 引用稳定性前提核实（已做）：`copy` 为 locale 常量；`workflowCardsByToolCallId`
  是 `useMemo([mirror])`（app-workflow-controller.ts:49）；`expandedRunIds` 是
  useState 持有的 `ReadonlySet`。三者引用在无变化时稳定，浅比较即安全。

## Non-goals

- 不处理 GB 级堆外泄漏（独立线：活体取证协议见 diary 09:08 条目）。
- 不改 OpenTUI scrollbox / viewportCulling 行为，不引入虚拟化列表。
- 不给 `MarkdownText` 做流式增量解析——memo 后每 delta 只剩单个流式行重渲染，先观察
  实际收益，避免一次性扩大改动面。
- 不改 key 方案（`${index}-${message.role}`）：key 变更会影响 OpenTUI 复用与滚动定位
  语义，风险大于收益。
- 不改 shiki diff view 的异步高亮协议（effect + cacheKey）。

## Scenarios（验收）

1. 高亮缓存有界：填入 `LIMIT + N` 个互不相同的代码块后 `shikiHighlightCacheSizeForTest()
   <= SHIKI_HIGHLIGHT_CACHE_LIMIT`；最早插入的条目被淘汰（重算产生新引用）。
2. LRU 语义：插入 [a, b] 后再命中 a（touch），继续插入至触发单次淘汰，被淘汰的是 b
   （重算新引用），a 仍返回原引用。
3. memo 比较器：同引用 message + 其余 prop 不变 → `true`（跳过重渲染）；`index` 单独
   变化 → `true`；message / copy / terminalWidth / 卡片索引 Map / 展开集合任一变化 →
   `false`。
4. `ContentPane` 空转录与有消息路径行为不变（现有 logo / message 断言更新为
   `MemoizedMessageRow`）。
5. 既有 tui 测试（220 项）全绿；typecheck / lint / format / architecture:check 全绿。
