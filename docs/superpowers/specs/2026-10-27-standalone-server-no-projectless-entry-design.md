# 独立 Server 隐藏「不在项目中工作」入口 Design

日期：2026-10-27 · 状态：已裁决（用户选定方案 a：隐藏入口）· 关联：2026-10-10 远程裁决（`2026-10-10-session-manage-upstream-integration.md`）、d53e646b（Web「此电脑」local 路由修复）

## 背景与事故

自托管 webapp（entry-http，即 zcode-serve 启动的 zcode-web-server.cjs）中，用户在 composer 菜单选「不在项目中工作」后发送消息必败：`sendConversationCommandV4` → `prepareSessionCreation` → `ProjectRepository.reserveCreatedTask` → `assertRemoteTaskDirectories` 抛 `project.remote-project-required`（remote-policy.ts:23），日志 6 次重试全败（2026-10-27 22:51，cq.75 包）。

根因链（三层叠加，均已在源码与日志核实）：

1. standalone Server 存储 owner 恒为非 local 的 `remote:server:<id>`（`node.ts:3227` 强制，注释「入口不得以 local owner 开放远端项目 RPC」）；`assertRemoteTaskDirectories` 对该 owner 下一切无项目任务拒绝。这是上游 2026-10-10 裁决「远程先建单目录项目再建会话，不允许无项目创建」的 fail-closed 实现，**不是 bug**。
2. UI 侧 `hostId` 由 `workspaceIdentity` 推导（`ProjectComposerMenu.tsx:256`），菜单项仅在 `!hostId` 时渲染（:522）；webapp 根 workspace 无 identity（entry-http 的 server-info workspaces 只给 `path/label`），于是 UI 误判「此电脑」，渲染出必败入口。
3. d53e646b（随 cq.75 发布）让浏览器端「此电脑」目录浏览/建项目可用（字面量 `hostId:"local"` 归一为 owner 本机路由），正是它让这条死路首次可达。守卫与策略均为上游同步代码（0a1fc56d）。

日志佐证：该 webapp `sendConversationCommandV4` 6 FAIL / 0 OK、`saveProject` 调用为 0 —— 用户没有任何项目，唯一可点入口就是死路。

## 规则（产品裁决）

独立 Server 不提供无项目会话。UI 在「origin server 声明不支持无项目会话」时：

- 隐藏 composer 菜单的「不在项目中工作」项（`work_outside_project`，ProjectComposerMenu.tsx:522）；
- 同步禁用「脱离项目」入口（`canDetachProject`，:270——它是同一规则的反向门）。

不受影响的面：桌面 UI（不经此合同，默认支持无项目）；手机远控（走 `/ws/remote/<id>` 不读 origin server-info，workspace 恒带 identity，既有 `!hostId` gate 已隐藏）；AutomationEditView 同款文案是定时任务合法的虚拟项目选择器，不 gate；webapp 的目录浏览/建项目/项目内会话（d53e646b 成果）全部保留。

已知边界（不在本次范围）：webapp 无任何项目时，composer 直接发送同样被服务端 fail-closed 拒绝——这是上游设计；空态由菜单的 ProjectCreation 引导建项目。错误文案优化另立任务。

## 合同与所有权

```text
server-info capabilities（事实源，单写者：server http.ts createServerInfo）
  └─ 新增 optional: projectlessConversationWorkspaces: boolean
     缺省 = 支持（桌面 UI 不经此合同）；entry-http（standalone 唯一 producer）显式 false
web main.tsx resolveWebBootstrap（单次读取，唯一写者）
  └─ 注入 originServerCapabilitiesStore（renderer 只读镜像，不二次推导）
ProjectComposerMenu（读者）
  └─ gate = allowConversationWorkspaceSelection && !hostId && store.projectlessConversationWorkspaces
```

- Schema：wire（`serverRemoteInfoSchema`）与 strict output（`serverRemoteInfoOutputSchema`）同步加字段，沿 `processResourceTelemetry` 先例；同 `protocolVersion=1` 下 additive optional，旧客户端忽略（server-remote.ts:12 既定规则）。
- 事件序：bootstrap 先于 Root render 完成 store 注入；菜单读取发生在 render 期，不产生异步竞态。无重连/失效路径（capability 为进程级静态事实，页面刷新即重取）。
- 桌面/手机交付语义不变（本次不触碰 stream/snapshot/queue）。

## 验收场景

1. entry-http 启动的 webapp：`/api/server-info` 返回 `capabilities.projectlessConversationWorkspaces === false`；composer 菜单无「不在项目中工作」；已绑定项目时脱离（X）入口不可用。
2. 桌面：store 未注入默认 true，菜单项与脱离行为与改动前一致。
3. 旧 Server（无该字段）：wire schema 解析兼容，UI 按缺省支持处理。
4. 定时任务编辑页仍可选「不在项目中工作」文案的虚拟项目（不误伤）。
