# 2026-10-21-01 PlanB：legacy 投影 contextWindow 事件化（交接文档）

> 状态：**✅ 已完成并提交（2026-10-21 08:40 批注）**。原交接状态：实现约 90%，卡在 TUI 测试
> 执行方式。续跑结果：tui 220/220（CLI node_modules 缺 tsx，需把外层 node_modules/.bin 加进
> PATH）、oxfmt 修 4 文件折行、typecheck 32/32、contracts 34/34、桌面 ui 相关 176/176、
> CLI/外层 lint 0 errors、architecture:check --changed 0 违规。详见 diary/2026-10-21.mac.md。

## 背景与问题

用户观察到：CLI TUI 右下角上下文徽标 128K 显示 64%、152.2K 显示 76%（分母恒 200000），
而 GLM-5.3-Flash 注册表窗口是 1M，桌面端显示正确。根因（已逐层源码确认）：

1. CLI TUI 百分比分母 = contracts `EventReducer` 归约出的 `projection.contextWindow`。
2. 归约器唯一写它的 handler 是 `session_created`；`model_complete` 只写 `contextUsed`。
3. **活跃会话事件流里没有 `session_created`**——只在冷恢复时由 `transcript-hydration.ts:1626`
   合成。所以活跃会话的窗口永远停在 `initialSessionProjection.contextWindow = 200000` 假默认。
4. 运行时执行（auto-compact ~966K 阈值、preflight 输出上限）读
   `model.properties.contextWindow`，不受影响——纯显示层缺陷。

Spec（实现前事实源，含验收场景）：
`docs/superpowers/specs/2026-10-21-legacy-projection-context-window-from-model-selected-design.md`

方案（用户裁决）：B = 事件化根治。关键发现：`ModelSelectedPayload.contextWindow?: number | null`
（`session.events.ts:744`）与整条发射链**早已存在**（`steering.ts:1124` 从 Active Model 统一填值；
首轮 `turn-model.ts:160`、v4 切换 `model-config.ts:132/231`、子代理 `subagent.ts:470`），
v4 投影已在消费（`product-projection.ts:4730` onModelSelected）。缺的只是 legacy 归约器不认这个事件。

## 已完成改动（工作树未提交，7 文件 + 1 spec）

| 文件 | 改动 |
| --- | --- |
| `apps/zcode-cli/packages/contracts/src/events/event-reducer-helpers.ts` | 移除 `initialSessionProjection.contextWindow: 200000` 假默认（留注释） |
| `apps/zcode-cli/packages/contracts/src/interfaces/session.port.ts` | `SessionProjection.contextWindow` 改为可选 `contextWindow?: number` |
| `apps/zcode-cli/packages/contracts/src/events/event-reducer.ts` | 新增 `ModelSelected` handler：正数=权威窗口、`null`=显式清除回未知、缺失=不覆盖（与 v4 onModelSelected 同语义）；新增 payload import |
| `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/session-mapper.ts` | ① `mapSessionProjection` 与 `buildGoalStats` 的 wire 映射 `?? 0`（wire schema 要求非负整数，0=未知，桌面已有 `<=0` 守卫）；② `contextUsageFromProjection` 改局部常量 + `undefined/<=0` 守卫（原 `<=0` 对 undefined 是 NaN 比较会放行）；③ `contextUsageFromPersistedMessages` 参数放宽 `number \| undefined` + 守卫。注意 `session-mapper.ts:125` `currentModelContextWindow: projection.contextWindow` **刻意未改**：参数 optional，假默认移除后经 `positiveInteger(undefined) ?? 注册表值` 自然回落 |
| `apps/zcode-cli/packages/tui/src/app-events.ts` | `applyModelSelectedEvent` 增加第 4 参 `setContextUsage`：正数=更新分母、null/非法=清空（置 undefined）、缺失=不动；调用点透传 `handlers.setContextUsage`。刻意不用 `numberField`（它把 null 归并成 undefined，丢显式清除语义） |
| `apps/zcode-cli/packages/contracts/tests/event-reducer.test.ts` | +6 用例：无事件不伪造窗口 / model_selected 写入 / 活跃会话播种 / 缺失不覆盖 / null 清除 / 切换更新 |
| `apps/zcode-cli/packages/tui/tests/tui-events.test.ts` | `createSessionEventState` helper 增捕获 `contextUsage`（setContextUsage 实现 updater 语义）+ 3 个同语义用例 |

