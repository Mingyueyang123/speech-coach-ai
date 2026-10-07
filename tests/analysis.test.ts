import { describe, expect, it } from "vitest";
import { buildLocalReview, calculateDeliveryMetrics } from "@/lib/analysis";
import { SCENARIOS } from "@/lib/scenarios";

describe("delivery analysis", () => {
  it("calculates observable metrics without storing raw landmarks", () => {
    const metrics = calculateDeliveryMetrics("大家好，今天我想介绍一个真实案例。", 60_000, [
      { timestampMs: 0, volume: 0.2, cameraFacing: 1, expression: 0.4, smile: 0.3, handsVisible: 1, gestureMovement: 0.5, bodySway: 0.1 },
      { timestampMs: 500, volume: 0.4, cameraFacing: 0, expression: 0.6, smile: 0.5, handsVisible: 0.5, gestureMovement: 0.3, bodySway: 0.2 },
    ]);
    expect(metrics.wordsPerMinute).toBeGreaterThan(0);
    expect(metrics.cameraFacingRatio).toBe(50);
    expect(metrics.handsVisibleRatio).toBe(75);
    expect(metrics.averageVolume).toBe(30);
  });

  it("returns a complete local fallback review", () => {
    const metrics = calculateDeliveryMetrics("大家好，请先想一个问题。", 30_000, []);
    const review = buildLocalReview("大家好，请先想一个问题。", metrics, SCENARIOS[2]);
    expect(review.strengths).toHaveLength(3);
    expect(review.improvements).toHaveLength(3);
    expect(review.overallScore).toBeGreaterThanOrEqual(0);
    expect(review.overallScore).toBeLessThanOrEqual(100);
  });
});
