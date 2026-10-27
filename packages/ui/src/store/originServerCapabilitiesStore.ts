import { create } from "zustand";

// ============================================================
// origin server（与页面同源的 /api/server-info）capability 在 renderer 的只读镜像
// ============================================================
//
// 事实源是服务端 http.ts 的 createServerInfo；唯一写者是 web main.tsx 的
// resolveWebBootstrap（Root 渲染前一次性注入）。桌面 app 与手机远控
// （/ws/remote/<id>，bootstrap 跳过 server-info）不经过该注入，保持缺省值：
//   - projectlessConversationWorkspaces 缺省 true：桌面支持无项目会话（任务区），
//     不能因「字段缺席」收走既有入口；fail-closed 只由显式声明的服务端触发
//     （standalone Server 声明 false，2026-10-10 远程裁决「不允许无项目创建」）；
//   - 该值是进程级静态事实，无重连/失效路径，要刷新就整页重载；
//   - 这是服务端事实的镜像，不是 UI 局部推导，任何组件不得本地改写。

interface OriginServerCapabilitiesState {
  /** origin server 是否允许无项目会话（「不在项目中工作」与脱离项目入口）。 */
  readonly projectlessConversationWorkspaces: boolean;
  /** 仅由 web bootstrap 在渲染前调用；幂等。 */
  setProjectlessConversationWorkspaces(enabled: boolean): void;
}

export const useOriginServerCapabilitiesStore = create<OriginServerCapabilitiesState>((set) => ({
  projectlessConversationWorkspaces: true,
  setProjectlessConversationWorkspaces: (enabled) =>
    set({ projectlessConversationWorkspaces: enabled }),
}));

/** 测试用：恢复缺省。 */
export function resetOriginServerCapabilitiesStoreForTests(): void {
  useOriginServerCapabilitiesStore.setState({ projectlessConversationWorkspaces: true });
}

/** web bootstrap 注入入口（@zcode/ui 公开面只暴露这一个意图）。 */
export function setOriginServerProjectlessConversationWorkspaces(enabled: boolean): void {
  useOriginServerCapabilitiesStore.getState().setProjectlessConversationWorkspaces(enabled);
}
