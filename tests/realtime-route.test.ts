import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/server-config", () => ({
  getConfig: vi.fn().mockResolvedValue({ OPENAI_API_KEY: "private-test-key", OPENAI_REALTIME_MODEL: "gpt-realtime" }),
}));
import { POST } from "@/app/api/realtime/session/route";

const request = (sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n") => new Request("http://localhost/api/realtime/session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sdp, intensity: "balanced", scenario: { language: "zh-CN", title: "练习", goal: "清晰表达", audiencePersona: "普通听众", prompts: [], rubric: [] } }),
});
afterEach(() => vi.unstubAllGlobals());
describe("realtime session privacy", () => {
  it("rejects video before contacting the provider", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await POST(request("v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n"))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not forward upstream errors that may contain a key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Incorrect key: private-test-key", { status: 401 })));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("private-test-key");
  });
  it("returns an actionable failure on network interruption", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("手动滚动");
  });
});
