import { create } from "zustand";
import {
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
} from "@zcode/shared";

// ============================================================
// origin server（与页面同源的 /api/server-info）capability 与身份在 renderer 的只读镜像
// ============================================================
//
// 事实源是服务端 http.ts 的 createServerInfo；唯一写者是 web main.tsx 的
// resolveWebBootstrap（Root 渲染前一次性注入）。桌面 app 与手机远控
// （/ws/remote/<id>，bootstrap 跳过 server-info）不经过该注入，保持缺省值：
//   - projectlessConversationWorkspaces 缺省 true：桌面支持无项目会话（任务区），
//     不能因「字段缺席」收走既有入口；fail-closed 只由显式声明的服务端触发
//     （standalone Server 声明 false，2026-10-10 远程裁决「不允许无项目创建」）；
//   - ownerHostId 缺省 null：未知 origin 身份时消费方必须保持原行为（spec
//     2026-10-31-standalone-server-local-project-creation.md）；
//   - 两个值都是进程级静态事实，无重连/失效路径，要刷新就整页重载；
//   - 这是服务端事实的镜像，不是 UI 局部推导，任何组件不得本地改写。

interface OriginServerCapabilitiesState {
  /** origin server 是否允许无项目会话（「不在项目中工作」与脱离项目入口）。 */
  readonly projectlessConversationWorkspaces: boolean;
  /**
   * origin server 的项目存储 owner hostId（remote:server:<serverId>）。standalone
   * webapp 的「此电脑」就是该设备：projectService 返回值携带 owner 身份而非 "local"，
   * 消费方（ProjectCreation.saved）据此把创建结果按本地项目收尾。
   */
  readonly ownerHostId: string | null;
  /** 仅由 web bootstrap 在渲染前调用；幂等。 */
  setProjectlessConversationWorkspaces(enabled: boolean): void;
  setOwnerHostId(serverId: string | undefined | null): void;
}

export const useOriginServerCapabilitiesStore = create<OriginServerCapabilitiesState>((set) => ({
  projectlessConversationWorkspaces: true,
  ownerHostId: null,
  setProjectlessConversationWorkspaces: (enabled) =>
    set({ projectlessConversationWorkspaces: enabled }),
  setOwnerHostId: (serverId) => {
    const id = serverId?.trim();
    if (!id) return;
    set({
      ownerHostId: remoteHostIdFromWorkspaceIdentity(
        buildServerRemoteWorkspaceIdentity({ serverId: id, workspacePath: "/" }),
      ),
    });
  },
}));

/** 测试用：恢复缺省。 */
export function resetOriginServerCapabilitiesStoreForTests(): void {
  useOriginServerCapabilitiesStore.setState({
    projectlessConversationWorkspaces: true,
    ownerHostId: null,
  });
}

/** web bootstrap 注入入口（@zcode/ui 公开面只暴露这两个意图）。 */
export function setOriginServerProjectlessConversationWorkspaces(enabled: boolean): void {
  useOriginServerCapabilitiesStore.getState().setProjectlessConversationWorkspaces(enabled);
}

export function setOriginServerOwnerHostId(serverId: string | undefined | null): void {
  useOriginServerCapabilitiesStore.getState().setOwnerHostId(serverId);
}
