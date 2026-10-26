#!/usr/bin/env node
/**
 * cgq0 fork 专属：staging 自托管 Web 应用运行时目录 zcode-webapp/（选 B 方案，2026-10-25 裁决）。
 *
 * 用法（仓库根目录，产物已构建后执行）：
 *   node cgq0/scripts/stage-webapp.mjs --target linux-x64|win32-x64|darwin-x64|darwin-arm64 --out <dir>
 *
 * 产出布局（启动器 zcode-serve/zcode-serve.ps1 按同构约定寻址）：
 *   <out>/zcode-web-server.cjs      packages/server/dist/remote（entry-http 自包含 bundle）
 *   <out>/build/Release/            node-pty 原生模块（bundle 同目录约定，与远端部署一致）
 *   <out>/web/                      packages/web/dist（浏览器静态前端）
 *   <out>/agent/zcode.cjs           agent 运行时（GLM_BINARY_PATH 指向它，Node 直跑）
 *   <out>/node/node(.exe)           随包 Node（复用 zcode-server-cli 的缓存/镜像链）
 *   <out>/THIRD-PARTY-NOTICES.md    第三方声明
 *
 * 前置：pnpm --filter @zcode/server build（含 build:remote）、--filter @zcode/web build、
 * "--filter @zcode/cli..." build（产 dist/zcode.cjs）。缺一即报错退出。
 * Node 下载策略与 stageCli.ensureNodeBinary 一致：mock-cdn 缓存 → node_modules/.cache
 * 自有缓存 → Node dist 镜像（ZCODE_NODE_DIST_MIRROR 可覆盖，默认 npmmirror）。
 */

