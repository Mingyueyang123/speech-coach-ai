import { describe, expect, it } from "vitest";
import { findSpeechProgress, normalizeSpeechText, progressToSection } from "@/lib/speech-follow";

describe("speech-follow matching", () => {
  it("normalizes Chinese and English punctuation", () => {
    expect(normalizeSpeechText("大家好，AI！", "zh-CN")).toBe("大家好ai");
    expect(normalizeSpeechText("Hello, AI world!", "en-US")).toBe("helloaiworld");
  });

  it("tracks Chinese speech forward through a script", () => {
    const script = "大家好，今天我们讨论人工智能。接下来我会分享一个真实案例。";
    const first = findSpeechProgress(script, "大家好今天我们讨论人工智能", "zh-CN", 0);
    const second = findSpeechProgress(script, "接下来我会分享一个真实案例", "zh-CN", first.progress);
    expect(first.matched).toBe(true);
    expect(second.matched).toBe(true);
    expect(second.progress).toBeGreaterThanOrEqual(first.progress);
  });

  it("allows small English recognition errors and never moves backward", () => {
    const script = "We start with the customer problem and then explain the four week pilot.";
    const first = findSpeechProgress(script, "we start with the customer problem", "en-US", 0);
    const repeated = findSpeechProgress(script, "we start with customer problem", "en-US", first.progress);
    expect(first.matched).toBe(true);
    expect(repeated.progress).toBeGreaterThanOrEqual(first.progress);
  });

  it("keeps progress when no confident match exists", () => {
    const result = findSpeechProgress("这是完整的训练台词内容", "完全无关的识别结果", "zh-CN", 0.42);
    expect(result.matched).toBe(false);
    expect(result.progress).toBe(0.42);
  });

  it("maps progress to cue sections", () => {
    expect(progressToSection(0, 5)).toBe(0);
    expect(progressToSection(0.55, 5)).toBe(2);
    expect(progressToSection(1, 5)).toBe(4);
  });
});
