import type { TrainingLanguage } from "../types";
export type ProviderId = "openai" | "deepseek" | "aliyun" | "minimax";
export interface ProviderCapabilities { text: boolean; realtimeRecognition: boolean; fileTranscription: boolean; synthesis: boolean }
export const CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  openai: { text: true, realtimeRecognition: true, fileTranscription: false, synthesis: true },
  deepseek: { text: true, realtimeRecognition: false, fileTranscription: false, synthesis: false },
  aliyun: { text: false, realtimeRecognition: true, fileTranscription: false, synthesis: false },
  minimax: { text: false, realtimeRecognition: false, fileTranscription: false, synthesis: true },
};
export interface ProviderBindings { text: "openai" | "deepseek"; recognition: "openai" | "aliyun" | "browser" | "off"; synthesis: "minimax" | "openai" | "off" }
export interface ProviderSnapshot extends ProviderBindings { textModel: string; recognitionModel: string; synthesisModel: string }
export interface TextProvider { generate(prompt: string, signal?: AbortSignal): Promise<string> }
export interface SpeechRecognizer { stop(): Promise<void> }
export interface SpeechSynthesizer { synthesize(text: string, language: TrainingLanguage, signal?: AbortSignal): Promise<Uint8Array> }
export interface SpeechUpdate { id: string; text: string; final: boolean }
export interface VoiceOption { id: string; name: string }
export type ProviderCheck = { authenticationAt?: string; callAt?: string; callCapability?: "text" | "synthesis" | "recognition"; latencyMs?: number };
export interface SettingsStatus {
  version: 2; openai: boolean; feishu: boolean; realtimeModel: string; reviewModel: string;
  providers: Record<ProviderId, { saved: boolean; checks: ProviderCheck }>;
  bindings: ProviderBindings;
  models: { deepseek: string; aliyun: string; minimax: string };
  region: "cn-beijing" | "ap-southeast-1"; voice: string;
}
