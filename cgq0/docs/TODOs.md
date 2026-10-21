# TODOs

> 一行一条 + 指针；做完移入对应 diary/plan 留档后删行。规则见 [../README.md](../README.md)。

- [ ] 搭建 GitHub Actions：sync-upstream（定时合并上游）+ release-cli（ubuntu/windows/macos 三 runner 矩阵构建 SEA 单文件并自动发 Release）——方案与仓库事实见 diary/2026-10-20.mac.md
- [ ] 环境就绪检查：本机装 mise 并 `mise install`，对齐 node 24.14.0 + pnpm 10.33.2（当前 node 24.18.0，满足 engines >=24 但与 mise 基线有偏差）
- [ ] 调查 zcode-cli 疑似内存泄露（截图实锤 PID 30091 footprint 21.6GB + 系统 swap 5.74GB，GB 级泄漏确认；排除 SEA 堆旗标/jsqlite mmap 后矛头指向堆外内存；静态扫不出唯一真凶，待活体取证）——协议与工具见 diary/2026-10-21.mac.md 09:08 条目 + cgq0/tmp/mem-watch.sh、heap-snapshot.mjs；显示层两缺陷已修（highlightCache LRU 上界 + MessageRow memo，见 12:40 条目，commit 87a2c2c4）
- [ ] 验证 BigModel 对 GLM-5.3-Flash 是否真给 1M 窗口：长会话跑过 ~966K 观察 auto-compact 或提前爆 context 错误——背景见 diary/2026-10-20.mac.md 与 spec
