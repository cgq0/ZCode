import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const moduleDir = import.meta.dirname;

function findPackageDir(packageName, startDirs) {
  for (const startDir of startDirs) {
    let currentDir = resolve(startDir);

    while (true) {
      const packageJsonPath = resolve(currentDir, "package.json");
      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = readJson(packageJsonPath);
          if (packageJson.name === packageName) {
            return currentDir;
          }
        } catch {
          // ignore invalid package.json and continue walking up
        }
      }

      const parentDir = resolve(currentDir, "..");
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  }

  throw new Error(`Unable to find package directory for ${packageName}`);
}

const desktopDir = findPackageDir("@zcode/desktop", [
  moduleDir,
  resolve(moduleDir, ".."),
  process.cwd(),
]);
const workspaceDir = resolve(desktopDir, "../..");
const metadataDir = resolve(desktopDir, "out/metadata");
const metadataPath = resolve(metadataDir, "build-meta.json");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function normalizeVersion(version) {
  if (typeof version !== "string" || version.length === 0) {
    return "unknown";
  }

  const normalized = version.replace(/^[^\d]*/, "");
  return normalized || version;
}

function resolveInstalledPackageVersion(packageName, fallbackVersion) {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`, { paths: [desktopDir] });
    return normalizeVersion(readJson(packageJsonPath).version);
  } catch {
    return normalizeVersion(fallbackVersion);
  }
}

function resolveCommitId() {
  try {
    return execSync("git rev-parse --short=8 HEAD", {
      cwd: workspaceDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return process.env.ZCODE_COMMIT ?? "unknown";
  }
}

// fork 构建身份（cq.<n>.g<sha>[.dirty]），与 apps/zcode-cli/packages/cli/scripts/build.mjs
// 的 parseGitDescribeToBuildMetadata 同一语义；跨包无法直接 import 该 ESM，这里独立维护
// 同款正则（该处语义由其 build.test.mjs 锚定）。macOS 的 CFBundleShortVersionString 只接受
// 纯数字三段版本，`+cq...` 进不了系统版本号，About 的身份展示走本字段。CI 全量历史下与
// Release zip 文件名、cli/server 二进制 --version 三处一致（2026-10-24 统一发版裁决）。
function resolveForkBuildMeta() {
  const override = process.env.ZCODE_FORK_BUILD_META?.trim();
  if (override) return override;
  try {
    const out = execSync("git describe --tags --long --dirty", {
      cwd: workspaceDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const match = /^(.+?)-(\d+)-g([0-9a-f]+)(-dirty)?$/.exec(out);
    if (match) {
      return ["cq", match[2], `g${match[3]}`, match[4] && "dirty"].filter(Boolean).join(".");
    }
  } catch {
    // 无 tag 或非 git 检出：走 rev-parse 回退。
  }
  try {
    const shortSha = execSync("git rev-parse --short HEAD", {
      cwd: workspaceDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (/^[0-9a-f]{4,40}$/.test(shortSha)) return `cq.dev.g${shortSha}`;
  } catch {
    // rev-parse 也失败：不是 git 检出。
  }
  return "cq.dev";
}

export function collectBuildMetadata() {
  const rootPackageJson = readJson(resolve(workspaceDir, "package.json"));
  const desktopPackageJson = readJson(resolve(desktopDir, "package.json"));

  return {
    appVersion: normalizeVersion(rootPackageJson.version),
    minCompatibleVersion: normalizeVersion(
      rootPackageJson.zcodeCompatibility?.minCompatibleVersion ?? rootPackageJson.version,
    ),
    buildCommitId: resolveCommitId(),
    forkBuildMeta: resolveForkBuildMeta(),
    buildTime: new Date().toISOString(),
    electronBuilderVersion: resolveInstalledPackageVersion(
      "electron-builder",
      desktopPackageJson.devDependencies?.["electron-builder"],
    ),
  };
}

export function readBuildMetadata() {
  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    const metadata = readJson(metadataPath);
    return {
      ...metadata,
      minCompatibleVersion:
        typeof metadata.minCompatibleVersion === "string" && metadata.minCompatibleVersion.length > 0
          ? normalizeVersion(metadata.minCompatibleVersion)
          : normalizeVersion(metadata.appVersion),
    };
  } catch {
    return null;
  }
}

export function getBuildMetadata() {
  return readBuildMetadata() ?? collectBuildMetadata();
}

export function writeBuildMetadata() {
  // About 之前分别在 tsup、vite 里各算一份 commit 和时间。
  // 问题原因：两次构建是独立进程，时间点天然不一致；后面再打包时，最终安装包里展示的信息也不一定对应同一次产物。
  // 这里先统一落盘成 build-meta.json，再让构建和运行时都复用同一份数据，保证 about 可追溯。
  const metadata = collectBuildMetadata();
  mkdirSync(metadataDir, { recursive: true });
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
  return metadata;
}

export function getBuildMetadataPath() {
  return metadataPath;
}

const entryFilePath = process.argv[1] ? resolve(process.argv[1]) : null;
const currentFilePath = fileURLToPath(import.meta.url);

if (entryFilePath === currentFilePath) {
  const metadata = writeBuildMetadata();
  process.stdout.write(`[build-meta] wrote ${metadataPath}\n`);
  process.stdout.write(
    `[build-meta] commit=${metadata.buildCommitId} time=${metadata.buildTime}\n`,
  );
}
