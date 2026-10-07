import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMediaSession } from "@/hooks/useMediaSession";
import { DEFAULT_DEVICES } from "@/lib/media-devices";
import { buildLocalReview, calculateDeliveryMetrics } from "@/lib/analysis";
import { SCENARIOS } from "@/lib/scenarios";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mocks() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("AudioContext", class {
    close = close;
    createMediaStreamSource = () => ({ connect: vi.fn() });
    createAnalyser = () => ({ fftSize: 1024, getByteTimeDomainData: vi.fn() });
  });
  return { stream, track, getUserMedia, close };
}
it("reuses the selected microphone stream and stops tracks on close", async () => {
  const mock = mocks(); const { result } = renderHook(() => useMediaSession());
  await act(async () => { await result.current.prepare({ ...DEFAULT_DEVICES, cameraEnabled: false, microphoneId: "usb-mic" }); });
  expect(mock.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: false, audio: expect.objectContaining({ deviceId: { exact: "usb-mic" } }) }));
  expect(result.current.cameraReady).toBe(false);
  expect(result.current.visionStatus).toContain("仅录音");
  await act(async () => { await result.current.prepare(); });
  expect(mock.getUserMedia).toHaveBeenCalledTimes(1);
  act(() => result.current.stopCamera());
  expect(mock.track.stop).toHaveBeenCalledOnce();
  expect(mock.close).toHaveBeenCalledOnce();
});
it("closes a permission result arriving after cancellation and deduplicates pending requests", async () => {
  const mock = mocks(); let resolve!: (stream: MediaStream) => void;
  mock.getUserMedia.mockImplementation(() => new Promise<MediaStream>(r => { resolve = r; }));
  const { result } = renderHook(() => useMediaSession());
  let first!: Promise<MediaStream>, second!: Promise<MediaStream>;
  act(() => { first = result.current.prepare(DEFAULT_DEVICES); second = result.current.prepare(DEFAULT_DEVICES); });
  expect(mock.getUserMedia).toHaveBeenCalledTimes(1);
  act(() => result.current.stopCamera());
  await act(async () => { resolve(mock.stream); await expect(first).rejects.toThrow("设备设置已变更"); await expect(second).rejects.toThrow(); });
  expect(mock.track.stop).toHaveBeenCalledOnce();
  expect(result.current.stream).toBeNull();
});
it("records audio-only MP4 with the actual recorder MIME", async () => {
  mocks();
  vi.stubGlobal("MediaRecorder", class {
    static isTypeSupported = (type: string) => type === "audio/mp4";
    mimeType = "audio/mp4";
    state = "inactive";
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    start() { this.state = "recording"; this.ondataavailable?.({ data: new Blob(["test"], { type: this.mimeType }) }); }
    stop() { this.state = "inactive"; this.onstop?.(); }
  });
  const { result } = renderHook(() => useMediaSession());
  await act(async () => { await result.current.prepare({ ...DEFAULT_DEVICES, cameraEnabled: false }); });
  act(() => result.current.startRecording());
  expect(result.current.recording).toBe(true);
  let blob: Blob | null = null;
  await act(async () => { blob = await result.current.stopRecording(); });
  expect(blob).toMatchObject({ type: "audio/mp4", size: 4 });
  expect(result.current.recording).toBe(false);
});
it("excludes absent visual data from feedback", () => {
  const metrics = calculateDeliveryMetrics("A clear message", 3000, [], "en-US");
  metrics.visualAvailable = false;
  const review = buildLocalReview("A clear message", metrics, { ...SCENARIOS[0], language: "en-US" });
  expect(review.strengths.join(" ")).toContain("visual delivery was not assessed");
  expect(review.improvements.join(" ")).not.toMatch(/camera|body movement|eye/i);
});
