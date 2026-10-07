import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PracticeDock } from "@/components/PracticeDock";
import { FloatingTools, PracticeClock } from "@/components/FloatingTools";
import { DEFAULT_DEVICES, mediaConstraints, recordingMimeType, routeAudio } from "@/lib/media-devices";
import { SCENARIOS } from "@/lib/scenarios";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function props() {
  return { scenario: SCENARIOS[0], practicing: false, intensity: "balanced" as const, chooseScenario: vi.fn(), setIntensity: vi.fn(), devices: DEFAULT_DEVICES, setDevices: vi.fn(), target: 180, setTarget: vi.fn(), scriptVisible: true, timerVisible: true, cameraPanelVisible: true, audiencePanelVisible: true, scriptPinned: false, timerPinned: false, toggleScript: vi.fn(), toggleTimer: vi.fn(), toggleCameraPanel: vi.fn(), toggleAudiencePanel: vi.fn(), toggleScriptPinned: vi.fn(), toggleTimerPinned: vi.fn(), fontSize: 24, setFontSize: vi.fn(), scrollMode: "speech" as const, changeScrollMode: vi.fn(), scrollSpeed: 1, setScrollSpeed: vi.fn(), start: vi.fn(), stop: vi.fn(), startRequested: false, cancelStart: vi.fn(), requestStart: vi.fn() };
}
describe("touch practice dock", () => {
  it("opens language options only on demand and routes the selection", () => {
    const p = props(); render(<PracticeDock {...p} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "训练语言" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "英文" }));
    expect(p.chooseScenario).toHaveBeenCalledWith(SCENARIOS[0].kind, "en-US");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  it("separates script scaling and timer target settings", () => {
    const p = props(); render(<PracticeDock {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "台词" }));
    fireEvent.click(screen.getByTitle("放大台词"));
    expect(p.setFontSize).toHaveBeenCalledWith(26);
    expect(p.setTarget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "计时" }));
    fireEvent.click(screen.getByTitle("增加目标时长"));
    expect(p.setTarget).toHaveBeenCalledWith(240);
    fireEvent.click(screen.getByText("隐藏计时器"));
    expect(p.toggleTimer).toHaveBeenCalledOnce();
  });
  it("keeps cross-page script and timer floating opt-in and independent", () => {
    const p = props(); render(<PracticeDock {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "台词" }));
    const scriptPin = screen.getByRole("menuitemcheckbox", { name: "跨页面悬浮" });
    expect(scriptPin).toHaveAttribute("aria-checked", "false");
    fireEvent.click(scriptPin);
    expect(p.toggleScriptPinned).toHaveBeenCalledOnce();
    expect(p.toggleTimerPinned).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "计时" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "跨页面悬浮" }));
    expect(p.toggleTimerPinned).toHaveBeenCalledOnce();
  });
  it("requires start confirmation and removes scroll mode switches in practice", async () => {
    const p = props(); const { rerender } = render(<PracticeDock {...p} startRequested />);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "匀速滚动" }));
    expect(p.changeScrollMode).toHaveBeenCalledWith("manual");
    expect(p.start).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "开始本轮" }));
    await waitFor(() => expect(p.start).toHaveBeenCalledOnce());
    rerender(<PracticeDock {...p} practicing />);
    fireEvent.click(screen.getByRole("button", { name: "台词" }));
    expect(screen.queryByRole("button", { name: "语音跟随" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "匀速滚动" })).not.toBeInTheDocument();
  });
  it("routes input device choices, blocks changes while recording, and explains system output", () => {
    const p = props(); const { rerender } = render(<PracticeDock {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "相机接入" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "不接入相机 · 只录音" }));
    expect(p.setDevices).toHaveBeenCalledWith({ ...DEFAULT_DEVICES, cameraEnabled: false });
    rerender(<PracticeDock {...p} practicing />);
    expect(screen.getByRole("menuitemradio", { name: "不接入相机 · 只录音" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "音频输出" }));
    expect(screen.getByText(/控制中心选择耳机/)).toBeVisible();
  });
  it("restores hidden camera and audience surfaces from their menus", () => {
    const p = props(); render(<PracticeDock {...p} cameraPanelVisible={false} audiencePanelVisible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "相机接入" }));
    fireEvent.click(screen.getByRole("button", { name: "显示镜头窗口" }));
    expect(p.toggleCameraPanel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "听众强度" }));
    fireEvent.click(screen.getByRole("button", { name: "显示听众与转写" }));
    expect(p.toggleAudiencePanel).toHaveBeenCalledOnce();
  });
  it("marks the final minute and target completion, without negative countdown", () => {
    const { rerender } = render(<PracticeClock elapsed={119} practicing targetSeconds={180} />);
    expect(screen.getByRole("timer")).toHaveTextContent("01:01");
    expect(screen.getByLabelText("练习计时器")).not.toHaveClass("time-warning");
    rerender(<PracticeClock elapsed={120} practicing targetSeconds={180} />);
    expect(screen.getByLabelText("练习计时器")).toHaveClass("time-warning");
    expect(screen.getByRole("status")).toHaveTextContent("最后一分钟");
    rerender(<PracticeClock elapsed={200} practicing targetSeconds={180} />);
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");
    expect(screen.getByRole("status")).toHaveTextContent("已到目标时长");
  });
  it("retains separate surfaces and content when hidden or detached", () => {
    const { rerender } = render(<><FloatingTools title="台词"><p>Script</p></FloatingTools><FloatingTools title="计时器"><PracticeClock elapsed={12} practicing /></FloatingTools></>);
    const script = screen.getByText("Script");
    rerender(<><FloatingTools title="台词" forceFloating hidden><p>Script</p></FloatingTools><FloatingTools title="计时器" forceFloating><PracticeClock elapsed={13} practicing /></FloatingTools></>);
    expect(script).not.toBeVisible();
    expect(screen.getByRole("timer")).toHaveTextContent("00:13");
    expect(screen.getByLabelText("计时器窗口")).toHaveClass("is-floating");
  });
  it("gives every practice surface move, resize and hide controls", () => {
    const hide = vi.fn();
    render(<FloatingTools title="镜头" surface="camera" initialSize={{ width: 640, height: 480 }} onHide={hide}><div>Camera</div></FloatingTools>);
    expect(screen.getByTitle("拖动镜头")).toBeVisible();
    expect(screen.getByTitle("调整镜头窗口大小")).toBeVisible();
    fireEvent.click(screen.getByTitle("隐藏镜头"));
    expect(hide).toHaveBeenCalledOnce();
  });
});

describe("actual media routing", () => {
  it("uses exact selected inputs and supports audio-only practice", () => {
    expect(mediaConstraints({ ...DEFAULT_DEVICES, microphoneId: "external-mic", cameraId: "front" })).toMatchObject({ audio: { deviceId: { exact: "external-mic" } }, video: { deviceId: { exact: "front" } } });
    expect(mediaConstraints({ ...DEFAULT_DEVICES, cameraEnabled: false }).video).toBe(false);
  });
  it("selects MP4 on Safari and leaves unsupported MIME selection to the browser", () => {
    expect(recordingMimeType(true, t => t === "video/mp4")).toBe("video/mp4");
    expect(recordingMimeType(false, t => t === "audio/mp4")).toBe("audio/mp4");
    expect(recordingMimeType(true, () => false)).toBeUndefined();
  });
  it("routes a chosen output without silently substituting another one", async () => {
    const audio = { setSinkId: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLMediaElement;
    await routeAudio(audio, "headphones");
    expect(audio.setSinkId).toHaveBeenCalledWith("headphones");
    await expect(routeAudio({} as HTMLMediaElement, "headphones")).rejects.toThrow("控制中心");
  });
});
