# Fork Build Metadata Version Identity Design

## Feature/change summary

上游同一版本号（如 v0.17.0）对应多份代码与多个构建；本 fork 在其上修复缺陷后，构建产物
仍只报 package.json 的 version，`--version` 无法区分「修过 bug」与「没修过」的运行实例，
影响问题报告、取证与回滚定位（背景讨论见 diary/2026-10-21.mac.md 22:38 条目）。

方案：构建时从 git 推导 fork 身份，按 **SemVer build metadata（`+` 后缀）** 附加到版本号：

```
0.17.0+cq.<n>.g<sha>[.dirty]
```

- `n` = 领先最近可达 tag 的提交数（`git describe --tags --long` 的 distance）；
- `sha` = HEAD 短 SHA（`g` 前缀 + describe 输出）；
- `dirty` = 工作区有未提交改动（`git describe --dirty`）。

`__CLI_VERSION__` 仍由 `packages/cli/scripts/build.mjs` 注入，消费方（`run.ts --version`、
help、telemetry `cliVersion`）零改动——版本号在 CLI/TUI 全链路只作不透明字符串透传，
无 semver 解析/比较点（已核查）。

## Rules（产品规则与取舍）

1. **用 `+` build metadata，不用 `-` 预发布、不用 `#`**：`-revx` 会被 SemVer 判为低于
   正式版（`>=0.17.0` 匹配不到），`#` 非法字符；`+` 后缀不参与优先级比较，构建既等于
   基线版本又唯一可辨。
2. **tag 名不入 metadata**：本仓库 tag 是 `zcode-cli-v3.16.2` 的 monorepo 风格，与 CLI
   package.json 的 0.x 不同源；只有提交距离 + SHA 是跨命名体系可信的字段。tag 版本与
   package 版本是否一致不做校验，SHA 是最终事实。
3. **package.json 版本保持与上游同步**，fork 身份只存在于构建产物——上游合并冲突面为零。
4. **git 失败不挡构建**（版本只影响可辨识度），回退链：
   `describe`（无 tag/浅克隆失败）→ `rev-parse --short HEAD`（`cq.dev.g<sha>`）→
   `cq.dev`（tarball 等非 git 检出）。
5. **base 已残留 `+` metadata 时整体重建**，不叠加多段；metadata 经
   `[0-9A-Za-z-.]` 白名单校验，异常 tag 解析出脏数据按失败走回退。
6. dev 构建、`--desktop-agent`、SEA 三条路径同走 `buildCli`，自动继承，无旁路注入点。

## Interfaces

- `build.mjs` 新增导出（均在 `tests/build.test.mjs` 覆盖）：
  - `parseGitDescribeToBuildMetadata(output)`：`<tag>-<n>-g<sha>[-dirty]` →
    `cq.<n>.g<sha>[.dirty]`，不可解析返回 `undefined`（懒惰匹配 + 整体锚定，容忍 tag 内 `-`）；
  - `resolveForkBuildMetadata({ cwd?, execGit? })`：回退链编排，`execGit` 可注入供测试；
  - `resolveForkCliVersion({ baseVersion, cwd?, execGit? })`：`base + "+" + metadata`。
- `buildCli` 内部把 `await version` 换成 `resolveForkCliVersion({ baseVersion: await version })`，
  对外签名不变。

## Non-goals

- 不改 `apps/zcode-cli/package.json` 的 version 字段语义（继续与上游同步）。
- 不改桌面端 About/诊断页对 cliVersion 的透传展示（待后续单独裁决）。
- 不加构建日期段（短 SHA 已隐含顺序，避免冗余）。
- 不在 SEA 冒烟（`build-sea.mjs` 的 `--version` 探测）里解析版本内容。

## Scenarios（验收）

1. git 正常检出：`node scripts/build.mjs` 后 `node dist/zcode.cjs --version` 输出
   `0.17.0+cq.<n>.g<sha>`；工作区有未提交改动时以 `.dirty` 结尾。
   实测：`0.17.0+cq.9.gd4bbd48d.dirty`（改动未提交时构建）。
2. describe 解析：`zcode-cli-v3.16.2-9-gd4bbd48d` → `cq.9.gd4bbd48d`；`-dirty` 尾缀、
   预发布 tag（`v0.17.0-rc.1-3-gabc1234`）、垃圾输入、空串各分支正确。
3. 回退链：describe 失败 → `cq.dev.g<短SHA>`；rev-parse 输出非 hex → `cq.dev`；
   git 完全缺失 → `cq.dev`；base 带 `+stale` → 重建而非叠加。
4. 既有 `tests/build.test.mjs` 14/14 全绿（含新增 2 用例）；cli oxlint 0/0、oxfmt 干净、
   `architecture:check --changed` 0 违规；typecheck 不涉及（tsconfig 仅含 `src/**/*`，
   本次纯 `.mjs`）。
