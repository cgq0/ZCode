# 2026-10-22-01 CLI TUI 三项易用性修复（交接文档）

> 状态：**未开始写代码**。三份 spec 已定稿（含验收场景），代码零改动。
> 本文是唯一交接入口，写给在另一台机器上续跑的 agent/人。读完 AGENTS.md + 本文 +
> 三份 spec 即可开工，无需回溯本会话。

## 背景

用户（fork 维护者）报告 zcode-cli TUI 三个易用性问题，调查已到根因级：

1. **启动后右下角上下文徽标不显示**，首个响应完成才出现——resume 也一样
   （2026-10-21 a2902559 去假分母修复的遗留显示缺口）。
2. **Ctrl+J 不能换行**（预期对齐主流 TUI），实际行为是提交草稿。
3. **不支持 `/exit`、`/quit`**（当前只能 Ctrl+C 连按两次）。

工作量评估（已与用户对齐）：合计 1~1.5 天含测试；#2 一行级。

## Spec（实现的唯一事实源，含验收场景，先读）

| 项 | Spec |
| --- | --- |
| #2 Ctrl+J | `docs/superpowers/specs/2026-10-22-tui-ctrl-j-newline-design.md` |
| #3 /exit /quit | `docs/superpowers/specs/2026-10-22-cli-slash-exit-quit-design.md` |
| #1 徽标启动播种 | `docs/superpowers/specs/2026-10-22-tui-context-badge-startup-seeding-design.md` |

关键根因速记（细节以 spec 为准）：

- #1：徽标需要 `contextUsed`（仅 `ModelComplete` 写入）+ `contextWindow`（仅
  `session_created`/`model_selected` 写入）；冷恢复合成事件**不带 usage**
  （`cold-event-merge.ts` 已核实无 usage 合成），故 resume 后照样隐藏。修复 =
  启动元数据 + `/new` + `/resume` 三处用权威源播种（分母 `getCurrentModelOption()`
  .contextWindow、分子新增 `CommandCenterApp.getContextUsage?()`），事件仍是唯一权威。
  注意 `app-result.ts` 里 `resetSessionProjection` 清空块在 projection merge **之后**，
  必须对调顺序，否则 `/new`、`/resume` 的 seed 会被自己清掉。
- #2：终端 Ctrl+J = LF(0x0A)，OpenTUI 解析为裸 `linefeed`（无 ctrl 位）；
  opentui 编辑器默认就是 `linefeed → newline`，是我们的
  `PROMPT_TEXTAREA_KEY_BINDINGS`（`tui/src/app-input-pane.tsx:34`）把它覆盖成了
  submit。改回来即可。
- #3：命令链路全现成（parse → dispatch → result → TUI 消费），加 `exit` 分支 +
  `TuiSubmitPromptResult.exit?` + applyResult 消费；建议下拉与 `/help` 从 shared
  帮助条目自动派生。

## 建议实现顺序（从小到大，三个独立 commit）

1. **#2 Ctrl+J**（~1h）：改 1 个常量 + 更新 `tui/tests/tui-input.test.ts:36` 的
   deepEqual 断言 + 补 1 条交互用例（模拟 `"\n"` sequence：不提交、buffer 换行）。
2. **#3 /exit**（~半天）：shared 帮助条目 → parse 分支 → dispatch 分支 → tui 类型
   → applyResult 消费 → headless 早退 → 测试。实现时确认两点（spec 已注明）：
   applyResult 的 input 是否需注入 onExit；`BuiltinZCodeSlashCommandHelpEntry`
   有无可选 `aliases` 字段。
3. **#1 徽标播种**（~1 天）：CommandCenterApp.getContextUsage? → bootstrap 实现
   （与 submit result.projection 同源；冷恢复 fallback
   `resolveSessionContextUsage`，`session-mapper.ts:609`）→ readTuiSessionMetadata
   → TUI 类型 Pick 列表 → app.tsx 首帧 useState → /new、/resume result 播种 →
   app-result.ts 顺序对调 → 测试。实现时验证：冷恢复投影是否已含 restored used
   （决定 fallback 分支去留）。

