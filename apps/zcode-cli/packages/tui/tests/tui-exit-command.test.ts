import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@mbears/opentui-react/test-utils";
import { TuiApp } from "../src/app.js";
import type { TuiOptions, TuiPromptInput } from "../src/types.js";

test("/exit submit result exits the idle TUI with code 0", async () => {
  const exitCodes: number[] = [];
  const submitted: TuiPromptInput[] = [];
  let view: Awaited<ReturnType<typeof testRender>> | undefined;

  const options: TuiOptions = {
    noColor: true,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    submitPrompt: async (input) => {
      submitted.push(input);
      return { response: "Exiting ZCode CLI.", exit: true };
    },
  };

  await act(async () => {
    view = await testRender(
      React.createElement(TuiApp, {
        copySelection: async () => ({ kind: "empty" }),
        hasCopyableSelection: () => false,
        onExit: (code) => {
          exitCodes.push(code);
        },
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

  try {
    await act(async () => {
      assert.ok(view);
      await view.mockInput.typeText("/exit");
      await Promise.resolve();
      await view.renderOnce();
    });

    await act(async () => {
      assert.ok(view);
      view.mockInput.pressEnter();
      await Promise.resolve();
      await view.renderOnce();
    });

    assert.deepEqual(submitted, ["/exit"]);
    assert.deepEqual(exitCodes, [0]);
  } finally {
    await act(async () => {
      view?.renderer.destroy();
    });
  }
});

test("busy /exit aborts the active turn before exiting with code 0", async () => {
  const exitCodes: number[] = [];
  let sendInputSignal: AbortSignal | undefined;
  let view: Awaited<ReturnType<typeof testRender>> | undefined;

  const options: TuiOptions = {
    noColor: true,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    // 第一轮永不返回，让 TUI 停在 busy 态。
    submitPrompt: async () => new Promise(() => {}),
    sendInput: async (_input, sendOptions) => {
      sendInputSignal = sendOptions?.abortSignal;
      return {
        kind: "command_result",
        result: { response: "Exiting ZCode CLI.", exit: true },
      };
    },
  };

  await act(async () => {
    view = await testRender(
      React.createElement(TuiApp, {
        copySelection: async () => ({ kind: "empty" }),
        hasCopyableSelection: () => false,
        onExit: (code) => {
          exitCodes.push(code);
        },
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

  try {
    await act(async () => {
      assert.ok(view);
      await view.mockInput.typeText("hello");
      await Promise.resolve();
      await view.renderOnce();
      view.mockInput.pressEnter();
      await Promise.resolve();
      await view.renderOnce();
    });

    // 等 busy 态真正建立（active status 行出现 "esc to interrupt"）再提交 /exit。
    assert.ok(view);
    await view.waitFor(() => view.captureCharFrame().includes("esc to interrupt"));

    await act(async () => {
      assert.ok(view);
      await view.mockInput.typeText("/exit");
      await Promise.resolve();
      await view.renderOnce();
    });

    await act(async () => {
      assert.ok(view);
      view.mockInput.pressEnter();
      await Promise.resolve();
      await view.renderOnce();
    });

    assert.deepEqual(exitCodes, [0]);
    // abort 必须发生在 onExit 之前：busy 回合的 signal 已被 /exit 消费中断。
    assert.equal(sendInputSignal?.aborted, true);
  } finally {
    await act(async () => {
      view?.renderer.destroy();
    });
  }
});
