// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { EventEmitter, once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocket as Client } from "ws";
import { resolveConfig } from "@/lib/server-config";

const state = vi.hoisted(() => ({ upstreams: [] as { sent: unknown[]; terminated: boolean; emit(event: string, ...args: unknown[]): boolean }[] }));
vi.mock("ws", async importOriginal => {
  const actual = await importOriginal<typeof import("ws")>();
  const { EventEmitter: Events } = await import("node:events");
  class Upstream extends Events {
    static OPEN = 1; readyState = 1; bufferedAmount = 0; sent: unknown[] = []; terminated = false;
    constructor() { super(); state.upstreams.push(this); queueMicrotask(() => this.emit("open")); }
    send(data: unknown, options?: { binary?: boolean }) {
      this.sent.push(data);
      if (options?.binary) return;
      const parsed = JSON.parse(String(data));
      if (parsed.header.action === "run-task") queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ header: { event: "task-started" } }))));
      if (parsed.header.action === "finish-task") queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ header: { event: "task-finished" } }))));
    }
    terminate() { this.terminated = true; this.readyState = 3; this.emit("close"); }
  }
  return { ...actual, default: Upstream };
});
vi.mock("@/lib/server-config", async original => ({ ...await original<object>(), getConfig: vi.fn(), recordProviderCheck: vi.fn().mockResolvedValue(undefined) }));
import { getConfig } from "@/lib/server-config";
import { createSpeechGateway } from "../server/speech-gateway";

let server: Server, gateway: ReturnType<typeof createSpeechGateway>, origin: string;
const clients: Client[] = [];
beforeEach(async () => {
  state.upstreams.length = 0;
  vi.mocked(getConfig).mockResolvedValue(resolveConfig({ ALIYUN_API_KEY: "private-key", ALIYUN_WORKSPACE_ID: "test-workspace" }, {}));
  gateway = createSpeechGateway(); server = createServer((req, res) => void gateway.session(req, res));
  server.on("upgrade", gateway.upgrade); server.listen(0, "127.0.0.1"); await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { clients.forEach(c => c.terminate()); clients.length = 0; gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
async function token() {
  const response = await fetch(`${origin}/api/speech/session`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "aliyun" }) });
  expect(response.status).toBe(200); const data = await response.json(); expect(JSON.stringify(data)).not.toContain("private-key"); return data.token as string;
}
async function connect(grant: string) {
  const socket = new Client(origin.replace("http", "ws"), { origin }); clients.push(socket); const inbox = new EventEmitter(); const messages: Record<string, unknown>[] = [];
  socket.on("message", raw => { const message = JSON.parse(raw.toString()); messages.push(message); inbox.emit("message", message); });
  await once(socket, "open");
  socket.send(JSON.stringify({ type: "start", token: grant, language: "en-US", format: "pcm_s16le", sampleRate: 16000, channels: 1 }));
  const [first] = await once(inbox, "message"); return { socket, first, messages, inbox };
}
describe("local speech gateway", () => {
  it("rejects cross-origin session grants before opening a provider socket", async () => {
    const response = await fetch(origin, { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" });
    expect(response.status).toBe(403); expect(state.upstreams).toHaveLength(0);
  });
  it("requires one-use session authorization and preserves English format", async () => {
    const grant = await token(); const { socket, first } = await connect(grant);
    expect(first.type).toBe("ready");
    const run = JSON.parse(String(state.upstreams[0].sent[0]));
    expect(run.payload.parameters.language_hints).toEqual(["en"]); expect(run.payload.parameters.sample_rate).toBe(16000);
    const second = await connect(grant); expect(second.first.type).toBe("error"); expect(state.upstreams).toHaveLength(1);
    socket.send(Buffer.alloc(3200));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(state.upstreams[0].sent.some(Buffer.isBuffer)).toBe(true);
  });
  it("finishes both connections and forwards only normalized speech results", async () => {
    const { socket, inbox } = await connect(await token());
    const message = once(inbox, "message");
    state.upstreams[0].emit("message", Buffer.from(JSON.stringify({ header: { event: "result-generated" }, payload: { output: { sentence: { sentence_id: 1, text: "Hello.", sentence_end: true }, internal: "private-key" } } })));
    expect((await message)[0]).toMatchObject({ type: "transcript", text: "Hello.", final: true });
    const close = once(socket, "close"); socket.send(JSON.stringify({ type: "stop" })); await close;
    expect(state.upstreams[0].terminated).toBe(true);
    expect(JSON.parse(String(state.upstreams[0].sent.at(-1))).header.action).toBe("finish-task");
  });
  it("rejects malformed audio without forwarding it", async () => {
    const { socket, inbox } = await connect(await token()); const error = once(inbox, "message"); socket.send(Buffer.alloc(3));
    expect((await error)[0].type).toBe("error"); expect(state.upstreams[0].sent.some(Buffer.isBuffer)).toBe(false);
  });
});
