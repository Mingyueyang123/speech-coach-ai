import type { TrainingLanguage } from "./types";

export interface SpeechMatch {
  progress: number;
  confidence: number;
  matched: boolean;
}

export function normalizeSpeechText(text: string, language: TrainingLanguage): string {
  const normalized = text.normalize("NFKC").toLocaleLowerCase(language).replace(/[\p{P}\p{S}\s]+/gu, "");
  return language === "en-US" ? normalized.replace(/[^a-z0-9]/g, "") : normalized;
}

function bigrams(value: string): string[] {
  if (value.length < 2) return value ? [value] : [];
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
}

function diceSimilarity(left: string, right: string): number {
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  if (!leftPairs.length || !rightPairs.length) return 0;
  const remaining = [...rightPairs];
  let overlap = 0;
  for (const pair of leftPairs) {
    const index = remaining.indexOf(pair);
    if (index >= 0) {
      overlap += 1;
      remaining.splice(index, 1);
    }
  }
  return (2 * overlap) / (leftPairs.length + rightPairs.length);
}

export function findSpeechProgress(
  script: string,
  spoken: string,
  language: TrainingLanguage,
  previousProgress = 0,
): SpeechMatch {
  const source = normalizeSpeechText(script, language);
  const heard = normalizeSpeechText(spoken, language);
  const minimum = language === "zh-CN" ? 4 : 8;
  if (source.length < minimum || heard.length < minimum) {
    return { progress: previousProgress, confidence: 0, matched: false };
  }

  const searchFloor = Math.max(0, Math.floor(source.length * previousProgress) - 36);
  for (let size = Math.min(36, heard.length); size >= minimum; size -= 1) {
    const needle = heard.slice(-size);
    const index = source.indexOf(needle, searchFloor);
    if (index >= 0) {
      const progress = Math.max(previousProgress, Math.min(1, (index + size) / source.length));
      return { progress, confidence: Math.min(1, 0.75 + size / 100), matched: true };
    }
  }

  const sampleSize = Math.min(language === "zh-CN" ? 18 : 28, heard.length);
  const sample = heard.slice(-sampleSize);
  const start = Math.max(0, searchFloor);
  const end = Math.min(source.length - sampleSize, Math.floor(source.length * previousProgress) + 180);
  let bestScore = 0;
  let bestIndex = -1;
  for (let index = start; index <= end; index += 1) {
    const score = diceSimilarity(sample, source.slice(index, index + sampleSize));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  if (bestIndex >= 0 && bestScore >= 0.62) {
    const progress = Math.max(previousProgress, Math.min(1, (bestIndex + sampleSize) / source.length));
    return { progress, confidence: bestScore, matched: true };
  }
  return { progress: previousProgress, confidence: bestScore, matched: false };
}

export function progressToSection(progress: number, sectionCount: number): number {
  if (sectionCount <= 1) return 0;
  return Math.min(sectionCount - 1, Math.floor(Math.max(0, Math.min(0.999, progress)) * sectionCount));
}
