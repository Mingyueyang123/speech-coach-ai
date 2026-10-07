import MiniSearch from "minisearch";
import type { KnowledgeChunk, KnowledgeDocument } from "./types";

const CHUNK_SIZE = 700;
const CHUNK_OVERLAP = 100;

export function chunkText(text: string): KnowledgeChunk[] {
  const normalized = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];
  const chunks: KnowledgeChunk[] = [];
  let cursor = 0;
  let order = 0;
  while (cursor < normalized.length) {
    let end = Math.min(normalized.length, cursor + CHUNK_SIZE);
    if (end < normalized.length) {
      const boundary = Math.max(normalized.lastIndexOf("\n", end), normalized.lastIndexOf("。", end));
      if (boundary > cursor + CHUNK_SIZE / 2) end = boundary + 1;
    }
    chunks.push({ id: crypto.randomUUID(), text: normalized.slice(cursor, end).trim(), order });
    order += 1;
    if (end >= normalized.length) break;
    cursor = Math.max(cursor + 1, end - CHUNK_OVERLAP);
  }
  return chunks.filter((chunk) => chunk.text.length > 0);
}

export async function parseKnowledgeFile(file: File): Promise<KnowledgeDocument> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  let text = "";

  if (extension === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    text = result.value;
  } else if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    text = pages.join("\n\n");
  } else if (["md", "txt"].includes(extension ?? "")) {
    text = await file.text();
  } else {
    throw new Error("暂不支持该文件格式，请使用 DOCX、PDF、Markdown 或 TXT。 ");
  }

  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    source: "local",
    title: file.name,
    mimeType: file.type || `text/${extension ?? "plain"}`,
    chunks: chunkText(text),
    createdAt: now,
    updatedAt: now,
  };
}

export function searchKnowledge(
  documents: KnowledgeDocument[],
  query: string,
  limit = 6,
): KnowledgeChunk[] {
  const records = documents.flatMap((document) =>
    document.chunks.map((chunk) => ({ ...chunk, documentTitle: document.title })),
  );
  if (!records.length) return [];
  const index = new MiniSearch({ fields: ["text", "documentTitle"], storeFields: ["text", "order"] });
  index.addAll(records);
  const terms = query.trim() || records[0].text.slice(0, 30);
  const results = index.search(terms, { prefix: true, fuzzy: 0.2 }).slice(0, limit);
  if (!results.length) return records.slice(0, limit);
  return results.map((result) => ({ id: String(result.id), text: String(result.text), order: Number(result.order) }));
}
