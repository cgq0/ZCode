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
