import { describe, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", () => {
  const mock = { readFile: vi.fn().mockResolvedValue(JSON.stringify({ OPENAI_API_KEY: "test-secret-not-returned", FEISHU_APP_SECRET: "feishu-secret" })), mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn() };
  return { ...mock, default: mock };
});
import { configStatus, isLocalConfigRequest } from "@/lib/server-config";
describe("local settings security", () => {
  it("returns configuration status without exposing credentials", async () => {
    const status = await configStatus();
    expect(status.openai).toBe(true);
    expect(JSON.stringify(status)).not.toContain("secret");
  });
  it("only accepts loopback same-origin mutations", () => {
    const request = (host: string, origin: string) => new Request(`http://${host}/api/settings`, { method: "POST", headers: { host, origin } });
    expect(isLocalConfigRequest(request("127.0.0.1:3003", "http://127.0.0.1:3003"))).toBe(true);
    expect(isLocalConfigRequest(request("127.0.0.1:3003", "https://other.example"))).toBe(false);
    expect(isLocalConfigRequest(request("other.example", "http://other.example"))).toBe(false);
  });
  it("only accepts the configured HTTPS deployment origin", () => {
    const request = (host: string, origin: string) => new Request(`http://${host}/api/settings`, { method: "POST", headers: { host, origin } });
    process.env.SPEECH_COACH_ALLOWED_ORIGIN = "https://101.132.96.36";
    expect(isLocalConfigRequest(request("101.132.96.36", "https://101.132.96.36"))).toBe(true);
    expect(isLocalConfigRequest(request("101.132.96.36", "https://evil.example"))).toBe(false);
    expect(isLocalConfigRequest(request("other.example", "https://101.132.96.36"))).toBe(false);
    delete process.env.SPEECH_COACH_ALLOWED_ORIGIN;
  });
});
