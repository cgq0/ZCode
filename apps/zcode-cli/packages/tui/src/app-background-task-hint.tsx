import type { TuiCopy } from "@zcode/i18n";
import type { BackgroundTaskInfo } from "@zcode/contracts";
import React from "react";
import { palette } from "./app-model.js";
import { truncateDisplay } from "./app-terminal-width.js";

const h = React.createElement as (
  type: React.ElementType | string,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
) => React.ReactElement;

const BACKGROUND_TASKS_HINT_HEIGHT = 1;
const BACKGROUND_TASKS_HINT_MIN_CONTENT_WIDTH = 8;
const BACKGROUND_TASKS_HINT_FALLBACK_WIDTH = 80;
const MINUTE_MS = 60_000;

/** 分钟粒度展示：<1m / Nm / NhNm。无 startedAt 的任务按 <1m 计（保守不夸大）。 */
export function formatBackgroundTaskAge(startedAt: Date | undefined, nowMs: number): string {
  if (!startedAt) return "<1m";
  const minutes = Math.floor(Math.max(0, nowMs - startedAt.getTime()) / MINUTE_MS);
  if (minutes < 1) return "<1m";
  const hours = Math.floor(minutes / 60);
  return hours < 1 ? `${minutes}m` : `${hours}h${minutes % 60}m`;
}

export function longestRunningBackgroundTaskAge(
  running: BackgroundTaskInfo[],
  nowMs: number,
): string {
  const oldest = running.reduce<number>((maxMs, task) => {
    const startedAtMs = task.startedAt?.getTime();
    return startedAtMs === undefined ? maxMs : Math.max(maxMs, nowMs - startedAtMs);
  }, -1);
  if (oldest < 0) return "<1m";
  return formatBackgroundTaskAge(new Date(nowMs - oldest), nowMs);
}

/**
 * 输入框上方的后台任务常驻指示行（docs/cli-tui-activity-visibility.md）。只在
 * running > 0 时渲染；ApprovalPanel/SelectionPanel 出现时由调用方让位不挂载。
 * 耗时在渲染时计算，静默期可能滞后——提示性 UI，不为它加独立时钟。
 */
export function BackgroundTasksHint({
  tasks,
  copy,
  contentWidth,
  nowMs = Date.now(),
  dots = "",
}: {
  tasks: BackgroundTaskInfo[];
  copy: TuiCopy;
  contentWidth?: number;
  nowMs?: number;
  /** 400ms 活动帧（docs/cli-tui-activity-visibility.md）：运行中即点动，不要求 busy。 */
  dots?: string;
}): React.ReactElement | null {
  const running = tasks.filter((task) => task.status === "running");
  if (running.length === 0) return null;
  const label = copy.input.backgroundTasksRunning(
    running.length,
    longestRunningBackgroundTaskAge(running, nowMs),
    dots,
  );
  // 与 InputActiveStatus 同款归一化：缺宽度时按回退宽度截断，超窄按最小宽度兜底。
  const maxWidth = Math.max(
    BACKGROUND_TASKS_HINT_MIN_CONTENT_WIDTH,
    Math.floor(contentWidth ?? BACKGROUND_TASKS_HINT_FALLBACK_WIDTH),
  );
  return h(
    "box",
    {
      style: {
        flexDirection: "row",
        height: BACKGROUND_TASKS_HINT_HEIGHT,
        paddingLeft: 1,
        width: "100%",
      },
    },
    h(
      "text",
      {
        style: {
          fg: palette.warning,
          flexShrink: 1,
        },
      },
      truncateDisplay(label, maxWidth),
    ),
  );
}
