import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// fork 构建身份 cq.<n>.g<sha>[.dirty] 的单点实现（2026-10-25 裁决，spec 见
// docs/superpowers/specs/2026-10-21-fork-build-metadata-version-identity-design.md）。
// cli 的 build.mjs、desktop 的 build-metadata.mjs 与 .github/workflows/release.yml
// 三处同引本模块——此前 describe 解析逻辑逐字复制三份，改基线时必须人工保持同步。
//
// 基线锚点 = 从 HEAD 可达的最近「官方上游同步合并提交」：merge commit 且 subject
// 含 `zai-org:main` 或 `upstream/main`（两个 --grep 天然 OR，分别覆盖 GitHub Sync
// fork 按钮与 sync-upstream.yml 的默认 merge 消息）。不能用 fork 自己的发版 tag 作
// 基线：tag 落在 fork 提交上，会把计数重置成「距上次发版」（实证：v3.16.2 发布后
// dev 构建得 cq.2，而发布值 cq.41 才是距同步点的真实距离）。
// 设计约定：同步 API（desktop 的 build-meta 落盘是同步链路，async 化会波及 about
// 消费方）；execGit 可注入供测试；任何 git 失败不挡构建，按回退链降级。

const repoRoot = resolve(import.meta.dirname, "..");
const describeOutputPattern = /^(.+?)-(\d+)-g([0-9a-f]+)(-dirty)?$/;
const buildMetadataPattern = /^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/;
const shortShaPattern = /^[0-9a-f]{4,40}$/;
const mergeShaPattern = /^[0-9a-f]{7,40}$/;

// `describe --tags --long --dirty` 固定输出 `<tag>-<n>-g<sha>[-dirty]`；tag 本身可含
// `-`（如 zcode-cli-v3.16.2），靠懒惰匹配 + 整体锚定把最后两段留给提交数和短 SHA。
export const parseGitDescribeToBuildMetadata = (output) => {
  const match = describeOutputPattern.exec(output.trim());
  if (!match) return undefined;
  return composeForkBuildMetadata({ count: match[2], sha: match[3], dirty: Boolean(match[4]) });
};

// 提交数 + 短 SHA → metadata；输入不合法（异常 tag/计数解析出脏数据）返回 undefined，
// 由调用方按失败走回退。build metadata 只允许 [0-9A-Za-z-] 与点分隔。
export const composeForkBuildMetadata = ({ count, sha, dirty }) => {
  if (!/^\d+$/.test(count) || !shortShaPattern.test(sha)) return undefined;
  const metadata = ["cq", count, `g${sha}`, ...(dirty ? ["dirty"] : [])].join(".");
  return buildMetadataPattern.test(metadata) ? metadata : undefined;
};

const defaultExecGit = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" });

export const resolveForkBuildMeta = ({ cwd = repoRoot, execGit = defaultExecGit } = {}) => {
  // 1. 官方同步合并锚点。--untracked-files=no 对齐 describe --dirty 语义：
  // 未跟踪文件不算 dirty，只看已跟踪文件的未提交改动。
  try {
    const mergeSha = execGit(
      ["rev-list", "HEAD", "--merges", "--grep=zai-org:main", "--grep=upstream/main", "-1"],
      cwd,
    ).trim();
    if (mergeShaPattern.test(mergeSha)) {
      const count = execGit(["rev-list", "--count", `${mergeSha}..HEAD`], cwd).trim();
      const head = execGit(["rev-parse", "--short", "HEAD"], cwd).trim();
      const dirty = execGit(["status", "--porcelain", "--untracked-files=no"], cwd).trim() !== "";
      const metadata = composeForkBuildMetadata({ count, sha: head, dirty });
      if (metadata) return metadata;
    }
  } catch {
    // 无同步合并或 git 异常：走 describe 回退。
  }
  // 2. tag 基线旧口径（2026-10-25 前的主路径；保留作回退，注意发版 tag 会重置计数）。
  try {
    const metadata = parseGitDescribeToBuildMetadata(
      execGit(["describe", "--tags", "--long", "--dirty"], cwd),
    );
    if (metadata) return metadata;
  } catch {
    // 无 tag 或非 git 检出：走 rev-parse 回退。
  }
  try {
    const shortSha = execGit(["rev-parse", "--short", "HEAD"], cwd).trim();
    if (shortShaPattern.test(shortSha)) return `cq.dev.g${shortSha}`;
  } catch {
    // rev-parse 也失败：不是 git 检出。
  }
  return "cq.dev";
};

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  process.stdout.write(`${resolveForkBuildMeta()}\n`);
}
