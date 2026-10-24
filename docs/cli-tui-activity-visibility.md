# CLI TUI 活动可见性：后台任务指示、thinking 动效、滚动快捷键

CLI TUI 三个易用性行为的合同。背景：后台任务挂起后 TUI 无常驻指示，`/exit`
无条件放行且 runtime shutdown 会 abort 全部后台任务，用户误判完成而退出即静默
杀任务；thinking 状态文本三点静止无法判断活性；主转写 scrollbox 不持有焦点，
键盘无法滚动主转写。

## 后台任务可见性

### 数据源与所有权

- **唯一事实源**：runtime `getProjection().backgroundTasks`（`BackgroundTaskInfo`，
  含 taskId/taskKind/command/description/status/startedAt）。TUI 不自建账本，
  只做「查询 + 事件触发刷新」，计数 = `status === "running"` 条数。
- bootstrap `ZCodeApp` 新增同步查询 `listBackgroundTasks(): BackgroundTaskInfo[]`，
  实现直读投影（与 `getContextUsage` 同法），running 优先、其余按 startedAt 倒序。
  不改 `ExecutionPort`，不新增协议命令。
- CLI → TUI 沿 `attachTuiAppQueries` 既有转发模式挂到 `TuiOptions`；查询缺失
  （旧 handler / 测试桩）时 hook 静默降级为不显示，不报错。

### 刷新语义

- `useBackgroundTasks` 初始读一次 + `SessionResumed` 重读；`BackgroundTaskStarted/
  Updated/Completed` 会话事件触发合并刷新（coalesced，同 `useSubagents`
  refreshDirectory 节流模式）。事件只当触发器，计数永远以查询结果为准——
  事件丢失不漂移，确认时重读防 stale。
- 指示行只在 running > 0 时渲染，busy 态不消失（痛点场景正是「回合已结束、
  后台还在跑」）。

### 指示行与 /tasks

- 指示行位于输入区上方（ApprovalPanel/SelectionPanel 分支优先，面板出现时
  指示行让位），文案 i18n（en/zh），附 `/tasks` 指引与最长任务耗时（分钟粒度）。
- `/tasks` 为只读命令：解析分支 + shared 帮助条目 + 处理器，列出状态符号、
  taskId 短码、kind、耗时、command/description 截断；running 优先。
  `/tasks cancel <id>` 复用既有 `app.cancelBackgroundTask`（当前仅桌面 v4 协议
  在用），结果以 `BackgroundTaskCancelResult` 回显。

### 退出拦截（二次确认）

- `/exit` 汇点在 TUI `useTuiApplyResult`：`exit === true` 且 running > 0 且无
  窗口内首次确认 → setStatus 警告（含当时 running 数）+ 记时间戳，不退出；
  `CTRL_C_EXIT_CONFIRMATION_WINDOW_MS`（2s）内再次 /exit → 放行。确认时重读
  running 数，任务已清零则直接放行。
- Ctrl+C 双击守卫流程不变；running > 0 时首按文案改为「N 个后台任务将终止」
  版本。守卫纯函数与 `resolveCtrlCExitIntent` 同构共用，时间源注入可测。
- 有界 shutdown 语义不变：任何路径的真退出仍走既有 abort + 杀树；拦截只发生在
  TUI 意图层，不新增 runtime 状态。

## thinking 点动画

- `app-motion.tsx` 新增纯函数 `thinkingDotsFrame(frameMs)`（"." → ".." → "..."，
  400ms 步进，`Date.now()` 推导可注入）与 `useThinkingDots(animated)`（interval
  仅 animated 时存在，卸载清理，同 `useSpinnerFrame` 模式）。
- 渲染点仅侧栏状态行：busy 时剥掉状态文本尾部省略号、接动态点。zh-CN 同路径
  生效。转写流式 thought 占位符**保持静态**（每行内容不做动画，避免多行 timer
  破坏 MemoizedMessageRow 渲染预算）。

## 滚动快捷键

- 绑定层行为：常规（非 readOnly）模式下 `end` + ctrl/meta/option → 主转写
  `scrollBy(1, "content")` 滚底；`home` + 同修饰键 → `scrollBy(-1, "content")`
  置顶；消费键（preventDefault + stopPropagation）。解析层零改动
  （`ESC[1;5F`/`ESC[1;3F` 及 kitty、modifyOtherKeys 形态均已解码）。
- scrollbox 实例经 React ref 从 TuiApp 线程到 ContentPane；滚底即恢复
  stickyScroll 跟随（ScrollBox 既有行为）。
- readOnly（子代理视图）不接：现有 fall-through 让这些键直达子代理 scrollbox，
  其按键处理只匹配 `key.name`，修饰键组合天然生效。
- 普通 End/Home（无修饰键）行为不变（composer 光标移动）。

## 验收场景

1. 挂 `run_in_background` 长任务 → 回合结束后输入框上方出现指示行，计数/耗时正确；
   `/tasks` 列出该任务；任务结束后指示行消失。
2. running > 0 时 `/exit` → 出警告不退出；2s 内再次 `/exit` → 退出；等任务完成后再
   `/exit` → 一次即退。Ctrl+C 双击文案含后台任务警示。
3. busy 期间侧栏状态行点数循环可见变化（400ms 步进），空闲无 timer。
4. 常规模式 Ctrl+End/Option+End 滚底并恢复跟随，Ctrl+Home 置顶；子代理视图内
   Ctrl+End 滚子代理转写；composer 内普通 End 光标到行尾不变。
