#!/usr/bin/env node
/**
 * cgq0 fork 专属：Web 自托管服务（@zcode/server entry-http + web 静态）一键启停。
 *
 * 用法（仓库根目录执行）：
 *   node cgq0/scripts/serve-web.mjs start [--port 3030] [--host 127.0.0.1] [--token <auth-token>]
 *   node cgq0/scripts/serve-web.mjs stop      # 幂等：没在跑也返回成功
 *   node cgq0/scripts/serve-web.mjs status
 *   node cgq0/scripts/serve-web.mjs run       # 前台运行（调试用，Ctrl-C 结束）
 *
 * 行为要点：
 *   - start 幂等：pid 文件里的进程仍活着就拒绝重复拉起（只提示，不报错）；
 *   - 后台脱离：detached 启动，SSH 断开/父进程退出不影响（Windows 同样适用）；
 *   - 进程管理只认 pid 文件，绝不按进程名 grep（命令行自匹配会误杀，见
 *     diary/2026-10-25.lin.md 13:3x 的踩坑记录）；
 *   - 前置条件：packages/server/dist/entry-http.js 与 packages/web/dist 已构建
 *     （pnpm --filter @zcode/server build && pnpm --filter @zcode/web build），
 *     agent 运行时需要 apps/zcode-cli/packages/cli/dist/zcode.cjs
 *     （pnpm --filter "@zcode/cli..." build）；
 *   - 日志：cgq0/tmp/web-serve.log；pid：cgq0/tmp/web-serve.pid。
 */

import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const entryPath = resolve(repoRoot, "packages/server/dist/entry-http.js");
const webDist = resolve(repoRoot, "packages/web/dist");
const pidFile = resolve(repoRoot, "cgq0/tmp/web-serve.pid");
const logFile = resolve(repoRoot, "cgq0/tmp/web-serve.log");

function parseArgs(argv) {
  const out = { command: argv[0] ?? "start", port: "3030", host: "127.0.0.1", token: undefined };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--port") out.port = argv[++i];
    else if (argv[i] === "--host") out.host = argv[++i];
    else if (argv[i] === "--token") out.token = argv[++i];
    else {
      console.error(`未知参数：${argv[i]}（支持 --port/--host/--token）`);
      process.exit(2);
    }
  }
  return out;
}

function readPid() {
  try {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM"; // 无权限探测按存活处理
  }
}

function probeHttp(host, port, timeoutMs = 1500) {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs);
    fetch(`http://${host}:${port}/api/server-info`)
      .then(async (res) => {
        // 必须把 body 读完：未消费的响应流会让 undici 连接挂住，事件循环永不排空，
        // 启动器进程因此退不出去（实测踩坑，见 diary/2026-10-25.lin.md）。
        await res.arrayBuffer();
        clearTimeout(timer);
        resolvePromise(res.ok);
      })
      .catch(() => {
        clearTimeout(timer);
        resolvePromise(false);
      });
  });
}

function buildEnv(options) {
  return {
    ...process.env,
    PORT: options.port,
    ZCODE_SERVER_HOST: options.host,
    ZCODE_WEB_STATIC_ROOT: webDist,
    ...(options.token ? { ZCODE_SERVER_AUTH_TOKEN: options.token } : {}),
  };
}

function assertBuilt() {
  const missing = [
    [entryPath, "packages/server/dist/entry-http.js（pnpm --filter @zcode/server build）"],
    [resolve(webDist, "index.html"), "packages/web/dist（pnpm --filter @zcode/web build）"],
  ].filter(([path]) => !existsSync(path));
  if (missing.length) {
    for (const [, hint] of missing) console.error(`缺少构建产物：${hint}`);
    process.exit(1);
  }
}

async function start(options) {
  assertBuilt();
  const pid = readPid();
  if (isAlive(pid)) {
    const up = await probeHttp(options.host, options.port);
    console.log(`已在运行（pid ${pid}，http 探测 ${up ? "正常" : "未就绪/端口不同"}），跳过启动`);
    return;
  }
  if (pid) rmSync(pidFile, { force: true }); // 清理陈旧 pid 文件
  const logFd = openSync(logFile, "a");
  const child = spawn(process.execPath, [entryPath], {
    cwd: repoRoot,
    env: buildEnv(options),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  writeFileSync(pidFile, `${child.pid}\n`);
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (!isAlive(child.pid)) {
      console.error(`进程退出，查看日志：${logFile}`);
      process.exit(1);
    }
    if (await probeHttp(options.host, options.port)) {
      console.log(`已启动：http://${options.host}:${options.port}（pid ${child.pid}，后台脱离）`);
      console.log(`日志：${logFile}；停止：node cgq0/scripts/serve-web.mjs stop`);
      return;
    }
  }
  console.log(`进程运行中（pid ${child.pid}）但 http 未就绪，查看日志：${logFile}`);
}

async function stop() {
  const pid = readPid();
  if (!isAlive(pid)) {
    if (pid) rmSync(pidFile, { force: true });
    console.log("未在运行");
    return;
  }
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 10 && isAlive(pid); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (isAlive(pid)) {
    process.kill(pid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 300));
  }
  rmSync(pidFile, { force: true });
  console.log(`已停止（pid ${pid}）`);
}

async function status(options) {
  const pid = readPid();
  if (!isAlive(pid)) {
    console.log("状态：未运行");
    return;
  }
  const up = await probeHttp(options.host, options.port);
  console.log(`状态：运行中（pid ${pid}，http://${options.host}:${options.port} 探测 ${up ? "正常" : "未就绪"}）`);
}

async function run(options) {
  assertBuilt();
  const child = spawn(process.execPath, [entryPath], {
    cwd: repoRoot,
    env: buildEnv(options),
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

const options = parseArgs(process.argv.slice(2));
switch (options.command) {
  case "start":
    await start(options);
    break;
  case "stop":
    await stop();
    break;
  case "status":
    await status(options);
    break;
  case "run":
    await run(options);
    break;
  default:
    console.error(`未知命令：${options.command}（支持 start/stop/status/run）`);
    process.exit(2);
}
// fetch/子进程句柄兜底：命令完成后显式退出，防止 keep-alive 连接拖住进程。
process.exit(0);
