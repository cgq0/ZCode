import assert from "node:assert/strict";
import test from "node:test";
import {
  stripTrailingEllipsis,
  THINKING_DOTS_INTERVAL_MS,
  thinkingDotsFrame,
} from "../src/app-motion.js";

test("thinkingDotsFrame 按 400ms 步进循环 1→2→3 个点", () => {
  assert.equal(THINKING_DOTS_INTERVAL_MS, 400);
  assert.equal(thinkingDotsFrame(0), ".");
  assert.equal(thinkingDotsFrame(THINKING_DOTS_INTERVAL_MS), "..");
  assert.equal(thinkingDotsFrame(THINKING_DOTS_INTERVAL_MS * 2), "...");
  // 一轮结束回到单点
  assert.equal(thinkingDotsFrame(THINKING_DOTS_INTERVAL_MS * 3), ".");
  // 任意大时间戳取模正确
  assert.equal(thinkingDotsFrame(THINKING_DOTS_INTERVAL_MS * 7 + 1), "..");
});

test("stripTrailingEllipsis 剥掉尾部省略号但不碰句号结尾的普通文本", () => {
  assert.equal(stripTrailingEllipsis("Thinking..."), "Thinking");
  assert.equal(stripTrailingEllipsis("思考中..."), "思考中");
  assert.equal(stripTrailingEllipsis("Thinking…"), "Thinking");
  assert.equal(stripTrailingEllipsis("Calling model..."), "Calling model");
  // 句号不是省略号：保持原样
  assert.equal(stripTrailingEllipsis("Ready."), "Ready.");
  assert.equal(stripTrailingEllipsis("Running tool"), "Running tool");
  // 空串与纯点边界
  assert.equal(stripTrailingEllipsis(""), "");
  assert.equal(stripTrailingEllipsis("..."), "");
});
