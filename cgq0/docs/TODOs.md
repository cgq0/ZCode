# TODOs

> 一行一条 + 指针；做完移入对应 diary/plan 留档后删行。规则见 [../README.md](../README.md)。

- [ ] 验证 CI 产物 `ZCode.fork.app`（蓝底图标）在 mac 上与官方并排安装：互不覆盖、图标区分、退一切换、Dock 16px 辨识度——见 diary/2026-10-25.lin.md 09:47
- [ ] 常备：CI 突然零触发（push 落库但无 run、API 全绿）= GitHub 静默禁了 fork Actions，去 Actions 页横幅手动 enable，再手动 dispatch release——见 diary/2026-10-25.lin.md 10:45
- [ ] 删旧 Release `zcode-cli-v3.16.2`（新三产物 Release `v3.16.2` 已接棒，cq 基线已切到新 tag）——见 diary/2026-10-24.mac.md 22:20
- [ ] 验证打包版开关"关→重启→注入对+哨兵"（可选，机制已在 dev 日志证明）——见 diary/2026-10-24.mac.md 19:40
- [ ] 判定 B2：打包版前台安静"转圈圈"态 GPU 对比 46.7% 基线（目标 <15%）；未达标用 dev CDP 9229 trace 归因（含进度条 left→transform 候选）——见 docs/ui/foreground-animation-paint-budget.md 与 diary/2026-10-24.mac.md
- [ ] 长期使用前重打 production 身份安装包（当前 dist 包是 preview 身份，走 preview 更新通道，勿长留）——见 diary/2026-10-24.mac.md 19:45
- [ ] 试用期观察三处：扫光步进感可接受性（回退=styles.css 三处 steps 改回 linear）、手机远控在窗口被完全遮挡时是否收得到帧、preview 自动更新是否替换测试包——见 docs/ui/foreground-animation-paint-budget.md 与 docs/desktop/mac-occlusion-throttling.md
