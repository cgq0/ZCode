import type { BackgroundTaskInfo } from "@zcode/contracts";
import type { CommandCenterDeps } from "../types.js";
import type { TuiSubmitPromptResult } from "@zcode/tui";

const TASKS_COMMAND_USAGE = "Usage: /tasks [list|cancel <taskId>]";
const TASK_ID_DISPLAY_LENGTH = 13; // "exec_" 前缀 + 8 位短码，够区分且不刷屏
const TASK_COMMAND_DISPLAY_LIMIT = 72;
const UNIQUE_PREFIX_MATCH = 1;

export async function handleTasksCommand(
  args: string,
  deps: CommandCenterDeps,
): Promise<TuiSubmitPromptResult> {
  const app = await deps.getApp();
  const [action = "list", taskId] = splitArgs(args);

  if (action === "list") {
    if (!app.listBackgroundTasks) {
      return {
        mode: deps.getMode?.(),
        response: "Background task inspection is not available in this client.",
      };
    }
    const tasks = await app.listBackgroundTasks();
    return {
      mode: deps.getMode?.(),
      response: formatBackgroundTaskList(tasks),
    };
  }

  if (action === "cancel") {
    if (!taskId) return { mode: deps.getMode?.(), response: TASKS_COMMAND_USAGE };
    if (!app.listBackgroundTasks || !app.cancelBackgroundTask) {
      return {
        mode: deps.getMode?.(),
        response: "Background task management is not available in this client.",
      };
    }
    const tasks = await app.listBackgroundTasks();
    const matches = tasks.filter((task) => task.taskId.startsWith(taskId));
    if (matches.length === 0) {
      return { mode: deps.getMode?.(), response: `No background task matches: ${taskId}` };
    }
    if (matches.length > UNIQUE_PREFIX_MATCH) {
      return {
        mode: deps.getMode?.(),
        response: [
          `Task id prefix is ambiguous, candidates:`,
          // 歧义场景必须给完整 id：短码按同一前缀截断后无法区分，用户没法接着选。
          ...matches.map((task) => `- ${task.taskId} [${task.status}] ${task.command ?? task.description ?? ""}`),
        ].join("\n"),
      };
    }
    const result = await app.cancelBackgroundTask(matches[0].taskId);
    return {
      mode: deps.getMode?.(),
      response: result.cancelled
        ? `Cancelled background task ${matches[0].taskId}.`
        : `Could not cancel background task ${matches[0].taskId}: ${result.reason ?? result.status}`,
    };
  }

  return { mode: deps.getMode?.(), response: TASKS_COMMAND_USAGE };
}

function splitArgs(args: string): string[] {
  return args.trim().length > 0 ? args.trim().split(/\s+/u) : [];
}

export function formatBackgroundTaskList(tasks: BackgroundTaskInfo[]): string {
  if (tasks.length === 0) {
    return "No background tasks in this session.";
  }
  const nowMs = Date.now();
  return [
    "Background tasks:",
    ...tasks.map((task) => `- ${formatBackgroundTaskLine(task, nowMs)}`),
  ].join("\n");
}

function formatBackgroundTaskLine(task: BackgroundTaskInfo, nowMs = Date.now()): string {
  const symbol = task.status === "running" ? "⏳" : task.status === "completed" ? "✓" : "✗";
  const label = task.command ?? task.description ?? task.taskKind ?? "task";
  const truncated =
    label.length > TASK_COMMAND_DISPLAY_LIMIT ? `${label.slice(0, TASK_COMMAND_DISPLAY_LIMIT)}…` : label;
  return `${symbol} ${shortTaskId(task.taskId)} [${task.status}] ${formatTaskElapsed(task, nowMs)} ${truncated}`;
}

function shortTaskId(taskId: string): string {
  return taskId.slice(0, TASK_ID_DISPLAY_LENGTH);
}

function formatTaskElapsed(task: BackgroundTaskInfo, nowMs: number): string {
  const endMs = task.completedAt?.getTime() ?? nowMs;
  if (!task.startedAt) return "-";
  const seconds = Math.max(0, Math.floor((endMs - task.startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}
