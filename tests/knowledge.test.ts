import { describe, expect, it } from "vitest";
import { chunkText, materialToKnowledgeDocument, searchKnowledge } from "@/lib/knowledge";

describe("knowledge utilities", () => {
  it("chunks long documents with stable ordering", () => {
    const chunks = chunkText("这是第一段。\n\n" + "这是内容。".repeat(220));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.order)).toEqual(chunks.map((_, index) => index));
  });

  it("retrieves relevant local context", () => {
    const now = new Date().toISOString();
    const documents = [{
      id: "doc-1", source: "local" as const, title: "客户路演材料", mimeType: "text/plain",
      chunks: [
        { id: "a", order: 0, text: "方案采用四周试点，重点验证交付周期和投资回报率。" },
        { id: "b", order: 1, text: "团队喜欢在周五举行读书会。" },
      ],
      createdAt: now, updatedAt: now,
    }];
    const results = searchKnowledge(documents, "交付周期 ROI");
    expect(results[0].text).toContain("四周试点");
  });

  it("turns an editable inspiration into searchable knowledge", () => {
    const document = materialToKnowledgeDocument({
      id: "idea-1", type: "observation", title: "会议里的 AI 反差", content: "所有人都说拥抱 AI，最后最忙的却是复制粘贴。",
      coreIdea: "口号和实际工作之间存在反差。", language: "zh-CN", scenarioKinds: ["live-speaking"], audienceBoundary: "不攻击个人",
      sensitiveTopics: [], tags: ["AI", "会议"], createdAt: "2026-01-01", updatedAt: "2026-01-02",
    });
    expect(document.source).toBe("inspiration");
    expect(document.sourceMaterialId).toBe("idea-1");
    expect(document.chunks[0].text).toContain("复制粘贴");
    expect(searchKnowledge([document], "AI 反差")[0].text).toContain("口号和实际工作");
  });
});
