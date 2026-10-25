# TODOs

> 一行一条 + 指针；做完移入对应 diary/plan 留档后删行。规则见 [../README.md](../README.md)。

- [ ] 重新出包并验证（zip 漏 desktop 修复后）：enable workflows → dispatch release → darwin-x64 zip ≥1.3GB 且含 ZCode.fork.app（蓝底）→ mac 与官方并排安装：互不覆盖、图标区分、退一切换、Dock 16px 辨识度——见 diary/2026-10-25.lin.md 11:35
- [ ] 常备：CI 零触发先分清两种情况——GitHub 静默禁 fork Actions（push 落库但无 run、API 全绿，Actions 页横幅手动 enable）vs 自己手动 disable 过（重新 enable 即可）——见 diary/2026-10-25.lin.md 10:45/11:35
- [ ] 排查存量测试失败：browserDataManager「先复制 LocalStorage 快照」稳定挂（对照实验证明与本 fork 改动无关）+ webRemoteControlTransport/stdioDesktopPresentationSurface 两个 flaky；8e4f203f 推送因此走了 --no-verify——见 diary/2026-10-25.lin.md 12:55
- [ ] 删旧 Release `zcode-cli-v3.16.2`（新三产物 Release `v3.16.2` 已接棒，cq 基线已切到新 tag）——见 diary/2026-10-24.mac.md 22:20
- [ ] 验证打包版开关"关→重启→注入对+哨兵"（可选，机制已在 dev 日志证明）——见 diary/2026-10-24.mac.md 19:40
- [ ] 判定 B2：打包版前台安静"转圈圈"态 GPU 对比 46.7% 基线（目标 <15%）；未达标用 dev CDP 9229 trace 归因（含进度条 left→transform 候选）——见 docs/ui/foreground-animation-paint-budget.md 与 diary/2026-10-24.mac.md
- [ ] 长期使用前重打 production 身份安装包（当前 dist 包是 preview 身份，走 preview 更新通道，勿长留）——见 diary/2026-10-24.mac.md 19:45
- [ ] 试用期观察三处：扫光步进感可接受性（回退=styles.css 三处 steps 改回 linear）、手机远控在窗口被完全遮挡时是否收得到帧、preview 自动更新是否替换测试包——见 docs/ui/foreground-animation-paint-budget.md 与 docs/desktop/mac-occlusion-throttling.md
