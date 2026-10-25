import type { ScrollBoxRenderable } from "@mbears/opentui-core";
import React from "react";
import type { TuiCopy } from "@zcode/i18n";
import type { Message } from "./app-model.js";
import { palette } from "./app-model.js";
import { EmptyTranscriptLogo } from "./app-empty-transcript.js";
import { DEFAULT_TUI_COPY } from "./app-locale.js";
import { MarkdownText } from "./app-markdown.js";
import { ThoughtTranscriptPartView } from "./app-thought-components.js";
import { ToolTranscriptPartView } from "./app-tool-components.js";
import { WorkflowRunCardView } from "./app-workflow-card.js";
import type { TuiWorkflowCard } from "./app-workflow-mirror.js";

const h = React.createElement as (
  type: React.ElementType | string,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
) => React.ReactElement;

const USER_MESSAGE_VERTICAL_PADDING = 1;

export function ContentPane({
  activeDots,
  animateEmptyLogo = false,
  copy = DEFAULT_TUI_COPY,
  expandedWorkflowRunIds,
  emptyText,
  id,
  focused,
  messages,
  scrollRef,
  terminalWidth = 100,
  workflowCardsByToolCallId,
}: {
  activeDots?: string;
  animateEmptyLogo?: boolean;
  copy?: TuiCopy;
  expandedWorkflowRunIds?: ReadonlySet<string>;
  emptyText?: string;
  id?: string;
  focused: boolean;
  messages: Message[];
  /** 主转写滚动实例出口（滚到底快捷键用）；子代理视图不传，走自身焦点滚动。 */
  scrollRef?: (instance: ScrollBoxRenderable | null) => void;
  terminalWidth?: number;
  workflowCardsByToolCallId?: ReadonlyMap<string, TuiWorkflowCard>;
}): React.ReactElement {
  return h(
    "scrollbox",
    {
      id,
      focused,
      ref: scrollRef,
      stickyScroll: true,
      stickyStart: "bottom",
      viewportCulling: true,
      style: {
        backgroundColor: palette.background,
        border: false,
        flexGrow: 1,
        marginBottom: 1,
        minHeight: 8,
        contentOptions: {
          backgroundColor: palette.background,
          flexDirection: "column",
          padding: 1,
        },
        rootOptions: {
          backgroundColor: palette.background,
        },
        scrollbarOptions: {
          showArrows: true,
        },
        viewportOptions: {
          backgroundColor: palette.background,
        },
        wrapperOptions: {
          backgroundColor: palette.background,
        },
      },
    },
    ...(messages.length === 0
      ? [
          emptyText
            ? h("text", { key: "empty", style: { fg: palette.muted } }, emptyText)
            : h(EmptyTranscriptLogo, { animated: animateEmptyLogo, key: "empty-transcript-logo" }),
        ]
      : messages.map((message, index) =>
          h(MemoizedMessageRow, {
            // 活动帧只发给含活动 part 的行（thinking 思考块 / running 工具行），其余行
            // 恒为 undefined——comparator 按引用比较后在 400ms tick 间继续拦截它们。
            activeDots: messageActivityDots(message, activeDots),
            copy,
            expandedWorkflowRunIds,
            index,
            key: `${index}-${message.role}`,
            message,
            terminalWidth,
            workflowCardsByToolCallId,
          }),
        )),
  );
}

/**
 * 400ms 活动帧只进含活动 part 的消息（docs/cli-tui-activity-visibility.md）：
 * thought part 处于 thinking、tool part 处于 running 的消息拿到帧值，其余消息返回
 * undefined，让 MemoizedMessageRow 在每次 tick 都被 comparator 拦下——每 tick 成本
 * 是 O(消息数) 次 prop 比较，重渲染仅限活动行，不回到 O(转录长度)。
 */
export function messageActivityDots(
  message: Message,
  activeDots: string | undefined,
): string | undefined {
  if (!activeDots) return undefined;
  return (message.parts ?? []).some(
    (part) =>
      (part.type === "tool" && part.status === "running") ||
      (part.type === "thought" && part.status === "thinking"),
  )
    ? activeDots
    : undefined;
}

type MessageRowProps = {
  activeDots?: string;
  copy?: TuiCopy;
  expandedWorkflowRunIds?: ReadonlySet<string>;
  index: number;
  message: Message;
  terminalWidth?: number;
  workflowCardsByToolCallId?: ReadonlyMap<string, TuiWorkflowCard>;
};

// 比较器刻意不比较 index：MessageRow 不消费它，消息数组位移（如插行）不应引发全量重渲染。
// 其余 prop 均按引用比较——copy 是 locale 常量，workflowCardsByToolCallId 是
// useMemo([mirror])，expandedWorkflowRunIds 是 useState 持有的 ReadonlySet，
// activeDots 只在活动行间变化（非活动行恒为 undefined），无变化时引用/值稳定
// （2026-10-21 spec 核实；activeDots 为 2026-10-25 活动动效扩展新增）。
export function messageRowPropsAreEqual(prev: MessageRowProps, next: MessageRowProps): boolean {
  return (
    prev.message === next.message &&
    prev.copy === next.copy &&
    prev.terminalWidth === next.terminalWidth &&
    prev.expandedWorkflowRunIds === next.expandedWorkflowRunIds &&
    prev.workflowCardsByToolCallId === next.workflowCardsByToolCallId &&
    prev.activeDots === next.activeDots
  );
}

