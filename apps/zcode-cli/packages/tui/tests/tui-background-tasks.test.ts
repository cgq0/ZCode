import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@mbears/opentui-react/test-utils";
import { TuiApp } from "../src/app.js";
import type { TuiOptions } from "../src/types.js";
import {
  createExitWithTasksGuard,
  resolveExitWithTasksIntent,
} from "../src/app-keyboard-helpers.js";
import {
  formatBackgroundTaskAge,
  BackgroundTasksHint,
  longestRunningBackgroundTaskAge,
} from "../src/app-background-task-hint.js";
import {
  isBackgroundTaskRefreshEvent,
  runningBackgroundTasks,
} from "../src/app-background-tasks.js";
import { DEFAULT_TUI_COPY } from "../src/app-locale.js";
import type { BackgroundTaskInfo } from "@zcode/contracts";
import type { SessionEvent } from "@zcode/contracts";

const MINUTE_MS = 60_000;

function task(overrides: Partial<BackgroundTaskInfo> = {}): BackgroundTaskInfo {
  return {
    taskId: "exec_11111111",
    status: "running",
    ...overrides,
  };
}

test("runningBackgroundTasks 只留 running，计数与指示行同一口径", () => {
  const tasks = [
    task({ taskId: "exec_a", status: "running" }),
    task({ taskId: "exec_b", status: "completed" }),
    task({ taskId: "exec_c", status: "failed" }),
    task({ taskId: "exec_d", status: "running" }),
  ];
  assert.deepEqual(
    runningBackgroundTasks(tasks).map((task) => task.taskId),
    ["exec_a", "exec_d"],
  );
});

test("BackgroundTask 生命周期与 SessionResumed 事件触发刷新", () => {
  const event = (type: SessionEvent["type"]): SessionEvent =>
    ({ type, sequenceNumber: 1, sessionId: "s1", payload: {} }) as SessionEvent;
  assert.equal(isBackgroundTaskRefreshEvent(event("background_task_started")), true);
  assert.equal(isBackgroundTaskRefreshEvent(event("background_task_updated")), true);
  assert.equal(isBackgroundTaskRefreshEvent(event("background_task_completed")), true);
  assert.equal(isBackgroundTaskRefreshEvent(event("session_resumed")), true);
  assert.equal(isBackgroundTaskRefreshEvent(event("turn_started")), false);
});

test("resolveExitWithTasksIntent：无任务直退、首按提示、窗口内确认、超窗重提示", () => {
  const guard = createExitWithTasksGuard();
  const t0 = 1_000_000;

  // 无运行中任务：直接放行，守卫不记时
  assert.equal(resolveExitWithTasksIntent(guard, t0, 0), "exit");
  assert.equal(guard.lastExitAtMs, undefined);

  // 有任务首按：提示 + 记时
  assert.equal(resolveExitWithTasksIntent(guard, t0, 2), "show_prompt");
  assert.equal(guard.lastExitAtMs, t0);

  // 窗口内（2s）再按：确认放行，守卫清零
  assert.equal(resolveExitWithTasksIntent(guard, t0 + 1_999, 2), "confirm_exit");
  assert.equal(guard.lastExitAtMs, undefined);

  // 超窗：重新提示
  assert.equal(resolveExitWithTasksIntent(guard, t0, 1), "show_prompt");
  assert.equal(resolveExitWithTasksIntent(guard, t0 + 2_001, 1), "show_prompt");

  // 提示后任务刚好跑完：确认时点重读为 0 → 直接放行（防 stale 误拦）
  assert.equal(resolveExitWithTasksIntent(guard, t0 + 100, 1), "show_prompt");
  assert.equal(resolveExitWithTasksIntent(guard, t0 + 200, 0), "exit");
});

test("formatBackgroundTaskAge 分钟粒度：<1m / Nm / NhNm；无 startedAt 保守 <1m", () => {
  const now = 10 * MINUTE_MS;
  assert.equal(formatBackgroundTaskAge(undefined, now), "<1m");
  assert.equal(formatBackgroundTaskAge(new Date(now - 30_000), now), "<1m");
  assert.equal(formatBackgroundTaskAge(new Date(now - 3 * MINUTE_MS), now), "3m");
  assert.equal(formatBackgroundTaskAge(new Date(now - 65 * MINUTE_MS), now), "1h5m");
});

