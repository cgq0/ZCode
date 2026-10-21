# TUI Context Badge Startup Seeding Design

## Feature/change summary

CLI TUI 右下角上下文徽标在**启动后、首个模型响应完成前**完全不显示（既无 token 数也无
百分比）；`/new`、`/resume` 之后同样如此。用户预期：启动即见（新会话 `0 (0%)`，
resume 立即显示接近退出前的占用）。

这是 2026-10-21「legacy 投影 contextWindow 事件化」修复的遗留显示缺口。根因
（全部已逐层源码确认）：

1. 徽标渲染（`tui/src/app-input-status.tsx:177` `inputContextUsageBadge`）需要两个值：
   `contextUsed` 非法（undefined）→ 整个徽标隐藏；`contextWindow` 非法 → 只显示
   token 数不显示百分比；两者合法 → `usedLabel (pct%)`。
2. TUI 的 `contextUsage` state（`tui/src/app.tsx:85` `useState<ContextUsage>({})`）
   只有两个事件写入点：
   - `contextUsed`：仅 `ModelComplete`（`tui/src/app-events.ts:326`，且
     `inputTokens > 0` 才写）；
   - `contextWindow`：仅 `session_created`（冷恢复合成，`app-events.ts:279`）与
     `model_selected`（每轮选型，`app-events.ts:291`）。
3. 因此全新会话启动时两值皆无 → 徽标隐藏；**resume 也不行**：冷恢复合成事件
   （`bootstrap/src/zcode-protocol-v4/cold-event-merge.ts` 的
   `synthesizeEventsFromMessages`）只合成消息事件、**不带 usage**，窗口虽由
   `resolveSessionModelContextWindow` 播种，但 used 缺席照样隐藏——直到本轮第一个
   `ModelComplete`。
4. submit 结果其实早有通道：`TuiSubmitPromptResult.projection` 已被 TUI 消费
   （`tui/src/app-result.ts:74` merge `validContextUsage`），但 CLI 侧
   `withTuiMetadata`（`cli/src/tui-submit-metadata.ts`）从不填它，字段形同虚设；
   且 `app-result.ts:81` 的 `resetSessionProjection` 清空块在 merge **之后**执行，
   `/new`、`/resume`（两者都置 `resetSessionProjection: true`）即使带了 seed 也会被清掉。

方案：**启动/重置时用权威源播种，事件仍是唯一权威**。数据源全部现成：
- 分母：`CommandCenterApp.getCurrentModelOption()?.contextWindow`
  （`cli/src/command-center/types.ts:193`；`ZCodeModelOption.contextWindow`，
  `packages/shared/src/zcode-protocol/index.ts:1153`）。
- 分子：bootstrap 侧已有冷恢复共享投影 `resolveSessionContextUsage`
  （`bootstrap/src/zcode-protocol/session-mapper.ts:609`，legacy snapshot 与 V4 窄种子
  共用的纯函数）；且 app facade 的 submit result.projection 每轮都在产出同源数据。

## Clarification log

| 日期 | 问题 | 用户裁决 | 固定边界 |
| --- | --- | --- | --- |
| 2026-10-22 | 全新会话 0 token 时显示什么？ | 显示 `0 (0%)` | 守卫接受 ≥0（`validContextTokenCount`，`app-input-status.tsx:292`；`validTokenCount`，`app-event-data.ts:122`），播种 0 合法存活 |
| 2026-10-22 | 播种值与事件冲突时谁赢？ | 事件赢 | seed 只负责首帧；`model_selected`/`model_complete` 到达后照常覆盖 |

## Goals

- `CommandCenterApp`（`cli/src/command-center/types.ts:190`）加可选只读查询
  `getContextUsage?(): { contextUsed?: number; contextWindow?: number } | undefined`：
  - `contextWindow` 来自 `getCurrentModelOption()?.contextWindow`；
  - `contextUsed` 来自 app 侧既投影（bootstrap 实现处与 submit result.projection 同源；
    冷恢复若投影未含 restored used，则退回 `resolveSessionContextUsage` 口径）。
  - 纯只读、幂等；缺席字段直接省略，不伪造 0。
- `readTuiSessionMetadata`（`cli/src/tui-prompt-handler-queries.ts:8`）返回值加
  `contextUsage`（window 取 `getCurrentModelOption`；used 取 `getContextUsage`，
  二者缺席则字段省略）。
- `TuiSubmitPromptResult` 与 `TuiSessionMetadata`、`TuiStartupOptions` 的 Pick 列表
  （`tui/src/types.ts:23`、`types.ts` 尾部 StartupOptions Pick）加 `contextUsage`。
