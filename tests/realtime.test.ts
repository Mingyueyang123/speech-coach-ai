import { afterEach, expect, it, vi } from "vitest";
import { connectRealtime } from "@/lib/realtime-client";
import { SCENARIOS } from "@/lib/scenarios";
afterEach(() => vi.unstubAllGlobals());
it("sends only audio and forwards partial and final user transcription for following", async () => {
  const channel = { onopen: null, onclose: null, onmessage: null as null | ((event: { data: string }) => void), readyState: "open", close: vi.fn(), send: vi.fn() };
  const audioTrack = { kind: "audio" };
  const addTrack = vi.fn();
  const close = vi.fn();
  vi.stubGlobal("RTCPeerConnection", class {
    addTrack = addTrack;
    close = close;
    createDataChannel() { return channel; }
    async createOffer() { return { sdp: "m=audio mock" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("answer")));
  const onTranscript = vi.fn();
  const connection = await connectRealtime({ stream: { getAudioTracks: () => [audioTrack] } as unknown as MediaStream, scenario: SCENARIOS[0], intensity: "friendly", knowledgeContext: "", onStatus: vi.fn(), onTurn: vi.fn(), onTranscript });
  expect(addTrack).toHaveBeenCalledOnce();
  expect(addTrack.mock.calls[0][0]).toBe(audioTrack);
  channel.onmessage?.({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", item_id: "a", delta: "Hello " }) });
  channel.onmessage?.({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", item_id: "a", delta: "world" }) });
  channel.onmessage?.({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "a", transcript: "Hello world" }) });
  expect(onTranscript.mock.calls).toEqual([["Hello ", false], ["Hello world", false], ["Hello world", true]]);
  connection.disconnect();
  expect(close).toHaveBeenCalled();
});
