# Fork Build Metadata Version Identity Design

## Feature/change summary

上游同一版本号（如 v0.17.0）对应多份代码与多个构建；本 fork 在其上修复缺陷后，构建产物
仍只报 package.json 的 version，`--version` 无法区分「修过 bug」与「没修过」的运行实例，
影响问题报告、取证与回滚定位（背景讨论见 diary/2026-10-21.mac.md 22:38 条目）。

方案：构建时从 git 推导 fork 身份，按 **SemVer build metadata（`+` 后缀）** 附加到版本号
（base 版本自 2026-10-24 起读 monorepo 根 package.json，如 `3.16.2`）：

```
<根版本>+cq.<n>.g<sha>[.dirty]
```

- `n` = 距**最近一次官方上游同步合并提交**的提交数（`git rev-list --count <sync-merge>..HEAD`；
  2026-10-25 裁决，见规则 2；tag 基线的 describe 口径降级为回退）；
- `sha` = HEAD 短 SHA；
- `dirty` = 工作区有未提交改动（`git status --porcelain` 非空）。

`__CLI_VERSION__` 仍由 `packages/cli/scripts/build.mjs` 注入，消费方（`run.ts --version`、
help、telemetry `cliVersion`）零改动——版本号在 CLI/TUI 全链路只作不透明字符串透传，
无 semver 解析/比较点（已核查）。

## Rules（产品规则与取舍）

1. **用 `+` build metadata，不用 `-` 预发布、不用 `#`**：`-revx` 会被 SemVer 判为低于
   正式版（`>=0.17.0` 匹配不到），`#` 非法字符；`+` 后缀不参与优先级比较，构建既等于
   基线版本又唯一可辨。
2. **基线锚点 = 最近官方同步合并提交（2026-10-25 裁决）**：从 HEAD 可达的最近 merge
   commit 且 subject 含 `zai-org:main` 或 `upstream/main`（两个 `--grep` 天然 OR，覆盖
   GitHub Sync fork 按钮与 sync-upstream.yml 两种产物格式），计数
   `git rev-list --count <锚点>..HEAD`。理由：fork 自己的发版 tag（如 `v3.16.2`）落在
   fork 提交上，作 describe 基线会把计数重置为「距上次发版」——实证：v3.16.2 发布后
   dev 本地构建得 `cq.2`，计数失义；发布值 `cq.41` 恰为同步点基线纯属 CI 构建时该 tag
   尚未创建的巧合。切换当日计数一次性跳变（`cq.2` → `cq.43`），与 2026-10-24 tag 改名
   跳变同类，无兼容性影响。SHA 是最终事实，tag/同步合并的版本号是否一致不做校验。
3. **package.json 版本保持与上游同步**，fork 身份只存在于构建产物——上游合并冲突面为零。
4. **git 失败不挡构建**（版本只影响可辨识度），回退链：找不到同步合并 →
   `describe --tags --long --dirty`（tag 基线旧口径）→ `rev-parse --short HEAD`
   （`cq.dev.g<sha>`）→ `cq.dev`（tarball 等非 git 检出）。
5. **base 已残留 `+` metadata 时整体重建**，不叠加多段；metadata 经
   `[0-9A-Za-z-.]` 白名单校验，异常 tag 解析出脏数据按失败走回退。
6. dev 构建、`--desktop-agent`、SEA 三条路径同走 `buildCli`，自动继承，无旁路注入点。
7. **CI 构建必须 `fetch-depth: 0`**：`actions/checkout@v4` 默认浅克隆且不带 tag，
   `git describe` 会失败（2026-10-21 本地浅克隆实证：`No names found`），基线定位的
   `git rev-list` 同样需要全量历史；缺历史时产物退化为 `cq.dev.g<sha>`（SHA 仍可
   追溯但丢失提交距离）。`release.yml`（2026-10-24 自 release-cli.yml 改名）各 job
   checkout 显式取全量历史 + tag，距离字段才成立。
8. **dev 分支保持零 CI**：workflow 触发只有 `push: main` + `workflow_dispatch`，dev
   推送天然静默（fork 有意为之，2026-10-21 用户裁决）；将来 dev 上若出现任何
   workflow 触发配置都视为偏离本规则。

## Interfaces

- `build.mjs` 新增导出（均在 `tests/build.test.mjs` 覆盖）：
  - `parseGitDescribeToBuildMetadata(output)`：`<tag>-<n>-g<sha>[-dirty]` →
    `cq.<n>.g<sha>[.dirty]`，不可解析返回 `undefined`（懒惰匹配 + 整体锚定，容忍 tag 内 `-`）；
  - `resolveForkBuildMetadata({ cwd?, execGit? })`：回退链编排，`execGit` 可注入供测试；
  - `resolveForkCliVersion({ baseVersion, cwd?, execGit? })`：`base + "+" + metadata`。
