import { describe, expect, it } from "vitest";
import { chunkText, searchKnowledge } from "@/lib/knowledge";

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
});
