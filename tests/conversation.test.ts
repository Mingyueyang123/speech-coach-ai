import { describe, expect, it } from "vitest";
import { cleanSpokenText, inferGoalDraft, inferMaterial, inferTargetDate } from "@/lib/conversation";

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
    expect(draft.actionSteps).toHaveLength(4);
    expect(draft.actionSteps.at(-1)).toContain("2026-11-20");
  });

  it("recognizes explicit dates and client scenarios", () => {
    const draft = inferGoalDraft("2026年12月5日向客户讲方案，希望确认四周试点。", undefined, now);
    expect(draft.targetDate).toBe("2026-12-05");
    expect(draft.scenarioKind).toBe("client-roadshow");
  });

  it("uses a future default date when the user does not mention one", () => {
    expect(inferTargetDate("我要主持一场线下活动", now)).toBe("2026-10-28");
  });

  it("turns a spoken month-week date into a concrete deadline", () => {
    expect(inferTargetDate("嗯，我的目标是在10月第2周做一场线下演讲", now)).toBe("2026-10-16");
  });

  it("organizes raw inspiration without asking for metadata", () => {
    const material = inferMaterial("今天开会时大家都说拥抱 AI，但是最后最忙的是复制粘贴的人。", "zh-CN");
    expect(material.type).toBe("contrast");
    expect(material.title).toContain("开会时");
    expect(material.scenarioKinds).toContain("live-speaking");
    expect(material.audienceBoundary).toContain("个人隐私");
    expect(material.coreIdea).toContain("拥抱 AI");
  });

  it("removes spoken filler and adjacent repetition while retaining the source", () => {
    const raw = "嗯，我的灵感素材是今天在生成这个 speech coach 的时候，就是发现没有对标的这种特别牛逼的口语陪练产品。然后想做个口语口语训练。";
    const material = inferMaterial(raw, "zh-CN");
    expect(material.sourceText).toBe(raw);
    expect(material.content).not.toContain("我的灵感素材是");
    expect(material.content).not.toContain("就是");
    expect(material.content).not.toContain("口语口语");
    expect(material.content).toContain("真正优秀的口语陪练产品");
    expect(cleanSpokenText("呃，就是今天想想讲这个。", "zh-CN")).toBe("今天想讲这个。");
  });
});
