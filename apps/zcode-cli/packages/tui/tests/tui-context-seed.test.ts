import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@mbears/opentui-react/test-utils";
import type { SessionEvent } from "@zcode/contracts";
import { TuiApp } from "../src/app.js";
import type { TuiOptions } from "../src/types.js";

function createOptions(overrides: Partial<TuiOptions>): TuiOptions {
  return {
    noColor: true,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    submitPrompt: async () => ({ response: "done" }),
    ...overrides,
  };
}

async function renderTuiApp(options: TuiOptions) {
  let view: Awaited<ReturnType<typeof testRender>> | undefined;
  await act(async () => {
    view = await testRender(
      React.createElement(TuiApp, {
        copySelection: async () => ({ kind: "empty" }),
        hasCopyableSelection: () => false,
        onExit: () => undefined,
        options,
      }),
      {
        exitOnCtrlC: false,
        height: 24,
        kittyKeyboard: true,
        otherModifiersMode: true,
        width: 100,
      },
    );
    await view.renderOnce();
  });
  return view!;
}

// startup 元数据 → TuiApp options.contextUsage → 首帧 useState 播种，无需等首轮响应。
test("startup options seed the context badge on the first frame", async () => {
  const view = await renderTuiApp(
    createOptions({
      contextUsage: { contextUsed: 152_200, contextWindow: 1_000_000 },
    }),
  );

  try {
    await view.waitFor(() => view.captureCharFrame().includes("152.2K (15%)"));
  } finally {
    await act(async () => {
      view.renderer.destroy();
    });
  }
});

// /new 式结果：reset 清场与 projection 播种在同一条 result 上，先清后种，seed 必须存活。
test("a reset result keeps its same-result projection seed", async () => {
  let view: Awaited<ReturnType<typeof testRender>> | undefined;
  const options = createOptions({
    contextUsage: { contextUsed: 152_200, contextWindow: 1_000_000 },
    submitPrompt: async () => ({
      response: "Started new session",
      resetSessionProjection: true,
      projection: { contextUsed: 0, contextWindow: 1_000_000 },
    }),
  });

  try {
    view = await renderTuiApp(options);
    await view.waitFor(() => view.captureCharFrame().includes("152.2K (15%)"));

    await act(async () => {
      await view.mockInput.typeText("hi");
      await Promise.resolve();
      await view.renderOnce();
      view.mockInput.pressEnter();
      await Promise.resolve();
      await view.renderOnce();
    });

    await view.waitFor(() => view.captureCharFrame().includes("0 (0%)"));
    assert.equal(view.captureCharFrame().includes("152.2K"), false);
  } finally {
    await act(async () => {
      view?.renderer.destroy();
    });
  }
});

// 播种只管首帧：model_selected 事件（权威通道）到达后照常覆盖分母。
test("model_selected events override the seeded context window", async () => {
  let sink: ((event: SessionEvent) => void) | undefined;
  const view = await renderTuiApp(
    createOptions({
      contextUsage: { contextUsed: 250_000, contextWindow: 1_000_000 },
      subscribeSessionEvents: (received) => {
        sink = received;
        return () => undefined;
      },
    }),
  );

  try {
    await view.waitFor(() => view.captureCharFrame().includes("250K (25%)"));

    await act(async () => {
      sink?.({
        payload: {
          contextWindow: 500_000,
          modelSelection: { modelId: "beta", providerId: "acme" },
        },
        sessionId: "main",
        type: "model_selected",
      } as never);
      await view.renderOnce();
    });

    await view.waitFor(() => view.captureCharFrame().includes("250K (50%)"));
    assert.equal(view.captureCharFrame().includes("250K (25%)"), false);
  } finally {
    await act(async () => {
      view.renderer.destroy();
    });
  }
});
