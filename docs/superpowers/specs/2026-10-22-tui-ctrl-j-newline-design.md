# TUI Ctrl+J Newline Design

## Feature/change summary

CLI TUI 输入框里 Ctrl+J 的预期行为是插入换行（主流 TUI 如 Claude Code 的同款键位），
当前实际行为是**提交草稿**。

根因（已逐层源码确认，非猜测）：

1. 终端里 Ctrl+J 发送 LF 字节（`0x0A`）。OpenTUI 把裸 LF 解析为 `{ name: "linefeed" }`
   且**不带 ctrl 标志**（`node_modules/@mbears/opentui-core/index-ba782b4w.js` 的
   key parser：`s === "\n"` → `key.name = "linefeed"`，无 ctrl 位可还原——legacy 编码
   下 Ctrl+J 与裸 LF 不可区分）。
2. OpenTUI 编辑器默认绑定本来就是换行：`{ linefeed → newline }`、`{ return → newline }`
   （`index-1j83z2zx.js` 默认编辑器 keybindings）。
3. 是我们的覆盖绑定改掉了它：`PROMPT_TEXTAREA_KEY_BINDINGS`
   （`apps/zcode-cli/packages/tui/src/app-input-pane.tsx:34`）把裸 `linefeed` 映射为
   `submit`，只给 `linefeed+shift` 保留了 `newline`。

因此修复就是改覆盖绑定本身，不需要动 OpenTUI、不需要新的修饰键解析。

## Clarification log

| 日期 | 问题 | 用户裁决 | 固定边界 |
| --- | --- | --- | --- |
| 2026-10-22 | 裸 `linefeed` 改回 `newline` 后，个别 Enter 发 LF 的终端会从「提交」变「换行」，接受吗？ | 接受 | 主流终端 Enter 都发 CR（`return` 路径不变）；行为对齐 Claude Code |

## Goals

- `PROMPT_TEXTAREA_KEY_BINDINGS` 中裸 `{ name: "linefeed", action: "submit" }` 改为
  `{ name: "linefeed", action: "newline" }`（即恢复 OpenTUI 默认语义，Ctrl+J 插入换行）。
- `{ name: "linefeed", shift: true, action: "newline" }` 删除：裸键已是 newline，
  shift 变体成为死条目，留着只会误导读者以为 linefeed 有独立语义。
- `return` 系绑定（`return → submit`、`return+shift → newline`）不变。

## Non-goals

- 不修改 OpenTUI（key parser 无法从裸 LF 还原 ctrl 位，上游改动无意义）。
- 不引入其他换行键位（如 Alt+Enter / Ctrl+O）：Ctrl+J 已覆盖诉求，多键位增加认知成本。
- 不改 question/approval 面板的 `return` 确认键（它们的场景是单选确认，不需要换行）。

## 设计

改动是纯数据（一个导出常量），无状态、无时序、无所有权变化：

```text
Ctrl+J (LF 0x0A)
  → OpenTUI parser: { name: "linefeed" }
    → PROMPT_TEXTAREA_KEY_BINDINGS: linefeed → newline（改）
      → TextareaRenderable.newLine()
Enter (CR 0x0D)
  → OpenTUI parser: { name: "return" }
    → PROMPT_TEXTAREA_KEY_BINDINGS: return → submit（不变）
      → TextareaRenderable.submit()
```

## 验收场景

1. 空草稿按 Ctrl+J：不提交，输入框插入一个空行（草稿保持空文本 + 换行）。
2. 已有多行草稿按 Ctrl+J：光标处插入换行，状态行不出现提交/发送迹象。
3. Enter 照旧提交；Shift+Enter 照旧换行。
4. 提交后的草稿清空逻辑、输入历史记录行为不变。
5. 建议下拉、@ 文件补全面板打开时 Ctrl+J 不误触提交（既有拦截链在 textarea 绑定之前，
   本改动不触及）。

## 回归证据