每项独立提交，commit message 按仓库惯例写触发场景/根因链/修复机制/回归验证，
`Spec:` 行指向对应 spec 文件。

## 环境备注（mac 机器实测，其他机器按实际情况调整）

- **无 mise**；pnpm 10.33.2 经 corepack 装在 `~/.local/bin`，命令前缀
  `PATH="$HOME/.local/bin:$PATH"`。
- **turbo 只在外层**：`/Users/macos01/Work/ZCode/node_modules/.bin/turbo`，且必须在
  `apps/zcode-cli/` 目录下运行（读它的 turbo.json）。
- **tui 包测试是 node:test 不是 vitest**：`cd apps/zcode-cli/packages/tui &&
  PATH="$HOME/.local/bin:$PATH" pnpm test`（= tsx --test）。vitest 跑它报
  "No test suite found"。
- **根 typecheck 会 OOM**：需 `NODE_OPTIONS=--max-old-space-size=8192`，且根 typecheck
  本就不含 apps/zcode-cli；CLI workspace 用上面的 turbo run typecheck。
- 分支：`dev`（本 fork 工作流 = dev 开发零 CI，验证后合 main）。dev 分支首推跑
  affected 时若基线选择失败，设 `ZCODE_AFFECTED_TEST_BASE=origin/main`。

## 验证清单（每项做完都跑）

```sh
# tui 单测（node:test）
cd apps/zcode-cli/packages/tui && PATH="$HOME/.local/bin:$PATH" pnpm test
# cli 包单测（vitest，按包 package.json 实际脚本为准）
cd apps/zcode-cli/packages/cli && PATH="$HOME/.local/bin:$PATH" pnpm test
# CLI workspace 类型检查（32 包）
cd apps/zcode-cli && PATH="$HOME/.local/bin:$PATH" \
  /Users/macos01/Work/ZCode/node_modules/.bin/turbo run typecheck
# lint / 架构 / affected（外层仓库根）
pnpm lint && pnpm architecture:check --changed && pnpm verify:pre-push
# shared/contracts 有改动时补跑对应包 vitest
```

行为验证（改完后真跑 TUI）：`#1` 新会话启动即 `0 (0%)`、resume 立即显示占用、
`/new` 后回 `0 (0%)`；`#2` Ctrl+J 插换行、Enter 照旧提交；`#3` 空闲/busy 两态
`/exit` 退出码 0、`/quit` 同效、`/help` 含条目。

## 提交规矩（强制）

- 一律走 `cgq0/scripts/ai-commit.sh -F <消息文件>`，**不要裸跑 git commit**
  （脚本自动附加 X-AI trailer；解析不出身份会拒提交，此时按脚本输出补环境）。
- 消息格式参照 `git log --oneline -10`（`fix(cli): …` + 中文正文四段 +
  `Spec: docs/superpowers/specs/…`）。
- 完成后：`cgq0/docs/diary/<日期>.<平台>.md` **append-only** 追记（先 git fetch 确认
  origin 上当天本机文件是否已存在），TODOs.md 对应行移入 diary 后删除。

## 风险与已定决策（推翻需回改 spec）

| 决策 | 内容 | 落点 |
| --- | --- | --- |
| 裸 linefeed 改换行 | 个别 Enter 发 LF 的终端会变「换行」，接受（对齐 Claude Code） | spec #2 Clarification |
| busy 中 /exit | 先 abort 当前轮再退出，退出码 0（对齐 Ctrl+C 连按路径） | spec #3 Clarification |
| headless /exit | 回提示文本，不建 app 不发模型 | spec #3 Clarification |
| 新会话徽标 | 显示 `0 (0%)`（守卫已接受 ≥0） | spec #1 Clarification |
| seed 与事件冲突 | 事件赢；seed 只管首帧 | spec #1 Clarification |

## 给续跑 agent 的开工清单

1. `node scripts/check-workspace-freshness.mjs` 确认基线。
2. 读 AGENTS.md → 本文 → 三份 spec。
3. 按顺序实现 #2 → #3 → #1，每项：spec 验收场景逐条过 → 测试 → 验证清单 →
   ai-commit 提交。
4. 全部完成后跑一遍行为验证清单，diary 记录结果，TODOs 勾除。
