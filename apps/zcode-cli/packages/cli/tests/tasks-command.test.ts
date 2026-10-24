import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundTaskInfo } from "@zcode/contracts";
import {
  createCommandCenter,
  listSlashCommandSuggestions,
  parseSlashCommand,
} from "../src/command-center.js";
import type { CommandCenterApp, CommandCenterDeps } from "../src/command-center.js";

/**
 * `/tasks` 的命令面测试（docs/cli-tui-activity-visibility.md）。
 * 不变量：能力缺席要说「不可用」而不是空表；cancel 用前缀匹配且歧义时列候选；
 * 排序信任 facade（running 优先），这里不重排。
 */

const ABORT = { abortSignal: new AbortController().signal };

function createHarness(app: Partial<CommandCenterApp>) {
  const deps: CommandCenterDeps = {
    getApp: async () =>
      ({
        sessionId: "sess_active",
        traceId: "trace-active",
        submitPrompt: async () => {
          throw new Error("prompt should not run for /tasks");
        },
        ...app,
      }) as never,
    getMode: () => "build" as never,
  };
  return createCommandCenter(deps);
}

function task(overrides: Partial<BackgroundTaskInfo> = {}): BackgroundTaskInfo {
  return {
    taskId: "exec_11111111aaaa",
    status: "running",
    taskKind: "bash",
    command: "pnpm --filter @zcode/cli sea --target darwin-x64",
    startedAt: new Date(Date.now() - 90_000),
    ...overrides,
  };
}

test("/tasks parses as a known command and appears in suggestions", () => {
  const parsed = parseSlashCommand("/tasks cancel exec_1");
  assert.equal(parsed.type, "known");
  assert.equal(parsed.name, "tasks");
  assert.equal(parsed.args, "cancel exec_1");

  const suggestions = listSlashCommandSuggestions(createHarness({}), "/tas");
  assert.ok(suggestions.some((entry) => entry.name === "tasks"));
});

test("/tasks lists tasks with status, elapsed, and command", async () => {
  const commandCenter = createHarness({
    listBackgroundTasks: async () => [
      task(),
      task({
        taskId: "exec_22222222bbbb",
        status: "completed",
        command: "tail -f server.log",
        startedAt: new Date(Date.now() - 600_000),
        completedAt: new Date(Date.now() - 300_000),
      }),
    ],
  });
  const result = await commandCenter("/tasks", ABORT);
  assert.match(result.response ?? "", /Background tasks:/);
  assert.match(result.response ?? "", /⏳ exec_11111111 \[running\] 1m30s pnpm --filter/);
  assert.match(result.response ?? "", /✓ exec_22222222 \[completed\] 5m/);
});

test("/tasks with no tasks says so; missing capability says unavailable", async () => {
  const empty = await createHarness({ listBackgroundTasks: async () => [] })("/tasks", ABORT);
  assert.equal(empty.response, "No background tasks in this session.");

  const unavailable = await createHarness({})("/tasks", ABORT);
  assert.equal(unavailable.response, "Background task inspection is not available in this client.");
});

test("/tasks cancel resolves a unique prefix; ambiguity lists candidates", async () => {
  const app: Partial<CommandCenterApp> = {
    listBackgroundTasks: async () => [
      task({ taskId: "exec_11111111aaaa" }),
      task({ taskId: "exec_11119999bbbb", command: "other command" }),
    ],
    cancelBackgroundTask: async () => ({ cancelled: true, status: "cancelled" }),
  };
  const commandCenter = createHarness(app);

  const ambiguous = await commandCenter("/tasks cancel exec_1", ABORT);
  assert.match(ambiguous.response ?? "", /ambiguous/);
  assert.match(ambiguous.response ?? "", /exec_11111111aaaa/);
  assert.match(ambiguous.response ?? "", /exec_11119999bbbb/);

  let cancelledId: string | undefined;
  const cancellable = createHarness({
    ...app,
    listBackgroundTasks: async () => [task()],
    cancelBackgroundTask: async (taskId) => {
      cancelledId = taskId;
      return { cancelled: true, status: "cancelled" };
    },
  });
  const ok = await cancellable("/tasks cancel exec_11111111", ABORT);
  assert.equal(cancelledId, "exec_11111111aaaa");
  assert.match(ok.response ?? "", /Cancelled background task exec_11111111aaaa/);

  const none = await createHarness({
    listBackgroundTasks: async () => [task()],
    cancelBackgroundTask: async () => ({ cancelled: true, status: "cancelled" }),
  })("/tasks cancel exec_ffff", ABORT);
  assert.match(none.response ?? "", /No background task matches/);

  const refused = await createHarness({
    listBackgroundTasks: async () => [task()],
    cancelBackgroundTask: async () => ({
      cancelled: false,
      reason: "already finished",
      status: "completed",
    }),
  })("/tasks cancel exec_11111111", ABORT);
  assert.match(refused.response ?? "", /Could not cancel/);
  assert.match(refused.response ?? "", /already finished/);
});

test("/tasks cancel without capability or id falls back to usage", async () => {
  const usage = await createHarness({
    listBackgroundTasks: async () => [task()],
    cancelBackgroundTask: async () => ({ cancelled: true, status: "cancelled" }),
  })("/tasks cancel", ABORT);
  assert.equal(usage.response, "Usage: /tasks [list|cancel <taskId>]");

  const noCapability = await createHarness({})("/tasks cancel exec_1", ABORT);
  assert.equal(
    noCapability.response,
    "Background task management is not available in this client.",
  );

  const unknownAction = await createHarness({
    listBackgroundTasks: async () => [task()],
  })("/tasks frobnicate", ABORT);
  assert.equal(unknownAction.response, "Usage: /tasks [list|cancel <taskId>]");
});