import { spawn } from "node:child_process";
import { access, chmod, copyFile, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const NODE_VERSION = "22.16.0";
const DEFAULT_NODE_DIST_BASE = "https://cdn.npmmirror.com/binaries/node";

const repoRoot = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
const target = argValue("--target");
const outDir = argValue("--out");
if (!target || !outDir) {
  console.error("用法: node cgq0/scripts/stage-webapp.mjs --target <t> --out <dir>");
  process.exit(2);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, commandArgs, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, { cwd, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", rejectPromise);
    child.once("exit", (code) =>
      code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited ${code}`)),
    );
  });
}

async function downloadFile(url, to) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed ${response.status}: ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(to));
}

/** 与 stageCli.ensureNodeBinary 同链：mock-cdn 缓存 → 自有缓存 → 镜像下载解包。 */
async function ensureNodeBinary() {
  const nodeVersion = `v${NODE_VERSION}`;
  const isWindows = target.startsWith("win32-");
  const nodeTarget = isWindows ? target.replace(/^win32-/u, "win-") : target;
  const binaryName = isWindows ? "node.exe" : "node";

  const mockCdnReleasesDir = join(repoRoot, "packages/desktop/mock-cdn/releases");
  if (await pathExists(mockCdnReleasesDir)) {
    for (const entry of (await readdir(mockCdnReleasesDir)).sort().reverse()) {
      const candidate = join(mockCdnReleasesDir, entry, "node", target, binaryName);
      if (await pathExists(candidate)) {
        console.log(`[webapp] reuse mock-cdn node: ${candidate}`);
        return candidate;
      }
    }
  }

  const cacheDir = join(
    repoRoot,
    "node_modules/.cache/zcode-server-cli",
    `node-${nodeVersion}-${target}`,
  );
  const cached = join(cacheDir, binaryName);
  if (await pathExists(cached)) {
    console.log(`[webapp] reuse cached node: ${cached}`);
    return cached;
  }

  const mirror = (process.env.ZCODE_NODE_DIST_MIRROR?.trim() || DEFAULT_NODE_DIST_BASE).replace(
    /\/+$/u,
    "",
  );
  const archiveName = `node-${nodeVersion}-${nodeTarget}.${isWindows ? "zip" : "tar.xz"}`;
  const url = `${mirror}/${nodeVersion}/${archiveName}`;
  console.log(`[webapp] download node: ${url}`);
  const tempDir = await mkdtemp(join(tmpdir(), "zcode-webapp-node-"));
  // Windows 下优先用系统自带 bsdtar（System32\tar.exe）：Git Bash 的 MSYS tar 会把
  // "C:\..." 参数当作 host:path 远程语法（实测报 tar: Cannot connect to C: resolve failed），
  // 原生 PATH 里 Git\usr\bin 又排在 System32 前面，按名 spawn 会命中 MSYS tar。
  const windowsTar = process.env.SystemRoot
    ? join(process.env.SystemRoot, "System32", "tar.exe")
    : "tar";
  const tarBin = isWindows && (await pathExists(windowsTar)) ? windowsTar : "tar";
  try {
    const archivePath = join(tempDir, archiveName);
    await downloadFile(url, archivePath);
    await mkdir(cacheDir, { recursive: true });
    if (isWindows) {
      await runCommand(
        tarBin,
        ["-xf", archivePath, "--strip-components=1", "-C", cacheDir, `node-${nodeVersion}-${nodeTarget}/node.exe`],
        repoRoot,
      );
    } else {
      await runCommand(
        tarBin,
        ["-xJf", archivePath, "--strip-components=2", "-C", cacheDir, `node-${nodeVersion}-${nodeTarget}/bin/node`],
        repoRoot,
      );
      await chmod(cached, 0o755);
    }
    return cached;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const serverBundle = join(repoRoot, "packages/server/dist/remote/zcode-web-server.cjs");
  const webDist = join(repoRoot, "packages/web/dist/index.html");
  const agentBundle = join(repoRoot, "apps/zcode-cli/packages/cli/dist/zcode.cjs");
  const notices = join(repoRoot, "packages/server/dist/remote/THIRD-PARTY-NOTICES.md");
  // node-pty 原生模块源目录：Linux CI 无 prebuild，pnpm install 时 node-gyp 源码构建，
  // 产物在 build/Release；Windows/macOS 本地 install 直接落 prebuilds/<plat>-<arch>
  // （prebuild 跨 ABI，随包 node 22 与系统 node 均可加载）。两处布局都要认，
  // 否则 Windows 本地 staging 直接报"缺少产物"（2026-10-25 实测踩坑）。
  const ptyBuildRelease = join(repoRoot, "node_modules/node-pty/build/Release");
  const ptyPrebuilds = join(repoRoot, "node_modules/node-pty/prebuilds", target);
  const ptySourceDir = (await pathExists(join(ptyBuildRelease, "pty.node")))
    ? ptyBuildRelease
    : ptyPrebuilds;
  const ptyNode = join(ptySourceDir, "pty.node");
  for (const [path, hint] of [
    [serverBundle, "pnpm --filter @zcode/server build"],
    [webDist, "pnpm --filter @zcode/web build"],
    [agentBundle, 'pnpm --filter "@zcode/cli..." build'],
    [notices, "pnpm --filter @zcode/server build（build:remote 附声明）"],
    [ptyNode, "pnpm install（node-pty 原生构建或 prebuild 落盘）"],
  ]) {
    if (!(await pathExists(path))) {
      console.error(`[webapp] 缺少产物 ${path}\n  先执行：${hint}`);
      process.exit(1);
    }
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await copyFile(serverBundle, join(outDir, "zcode-web-server.cjs"));
  await copyFile(notices, join(outDir, "THIRD-PARTY-NOTICES.md"));
  await cp(join(repoRoot, "packages/web/dist"), join(outDir, "web"), { recursive: true });
  await mkdir(join(outDir, "agent"), { recursive: true });
  await copyFile(agentBundle, join(outDir, "agent/zcode.cjs"));

  // node-pty 原生模块按 bundle 同目录 build/Release 布局（node-pty loadNativeModule
  // 依次探测 ./build/Release、./prebuilds，staging 统一收敛到 build/Release 一种约定，
  // 与 stdio bundle 的远端部署布局一致）。源目录两种：源码构建（build/Release，只含
  // pty.node + spawn-helper，其余是 node-gyp 中间产物要过滤）或 prebuild 目录（Windows
  // 还需 conpty.node、conpty/（OpenConsole.exe+conpty.dll）、winpty.dll、
  // winpty-agent.exe，缺了终端起不来；*.pdb 调试符号不需要）。子目录按目录整体拷贝。
  await mkdir(join(outDir, "build/Release"), { recursive: true });
  for (const entry of await readdir(ptySourceDir, { withFileTypes: true })) {
    const keep =
      entry.isDirectory() ||
      entry.name.endsWith(".node") ||
      entry.name.endsWith(".dll") ||
      entry.name.endsWith(".exe") ||
      entry.name.startsWith("spawn-helper");
    if (!keep) continue;
    const source = join(ptySourceDir, entry.name);
    const dest = join(outDir, "build/Release", entry.name);
    if (entry.isDirectory()) {
      await cp(source, dest, { recursive: true });
    } else {
      await copyFile(source, dest);
    }
  }

  const nodeBinary = await ensureNodeBinary();
  await mkdir(join(outDir, "node"), { recursive: true });
  await copyFile(nodeBinary, join(outDir, "node", nodeBinary.endsWith(".exe") ? "node.exe" : "node"));

  console.log(`[webapp] staged ${target} -> ${outDir}`);
}

await main();
