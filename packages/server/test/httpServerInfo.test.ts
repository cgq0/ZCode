import { afterEach, describe, expect, it } from "vitest";
import { AddressInfo } from "node:net";
import { ServiceCollection } from "@zcode/services";
import { createHttpServer } from "../src/http.js";

describe("http /api/server-info capabilities", () => {
  const servers: Array<{ close(callback?: (err?: Error) => void): void }> = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error?: Error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      ),
    );
    servers.length = 0;
  });

  async function fetchServerInfo(options?: Parameters<typeof createHttpServer>[2]) {
    const server = createHttpServer(new ServiceCollection(), 0, options);
    servers.push(server);
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/server-info`);
    expect(response.ok).toBe(true);
    return (await response.json()) as {
      capabilities: Record<string, unknown>;
    };
  }

  it("独立 Server 声明 projectlessConversationWorkspaces=false", async () => {
    const info = await fetchServerInfo({
      serverId: "server-1",
      virtualProjects: true,
      projectlessConversationWorkspaces: false,
    });
    expect(info.capabilities.projectlessConversationWorkspaces).toBe(false);
    expect(info.capabilities.virtualProjects).toBe(true);
  });

  it("缺省不声明该字段（桌面/旧部署兼容，UI 按支持处理）", async () => {
    const info = await fetchServerInfo({ serverId: "server-1" });
    expect("projectlessConversationWorkspaces" in info.capabilities).toBe(false);
  });
});