## 验证状态

- ✅ contracts：`pnpm exec vitest run tests/event-reducer.test.ts tests/event-reducer-session-status.test.ts`
  → 34/34 通过（含新用例）。
- ✅ CLI workspace typecheck：`PATH="$HOME/.local/bin:$PATH" /Users/macos01/Work/ZCode/node_modules/.bin/turbo run typecheck`
  （在 `apps/zcode-cli/` 下执行）→ 32/32 包全绿，无其他被可选化波及的编译点。
- ❌ **TUI 测试还没跑成**：`tui-events.test.ts` 用的是 **node:test**（`import test from "node:test"`），
  正确执行方式是 tui 包自己的脚本 `pnpm test`（= `tsx --disable-warning=DEP0205 --test tests/*.test.ts`），
  **不是 vitest**（vitest 跑它报 "No test suite found"）。这是下一步第一件事。
- ⏳ 未做：`oxfmt --check`/format（我在两个测试文件里有偏长行，可能需要 `format`）；
  tui `oxlint`；根 workspace `pnpm lint`（注意根 typecheck 默认堆会 OOM，需
  `NODE_OPTIONS=--max-old-space-size=8192`，且根 typecheck 不含 apps/zcode-cli）；
  `pnpm architecture:check --changed`（本次一直没跑）。
- ⏳ 桌面/web 侧未跑单测（改动不触及 packages/*，风险低；若要稳妥可跑 packages/ui 的
  zcodeSessionProjection 相关测试——wire 未知态从 200000 变 0，桌面已有 `<=0` 守卫）。
- 未 commit（用户未要求；本 fork 必须走 `cgq0/scripts/ai-commit.sh`）。

## 环境备注（本机 macos01， darwin x64）

- 无 mise；pnpm 经 `corepack enable --install-directory ~/.local/bin` 装好（10.33.2，
  与 packageManager 一致），shim 在 `~/.local/bin`，命令前缀 `PATH="$HOME/.local/bin:$PATH"`。
- turbo 只在外层 monorepo：`/Users/macos01/Work/ZCode/node_modules/.bin/turbo`，
  必须在 `apps/zcode-cli/` 目录下运行（读它的 turbo.json），否则找不到 pnpm binary。
- 外层 `zcode@3.16.2`（桌面版本系），`apps/zcode-cli@0.17.0`（用户实跑的 SEA 版本一致）。

## 后续步骤（按序）

1. `cd apps/zcode-cli/packages/tui && PATH="$HOME/.local/bin:$PATH" pnpm test` —— 跑通新增 3 用例。
2. `cd apps/zcode-cli && PATH="$HOME/.local/bin:$PATH" pnpm format:check`（或外层 oxfmt），
   有格式问题就 `pnpm format` 后复查 diff。
3. `PATH=... turbo run typecheck` 复跑（测试文件改动后）。
4. 外层 `pnpm architecture:check --changed`；`pnpm lint`（大堆内存）。
5. 桌面 `packages/ui` 快速单测（可选）。
6. 用户确认后经 `cgq0/scripts/ai-commit.sh` 提交（消息要点：bugfix + spec 链接 + 根因链 +
   回归验证；PR 描述按 AGENTS.md 模板写触发场景/根因证据/修复机制/回归验证）。
7. 用户实验观察点（未修前行为）：徽标 >100% 后会话照常；auto-compact 阈值 ≈966K；
   若 provider 提前爆 context 错误即测得真实窗口。

## 同批新增的独立问题（未开始）

**zcode-cli 疑似内存泄露**：用户报告越用越卡、内存到 19G。本次只记录未调查（见 TODOs）。
已有线索：主进程 PID 长命（8h+），RSS 在 620-800MB 间波动、VSZ 97GB（虚拟地址空间，
多半是 V8/分配器保留不算实锤）；"19G" 可能是 Activity Monitor 的「内存」列（含压缩/交换）
或某时刻峰值，需要复测。排查切面：长会话 rollout/model-io 累积、v4 eventStore/gateway
缓存、subagent runtime 泄漏（stale provider registry 教训同族）、TUI React 状态
（assistantMessageIdsByToolCallId 等 Map 只增不减？）。机器上 `~/.zcode/cli/log/` 与
rollout 文件可供对照。
