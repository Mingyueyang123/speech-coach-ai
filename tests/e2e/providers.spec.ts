import { expect, test, type Page } from "@playwright/test";
import type { SettingsStatus } from "../../src/lib/providers/contracts";
const settings: SettingsStatus = {
  version: 2, openai: false, feishu: false, realtimeModel: "gpt-realtime", reviewModel: "gpt-5-mini",
  providers: { openai: { saved: false, checks: {} }, aliyun: { saved: true, checks: {} }, deepseek: { saved: true, checks: {} }, minimax: { saved: true, checks: {} } },
  bindings: { text: "deepseek", recognition: "aliyun", synthesis: "minimax" }, models: { deepseek: "deepseek-flash", aliyun: "qwen-audio-3.1-asr-flash-streaming", minimax: "speech-2.8-turbo" }, region: "cn-beijing", voice: "test-voice",
};
async function setup(page: Page, text: string, disconnect = false) {
  await page.route("**/api/settings", route => route.fulfill({ json: settings }));
  await page.route("**/api/speech/session", route => route.fulfill({ json: { token: "bdfdddc6-76ec-4a6f-a969-f62d8f6a7c39" } }));
  let audioFrames = 0, closes = 0, connections = 0;
  await page.routeWebSocket("**/api/speech/stream", socket => {
    connections++; let frames = 0;
    socket.onMessage(message => {
      if (typeof message === "string") {
        const parsed = JSON.parse(message);
        if (parsed.type === "start") { expect(parsed.format).toBe("pcm_s16le"); socket.send(JSON.stringify({ type: "ready" })); }
        if (parsed.type === "stop") { closes++; socket.send(JSON.stringify({ type: "finished" })); socket.close(); }
      } else {
        audioFrames++; frames++; expect(message.length).toBeLessThanOrEqual(8192);
        if (frames === 1) socket.send(JSON.stringify({ type: "transcript", id: `${connections}:1`, text: text.slice(0, -1), final: false }));
        if (frames === 2) {
          for (let i = 0; i < 2; i++) socket.send(JSON.stringify({ type: "transcript", id: `${connections}:1`, text, final: true }));
          if (disconnect && connections === 1) socket.close();
        }
      }
    });
  });
  await page.route("**/api/audience", route => route.fulfill({ json: { question: "Could you give an example?", source: "ai" } }));
  // A valid silent WAV is sufficient for exercising browser playback without a paid TTS request.
  const wav = Buffer.alloc(3244); wav.write("RIFF"); wav.writeUInt32LE(3236, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(3200, 40);
  await page.route("**/api/speech/synthesize", route => route.fulfill({ contentType: "audio/wav", body: wav }));
  await page.route("**/api/review", route => route.fulfill({ status: 503, json: { error: "mock local review" } }));
  await page.route("https://cdn.jsdelivr.net/**", route => route.abort());
  await page.goto("/"); await page.getByRole("button", { name: "暂时跳过" }).click();
  return { counts: () => ({ audioFrames, closes, connections }) };
}

for (const language of ["zh-CN", "en-US"] as const) test(`continuous ${language} speech -> follow -> question -> voice -> local review`, async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone"]);
  const spoken = language === "en-US" ? "Hello, I am building an AI product that helps professionals turn scattered knowledge into repeatable workflows." : "各位好，我想介绍的是一款帮助专业人士把知识转化为可重复工作流的 AI 产品。";
  const mock = await setup(page, spoken);
  const requests: { url: string; body: string }[] = [];
  page.on("request", request => { if (request.method() === "POST") requests.push({ url: request.url(), body: request.postData() ?? "" }); });
  if (language === "en-US") {
    await page.getByRole("button", { name: "训练语言", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "英文" }).click();
  }
  await page.getByRole("button", { name: "用这段练习" }).click();
  await page.getByRole("button", { name: "开始本轮", exact: true }).click();
  await expect(page.getByText(spoken, { exact: true }).last()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/已跟随 \d+%/)).toBeVisible();
  expect(requests.filter(r => r.url.endsWith("/api/audience"))).toHaveLength(0);
  await page.getByRole("button", { name: "请听众回应" }).click();
  await expect(page.getByText("Could you give an example?", { exact: true })).toBeVisible();
  await expect.poll(() => requests.some(r => r.url.endsWith("/api/speech/synthesize"))).toBe(true);
  await page.getByRole("button", { name: "结束并复盘" }).click();
  await expect(page.getByRole("heading", { name: "练习复盘", level: 1 })).toBeVisible();
  const endedFrames = mock.counts().audioFrames; await page.waitForTimeout(400);
  expect(mock.counts().audioFrames).toBe(endedFrames); expect(mock.counts().closes).toBe(1);
  for (const request of requests) expect(request.body).not.toMatch(/videoBlob|faceLandmarks|poseLandmarks|m=video|metricTimeline/);
  await page.reload(); await expect(page.getByText("Speech Coach", { exact: true })).toBeVisible();
});

test("disconnect preserves text and only reconnects on request", async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone"]);
  const mock = await setup(page, "我们需要一个具体的例子。", true);
  await page.getByRole("button", { name: "用这段练习" }).click();
  await page.getByRole("button", { name: "开始本轮", exact: true }).click();
  await expect(page.getByRole("button", { name: "重连识别" })).toBeVisible();
  expect(mock.counts().connections).toBe(1);
  await page.getByRole("button", { name: "重连识别" }).click();
  await expect.poll(() => mock.counts().connections).toBe(2);
  await expect(page.getByText("我们需要一个具体的例子。", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "结束并复盘" }).click();
});

test("voice inspiration stays in composer until user sends it", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  await setup(page, "今天开会我发现一个有趣的观察。");
  let organized = 0;
  page.on("request", request => { if (request.url().endsWith("/api/materials/organize")) organized++; });
  await page.getByRole("button", { name: "灵感素材", exact: true }).click();
  await page.getByRole("button", { name: "语音输入", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "讲述灵感素材" })).toHaveValue("今天开会我发现一个有趣的观察。");
  expect(organized).toBe(0);
  await page.getByRole("button", { name: "停止语音输入", exact: true }).click();
  await page.getByRole("button", { name: "发送并整理" }).click();
  await expect.poll(() => organized).toBe(1);
});

test("settings remain usable at desktop and narrow width", async ({ page }) => {
  await setup(page, "test");
  await page.getByRole("button", { name: "API 配置", exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(page.getByRole("button", { name: "使用国内组合" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/providers-${width}.png`, fullPage: true });
  }
});
