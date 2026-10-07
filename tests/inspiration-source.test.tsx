import "fake-indexeddb/auto";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InspirationSource } from "@/components/SpeechCoachApp";
import { db } from "@/lib/db";
import { materialToKnowledgeDocument } from "@/lib/knowledge";
import type { HumorMaterial } from "@/lib/types";

const material: HumorMaterial = {
  id: "idea", knowledgeDocumentId: "inspiration:idea", type: "observation", title: "旧标题", content: "旧内容",
  language: "zh-CN", scenarioKinds: ["live-speaking"], audienceBoundary: "不涉及个人隐私", sensitiveTopics: [], tags: ["现场"],
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
};

beforeEach(async () => {
  await db.open();
  await db.transaction("rw", db.humorMaterials, db.documents, async () => {
    await db.humorMaterials.clear(); await db.documents.clear();
    await db.humorMaterials.put(material); await db.documents.put(materialToKnowledgeDocument(material));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("edits inspiration and refreshes its linked knowledge document", async () => {
  const reload = vi.fn().mockResolvedValue(undefined);
  render(<InspirationSource materials={[material]} busy={false} reload={reload} setNotice={vi.fn()} />);
  fireEvent.click(screen.getByTitle("编辑灵感"));
  fireEvent.change(screen.getByLabelText("编辑灵感标题"), { target: { value: "新标题" } });
  fireEvent.change(screen.getByLabelText("编辑灵感内容"), { target: { value: "编辑后的内容可以直接用于台本。" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect((await db.humorMaterials.get("idea"))?.content).toBe("编辑后的内容可以直接用于台本。");
  const document = await db.documents.get("inspiration:idea");
  expect(document?.title).toBe("新标题");
  expect(document?.chunks[0].text).toContain("编辑后的内容可以直接用于台本");
});
