/**
 * macOS 窗口遮挡节流（MacWebContentsOcclusion）启动协调。
 *
 * 背景（spec：docs/desktop/mac-occlusion-throttling.md）：
 * - Electron ≤41.1.x 在 FeatureList 初始化时硬编码把 MacWebContentsOcclusion 加入
 *   disable 列表，且初始化发生在 App JS 之前（PreBrowserMain）；
 * - Chromium 规定同名 feature 同时出现在 enable/disable 列表时一律 disabled，
 *   因此 ≤41.1.x 上 App 内任何手段都无法重新启用；
 * - Electron ≥41.2.0 移除该硬编码，遮挡节流回到 Chromium 默认（启用）。
 *
 * 机制：设置只表达"下次启动期望"。main 在 whenReady 读取 setting.json，发现 argv
 * 与期望不一致时，在创建任何窗口前 relaunch 一次（Electron relaunch 在当前实例
 * 退出后才拉起新实例，天然避开单实例锁竞争）。绝不使用 JS appendSwitch：浏览器
 * 进程的 FeatureList 在 JS 之前已冻结，写它对遮挡检测无效。
 */

export const MAC_OCCLUSION_FEATURE_NAME = "MacWebContentsOcclusion";
/** 我方注入对的身份哨兵：剥离只认哨兵在场，避免误伤用户自己的 feature 参数。 */
export const MAC_OCCLUSION_INJECTED_SENTINEL = "--zcode-mac-occlusion-injected";
export const MAC_OCCLUSION_DISABLE_FEATURES_ARG = `--disable-features=${MAC_OCCLUSION_FEATURE_NAME}`;

const FEATURE_SWITCH_NAMES = new Set(["--enable-features", "--disable-features"]);

export interface MacOcclusionArgsState {
  /** 用户/外部来源的 feature 开关参数（`--switch=value` 与 `--switch value` 两段式都算）。 */
  hasExternalFeatureSwitch: boolean;
  /** 我方注入对（哨兵 + disable 参数）是否在场。 */
  hasInjectedPair: boolean;
}

export function parseMacOcclusionArgsState(args: readonly string[]): MacOcclusionArgsState {
  const hasInjectedPair = args.includes(MAC_OCCLUSION_INJECTED_SENTINEL);
  let hasExternalFeatureSwitch = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === MAC_OCCLUSION_INJECTED_SENTINEL) {
      continue;
    }
    // 我方 disable 参数只有在哨兵在场时才归我方管理；无哨兵时视为用户自带。
    if (hasInjectedPair && arg === MAC_OCCLUSION_DISABLE_FEATURES_ARG) {
      continue;
    }
    const eqIndex = arg.indexOf("=");
    const switchName = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
    if (FEATURE_SWITCH_NAMES.has(switchName)) {
      hasExternalFeatureSwitch = true;
      // 两段式 `--switch value` 的值 token 不参与 switch 名解析。
      if (eqIndex === -1) {
        index += 1;
      }
    }
  }
  return { hasExternalFeatureSwitch, hasInjectedPair };
}

export interface MacOcclusionThrottleRelaunchInput {
  platform: NodeJS.Platform;
  /** setting.json 的 desktopMacOcclusionThrottlingEnabled；undefined 视为缺省 true。 */
  enabled: boolean | undefined;
  /** process.argv（含 argv[0] 可执行路径）。 */
  argv: readonly string[];
}

/**
 * 返回 relaunch 应使用的 args（不含 argv[0]）；无需变更时返回 undefined。
 * 循环安全：判定只依赖 argv 状态，relaunch 后必然命中"已匹配"分支。
 */
export function resolveMacOcclusionThrottleRelaunchArgs(
  input: MacOcclusionThrottleRelaunchInput,
): string[] | undefined {
  if (input.platform !== "darwin") return undefined;
  const enabled = input.enabled ?? true;
  const args = input.argv.slice(1);
  const state = parseMacOcclusionArgsState(args);
  if (enabled && state.hasInjectedPair) {
    // 剥离我方注入对；用户自己的 feature 参数原样保留。
    return args.filter(
      (arg) => arg !== MAC_OCCLUSION_DISABLE_FEATURES_ARG && arg !== MAC_OCCLUSION_INJECTED_SENTINEL,
    );
  }
  if (!enabled && !state.hasInjectedPair && !state.hasExternalFeatureSwitch) {
    // 注入我方参数对；用户自带 feature 参数时不接管，避免改写/吞掉用户开关意图。
    return [...args, MAC_OCCLUSION_DISABLE_FEATURES_ARG, MAC_OCCLUSION_INJECTED_SENTINEL];
  }
  return undefined;
}