// 流式期间每个 delta 都会重建 messages 数组：未变化行的 message 引用不变，memo 跳过
// 整行重建，把每 delta 成本从 O(转录长度) 降到 O(单个流式行)。
export const MemoizedMessageRow = React.memo(MessageRow, messageRowPropsAreEqual);

export function MessageRow({
  activeDots,
  copy = DEFAULT_TUI_COPY,
  expandedWorkflowRunIds,
  message,
  terminalWidth = 100,
  workflowCardsByToolCallId,
}: MessageRowProps): React.ReactElement {
  const parts = message.parts ?? [];
  if (message.role === "timeline") {
    return h(CompactTimelineRow, { copy, message, terminalWidth });
  }
  // speaker labels were visually noisy; only user prompts carry row chrome.
  const isUserMessage = message.role === "user";
  const rowBackground = isUserMessage ? palette.userMessageBackground : palette.background;
  const assistantText = message.role === "agent";
  const plainTextColor = message.role === "system" ? palette.warning : palette.text;

  return h(
    "box",
    {
      style: {
        backgroundColor: rowBackground,
        flexDirection: "column",
        marginBottom: 1,
        minHeight: 2,
        paddingLeft: 1,
        paddingRight: 1,
        paddingBottom: isUserMessage ? USER_MESSAGE_VERTICAL_PADDING : 0,
        paddingTop: isUserMessage ? USER_MESSAGE_VERTICAL_PADDING : 0,
        width: "100%",
      },
    },
    ...(assistantText && parts.length === 0
      ? [
          h(MarkdownText, {
            backgroundColor: rowBackground,
            content: message.content,
            key: "content",
            streaming: message.streaming,
          }),
        ]
      : parts.length === 0
        ? [h("text", { key: "content", style: { fg: plainTextColor } }, message.content)]
        : []),
    ...parts.map((part, partIndex) => {
      if (part.type === "tool") {
        // 卡片 join 按 toolCallId（与 GUI buildWorkflowRunByToolCallId 同规）。命中即渲染实时卡：
        // 工具行自己的 status 在 CreateWorkflow 上会在 run 还在飞的时候就变成 completed
        // （工具一launch完 run 就返回），所以状态必须读镜像，不能读 part.status。
        const workflowCard = workflowCardsByToolCallId?.get(part.toolCallId);
        if (workflowCard) {
          return h(WorkflowRunCardView, {
            card: workflowCard,
            copy,
            expanded: expandedWorkflowRunIds?.has(workflowCard.runId) ?? false,
            key: `workflow-${part.toolCallId}`,
            terminalWidth,
          });
        }
        // 无命中就回落今日的文本投影（编过但没有 run、或镜像尚未补种）。
        return h(ToolTranscriptPartView, {
          activeDots,
          key: `tool-${part.toolCallId}`,
          part,
          terminalWidth,
        });
      }
      if (part.type === "thought") {
        return h(ThoughtTranscriptPartView, {
          activeDots,
          copy,
          key: `thought-${partIndex}`,
          part,
        });
      }
      return assistantText && part.format !== "plain"
        ? h(MarkdownText, {
            backgroundColor: rowBackground,
            content: part.text,
            key: `text-${partIndex}`,
            streaming: message.streaming,
          })
        : h("text", { key: `text-${partIndex}`, style: { fg: plainTextColor } }, part.text);
    }),
  );
}

function CompactTimelineRow({
  copy,
  message,
  terminalWidth,
}: {
  copy: TuiCopy;
  message: Message;
  terminalWidth: number;
}): React.ReactElement {
  const timeline = message.timeline;
  if (!timeline || timeline.type !== "context_compaction") {
    return h("box", null);
  }
  const compactCopy = copy.transcript.compact;
  const label =
    timeline.status === "started"
      ? compactCopy.started
      : timeline.status === "retrying"
        ? compactCopy.retrying({
            attempt: timeline.attempt ?? 0,
            maxAttempts: timeline.maxAttempts ?? 0,
          })
        : timeline.status === "skipped"
          ? compactCopy.skipped
          : timeline.status === "failed"
            ? compactCopy.failed
            : timeline.status === "interrupted"
              ? compactCopy.interrupted
              : compactCopy.completed;
  const retry =
    timeline.status === "failed" || timeline.status === "interrupted"
      ? compactCopy.retry(timeline.command ?? "/compact")
      : undefined;
  const center = retry ? ` ${label} | ${retry} ` : ` ${label} `;
  const sideWidth = Math.max(4, Math.floor((terminalWidth - center.length - 6) / 2));
  const line = "-".repeat(sideWidth);
  const color =
    timeline.status === "failed"
      ? palette.warning
      : timeline.status === "started"
        ? palette.accent
        : timeline.status === "retrying"
          ? palette.accent
          : palette.muted;

  return h(
    "box",
    {
      style: {
        backgroundColor: palette.background,
        flexDirection: "column",
        marginBottom: 1,
        minHeight: 1,
        paddingLeft: 1,
        paddingRight: 1,
        width: "100%",
      },
    },
    h(
      "text",
      {
        key: "compact-timeline",
        style: { fg: color },
      },
      `${line}${center}${line}`,
    ),
  );
}
