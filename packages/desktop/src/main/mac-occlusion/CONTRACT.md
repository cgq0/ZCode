# desktop-mac-occlusion

macOS 窗口遮挡节流（`MacWebContentsOcclusion`）的启动参数协调纯函数。完整背景与
事件顺序见 `docs/desktop/mac-occlusion-throttling.md`；本模块只做 argv 判定与
relaunch args 构造，不读设置文件、不触碰 Electron API（由调用方 `main/index.ts`
在 whenReady 内执行 relaunch）。

不变量：

- 判定只依赖入参（platform / enabled / argv），纯函数、无 IO、无副作用；同一输入
  恒得同一输出，relaunch 后必然命中"已匹配"分支，天然无启动循环。
- 剥离只认我方哨兵 `--zcode-mac-occlusion-injected` 在场时的精确 token；用户自带
  的 `--enable-features` / `--disable-features`（含裸用
  `--disable-features=MacWebContentsOcclusion`）一律不接管、不改写、不吞并。
- 非 darwin 平台恒 no-op；`enabled` 缺省按 true 解释（跟随 Chromium 默认）。

与其它模块的交集：`packages/shared` 的 `desktopMacOcclusionThrottlingEnabled`
设置字段提供 `enabled` 入参；main 进程负责持久化与窗口生命周期，本模块不感知。
