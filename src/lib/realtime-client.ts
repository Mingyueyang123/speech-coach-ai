import type { AudienceIntensity, ConversationTurn, PracticeScenario } from "./types";

interface RealtimeOptions {
  stream: MediaStream;
  scenario: PracticeScenario;
  intensity: AudienceIntensity;
  knowledgeContext: string;
  onTurn: (turn: ConversationTurn) => void;
  onStatus: (status: string) => void;
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
  channel.onopen = () => options.onStatus("真实听众已连接");
  channel.onclose = () => options.onStatus("真实听众已断开");
  channel.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as Record<string, unknown>;
      const type = String(payload.type ?? "");
      if (type === "conversation.item.input_audio_transcription.completed") {
        const transcript = String(payload.transcript ?? "").trim();
        if (transcript) {
          options.onTurn({ id: crypto.randomUUID(), role: "speaker", text: transcript, timestampMs: Date.now() });
        }
      }
      if (type === "response.audio_transcript.done") {
        const transcript = String(payload.transcript ?? "").trim();
        if (transcript) {
          options.onTurn({ id: crypto.randomUUID(), role: "audience", text: transcript, timestampMs: Date.now() });
        }
      }
      if (type === "error") options.onStatus("实时听众返回错误，请检查配置");
    } catch {
      options.onStatus("收到无法解析的实时事件");
    }
  };

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const response = await fetch("/api/realtime/session", {
    method: "POST",
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
      channel.close();
      peer.close();
      audio.srcObject = null;
    },
  };
}
