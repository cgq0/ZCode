# TODOs

> 一行一条 + 指针；做完移入对应 diary/plan 留档后删行。规则见 [../README.md](../README.md)。

- [ ] 搭建 GitHub Actions：sync-upstream（定时合并上游）+ release-cli（ubuntu/windows/macos 三 runner 矩阵构建 SEA 单文件并自动发 Release）——方案与仓库事实见 diary/2026-10-20.mac.md
- [ ] 环境就绪检查：本机装 mise 并 `mise install`，对齐 node 24.14.0 + pnpm 10.33.2（当前 node 24.18.0，满足 engines >=24 但与 mise 基线有偏差）
- [ ] 调查 zcode-cli 疑似内存泄露（用户报 19G、越用越卡；快照 RSS 623MB/VSZ 97GB 未定性）——排查切面见 plan/2026-10-21-01-planb-context-window-handoff.md 末节
- [ ] 验证 BigModel 对 GLM-5.3-Flash 是否真给 1M 窗口：长会话跑过 ~966K 观察 auto-compact 或提前爆 context 错误——背景见 diary/2026-10-20.mac.md 与 spec
