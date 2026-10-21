# Legacy Projection Context Window From ModelSelected Design

## Feature/change summary

CLI legacy 会话投影（contracts `EventReducer`）的 `contextWindow` 只认 `session_created` 事件，
而活跃会话的事件流里没有 `session_created`（该事件只在冷恢复时由 transcript hydration 合成）。
结果投影永远停在 `initialSessionProjection` 的假默认 `200000`：

- CLI TUI 右下角徽标与侧栏的占用百分比分母恒为 200000。实测 GLM-5.3-Flash（注册表窗口 1M）
  会话在 128K 时显示 `64%`、152.2K 时显示 `76%`，真实占用只有 12.8%/15.2%。
- `session-mapper` 把投影默认值经 `currentModelContextWindow` 优先于注册表值写进 session
  settings，把假分母泄漏给协议消费端。
- 运行时执行事实（auto-compact、preflight 输出上限）读的是 `model.properties.contextWindow`，
  不受影响；受害的只有 legacy 投影及其下游显示。

修复方式：让事实经既有事件流入投影。`ModelSelectedPayload.contextWindow`（`session.events.ts`）
与发射链已经存在且被 v4 投影消费（`product-projection.onModelSelected`），本设计把同一事实
接入 legacy 投影，并移除假默认，使「窗口未知」成为合法状态。

## Clarification log

| 日期 | 问题 | 用户裁决 | 固定边界 |
| --- | --- | --- | --- |
| 2026-10-21 | 显示层兜底（方案 A）还是事件化根治（方案 B）？ | 直接做 B | 投影事实必须来自事件，消费端不再各自兜底 |
| 2026-10-21 | 初始投影的 200000 保留吗？ | 移除 | 未知容量是合法状态；显示端在未知时不渲染百分比，不伪造分母 |

## Goals

- contracts `EventReducer` 新增 `model_selected` 处理器，把 payload 的 `contextWindow`
  写入投影，语义与 v4 `onModelSelected` 完全一致：
  - 正数（有限、>0）＝权威窗口，覆盖投影值；
  - `null` ＝显式清除，投影回到未知；
  - 缺失 ＝旧事件/冷恢复合成事件，不覆盖既有事实。
- `initialSessionProjection.contextWindow` 移除 200000 假默认；
  `SessionProjection.contextWindow` 类型改为可选，未知容量表达为缺席。
- TUI `applyModelSelectedEvent` 同步消费 payload 的 `contextWindow`，徽标分母在首轮选型
  事件到达时即更新，而不必等 submitPrompt 结果回填投影。
- 修复杂的会话内切换：切换到不同窗口的模型后，下一次 `model_selected` 直接更新分母。

## Non-goals

- 不改变 `SessionCreatedPayload.contextWindow` 与 `session_created` 处理器；冷恢复
  hydration 的既有语义（`resolveSessionModelContextWindow` 播种）保持不变。
- 不改变 v4 投影（`product-projection`）——它已经按本语义消费该字段。
- 不改变 auto-compact / preflight 的窗口来源（`model.properties.contextWindow`）。
- 不修改协议 schema：`zcodeSessionProjectionSchema.contextWindow` 保持 required
  nonnegative，legacy 快照在未知时写 `0`（桌面端已有 `<= 0` 即未知的守卫）。
- 不在本设计内处理 `session-mapper` `currentModelContextWindow` 的 resume 恢复模型 ≠
  当前选择语义；假默认移除后该路径经 `positiveInteger(undefined) ?? 注册表值` 自然回落，
  行为只会更正确。

## 设计

### 所有权与事件顺序

```text
Provider Registry（model.properties.contextWindow 的唯一事实源）
  → emitModelSelected（steering.ts，统一从 Active Model 读窗口并 append 持久化事件）
      ├─ v4 product-projection.onModelSelected（既有，不动）
      ├─ contracts EventReducer[ModelSelected]（新增，legacy 投影唯一写入点）
      └─ TUI applyModelSelectedEvent（新增消费，仅展示态）
  → 投影消费端：prompt-command（?? null）、session-mapper（?? 0 / 正数守卫）、TUI 徽标/侧栏
```

- 单一写入者：legacy 投影的 `contextWindow` 只由 `session_created`（冷恢复播种）与
  `model_selected`（活跃/切换权威事实）两类事件写入。
- 发射时机即既有事实：`applySubmissionExecutionState`（每轮选型变化时）、v4
  `switchModelConfig` / `applyRequestedSessionConfig`、子代理绑定；发射点已统一填充
  `model.properties.contextWindow`，本设计不新增发射点。
- 幂等与重放：同一事件的重复投递（relay 去重前的竞态）写入同一值；冷恢复合并
  （`TRANSCRIPT_DERIVED_EVENT_TYPES` + `setupModelEventIndexes`）保留权威轮次前最新的
  一条 `model_selected`，缺失 `contextWindow` 的合成事件按「不覆盖」处理。
- 未知容量语义：投影初始与 `null` 清除后均为缺席；首次选型事件到达前，徽标只显示
  已用量、不显示百分比（现状显示错误百分比，属于回归性修正而非 UX 降级）。

### 消费端契约

- `mapSessionProjection`：`contextWindow: projection.contextWindow ?? 0`（wire 非负整数，
  0 = 未知；桌面 `contextUsageFromProjection` 既有 `<= 0` 守卫按未知处理并回落
  runtime.contextUsage）。
- `contextUsageFromProjection` / `contextUsageFromPersistedMessages`：窗口非正整数时返回
  undefined（原 `<= 0` 守卫对 undefined 是 NaN 比较，会放行 undefined 到 `size`）。
- `prompt-command`：`?? null` 保持不变。
- TUI `validContextUsage`：正整数过滤保持不变（0/null/undefined 均被丢弃）。

## 验收场景

1. 新建活跃会话发出首轮输入：`model_selected` 落库后投影 `contextWindow` = 注册表值
   （GLM-5.3-Flash 为 1,000,000）；徽标百分比按 1M 计算（128K → 13%）。
2. 首轮事件到达前：徽标只显示已用量，无百分比；侧栏 window 行显示 `-`。
3. 会话内从 1M 模型切到 200K 模型：下一次 `model_selected` 后分母变为 200K。
4. 冷恢复：hydration 合成的 `model_selected`（无 `contextWindow`）不覆盖已播种窗口；
   resume 后首轮的新 `model_selected` 带真实窗口。
5. 旧事件流回放（payload 无该字段）：投影窗口保持未知，不回退到任何默认值。
6. `--prompt` JSON 输出：未知时 `contextWindow: null`，已知时为真实窗口。

## 回归证据

- contracts `event-reducer.test.ts`：新增 ModelSelected 三态用例 + 初始投影无假默认 +
  切换更新；既有 `session_created` 用例保持不变。
- 受影响包目标单测（contracts / bootstrap mapper / tui）+ `pnpm typecheck` + `pnpm lint`。
