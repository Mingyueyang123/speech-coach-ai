import { describe, expect, it } from "vitest";
import { inferGoalDraft, inferMaterial, inferTargetDate } from "@/lib/conversation";

describe("conversation understanding", () => {
  const now = new Date(2026, 9, 7, 12, 0, 0);

  it("extracts a structured investor goal from one natural sentence", () => {
    const draft = inferGoalDraft(
      "下个月20号我要面对早期投资人做3分钟英文 Pitch，希望他们愿意约下一次会。",
      undefined,
      now,
    );
    expect(draft.scenarioKind).toBe("investor-pitch");
    expect(draft.targetDate).toBe("2026-11-20");
    expect(draft.durationSeconds).toBe(180);
    expect(draft.language).toBe("en-US");
    expect(draft.audience).toContain("早期投资人");
    expect(draft.desiredOutcome).toContain("愿意约下一次会");
  });

  it("recognizes explicit dates and client scenarios", () => {
    const draft = inferGoalDraft("2026年12月5日向客户讲方案，希望确认四周试点。", undefined, now);
    expect(draft.targetDate).toBe("2026-12-05");
    expect(draft.scenarioKind).toBe("client-roadshow");
  });

  it("uses a future default date when the user does not mention one", () => {
    expect(inferTargetDate("我要主持一场线下活动", now)).toBe("2026-10-28");
  });

  it("organizes raw inspiration without asking for metadata", () => {
    const material = inferMaterial("今天开会时大家都说拥抱 AI，但是最后最忙的是复制粘贴的人。", "zh-CN");
    expect(material.type).toBe("contrast");
    expect(material.title).toContain("今天开会时");
    expect(material.scenarioKinds).toContain("live-speaking");
    expect(material.audienceBoundary).toContain("个人隐私");
  });
});
