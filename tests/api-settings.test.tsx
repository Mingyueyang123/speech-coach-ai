import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiSettings } from "@/components/ApiSettings";
import type { SettingsStatus } from "@/lib/providers/contracts";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps independent providers configurable without requiring all keys", async () => {
  const status: SettingsStatus = { version: 2, openai: false, feishu: false, realtimeModel: "gpt-realtime", reviewModel: "gpt-5-mini", bindings: { text: "deepseek", recognition: "aliyun", synthesis: "minimax" }, models: { deepseek: "deepseek-flash", aliyun: "qwen-audio-3.1-asr-flash-streaming", minimax: "speech-2.8-turbo" }, region: "cn-beijing", voice: "", providers: { openai: { saved: false, checks: {} }, deepseek: { saved: true, checks: {} }, aliyun: { saved: false, checks: {} }, minimax: { saved: false, checks: {} } } };
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(status))); vi.stubGlobal("fetch", fetch);
  render(<ApiSettings />);
  await screen.findByText("已保存 · 未测试");
  fireEvent.click(screen.getByRole("tab", { name: /DeepSeek/ }));
  expect(screen.getByRole("button", { name: "短文本测试" })).toBeEnabled();
  expect(screen.queryByLabelText("Workspace ID")).not.toBeInTheDocument();
  expect(screen.getByLabelText("API Key")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "使用国内组合" }));
  await waitFor(() => expect(fetch.mock.calls.some(call => call[1]?.method === "POST")).toBe(true));
  const posted = fetch.mock.calls.find(call => call[1]?.method === "POST")!;
  expect(JSON.parse(posted[1].body)).toEqual({ bindings: { text: "deepseek", recognition: "aliyun", synthesis: "minimax" } });
});
