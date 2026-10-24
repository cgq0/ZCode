# TODOs

> 一行一条 + 指针；做完移入对应 diary/plan 留档后删行。规则见 [../README.md](../README.md)。

- [ ] 观察(sync-upstream 已跑 2 次 no-op success)：上游真有新提交时的两条未验证分支路径——merged 端到端（自动 push main + dispatch release-cli）与 conflict 自动开 issue；调度惯常延迟 2-3h，某日 05:17 未跑先等到 08:00 再查——事实见 diary/2026-10-23.mac.md
- [ ] 验证打包版开关"关→重启→注入对+哨兵"（可选，机制已在 dev 日志证明）——见 diary/2026-10-24.mac.md 19:40
- [ ] 判定 B2：打包版前台安静"转圈圈"态 GPU 对比 46.7% 基线（目标 <15%）；未达标用 dev CDP 9229 trace 归因（含进度条 left→transform 候选）——见 docs/ui/foreground-animation-paint-budget.md 与 diary/2026-10-24.mac.md
- [ ] 长期使用前重打 production 身份安装包（当前 dist 包是 preview 身份，走 preview 更新通道，勿长留）——见 diary/2026-10-24.mac.md 19:45
- [ ] 试用期观察三处：扫光步进感可接受性（回退=styles.css 三处 steps 改回 linear）、手机远控在窗口被完全遮挡时是否收得到帧、preview 自动更新是否替换测试包——见 docs/ui/foreground-animation-paint-budget.md 与 docs/desktop/mac-occlusion-throttling.md
