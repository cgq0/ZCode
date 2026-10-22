#!/usr/bin/env node
// heap-snapshot.mjs — 对已开 inspector 的 zcode-cli 进程远程取 V8 堆快照。
// 前置: kill -USR1 <pid>   (Node/SEA 进程收到 SIGUSR1 会在 127.0.0.1:9229 开 inspector)
// 用法: node cgq0/scripts/heap-snapshot.mjs [port]   (默认 9229)
// 产物: cgq0/tmp/heap-<pid>-<ts>.heapsnapshot
// 判读: 若堆快照 "正常"(几十~几百 MB)而 footprint 爆炸 → 泄漏在堆外(Buffer/WASM/原生)。
import { writeFileSync } from "node:fs";

const port = process.argv[2] ?? "9229";
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const target = list.find((t) => t.webSocketDebuggerUrl);
if (!target) throw new Error(`no debuggable target: ${JSON.stringify(list)}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const chunks = [];
ws.onmessage = async (event) => {
  const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    return;
  }
  if (msg.method === "HeapProfiler.addHeapSnapshotChunk") chunks.push(msg.params.chunk);
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

const out = `cgq0/tmp/heap-${target.id?.replace(/[^a-z0-9-]/gi, "") ?? "proc"}-${Date.now()}.heapsnapshot`;
await send("HeapProfiler.enable");
await send("HeapProfiler.collectGarbage"); // 先 GC 再快照：活对象才计入，排除垃圾干扰
await send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
ws.close();
writeFileSync(out, chunks.join(""));
console.log(`saved ${out} (${(chunks.join("").length / 1048576).toFixed(1)} MB)`);
