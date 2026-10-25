import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundTaskInfo } from "@zcode/contracts";
import { getZCodeCopy } from "@zcode/i18n";
import { BackgroundTasksHint } from "../src/app-background-task-hint.js";
import {
  ContentPane,
  messageActivityDots,
  messageRowPropsAreEqual,
} from "../src/app-transcript-components.js";
import type { Message, ThoughtTranscriptPart, ToolTranscriptPart } from "../src/app-model.js";
import { ThoughtTranscriptPartFrame } from "../src/app-thought-components.js";
import { ToolTranscriptPartView } from "../src/app-tool-components.js";

const EN_COPY = getZCodeCopy("en-US").tui;

// 直接函数调用收集渲染文本（与 tui.unit.test.ts 同款测试模式）：组件树经 props.children
// 递归取字符串，不经 React 渲染器——被测组件必须保持无 hook。
function collectTexts(node: unknown): string[] {
  const texts: string[] = [];
  const walk = (current: unknown): void => {
    if (!current || typeof current !== "object") return;
    const element = current as { props?: { children?: unknown } };
    const children = element.props?.children;
    if (typeof children === "string") {
      texts.push(children);
      return;
    }
    if (Array.isArray(children)) {
      for (const child of children) walk(child);
      return;
    }
    if (children) walk(children);
  };
  walk(node);
  return texts;
}

function childElements(node: unknown): Array<Record<string, any>> {
  const element = node as { props?: { children?: unknown } };
  return Array.isArray(element.props?.children) ? (element.props!.children as any[]) : [];
}

const toolPart = (overrides: Partial<ToolTranscriptPart> = {}): ToolTranscriptPart => ({
  detailLines: [],
  status: "running",
  title: "Read /tmp/a.ts",
  toolCallId: "call-1",
  toolName: "Read",
  type: "tool",
  ...overrides,
});

const thoughtPart = (overrides: Partial<ThoughtTranscriptPart> = {}): ThoughtTranscriptPart => ({
  contentCharCount: 12,
  status: "thinking",
  text: "reasoning",
  type: "thought",
  ...overrides,
});

const backgroundTask = (overrides: Partial<BackgroundTaskInfo> = {}): BackgroundTaskInfo => ({
  status: "running",
  taskId: "exec_deadbeef",
  ...overrides,
});

test("messageActivityDots 只给含活动 part 的消息发帧值", () => {
  const dots = "..";
  const runningTool: Message = {
    content: "",
    parts: [toolPart({ status: "running" })],
    role: "agent",
  };
  const thinkingThought: Message = {
    content: "",
    parts: [thoughtPart({ status: "thinking" })],
    role: "agent",
  };
  const doneTool: Message = {
    content: "",
    parts: [toolPart({ status: "completed" })],
    role: "agent",
  };
  const thinkingTool: Message = {
    content: "",
    parts: [toolPart({ status: "pending" })],
    role: "agent",
  };
  const plain: Message = { content: "hi", role: "user" };

  assert.equal(messageActivityDots(runningTool, dots), dots);
  assert.equal(messageActivityDots(thinkingThought, dots), dots);
  // 非活动消息恒为 undefined——MemoizedMessageRow 靠它在 400ms tick 间被拦截。
  assert.equal(messageActivityDots(doneTool, dots), undefined);
  assert.equal(messageActivityDots(thinkingTool, dots), undefined);
  assert.equal(messageActivityDots(plain, dots), undefined);
  assert.equal(messageActivityDots(runningTool, undefined), undefined);
});

test("messageRowPropsAreEqual 对 activeDots 按值比较", () => {
  const message: Message = { content: "hi", role: "agent" };
  const base = { activeDots: ".." as string | undefined, index: 0, message };

  assert.equal(messageRowPropsAreEqual(base, { ...base }), true);
  // 非活动行恒 undefined === undefined，帧值变化不击穿 memo。
  assert.equal(
    messageRowPropsAreEqual({ ...base, activeDots: undefined }, { ...base, activeDots: undefined }),
    true,
  );
  // 活动行帧值每 tick 变化，必须重渲染。
  assert.equal(messageRowPropsAreEqual(base, { ...base, activeDots: "..." }), false);
  assert.equal(messageRowPropsAreEqual(base, { ...base, activeDots: undefined }), false);
});

test("running 工具行标题接动态点，完成行不受帧影响", () => {
  const running = ToolTranscriptPartView({ activeDots: "..", part: toolPart() });
  assert.ok(collectTexts(running).includes("Read /tmp/a.ts.."));

  const idleFrame = ToolTranscriptPartView({ part: toolPart() });
  assert.ok(collectTexts(idleFrame).includes("Read /tmp/a.ts"));

  const done = ToolTranscriptPartView({
    activeDots: "..",
    part: toolPart({ status: "completed" }),
  });
  assert.ok(collectTexts(done).includes("Read /tmp/a.ts"));
  assert.ok(!collectTexts(done).some((text) => text.includes("Read /tmp/a.ts..")));

  // 无 title 的兜底文案同样接点。
  const fallback = ToolTranscriptPartView({
    activeDots: ".",
    part: toolPart({ title: undefined, toolName: "Bash" }),
  });
  assert.ok(collectTexts(fallback).includes("Tool Bash running."));
});

test("thinking 思考块剥静态省略号接动态点，完成态静止", () => {
  const thinking = ThoughtTranscriptPartFrame({
    activeDots: "..",
    expanded: false,
    onToggle: () => {},
    part: thoughtPart(),
  });
  // i18n 文案 "Thinking..." 剥掉静态尾部再接帧点，避免出现 "Thinking...."。
  assert.ok(collectTexts(thinking).some((text) => text === "+ Thinking.."));

  const staticThinking = ThoughtTranscriptPartFrame({
    expanded: false,
    onToggle: () => {},
    part: thoughtPart(),
  });
  assert.ok(collectTexts(staticThinking).includes("+ Thinking..."));

  const done = ThoughtTranscriptPartFrame({
    activeDots: "..",
    expanded: false,
    onToggle: () => {},
    part: thoughtPart({ status: "thought" }),
  });
  assert.ok(collectTexts(done).includes("+ Thought"));
});

test("后台任务指示行文案接动态点", () => {
  const view = BackgroundTasksHint({
    copy: EN_COPY,
    dots: "..",
    tasks: [backgroundTask()],
  });
  const texts = collectTexts(view).join(" ");
  assert.ok(texts.includes("running.."));
  assert.ok(texts.includes("/tasks"));
});

test("ContentPane 只给活动行的 MemoizedMessageRow 传 activeDots", () => {
  const runningMessage: Message = {
    content: "",
    parts: [toolPart({ status: "running" })],
    role: "agent",
  };
  const doneMessage: Message = {
    content: "",
    parts: [toolPart({ status: "completed" })],
    role: "agent",
  };
  const rows = childElements(
    ContentPane({
      activeDots: "..",
      copy: EN_COPY,
      focused: false,
      messages: [runningMessage, doneMessage],
    }),
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.props?.activeDots, "..");
  // 非活动行拿到 undefined，comparator 在 tick 间继续拦截。
  assert.equal(rows[1]?.props?.activeDots, undefined);
});
