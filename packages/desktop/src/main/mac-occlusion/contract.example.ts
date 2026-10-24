/**
 * desktop-mac-occlusion 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import { resolveMacOcclusionThrottleRelaunchArgs } from "./contract.js";

/**
 * main 进程 whenReady 内的典型调用：设置读取失败或非 darwin 都拿到 undefined，
 * 只有 argv 与期望不一致时才 relaunch（args 不含 argv[0]，直接交给 app.relaunch）。
 */
export function exampleDesktopMacOcclusionLaunch(): void {
  const relaunchArgs = resolveMacOcclusionThrottleRelaunchArgs({
    platform: process.platform,
    enabled: true,
    argv: process.argv,
  });
  if (relaunchArgs) {
    // 调用方负责 prepareAppQuit + app.relaunch({ args: relaunchArgs }) + app.quit()。
  }
}
