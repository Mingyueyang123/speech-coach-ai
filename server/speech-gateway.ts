import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
import { z } from "zod";
import { getConfig, recordProviderCheck, type ServerConfig } from "../src/lib/server-config";
import { parseAliSentence, speechStartSchema } from "../src/lib/providers/speech-protocol";

export function localOrigin(request: IncomingMessage) {
  const host = request.headers.host;
  return Boolean(host && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    && request.headers.origin === `http://${host}`
    && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? ""));
}
const sessionSchema = z.object({ provider: z.literal("aliyun") }).strict();
export function createSpeechGateway() {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  const tokens = new Map<string, { expires: number; config: ServerConfig; origin: string }>();
  async function session(request: IncomingMessage, response: ServerResponse) {
    const json = (status: number, body: object) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(body)); };
    if (request.method !== "POST" || !localOrigin(request)) return json(403, { error: "仅允许本机同源语音会话" });
    try {
      let body = "";
      for await (const chunk of request) { body += chunk.toString(); if (body.length > 1024) return json(413, { error: "请求过大" }); }
      if (!sessionSchema.safeParse(JSON.parse(body)).success) return json(400, { error: "语音会话参数无效" });
      const config = await getConfig();
      if (!config.ALIYUN_API_KEY || !config.ALIYUN_WORKSPACE_ID) return json(503, { error: "请在 API 配置中保存阿里云 Key 和 Workspace ID" });
      for (const [token, item] of tokens) if (item.expires < Date.now()) tokens.delete(token);
      if (tokens.size >= 16 || sockets.clients.size >= 4) return json(429, { error: "请先关闭其他语音会话" });
      const token = randomUUID(); tokens.set(token, { expires: Date.now() + 30000, config, origin: request.headers.origin! });
      json(200, { token });
    } catch { json(500, { error: "无法创建语音会话，请检查本机配置" }); }
  }
  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    if (!localOrigin(request) || sockets.clients.size >= 4) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, client => {
      let upstream: WebSocket | undefined, taskId = "", ready = false, finishing = false, closed = false;
      let verified = false;
      let bytes = 0, windowStart = Date.now(), lastAudio = Date.now();
      let finishTimer: ReturnType<typeof setTimeout> | undefined;
      const send = (value: object) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value)); };
      const cleanup = () => {
        if (closed) return; closed = true;
        clearTimeout(startTimer); clearTimeout(finishTimer); clearInterval(watchdog); clearTimeout(maxDuration);
        upstream?.terminate(); client.close();
      };
      const fail = (message: string) => { send({ type: "error", message }); cleanup(); };
      const startTimer = setTimeout(() => fail("识别连接超时，请主动重连"), 15000);
      const watchdog = setInterval(() => { if (ready && !finishing && Date.now() - lastAudio > 15000) fail("音频输入已中断，连接已关闭"); }, 5000);
      const maxDuration = setTimeout(() => fail("单次识别已达两小时，请重新连接"), 7200000);
      client.on("close", cleanup); client.on("error", cleanup);
      client.on("message", (buffer, binary) => {
        if (closed) return;
        if (binary) {
          if (!ready || finishing || !upstream || upstream.readyState !== WebSocket.OPEN) return fail("音频发送时序无效");
          const length = Buffer.isBuffer(buffer) ? buffer.length : Buffer.byteLength(buffer as ArrayBuffer);
          if (Date.now() - windowStart >= 1000) { bytes = 0; windowStart = Date.now(); }
          bytes += length; lastAudio = Date.now();
          if (!length || length % 2 || length > 8192 || bytes > 96000 || upstream.bufferedAmount > 128000) return fail("音频格式、速率或缓冲区超限");
          upstream.send(buffer, { binary: true }); return;
        }
        let message: unknown;
        try { message = JSON.parse(buffer.toString()); } catch { return fail("语音消息无效"); }
        if (z.object({ type: z.literal("stop") }).strict().safeParse(message).success) {
          if (finishing) return;
          finishing = true;
          if (ready && upstream?.readyState === WebSocket.OPEN) {
            upstream.send(JSON.stringify({ header: { action: "finish-task", task_id: taskId, streaming: "duplex" }, payload: { input: {} } }));
            finishTimer = setTimeout(cleanup, 1800);
          } else cleanup();
          return;
        }
        const parsed = speechStartSchema.safeParse(message);
        if (!parsed.success || upstream) return fail("语音启动参数无效");
        const grant = tokens.get(parsed.data.token); tokens.delete(parsed.data.token);
        if (!grant || grant.expires < Date.now() || grant.origin !== request.headers.origin) return fail("会话授权过期，请重连");
        const config = grant.config;
        if (!/^[a-zA-Z0-9-]+$/.test(config.ALIYUN_WORKSPACE_ID)) return fail("Workspace ID 无效");
        taskId = randomUUID();
        upstream = new WebSocket(`wss://${config.ALIYUN_WORKSPACE_ID}.${config.ALIYUN_REGION}.maas.aliyuncs.com/api-ws/v1/inference`, { headers: { Authorization: `Bearer ${config.ALIYUN_API_KEY}` }, handshakeTimeout: 10000, maxPayload: 262144 });
        upstream.on("open", () => {
          if (closed) return upstream?.terminate();
          upstream!.send(JSON.stringify({ header: { action: "run-task", task_id: taskId, streaming: "duplex" }, payload: { task_group: "audio", task: "asr", function: "recognition", model: config.ALIYUN_ASR_MODEL, parameters: { format: "pcm", sample_rate: 16000, language_hints: [parsed.data.language === "en-US" ? "en" : "zh"], heartbeat: true }, input: {} } }));
        });
        upstream.on("message", raw => {
          if (closed) return;
          try {
            const event = JSON.parse(raw.toString());
            if (event.header?.event === "task-started") { ready = true; lastAudio = Date.now(); clearTimeout(startTimer); send({ type: "ready" }); void recordProviderCheck("aliyun", false).catch(() => {}); }
            if (event.header?.event === "result-generated") {
              const update = parseAliSentence(event.payload?.output?.sentence, taskId);
              if (update) {
                send({ type: "transcript", ...update });
                if (!verified) { verified = true; void recordProviderCheck("aliyun", true, undefined, "recognition").catch(() => {}); }
              }
            }
            if (event.header?.event === "task-finished") { send({ type: "finished" }); cleanup(); }
            if (event.header?.event === "task-failed") fail("阿里云识别失败，请检查模型、地域、额度及权限");
          } catch { fail("识别服务返回格式无效"); }
        });
        upstream.on("error", () => fail("阿里云连接失败，请检查凭证、地域和网络"));
        upstream.on("close", () => { if (!closed) { if (!finishing) send({ type: "error", message: "识别连接已断开，文字已保留，请重连" }); cleanup(); } });
      });
    });
  }
  return { session, upgrade, close() { for (const socket of sockets.clients) socket.terminate(); sockets.close(); tokens.clear(); } };
}
