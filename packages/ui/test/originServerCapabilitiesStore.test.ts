import { afterEach, describe, expect, it } from "vitest";
import {
  resetOriginServerCapabilitiesStoreForTests,
  setOriginServerOwnerHostId,
  setOriginServerProjectlessConversationWorkspaces,
  useOriginServerCapabilitiesStore,
} from "@/store/originServerCapabilitiesStore.js";

afterEach(() => {
  resetOriginServerCapabilitiesStoreForTests();
});

describe("originServerCapabilitiesStore", () => {
  it("derives the storage owner hostId from the origin serverId with shared identity tools", () => {
    // 派生必须走 shared 身份工具（AGENTS.md：不在业务代码手写 identity 格式）；
    // web bootstrap 用它把 server-info serverId 折叠成 hostId 供创建流比对。
    setOriginServerOwnerHostId("web-1.example");
    expect(useOriginServerCapabilitiesStore.getState().ownerHostId).toBe(
      "remote:server:web-1.example",
    );
    setOriginServerOwnerHostId("Origin-2");
    expect(useOriginServerCapabilitiesStore.getState().ownerHostId).toBe("remote:server:origin-2");
  });

  it("keeps the previous owner when the bootstrap payload has no usable serverId", () => {
    // 旧 Server 或异常响应缺 serverId：保持现状（null = 未知 origin），消费方按原行为处理。
    setOriginServerOwnerHostId(undefined);
    expect(useOriginServerCapabilitiesStore.getState().ownerHostId).toBeNull();
    setOriginServerOwnerHostId("origin");
    setOriginServerOwnerHostId("   ");
    expect(useOriginServerCapabilitiesStore.getState().ownerHostId).toBe("remote:server:origin");
    setOriginServerOwnerHostId(null);
    expect(useOriginServerCapabilitiesStore.getState().ownerHostId).toBe("remote:server:origin");
  });

  it("resets both mirrored facts to their defaults", () => {
    setOriginServerProjectlessConversationWorkspaces(false);
    setOriginServerOwnerHostId("origin");
    resetOriginServerCapabilitiesStoreForTests();
    expect(useOriginServerCapabilitiesStore.getState()).toMatchObject({
      projectlessConversationWorkspaces: true,
      ownerHostId: null,
    });
  });
});