- `app.tsx:85` 初始 state 改 `useState<ContextUsage>(options.contextUsage ?? {})`。
  时序成立依据：`runTuiWithRenderer`（`tui/src/tui.tsx:103`）在 `loadStartupOptions`
  resolve 之后才 `renderApp` mount `TuiApp`，startup 字段直接进首帧 props，无需 effect。
- `/new` 分支（`cli/src/command-center/create.ts:306`）result 加
  `projection: { contextUsed: 0, contextWindow: getCurrentModelOption窗口 }`。
- `/resume` 兜底分支（`create.ts:359-381`）result 加
  `projection: { contextUsed: getContextUsage()?.contextUsed, contextWindow: … }`
  （used 缺席则省略该键）。
- `app-result.ts`：把 `result.projection` 的 merge 挪到 `resetSessionProjection`
  清空块**之后**（顺序对调），使「reset + seed」在同一条结果里生效。

## Non-goals

- 不改协议 schema、不新增事件、不改 `EventReducer`/v4 投影（2026-10-21 修复确立的
  「投影事实必须来自事件」不变，seed 只进 TUI 显示态）。
- 不改任何守卫（两处 `>= 0` 守卫已兼容播种 0）。
- 不改 headless 输出（`--json` 的 projection 字段本就正确）。
- 不处理会话内模型切换的分母（`model_selected` 已覆盖，2026-10-21 修复范畴）。

## 设计

所有权与事件顺序（seed = 播种通道，event = 权威通道，二者写同一个 TUI state）：

```text
Provider Registry（contextWindow 权威）
  → getCurrentModelOption() ─┐
bootstrap 投影 / resolveSessionContextUsage（used 权威）─┤
                            ▼
        CLI readTuiSessionMetadata / create.ts /new /resume result
                            ▼
        TUI options.contextUsage（首帧 useState）／result.projection（applyResult merge）
                            ▼
        contextUsage state ←── 事件覆盖：model_selected（窗）、model_complete（用）
                            ▼
        inputContextUsageBadge 渲染（守卫不变）
```

- 单一写入面不变：TUI `contextUsage` state 的写入点仍只有 事件处理器、applyResult、
  首帧初始化三处；seed 不引入新状态、不双向同步。
- 幂等：getContextUsage 只读；重复 merge 同值无副作用；事件重放语义不变
  （缺失不覆盖、null 显式清除，2026-10-21 已定）。
- 降级：元数据加载失败（loginRequired / 异常，`tui-command-data.ts:73` catch 返回
  `{}`）时 seed 缺席 → 徽标维持现状隐藏；resume 旧会话投影无 used → 只省略该键，
  徽标按数据缺席程度降级（有窗无用 → 隐藏；不伪造数字）。

## 验收场景

1. 全新会话启动（有可选模型）：徽标立即显示 `0 (0%)`，分母 = 注册表窗口
   （GLM-5.3-Flash 为 1M）。
2. resume 大会话启动：徽标立即显示接近退出前的 token 数与百分比，无需先发一轮。
3. `/new` 后：徽标立即回到 `0 (0%)`（不再等下一轮响应）。
4. `/resume` 切换会话后：徽标立即显示新会话占用。
5. 首轮 `model_selected`/`model_complete` 到达后：事件值覆盖 seed，无回退闪烁；
   seed 与事件一致时渲染无变化。
6. loginRequired 或元数据异常：徽标隐藏（现状保持，无报错）。
7. 会话内切换窗口不同的模型：分母由 `model_selected` 更新（既有行为回归通过）。

## 回归证据

- `tui/tests/tui-input.test.ts`：badge formatter 既有用例保持；补 seed 透传断言
  （startup options → 初始 state）。
- `tui/tests/tui-events.test.ts` 或 applyResult 落点：新增「reset 块后 merge 保留
  seed」「`/new` result 播种 0 (0%)」「事件覆盖 seed」用例（node:test）。
- `cli` 单测：`readTuiSessionMetadata` 带 contextUsage；`/new`、`/resume` result 带
  projection（跟随 `cli/tests/cli.unit.test.ts` 形态）。
- bootstrap：`getContextUsage` 若走 `resolveSessionContextUsage` 纯函数，补最小用例；
  实现时验证冷恢复投影是否已含 restored used（决定是否需要 fallback 分支）。
- 受影响包单测 + `pnpm typecheck` + `pnpm lint`（环境注意项见交接文件）。
