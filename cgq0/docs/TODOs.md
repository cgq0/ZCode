# TODOs

> 一行一条 + 指针；做完移入对应 diary/plan 留档后删行。规则见 [../README.md](../README.md)。

- [ ] 观察(sync-upstream 已跑 2 次 no-op success)：上游真有新提交时的两条未验证分支路径——merged 端到端（自动 push main + dispatch release-cli）与 conflict 自动开 issue；调度惯常延迟 2-3h，某日 05:17 未跑先等到 08:00 再查——事实见 diary/2026-10-23.mac.md
- [ ] 推送重写后的 dev：4 个 commit trailer 已改为 zcode/0.17.0（本地链 ff0e80f9..6a7ff102，树与旧链一致），force-push 被 affected 选中存量 relay 失败挡住（45629cc7 触碰 shared 必然卷入），待裁决 `--no-verify`——分析见 diary/2026-10-23.mac.md