test("longestRunningBackgroundTaskAge 取最久任务的耗时；无 startedAt 不拖长结论", () => {
  const now = 30 * MINUTE_MS;
  assert.equal(longestRunningBackgroundTaskAge([], now), "<1m");
  assert.equal(
    longestRunningBackgroundTaskAge(
      [task({ startedAt: new Date(now - MINUTE_MS) }), task({ startedAt: new Date(now - 5 * MINUTE_MS) })],
      now,
    ),
    "5m",
  );
  // 无 startedAt 的任务不参与"最久"计算
  assert.equal(
    longestRunningBackgroundTaskAge([task({}), task({ startedAt: new Date(now - 2 * MINUTE_MS) })], now),
    "2m",
  );
});

function collectTextNodes(node: unknown): Array<{ style?: unknown; text: string }> {
  if (Array.isArray(node)) return node.flatMap(collectTextNodes);
  if (typeof node !== "object" || node === null || !("props" in node)) return [];
  const element = node as { props?: { children?: unknown; style?: unknown }; type?: unknown };
  const children = element.props?.children;
  const current =
    element.type === "text" && typeof children === "string"
      ? [{ style: element.props?.style, text: children }]
      : [];
  return [...current, ...collectTextNodes(children)];
}

test("BackgroundTasksHint：无 running 返回 null，有 running 渲染计数与耗时", () => {
  const empty = BackgroundTasksHint({ tasks: [], copy: DEFAULT_TUI_COPY });
  assert.equal(empty, null);

  const now = 10 * MINUTE_MS;
  const hint = BackgroundTasksHint({
    tasks: [
      task({ taskId: "exec_a", status: "completed" }),
      task({ taskId: "exec_b", startedAt: new Date(now - 4 * MINUTE_MS) }),
      task({ taskId: "exec_c", startedAt: new Date(now - 9 * MINUTE_MS) }),
    ],
    copy: DEFAULT_TUI_COPY,
    nowMs: now,
  });
  const text = collectTextNodes(hint)
    .map((node) => node.text)
    .join("");
  assert.match(text, /2 background tasks running \(9m\)/);
});

test("/exit 带运行中任务：首次提示不退出，窗口内再次 /exit 放行", async () => {
  const exitCodes: number[] = [];
  let view: Awaited<ReturnType<typeof testRender>> | undefined;

  const options: TuiOptions = {
    noColor: true,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    listBackgroundTasks: async () => [
      task({ taskId: "exec_deadbeef", startedAt: new Date(Date.now() - 2 * MINUTE_MS) }),
    ],
    submitPrompt: async () => ({ response: "Exiting ZCode CLI.", exit: true }),
  };

  await act(async () => {
    view = await testRender(
      React.createElement(TuiApp, {
        copySelection: async () => ({ kind: "empty" }),
        hasCopyableSelection: () => false,
        onExit: (code: number) => {
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
    // 等初始快照就位：指示行出现即代表计数可用
    await view.waitFor(() => view!.captureCharFrame().includes("background task"));

    await act(async () => {
      view!.mockInput.typeText("/exit");
      await Promise.resolve();
      view!.mockInput.pressEnter();
      await Promise.resolve();
      await view!.renderOnce();
    });
    // 首次：提示但不退出。警示文案走 setStatus（与 CTRL_C 提示同通道，侧栏渲染），
    // 测试宽度下侧栏可能隐藏，故只断言行为契约：未退出。
    assert.deepEqual(exitCodes, []);

    await act(async () => {
      view!.mockInput.pressEnter();
      await Promise.resolve();
      await view!.renderOnce();
    });
    // 窗口内第二次：放行
    assert.deepEqual(exitCodes, [0]);
  } finally {
    await act(async () => {
      view?.renderer.destroy();
    });
  }
});
