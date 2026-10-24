# macOS 窗口遮挡节流设置（desktopMacOcclusionThrottlingEnabled）

## 背景

Electron ≤41.1.x 在浏览器进程 FeatureList 初始化时硬编码禁用 macOS 窗口遮挡检测：
`shell/browser/feature_list.cc` 的 macOS 分支无条件把 `MacWebContentsOcclusion` 追加进
`--disable-features` 串（上游注释原话 "causing some odd visibility issues with multiple
web contents"——Chromium 遮挡检测按"一窗口一网页"设计，Electron 单窗口叠多个
WebContents 会误报可见性，宁可放弃"被遮挡就节流"）。两个关键事实决定了 App 侧的
可调节空间：

1. **初始化时机**：FeatureList 在 `PreBrowserMain`（App JS 运行之前）冻结，JS 里的
   `app.commandLine.appendSwitch` 改不动浏览器进程。
2. **合并规则**：Chromium `base/feature_list.h` 规定同名 feature 同时出现在
   enable 与 disable 列表时**一律 disabled**，因此即使把参数写进进程命令行也无法
   在 ≤41.1.x 上重新启用。

Electron PR #50579（2026-03-30 合入，回移 41-x-y）修复可见性根因并删除该硬编码，
落在 **v41.2.0**（41.1.1 仍有、41.2.0 已清零）。本仓库 `packages/desktop/package.json`
的 Electron pin 由 41.0.3 升至 41.2.0 后，遮挡节流回到 Chromium 默认（启用）。

实测取证（2026-10-24，macOS 15.7.9 Intel x64，官方构建 3.16.3 / Electron 41.0.3）：

- 流式输出期间：Renderer 瞬时 47%→55%、GPU 进程 62%→82%；GPU 主线程 37% 样本在
  Intel 驱动编码 Metal 渲染命令（海量小 draw call + IOSurface 绑定）。
- 窗口不被 WindowServer 合成（截屏仅桌面壁纸）时二者照烧，且流式结束后"转圈圈"
  等待态仍有 GPU 46.7% / Renderer 27.4%——occlusion 被禁导致 Chromium 对"没人看"
  完全无感。最小化走的是原生 miniaturize 通知路径，与 occlusion 无关，所以用户
  观察到"最小化后 CPU 回落、其他不可见场景不回落"。

## 版本矩阵

| Electron | MacWebContentsOcclusion | 设置效果 |
| -------- | ----------------------- | -------- |
| ≤41.1.1  | FeatureList 硬编码禁用 | 开关无效（无法重新启用）；本次已随 pin 升级脱离此区间 |
| ≥41.2.0  | Chromium 默认启用       | 开关真实生效：开=默认行为；关=注入 disable 参数 |

## 设置语义与状态所有者

- 字段：`desktopMacOcclusionThrottlingEnabled: boolean`，默认 `true`（跟随上游
  Electron ≥41.2.0 默认；未动过设置的用户零感知、零额外重启）。
- **唯一事实**：`~/.zcode/v2/setting.json`。main 进程的进程参数是派生状态，仅由
  启动协调写入（见下）。设置页保存后不做 `platform.syncAppSettings`——本设置只在
  下次启动由 main 读取生效，与 `desktopChromiumHardwareAccelerationEnabled` 同模式。
- 桌面专属、macOS 专属：Windows 的遮挡检测是另一个 feature
  （`CalculateNativeWinOcclusion`，默认启用），不在本设置范围内。

## 启动协调（argv 与期望对齐）

```text
main whenReady（darwin、持有单实例锁、任何窗口创建之前）
  → 读 setting.json → 期望 = desktopMacOcclusionThrottlingEnabled（缺省 true）
  → 扫描 process.argv（跳过 argv[0]）：
      哨兵 --zcode-mac-occlusion-injected 在场？──是──> 我方上次注入生效中
      │                                              ├ 期望 true  → 剥离参数对 → relaunch
      │                                              └ 期望 false → 直接启动（已匹配）
      └──否
           argv 已有 --enable-features / --disable-features（两段式也算）？
           ──是──> 用户/外部所有，不接管，直接启动
           ──否──> 期望 true  → 直接启动（Chromium 默认）
                   期望 false → 注入参数对 → relaunch
  参数对 = --disable-features=MacWebContentsOcclusion + --zcode-mac-occlusion-injected
  relaunch = prepareAppQuit("settings-mac-occlusion-relaunch")
             + app.relaunch({ args }) + app.quit()
```

不变量与边界：

- **循环安全**：协调仅由"argv 状态 ≠ 期望"触发；relaunch 后必然匹配，每次状态
  变更至多一次 bounce（发生在窗口创建前，不闪窗）。
- **单实例锁**：Electron `app.relaunch` 在当前实例退出后才拉起新实例，天然避开
  `requestSingleInstanceLock` 竞争。
- **参数所有权**：argv 中存在我方哨兵时才允许剥离，且只剥离我方精确 token；
  用户自带 feature 参数（含 `--disable-features=MacWebContentsOcclusion` 裸用）
  一律不接管、不合并、不改写。
- **失败降级**：设置读取失败或协调抛错只 `logger.warn`，按当前 argv 直接启动；
  绝不阻断启动。
- 协调不使用 JS `appendSwitch`：浏览器进程 FeatureList 在 JS 之前已冻结（背景 1），
  写它对 macOS 遮挡检测无效。

## 已知权衡

- 窗口被完全遮挡时 renderer 停止产帧：**手机远控在桌面窗口被完全盖住时可能收不到
  新帧**（截图路径有 activity lease 临时唤醒，连续推流链路待实测）。这正是设置
  可关的原因；关闭后回到"持续渲染"行为。
- occlusion 只治理"不可见还在烧"；**前台可见时的高渲染成本是独立问题**（流光文字
  等每帧重绘动画逼出全窗口重合成），由前台渲染成本治理项跟进，不在本设置范围。

## 验收场景

1. 默认（未动设置）启动：argv 无注入参数对；Electron ≥41.2.0 下被完全遮挡的窗口
   CPU 回落（`top` 瞬时对比）。
2. 设置关 → 重启 → helper 命令行含 `--disable-features=MacWebContentsOcclusion` 与
   哨兵；遮挡不降载（回到旧行为）。
3. 设置开（从关切换）→ 重启 → 一次静默 relaunch 后参数对消失，此后启动零 bounce。
4. 用户自带 `--enable-features=X` 启动 + 设置关：参数不被吞（`X` 仍生效），不注入。
5. 非 darwin 平台：协调恒 no-op，设置行不渲染。
6. 官方构建共享同一 `setting.json`：未知字段被其 schema 剥离（非 strict），官方侧
   无感知；fork 侧字段在 fork 写入时恢复。
