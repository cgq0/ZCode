import React from "react";
import {
  SessionEventType,
  type BackgroundTaskInfo,
  type SessionEvent,
} from "@zcode/contracts";
import type { TuiOptions } from "./types.js";

// 行为合同见 docs/cli-tui-activity-visibility.md：runtime 投影是唯一事实源，事件只当
// 刷新触发器——事件丢失不漂移，每次刷新都以查询快照整体替换本地状态。
const BACKGROUND_TASK_REFRESH_EVENTS = new Set<SessionEventType>([
  SessionEventType.BackgroundTaskStarted,
  SessionEventType.BackgroundTaskUpdated,
  SessionEventType.BackgroundTaskCompleted,
  SessionEventType.SessionResumed,
]);

export function isBackgroundTaskRefreshEvent(event: SessionEvent): boolean {
  return BACKGROUND_TASK_REFRESH_EVENTS.has(event.type);
}

export const runningBackgroundTasks = (tasks: BackgroundTaskInfo[]): BackgroundTaskInfo[] =>
  tasks.filter((task) => task.status === "running");

export function useBackgroundTasks(options: TuiOptions) {
  const [tasks, setTasks] = React.useState<BackgroundTaskInfo[]>([]);
  const generation = React.useRef(0);
  const request = React.useRef<Promise<void> | undefined>(undefined);
  const dirty = React.useRef(false);

  const listBackgroundTasks = options.listBackgroundTasks;
  const refresh = React.useCallback((): void => {
    if (!listBackgroundTasks) return;
    dirty.current = true;
    if (request.current) return;
    const epoch = generation.current;
    request.current = (async () => {
      while (dirty.current && epoch === generation.current) {
        dirty.current = false;
        try {
          const snapshot = await listBackgroundTasks();
          if (epoch !== generation.current) return;
          setTasks(snapshot);
        } catch {
          // 指示行是提示性 UI：单次查询失败保留上一次快照，不闪没、不上报打断用户。
        }
      }
    })().finally(() => {
      if (epoch === generation.current) {
        request.current = undefined;
        // 刷新期间到来的事件同 useSubagents：保底再刷一次，不丢最后一次失效。
        if (dirty.current) refresh();
      }
    });
  }, [listBackgroundTasks]);

  const sessionId = options.getMainSessionId?.();
  React.useEffect(() => {
    generation.current += 1;
    request.current = undefined;
    setTasks([]);
    refresh();
    return () => {
      generation.current += 1;
    };
  }, [sessionId, refresh]);

  const onEvent = React.useCallback(
    (event: SessionEvent) => {
      if (isBackgroundTaskRefreshEvent(event)) refresh();
    },
    [refresh],
  );

  const running = React.useMemo(() => runningBackgroundTasks(tasks), [tasks]);
  return { tasks, running, onEvent, refresh };
}

export type BackgroundTasksController = ReturnType<typeof useBackgroundTasks>;
