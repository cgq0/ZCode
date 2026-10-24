# 前台动画绘制预算（foreground animation paint budget）

## 问题

实测（2026-10-24，Intel x64 iGPU，2560x1600；测量记录见
`cgq0/docs/diary/2026-10-24.mac.md`）：ZCode 桌面前台"几行字 + 转圈圈"的等待态
GPU 进程 46.7%、Renderer 27.4%；GPU 主线程 37% 样本在显卡驱动里编码海量小
draw call。根因是**常驻扫光动画逼出每帧重绘 + 60fps 全窗口重合成**：

- `background-clip: text` 流光文字动画的是 `background-position`——**非合成器
  友好属性**，每个渲染帧都要重绘文字；
- 工具 indeterminate 扫光动画的是 `left`——布局属性，比重绘更贵；
- 任一常驻动画都会让合成器持续产帧，弱 iGPU 上整窗重合成本身就是主要成本。

窗口不可见场景由 `desktopMacOcclusionThrottlingEnabled`
（`docs/desktop/mac-occlusion-throttling.md`）治理；本文管**前台可见**时的动画
绘制成本。

## 政策

1. **连续动画的重绘频率与循环时长无关**：把 4s 改 8s 不省任何重绘；降低重绘
   频率只有两条路——`steps()` 离散跳变，或停用动画。循环时长、缓动曲线都不改变
   每渲染帧一次重绘的事实。
2. 扫光类动画（流光文字、indeterminate 进度条）默认使用 `steps()` 节奏：
   - `.animated-gradient-text`（`gradient-flow 4s`）：`steps(20)` ≈ 5 次重绘/秒
     （原 ~60）；
   - `.cua-group-gradient-text`（`cua-group-gradient-flow 1s`）：`steps(8)` ≈ 8 次/秒；
   - `.tool-call-progress-indeterminate`（1.2s）：`steps(12)` ≈ 10 次/秒。
   恢复平滑只需把 `steps(N)` 换回 `linear`/`ease-in-out`，代价是重绘回到每帧。
3. 后续候选（验证轮按证据决定）：indeterminate 扫光从 `left` 改为
   `transform: translateX()`（合成器友好，可完全脱离重绘路径）——需先确认
   `ToolCallProgressIndicator` 的几何（轨道宽与条宽比例），盲改有视觉回归风险。
4. 新增常驻动画时默认选择合成器友好属性（transform/opacity/filter）；确需逐帧
   重绘的（background-position、left/top/width）必须 `steps()` 化并在本文件登记。

## 边界

- 转圈圈 spinner（`animate-spin`，transform rotate）是合成器动画，不重绘，
  保留——等待态必须有可感知反馈；它仍迫使合成器 60fps 产帧，这是等待态的
  残余成本下限。
- `markdown-image-loading-shimmer`、`zcode-alarm-ring` 等仅在瞬时状态出现的
  动画未降频。
- 本政策不改任何视觉 token / 颜色；只改时间离散度。

## 验收

- 合并 occlusion 工作流后统一冒烟：前台安静"转圈圈"态 GPU 进程 CPU 相对 46.7%
  基线明显下降（目标 <15%，含合成器残余）；流式态同步观察。
- 流光/扫光在 steps 节奏下目测可接受（轻微步进感属预期，不做插值补偿）。
