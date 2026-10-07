import { afterEach, expect, it, vi } from "vitest";
import { startRecognizer } from "@/lib/speech-client";

afterEach(() => vi.unstubAllGlobals());
it("streams only PCM, revises partials, deduplicates finals and stops before releasing its mic lease", async () => {
  const frames: unknown[] = [], sources: unknown[] = [], updates: unknown[] = [];
  const worklets: { port: { onmessage: ((event: { data: ArrayBuffer }) => void) | null }; disconnect(): void }[] = [];
  const sockets: MockSocket[] = [];
  class MockSocket {
    static OPEN = 1; readyState = 1; bufferedAmount = 0;
    onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
    constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
    receive(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
    send(data: unknown) {
      frames.push(data);
      if (typeof data !== "string") return;
      const event = JSON.parse(data);
      if (event.type === "start") queueMicrotask(() => this.receive({ type: "ready" }));
      if (event.type === "stop") queueMicrotask(() => this.close());
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(); }
  }
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({ token: crypto.randomUUID() }))));
  vi.stubGlobal("WebSocket", MockSocket);
  vi.stubGlobal("MediaStream", class { constructor(tracks: unknown) { sources.push(tracks); } });
  vi.stubGlobal("AudioContext", class {
    state = "running"; audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }; destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async resume() {} async close() { this.state = "closed"; }
  });
  vi.stubGlobal("AudioWorkletNode", class {
    port = { onmessage: null as ((e: { data: ArrayBuffer }) => void) | null }; constructor() { worklets.push(this); } connect() {} disconnect() {}
  });
  const microphone = { kind: "audio" }, video = { kind: "video" }, ctrl = new AbortController();
  const options = { provider: "aliyun" as const, stream: { getAudioTracks: () => [microphone], getTracks: () => [microphone, video] } as unknown as MediaStream, language: "en-US" as const, signal: ctrl.signal, onUpdate: (update: unknown) => updates.push(update), onStatus: vi.fn(), onError: vi.fn() };
  const connection = await startRecognizer(options);
  const socket = sockets[0], worklet = worklets[0];
  expect(sources).toEqual([[microphone]]);
  await expect(startRecognizer(options)).rejects.toThrow("已有语音识别");
  worklet.port.onmessage?.({ data: new ArrayBuffer(3200) });
  socket.receive({ type: "transcript", id: "1", text: "a", final: false }); socket.receive({ type: "transcript", id: "1", text: "a test", final: false });
  socket.receive({ type: "transcript", id: "1", text: "a test", final: true }); socket.receive({ type: "transcript", id: "1", text: "a test", final: true });
  expect(updates).toHaveLength(3);
  await connection.stop();
  expect(worklet.port.onmessage).toBeNull(); expect(socket.readyState).toBe(3);
  const length = frames.length; worklet.port.onmessage?.({ data: new ArrayBuffer(3200) }); expect(frames).toHaveLength(length);
  const next = await startRecognizer({ ...options, signal: new AbortController().signal }); await next.stop();
});
