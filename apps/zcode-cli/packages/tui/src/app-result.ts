import type { CollaborationMode, ModelUsageSummary, TodoItem, TurnId } from "@zcode/contracts";
import { getZCodeCopy } from "@zcode/i18n";
import React from "react";
import { validContextUsage } from "./app-event-data.js";
import type {
  CacheStats,
  ContextUsage,
  Message,
  ModifiedFileStat,
  NetworkRequest,
  QueuedInput,
  SelectionState,
} from "./app-model.js";
import { appendAgentResult } from "./app-submit.js";
import { createSelectionState } from "./app-selection-state.js";
import type { TuiOptions, TuiSubmitPromptResult } from "./types.js";

type TuiApplyResultInput = {
  fallback: {
    locale: NonNullable<TuiOptions["locale"]>;
    loginRequired: boolean;
    mode: CollaborationMode;
    model: string;
  };
  modifiedFileToolCallIds: Set<string>;
  setActiveTurnId: (turnId: TurnId | undefined) => void;
  setCacheStats: React.Dispatch<React.SetStateAction<CacheStats | undefined>>;
  setContextUsage: React.Dispatch<React.SetStateAction<ContextUsage>>;
  setEffortOptions: React.Dispatch<React.SetStateAction<NonNullable<TuiOptions["effortOptions"]>>>;
  setLastEvent: (event: string) => void;
  setLiveModelText: (value: string) => void;
  setLocale: (locale: NonNullable<TuiOptions["locale"]>) => void;
  setLoginRequired: (loginRequired: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setMode: React.Dispatch<React.SetStateAction<CollaborationMode>>;
  setModel: (model: string) => void;
  setModelOptions: React.Dispatch<React.SetStateAction<NonNullable<TuiOptions["modelOptions"]>>>;
  setModifiedFiles: React.Dispatch<React.SetStateAction<ModifiedFileStat[]>>;
  setNetworkRequests: React.Dispatch<React.SetStateAction<NetworkRequest[]>>;
  setQueuedInputs: React.Dispatch<React.SetStateAction<QueuedInput[]>>;
  setSelection: React.Dispatch<React.SetStateAction<SelectionState | undefined>>;
  setStatus: (status: string) => void;
  setThoughtLevel: (thoughtLevel: string) => void;
  setTodos: React.Dispatch<React.SetStateAction<TodoItem[]>>;
  setTraceId: (traceId: string | undefined) => void;
  setUsage: React.Dispatch<React.SetStateAction<ModelUsageSummary | undefined>>;
  /** 唯一持有 renderer 的退出通道（对齐 Ctrl+C 连按确认路径的 onExit(0)）。 */
  onExit: (code: number) => void;
  /** 在飞的回合控制器；/exit 在 busy 时先 abort 再退出，与 Ctrl+C 连按同一 abort 路径。 */
  turnRef: React.MutableRefObject<AbortController | undefined>;
  workspaceDirectory?: string;
};

export function useTuiApplyResult(input: TuiApplyResultInput) {
  return React.useCallback(
    (result: TuiSubmitPromptResult, preserveTurnState = false) => {
      // 两条产生 result 的路径（空闲 submit、busy sendInput 的 command_result）都汇入这里，
      // 消费点必须唯一且在 preserveTurnState 早退之前：exit 一到就终止，不再写任何状态。
      if (result.exit === true) {
        input.turnRef.current?.abort();
        input.onExit(0);
        return;
      }
      const resultCopy = getZCodeCopy(result.locale ?? input.fallback.locale).tui;
      input.setMode(result.mode ?? input.fallback.mode);
      input.setModel(result.model ?? input.fallback.model);
      if (result.locale) input.setLocale(result.locale);
      if (result.loginRequired !== undefined) input.setLoginRequired(result.loginRequired);
      if (result.effortOptions) input.setEffortOptions(result.effortOptions);
      if (result.modelOptions) input.setModelOptions(result.modelOptions);
      if ("thoughtLevel" in result) input.setThoughtLevel(result.thoughtLevel ?? "");
      input.setMessages((current) =>
        appendAgentResult(current, result, { workspaceDirectory: input.workspaceDirectory }),
      );
      if (preserveTurnState) {
        input.setStatus("Agent is still responding.");
        return;
      }
      input.setTraceId(result.traceId);
      input.setLiveModelText("");

      if (result.turnId) input.setActiveTurnId(result.turnId as TurnId);
      if (result.usage) input.setUsage(result.usage);
      // reset 必须先于 projection merge：/new、/resume 的结果同时带 resetSessionProjection
      // 和 projection seed，顺序反了 seed 会被自己清掉（先清后种）。
      if (result.resetSessionProjection) {
        input.setUsage(undefined);
        input.setContextUsage({});
        input.setCacheStats(undefined);
        input.setTodos([]);
        input.setNetworkRequests([]);
        input.setModifiedFiles([]);
        input.modifiedFileToolCallIds.clear();
      }
      if (result.projection) {
        input.setContextUsage((current) => ({
          ...current,
          ...validContextUsage(result.projection ?? {}),
        }));
      }

      input.setSelection(createSelectionState(result.selection));
      input.setQueuedInputs([]);
      const activeLoginRequired = result.loginRequired ?? input.fallback.loginRequired;
      input.setStatus(
        result.selection
          ? result.selection.prompt
          : activeLoginRequired
            ? resultCopy.loginRequired.status
            : resultCopy.status.ready,
      );
      input.setLastEvent(result.turnId ? `turn ${result.turnId}` : "complete");
    },
    [input],
  );
}
