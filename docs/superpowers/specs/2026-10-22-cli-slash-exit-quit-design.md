# CLI Slash /exit /quit Design

## Feature/change summary

CLI TUI 不支持 `/exit` 或 `/quit` 退出（当前唯一退出方式是 Ctrl+C 连按两次）。本设计为
command-center 增加 `exit` 内置命令：`/exit` 提交后 TUI 优雅退出，退出码 0；`/quit`
作为别名归并为同一命令。

命令链路全部现成，只加数据和一个消费点：

```text
用户输入 /exit（或 /quit）
  → parseSlashCommand（cli/src/command-center/slash-commands.ts:40）
      rawName "exit"|"quit" → { name: "exit", type: "known" }        【新增分支】
  → createCommandCenter dispatch（cli/src/command-center/create.ts:77 起）
      command.name === "exit" → { mode, response, exit: true }        【新增分支】
  → TuiSubmitPromptResult.exit?: boolean                              【types.ts 加字段】
  → TUI applyResult（tui/src/app-result.ts）
      result.exit → busy 则先 abort，再 onExit(0)                     【新增消费】
```

建议下拉与 `/help` 无需单独接线：两者都从
`BUILTIN_ZCODE_SLASH_COMMAND_HELP_ENTRIES`（`packages/shared/src/zcode-slash-command-help.ts`）
派生（`listSlashCommandSuggestions` ← `visibleHelpEntries`），加条目即全量生效。

## Clarification log

以下两点用户未显式裁决，为本设计按既有惯例做的裁定；实现前如被推翻只影响对应小节：

| 日期 | 问题 | 裁定 | 固定边界 |
| --- | --- | --- | --- |
| 2026-10-22 | busy（agent 回合进行中）执行 /exit 的语义？ | 先 abort 当前轮再退出 | 对齐 Ctrl+C 连按两次路径（`tui/src/app-keyboard.ts:217` abort → onExit） |
| 2026-10-22 | headless（`zcode --prompt "/exit"`）语义？ | 回提示文本，不改变进程语义 | headless 本就单 prompt 即退出，/exit 无意义；不建 app、不发模型 |

## Goals

- `parseSlashCommand` 新增 `exit`（rawName `exit`/`quit`）→ `type: "known"`，
  args 非空时不报错、由 dispatch 校验。
- `packages/shared` 帮助条目：`name: "exit"`、`summary`（退出 CLI）、`usage: "/exit"`、
  `details` 说明 busy 行为与 quit 别名；若 `BuiltinZCodeSlashCommandHelpEntry` 类型已有
  可选 `aliases` 字段则填 `["quit"]`（建议下拉会透传），没有则只在 details 里注明，
  不为别名扩协议类型。
- `create.ts` dispatch：`command.name === "exit"`：
  - args 非空 → `{ mode, response: "Usage: /exit" }`（不带 exit 标志，与 /logout 同款）。
  - 否则 `{ mode: deps.getMode?.(), response: <退出提示文案>, exit: true }`。
  - `recordSlashCommandInHistory` 照常（create.ts 函数尾部统一 await 记录后才返回，
    退出前已落盘）。
- `TuiSubmitPromptResult`（`tui/src/types.ts:152`）加可选 `exit?: boolean`。
- TUI 消费：`applyResult`（`tui/src/app-result.ts`）开头或独立早退段：
  `result.exit === true` → busy 轮先 `abortControllerRef.abort()`，然后 `onExit(0)`。
  onExit 需经 applyResult 的 input 注入（TuiApp 已持有 onExit 闭包）。两条产生
  result 的路径（submit 新回合、busy 时 sendInput 的 command_result）都汇入
  applyResult，消费点唯一。
- headless `prompt-command.ts` 的 known 命令早退链（`prompt-command.ts:90-128` 区域）
  加 `name === "exit"`：返回 `"/exit is only available in the interactive TUI."`，
  不建 app、不进模型路径；`--json` 输出沿用既有结构。

## Non-goals

- 不加 `/exit` 确认弹层（Ctrl+C 连按已有防误触；命令是显式输入，不二次确认）。
- 不处理 abort 之外的排队输入清场：abort 链已有既有清场语义，本设计只复用。
- 不动桌面/web 端（slash 命令面是 CLI command-center 专属）。

## 设计

无新增状态所有者。`exit` 是 submit 结果上的单向标志（CLI 声明意图 → TUI 执行），
消费即进程退出，无幂等/重放问题。事件顺序：

```text
CLI create.ts（命令裁决者）
  1. recordSlashCommandInHistory（await，先落盘）
  2. return { exit: true }
TUI applyResult（退出执行者，唯一持有 renderer/onExit）
  3. 若 busy：abort 当前轮（与 Ctrl+C 连按同一 abort 路径）
  4. onExit(0) → renderer.destroy() → runTui resolve(0) → 进程退出码 0
```

边界保持：退出执行权在 TUI（只有它持有 renderer），CLI 只声明意图——命令中心永不
直接 kill 进程，与「命令层不承载运行时控制」的既有分层一致。

## 验收场景

1. 空闲时 `/exit`：TUI 立即退出，shell 退出码 0，无残留渲染帧。
2. `/quit` 同效；输入 `/` 时建议下拉出现 exit 条目（quit 别名随条目展示）。
3. busy 中 `/exit`：当前轮中断（复用 Ctrl+C 的 abort 路径），TUI 退出码 0。
4. `/exit extra`：回 Usage 提示，不退出。
5. `/help` 输出含 exit 条目；`/help exit` 显示 details。
6. unknown 命令提示的可用列表含 `/exit`（`listAvailableCommandNames` 自动纳入）。
7. headless `zcode --prompt "/exit"`：输出提示文本正常退出，不建会话。
8. 退出前输入历史里已记录该命令（recordSlashCommandInHistory 生效）。

## 回归证据

- `apps/zcode-cli/packages/cli/tests/cli.unit.test.ts`：parse（exit/quit/带参）+
  dispatch（exit 标志、args 校验）用例。
- tui 侧 applyResult 消费用例：`result.exit` 触发 onExit(0)（node:test，跟随
  `tui/tests/` 下 applyResult 相关既有落点形态）。
- `packages/shared` 帮助条目如有快照/枚举测试则同步（实现时 grep `/compact` 定位）。
- 受影响包单测 + `pnpm typecheck` + `pnpm lint`（环境注意项见交接文件）。