- `apps/zcode-cli/packages/tui/tests/tui-input.test.ts:36` 的
  `deepEqual(PROMPT_TEXTAREA_KEY_BINDINGS, …)` 断言随新数组更新。
- 同文件交互用例（`"Shift+Enter inserts a newline while Enter submits…"` 附近）补一条：
  模拟发送 `"\n"` sequence，断言不触发 submit 且 textarea 文本新增换行。
- tui 包测试是 **node:test**（`pnpm test` = `tsx --test tests/*.test.ts`），不是 vitest。

---

# 后续：增强编码路径的 Ctrl+J（2026-10-22 晚补充）

## 问题

`cq.23.g83965317` 版本在 iTerm2 3.6.6 里 Ctrl+J 仍无任何反应（不换行、不提交），
而 Terminal.app（原生"终端"）里同一二进制换行正常。用户实测确认。

## 根因（已实测取证，非猜测）

上面的修复只覆盖了 **legacy 字节路径**。但 TUI 启动时会向终端发送键盘增强序列：
`CSI > 4;1m`（modifyOtherKeys=1）与 `CSI ? u`（kitty 协议查询；只查询、从不 push）。
终端对增强序列的应答与否，决定 Ctrl+J 的到达形态：

```text
Terminal.app（忽略增强序列）：
  Ctrl+J → 裸 LF(0x0A) → parser { name: "linefeed" } → linefeed → newline ✓

iTerm2 3.6.6（响应增强序列）：
  Ctrl+J → CSI 106;5u（kitty 形式）或 CSI 27;5;106~（XTMODKEYS 形式）
    → parser 解码为 { name: "j", ctrl: true }
      （StdinParser 默认 useKittyKeyboard: true；modifyOtherKeys 分支同样归到 j+ctrl）
    → 绑定表无 "j:1:0:0:0" 条目（OpenTUI 匹配键为 name:ctrl:shift:meta:super
      精确串）→ 整键被吞 ✗
```

取证：真实二进制 pty 注入 `CSI 106;5u`，落库消息正文 `"abcdef"`（键被吞）；
裸 `0x0A` 对照组落库 `"abc\ndef"`（换行正常）。

这不是 iTerm2 的 bug：协议里增强编码的目的恰恰就是把 Ctrl+J 从 Enter/LF 中消歧。
是 TUI 请求了增强编码却没处理增强编码下的键名。

## 设计

- `PROMPT_TEXTAREA_KEY_BINDINGS` 增加 `{ name: "j", ctrl: true, action: "newline" }`。
  legacy 路径下 Ctrl+J 永远解析为 `linefeed`（无 ctrl 位），此条目为死键不误伤；
  两种增强形式（kitty / XTMODKEYS）都归到 `{j, ctrl}`，一条覆盖。
  普通字母 `j` 匹配键为 `"j:0:0:0:0"`，与新条目 `"j:1:0:0:0"` 不相交，输入不受影响。
- **不关闭增强序列**（不给 opentui 传 useKittyKeyboard: false / 不去掉 modifyOtherKeys）：
  iTerm2 下 Shift+Enter 与 Enter 的区分正依赖增强编码，关掉会引入回归。

## 验收场景（增量）

1. iTerm2（增强编码生效）：Ctrl+J 在光标处插入换行，不提交。
2. Terminal.app（legacy）：Ctrl+J 行为不变（换行）。
3. 普通输入 `j` 字符照常上屏。
4. Enter 提交、Shift+Enter 换行在两种终端均不变。

## 回归证据（增量）

- 绑定数组 `deepEqual` 断言加入新条目。
- 交互用例：`pressKey("j", { ctrl: true })`（走 mock 的 kitty 编码器，复现 iTerm2 路径）
  断言不触发 submit、文本插入换行；`pressKeys` 直发 `CSI 27;5;106~` 覆盖 XTMODKEYS 形式。
- 真实 TUI pty 冒烟（tsx 跑源码）：注入 `\x1b[106;5u`，落库正文含换行。