- `buildCli` 内部把 `await version` 换成 `resolveForkCliVersion({ baseVersion: await version })`，
  对外签名不变。
- **共享模块 `scripts/fork-build-meta.mjs`（2026-10-25 新增）**：基线定位 + 元数据拼装
  单点实现（`resolveForkBuildMeta({ cwd?, execGit? })`，execGit 可注入供测试），CLI 直跑
  `node scripts/fork-build-meta.mjs` 打印结果供 workflow 消费（输出非 `cq.*` 时非零
  退出）。`build.mjs` 与 desktop `packages/desktop/scripts/build-metadata.mjs`（保留
  `ZCODE_FORK_BUILD_META` env 覆盖）均改引此模块，消除三处同语义复制；
  `parseGitDescribeToBuildMetadata` 仍由 `build.mjs` 导出，供测试与 describe 回退共用。

## Release 打包与发版语义（2026-10-21 第二轮裁决）

用户裁决：zip 打包、包内固定名、固定单条 Release。规则：

1. **zip 是唯一发行形态（2026-10-24 起三产物各一条 zip）**：
   `zcode-v<版本>-<meta>-<target>.zip`（如 `zcode-v3.16.2-cq.43.g8527891c-darwin-x64.zip`），
   cli/server/darwin-x64 桌面 app 同 commit 同版本；包内可执行文件名恒定（`zcode-cli`，
   Windows `zcode-cli.exe`；`zcode-server/` 为 staged 发行目录）——安装路径与脚本不随
   构建漂移，身份由 zip 文件名 + 二进制 `--version` 双重承载。
2. **tag 恒为 `v<根版本>`（2026-10-24 起，此前 `zcode-cli-v*`）**，每个版本只有一条
   Release；每次 push 刷新标题（`ZCode fork v<版本> · <meta>`）与说明（构建 commit
   随之更新），资产先删后传整体替换——页面上只有最新一份且文件名与本次构建一一对应。
   旧构建经 Actions run artifacts 回溯（保留 14 天）。
3. **元数据一致性**：build job（注入 `__CLI_VERSION__`）与 release job 独立解析同一
   SHA + 全量历史，结果必然一致；workflow 两侧均改跑共享脚本
   `scripts/fork-build-meta.mjs`（2026-10-25，消除 inline node 复制），语义由
   `build.test.mjs` 锚定。workflow 侧解析异常直接 fail——资产名与二进制身份
   不一致比构建失败更糟（与规则 4 的"本地不挡构建"不同：CI 有全量历史，
   解析失败说明流程假设已破）。
4. **force_release input 移除**：固定 Release 语义下每次 push 都刷新资产，
   "强制覆盖"开关失去存在意义；`workflow_dispatch` 保留为手动重跑入口。

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
5. 浅克隆回退：`git clone --depth 1 --no-tags` 的检出里 describe 失败，产物版本为
   `0.17.0+cq.dev.g<sha>`（本地实证 `f269ecf0`），构建不报错。
6. CI 产物（release-cli run artifacts）内的二进制 `--version` 含 `cq.<n>.g<sha>`；
   push 触发的 run 由 CI 日志/产物验证（主分支 push 即生效）。
7. CI run 产物为 4 个 zip + 4 个 `SHA256SUMS-<target>.txt`（校验对象是 zip）；
   Release `zcode-cli-v3.16.2` 标题带同元数据，资产整体替换无旧残留（连续两次
   push 后页面上只有第二次的 zip）。zip 内为固定名 `zcode-cli`/`zcode-cli.exe`。
8. 本地模拟打包逻辑实证（2026-10-21）：zip 命名、包内文件名、执行位、校验和
   内容与规则一致；workflow 侧 META 解析输出与 `build.mjs` 的
   `parseGitDescribeToBuildMetadata` 对同一 describe 输入结果一致。
9. 同步点基线（2026-10-25）：本机实跑 `node scripts/fork-build-meta.mjs` 输出
   `cq.43.g8527891c`（HEAD=8527891c，最近同步合并 5ad928cc，
   `rev-list --count 5ad928cc..HEAD` = 43）；工作区脏时以 `.dirty` 结尾。
   无同步合并的检出回退 describe 口径；workflow 内解析失败则该 job 硬失败。
