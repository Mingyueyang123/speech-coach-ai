import { createServer } from "node:http";
import { createSpeechGateway } from "./server/speech-gateway";

const args = process.argv.slice(2);
const option = (long: string, short: string) => { const index = args.findIndex(a => a === long || a === short); return index >= 0 ? args[index + 1] : undefined; };
const dev = args.includes("--dev");
// Poll in development to avoid macOS watcher limits while keeping Next HMR available.
if (dev) process.env.WATCHPACK_POLLING ??= "1000";
const hostname = option("--hostname", "-H") ?? "127.0.0.1";
const port = Number(option("--port", "-p") ?? process.env.PORT ?? 3000);
if (!["127.0.0.1", "localhost", "::1"].includes(hostname) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("This local-only server requires a loopback hostname and a valid port.");
const gateway = createSpeechGateway();
async function main() {
  const { default: next } = await import("next");
  const app = next({ dev, hostname, port, webpack: true });
  await app.prepare();
  const handler = app.getRequestHandler(), upgrade = app.getUpgradeHandler();
  const server = createServer((request, response) => {
    const path = request.url?.split("?")[0];
    const host = request.headers.host;
    if (path?.startsWith("/api/") && (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || (request.method !== "GET" && request.headers.origin !== `http://${host}`))) {
      response.writeHead(403, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: "仅允许本机同源访问" })); return;
    }
    if (path === "/api/speech/session") { void gateway.session(request, response); return; }
    void handler(request, response);
  });
  server.on("upgrade", (request, socket, head) => {
    if (request.url?.split("?")[0] === "/api/speech/stream") gateway.upgrade(request, socket, head);
    else void upgrade(request, socket, head);
  });
  server.listen(port, hostname, () => console.log(`Speech Coach AI: http://${hostname}:${port}`));
  const close = () => { gateway.close(); server.close(); void app.close().finally(() => process.exit(0)); };
  process.on("SIGINT", close); process.on("SIGTERM", close);
}
void main();
