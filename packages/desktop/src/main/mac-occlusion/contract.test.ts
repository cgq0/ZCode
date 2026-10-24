import { describe, expect, it } from "vitest";
import {
  MAC_OCCLUSION_DISABLE_FEATURES_ARG,
  MAC_OCCLUSION_INJECTED_SENTINEL,
  parseMacOcclusionArgsState,
  resolveMacOcclusionThrottleRelaunchArgs,
} from "./contract.js";

const EXEC = "/Applications/ZCode.app/Contents/MacOS/ZCode";

describe("parseMacOcclusionArgsState", () => {
  it("哨兵 + 我方 disable 参数识别为注入对", () => {
    expect(
      parseMacOcclusionArgsState([
        MAC_OCCLUSION_DISABLE_FEATURES_ARG,
        MAC_OCCLUSION_INJECTED_SENTINEL,
      ]),
    ).toEqual({ hasExternalFeatureSwitch: false, hasInjectedPair: true });
  });

  it("单独的 disable=MacWebContentsOcclusion 视为用户自带（外部参数、非注入对）", () => {
    expect(parseMacOcclusionArgsState([MAC_OCCLUSION_DISABLE_FEATURES_ARG])).toEqual({
      hasExternalFeatureSwitch: true,
      hasInjectedPair: false,
    });
  });

  it("enable/disable-features 等号与两段式都算外部参数，两段式跳过值 token", () => {
    expect(parseMacOcclusionArgsState(["--enable-features=A,B"])).toEqual({
      hasExternalFeatureSwitch: true,
      hasInjectedPair: false,
    });
    expect(parseMacOcclusionArgsState(["--disable-features", "X"])).toEqual({
      hasExternalFeatureSwitch: true,
      hasInjectedPair: false,
    });
    expect(parseMacOcclusionArgsState(["--disable-features"])).toEqual({
      hasExternalFeatureSwitch: true,
      hasInjectedPair: false,
    });
    // 两段式的值 token 不应被误解析为下一个 switch 名。
    expect(parseMacOcclusionArgsState(["--enable-features", "--disable-features"])).toEqual({
      hasExternalFeatureSwitch: true,
      hasInjectedPair: false,
    });
  });

  it("不相关的 switch 不触发外部参数判定", () => {
    expect(parseMacOcclusionArgsState(["--remote-debugging-port=9229", "--foo"])).toEqual({
      hasExternalFeatureSwitch: false,
      hasInjectedPair: false,
    });
  });
});

describe("resolveMacOcclusionThrottleRelaunchArgs", () => {
  it("非 darwin 平台恒 no-op", () => {
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "win32",
        isPackaged: true,
        enabled: false,
        argv: [EXEC],
      }),
    ).toBeUndefined();
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "linux",
        isPackaged: true,
        enabled: false,
        argv: [EXEC],
      }),
    ).toBeUndefined();
  });

  it("dev（未打包）恒 no-op：watch 组拥有进程生命周期，应用自 relaunch 会拆掉开发会话", () => {
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "darwin",
        isPackaged: false,
        enabled: false,
        argv: [EXEC],
      }),
    ).toBeUndefined();
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "darwin",
        isPackaged: false,
        enabled: true,
        argv: [EXEC, MAC_OCCLUSION_DISABLE_FEATURES_ARG, MAC_OCCLUSION_INJECTED_SENTINEL],
      }),
    ).toBeUndefined();
  });

  it("缺省/true 且无注入对：直接启动（Chromium 默认），零 bounce", () => {
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "darwin",
        isPackaged: true,
        enabled: undefined,
        argv: [EXEC],
      }),
    ).toBeUndefined();
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "darwin",
        isPackaged: true,
        enabled: true,
        argv: [EXEC],
      }),
    ).toBeUndefined();
  });

  it("false 注入参数对到 argv 末尾", () => {
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "darwin",
        isPackaged: true,
        enabled: false,
        argv: [EXEC, "--some-flag"],
      }),
    ).toEqual(["--some-flag", MAC_OCCLUSION_DISABLE_FEATURES_ARG, MAC_OCCLUSION_INJECTED_SENTINEL]);
  });

  it("false 且注入对已在场：已匹配，不再 relaunch（循环安全）", () => {
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "darwin",
        isPackaged: true,
        enabled: false,
        argv: [EXEC, MAC_OCCLUSION_DISABLE_FEATURES_ARG, MAC_OCCLUSION_INJECTED_SENTINEL],
      }),
    ).toBeUndefined();
  });

  it("true 且注入对在场：剥离我方参数对", () => {
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "darwin",
        isPackaged: true,
        enabled: true,
        argv: [EXEC, MAC_OCCLUSION_DISABLE_FEATURES_ARG, MAC_OCCLUSION_INJECTED_SENTINEL],
      }),
    ).toEqual([]);
  });

  it("用户自带 feature 参数 + 无哨兵：不接管（即使与期望不一致）", () => {
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "darwin",
        isPackaged: true,
        enabled: false,
        argv: [EXEC, "--enable-features=SomeThing"],
      }),
    ).toBeUndefined();
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "darwin",
        isPackaged: true,
        enabled: false,
        argv: [EXEC, MAC_OCCLUSION_DISABLE_FEATURES_ARG],
      }),
    ).toBeUndefined();
  });

  it("哨兵在场时剥离只移除我方 token，保留用户 feature 参数", () => {
    expect(
      resolveMacOcclusionThrottleRelaunchArgs({
        platform: "darwin",
        isPackaged: true,
        enabled: true,
        argv: [
          EXEC,
          "--enable-features=SomeThing",
          MAC_OCCLUSION_DISABLE_FEATURES_ARG,
          MAC_OCCLUSION_INJECTED_SENTINEL,
        ],
      }),
    ).toEqual(["--enable-features=SomeThing"]);
  });
});
