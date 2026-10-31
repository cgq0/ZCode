# 独立 Server Webapp「此电脑」建项目被误判为设备已移除 Design

日期：2026-10-31 · 状态：已裁决（修复方案 b：origin 身份注入 + 创建流本地语义收尾）· 关联：2026-10-27 `standalone-server-no-projectless-entry-design.md`、d53e646b（「此电脑」local 路由修复）、2026-10-10 远程裁决

## 背景与事故

自托管 webapp（zcode-serve → entry-http）浏览器端，composer 菜单「新建项目」→ 选择服务器上的目录 → 创建，弹错误「此设备已从项目列表移除，请重新选择设备。」（`project.hostRemoved`）。项目实际已在服务端创建（侧栏可见），但创建弹窗不关闭、草稿不自动选中新项目，重试永远报同一错误。

## 根因链（代码证据，已确认）

```text
UI ProjectEditor.save (ProjectEditor.tsx)
  ├─ onBeforeSave("local") → ProjectCreation.prepareHost("local") 提前 return（:116），不登记 host
  ├─ service.saveProject({hostId:"local", roots})            ← RPC → standalone Server
  │    服务端 route("local") 归一为本机路由（d53e646b，project/index.ts:91）
  │    repository.saveProject：const hostId = this.ownerHostId ?? "local"（project-repository.ts:231）
  │    → 返回项目携带 hostId = remote:server:<serverId>（存储 owner，node.ts:3227 强制）
  ├─ await onSaved(saved) → ProjectCreation.saved (ProjectCreation.tsx:143)
  │    project.hostId !== "local" 成立（返回值是 owner 身份）
  │    admittedHosts.get(owner)：webapp 的远端目录恒为空（remote service controller=false，
  │    node.ts:2169 → remote-projects/index.ts:124），prepareHost("local") 又从未登记
  │    → throw "remote-project.host-removed"（:147）
  └─ catch → formatProjectError（view.ts:269）→ project.hostRemoved 文案
```

触发前提是 d53e646b（2026-10-25）把字面量 `"local"` 归一为本机路由，让浏览器「此电脑」建项目首次可达；该提交的端到端验证漏看了这个报错（项目已创建并被 prepend 进侧栏，流程可以被手动继续，但弹窗报错且自动导航从未发生）。上游同步的 `ProjectCreation.saved`（0a1fc56d）按桌面语义写死：返回值 hostId ≠ "local" ⇒ 必须是已登记的远端设备。6110996a（10-27）只 gate 了「不在项目中工作」入口，与本 bug 无关。

次生问题（同一根因，必须一并修）：`saved()` 的导航 `onCreateTask({hostId: project.hostId})` 传 owner 身份时，Root 会走 `openRemoteProjectWorkspace` 远端链路（useRootWorkspaceActions.ts:383）——webapp 没有（也不该有）指向自身的远端会话。所以修复不能只放行错误，必须把 owner 身份映射回 `"local"` 收尾。

## 规则（产品裁决）

独立 Server webapp 的「此电脑」= origin server 自身；其存储 owner（`remote:server:<serverId>`，可由 `/api/server-info` 的 `serverId` 派生）与字面量 `"local"` 是同一台设备的两种写法。创建流中：

- 服务端返回的项目 hostId 等于 origin owner 时，按**本地项目**收尾：不做远端成员登记（`addEntry`，standalone 的 remote service 是 controller=false，该模型不存在）、不抛 host-removed、导航 `hostId` 使用 `"local"`；
- 桌面（store 未注入，owner 未知）行为完全不变：返回值 `"local"` 走本地分支，真远端设备未登记仍然抛 host-removed（守卫保留）；
- 手机远控（bootstrap 跳过 server-info，不走注入）不变。

不在范围：desktop-attached-remote 场景（桌面作为 controller 连远端 Server）的空目录表现是另一条链路；webapp 无项目直接发送被 fail-closed 拒绝是上游设计（见 2026-10-27 spec）。

## 合同与所有权

```text
server-info（事实源，单写者：http.ts createServerInfo；serverId 字段已存在）
  └─ web main.tsx resolveWebBootstrap（唯一写者，Root 渲染前一次性注入）
       ├─ setOriginServerProjectlessConversationWorkspaces(...)   （既有）
       └─ setOriginServerOwnerHostId(serverInfo.serverId)          （新增）
            store 内部用 shared 身份工具派生 hostId，禁止手写格式
originServerCapabilitiesStore（renderer 只读镜像；桌面/手机不注入 → 缺省 null = 未知）
  └─ ProjectCreation.saved（唯一读者）：
       isLocalProject = hostId === "local" || hostId === store.ownerHostId
```

- 事件序：注入先于 Root render；`saved()` 是异步事件处理器，读 `getState()` 不订阅。无重连/失效路径（进程级静态事实，整页刷新重取）。
- 身份派生只允许 `buildServerRemoteWorkspaceIdentity` + `remoteHostIdFromWorkspaceIdentity`（AGENTS.md：不在业务代码手写 identity 格式）。

## 验收场景

1. webapp「此电脑」新建项目（选目录或空项目）：保存成功、无错误文案、弹窗关闭、草稿自动选中新项目（`onCreateTask` 收到 `hostId:"local"`），不调用 `addEntry`。
2. 桌面：owner 未注入时，返回 `"local"` 的创建与改动前一致；返回未登记 hostId 仍报「此设备已从项目列表移除」（回归守卫）。
3. 桌面远端设备建项目：prepareHost 登记 → `addEntry` 照旧（不误伤既有测试场景）。
4. 手机远控：不注入、不触发本地映射（行为不变）。
