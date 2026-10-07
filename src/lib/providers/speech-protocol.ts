import { z } from "zod";
import type { SpeechUpdate } from "./contracts";
export const speechStartSchema = z.object({
  type: z.literal("start"), token: z.string().uuid(), language: z.enum(["zh-CN", "en-US"]),
  format: z.literal("pcm_s16le"), sampleRate: z.literal(16000), channels: z.literal(1),
}).strict();
const sentenceSchema = z.object({ sentence_id: z.number().optional(), begin_time: z.number().optional(), text: z.string().max(12000), sentence_end: z.boolean(), heartbeat: z.boolean().optional() });
export function parseAliSentence(data: unknown, taskId: string): SpeechUpdate | null {
  const parsed = sentenceSchema.safeParse(data);
  if (!parsed.success || parsed.data.heartbeat || !parsed.data.text.trim()) return null;
  const s = parsed.data;
  if (s.sentence_id === undefined && s.begin_time === undefined) return null;
  return { id: `${taskId}:${s.sentence_id ?? s.begin_time}`, text: s.text.trim(), final: s.sentence_end };
}
// Revisions replace the current sentence. Dedup by sentence ID, not text: repeated phrases are legitimate speech.
export class TranscriptAccumulator {
  private finalIds = new Set<string>();
  accept(update: SpeechUpdate) {
    if (this.finalIds.has(update.id)) return null;
    if (update.final) this.finalIds.add(update.id);
    return update;
  }
}
