import type { AudienceIntensity, ConversationTurn, PracticeScenario } from "./types";

interface RealtimeOptions {
  stream: MediaStream;
  scenario: PracticeScenario;
  intensity: AudienceIntensity;
  knowledgeContext: string;
  onTurn: (turn: ConversationTurn) => void;
  onStatus: (status: string) => void;
  onTranscript?: (text: string, final: boolean) => void;
  signal?: AbortSignal;
  onError?: () => void;
}

export interface RealtimeConnection {
  disconnect: () => void;
  requestResponse: (instruction?: string) => void;
}

export async function connectRealtime(options: RealtimeOptions): Promise<RealtimeConnection> {
  const peer = new RTCPeerConnection();
  const audio = document.createElement("audio");
  audio.autoplay = true;
  peer.ontrack = (event) => {
    audio.srcObject = event.streams[0];
  };

  const audioTrack = options.stream.getAudioTracks()[0];
  if (!audioTrack) throw new Error("没有可用的麦克风音轨。");
  peer.addTrack(audioTrack, options.stream);

  const channel = peer.createDataChannel("oai-events");
  const partials = new Map<string, string>();
  const completed = new Set<string>();
  channel.onopen = () => options.onStatus("OpenAI 实时识别已连接");
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed" || peer.connectionState === "disconnected") options.onError?.();
  };
  channel.onclose = () => { options.onStatus("实时识别已断开"); options.onError?.(); };
  channel.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as Record<string, unknown>;
      const type = String(payload.type ?? "");
      if (type === "conversation.item.input_audio_transcription.delta") {
        const id = String(payload.item_id ?? "current");
        const text = (partials.get(id) ?? "") + String(payload.delta ?? "");
        partials.set(id, text);
        options.onTranscript?.(text, false);
      }
      if (type === "conversation.item.input_audio_transcription.completed") {
        const id = String(payload.item_id ?? "current");
        if (completed.has(id)) return;
        completed.add(id);
        partials.delete(id);
        const transcript = String(payload.transcript ?? "").trim();
        if (transcript) {
          options.onTranscript?.(transcript, true);
          options.onTurn({ id: crypto.randomUUID(), role: "speaker", text: transcript, timestampMs: Date.now() });
        }
      }
      if (type === "response.audio_transcript.done" || type === "response.output_audio_transcript.done") {
        const transcript = String(payload.transcript ?? "").trim();
        if (transcript) {
          options.onTurn({ id: crypto.randomUUID(), role: "audience", text: transcript, timestampMs: Date.now() });
        }
      }
      if (type === "error" || type === "conversation.item.input_audio_transcription.failed") { options.onStatus("实时语音返回错误，请检查 API 配置和额度"); options.onError?.(); }
    } catch {
      options.onStatus("收到无法解析的实时事件");
    }
  };

  try {
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const response = await fetch("/api/realtime/session", {
    method: "POST",
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sdp: offer.sdp,
      scenario: options.scenario,
      intensity: options.intensity,
      knowledgeContext: options.knowledgeContext,
    }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    peer.close();
    throw new Error(payload.error || "无法连接实时听众。");
  }
  await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
  } catch (error) { channel.close(); peer.close(); audio.srcObject = null; throw error; }

  const requestResponse = (instruction = "请根据我刚才的表达，以真实听众身份做出简短反应或追问。") => {
    if (channel.readyState !== "open") return;
    channel.send(JSON.stringify({
      type: "response.create",
      response: { instructions: instruction },
    }));
  };

  return {
    requestResponse,
    disconnect: () => {
      channel.onclose = null;
      channel.close();
      peer.close();
      audio.srcObject = null;
    },
  };
}
