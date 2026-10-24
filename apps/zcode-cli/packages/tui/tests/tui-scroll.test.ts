import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@mbears/opentui-react/test-utils";
import type { ScrollBoxRenderable } from "@mbears/opentui-core";
import { ContentPane } from "../src/app-transcript-components.js";
import { TuiApp } from "../src/app.js";
import type { Message, TuiOptions } from "../src/types.js";

function seededMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "agent",
    content: `message-${index} ${"lorem ipsum dolor ".repeat(6)}`,
  }));
}

test("ContentPane 暴露 scrollbox 实例：scrollTo(0) 置顶、scrollBy content 单位滚到底", async () => {
  let scrollbox: ScrollBoxRenderable | null = null;
  let view: Awaited<ReturnType<typeof testRender>> | undefined;

  await act(async () => {
    view = await testRender(
      React.createElement(ContentPane, {
        focused: false,
        messages: seededMessages(40),
        scrollRef: (instance) => {
          scrollbox = instance;
        },
        terminalWidth: 80,
      }),
      { exitOnCtrlC: false, height: 14, width: 80 },
    );
    await view.renderOnce();
  });

  try {
    assert.ok(view);
    assert.ok(scrollbox, "scrollRef should capture the ScrollBoxRenderable");
    const box = scrollbox as ScrollBoxRenderable;

    await act(async () => {
      box.scrollTo(0);
      await view!.renderOnce();
    });
    assert.equal(box.scrollTop, 0, "scrollTo(0) should pin the transcript to the top");

    await act(async () => {
      box.scrollBy(1, "content");
      await view!.renderOnce();
    });
    const maxScrollTop = Math.max(0, box.scrollHeight - box.viewport.height);
    assert.ok(maxScrollTop > 0, "fixture should overflow the viewport");
    assert.equal(box.scrollTop, maxScrollTop, "scrollBy(1, content) should land on bottom");
  } finally {
    await act(async () => {
      view?.renderer.destroy();
    });
  }
});

test("Ctrl/Option+End/Home 在全 app 内被消费：不落草稿、不崩溃", async () => {
  const exitCodes: number[] = [];
  let view: Awaited<ReturnType<typeof testRender>> | undefined;

  const options: TuiOptions = {
    noColor: true,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    submitPrompt: async () => ({ response: "done" }),
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
    assert.ok(view);
    await act(async () => {
      // 用裸字节注入（mock 的 kitty CSI-u 发射与测试渲染器的解析不配套，见
      // tui-input.test.ts 只对字母键用 pressKey；真实终端发的就是这些字节）。
      // 空转写不溢出，滚动静默——这里断言消费路径不炸、不落草稿、不误退出；
      // 滚动本体与 ref 出口由上面的 ContentPane 用例覆盖。
      view!.mockInput.pressKeys(["\x1b[1;5F"]);
      view!.mockInput.pressKeys(["\x1b[1;3F"]);
      view!.mockInput.pressKeys(["\x1b[1;5H"]);
      view!.mockInput.pressKeys(["\x1b[1;3H"]);
      await Promise.resolve();
      await view!.renderOnce();
    });
    const frame = view.captureCharFrame();
    assert.equal(frame.includes("endhome"), false);
    assert.deepEqual(exitCodes, []);
  } finally {
    await act(async () => {
      view?.renderer.destroy();
    });
  }
});
