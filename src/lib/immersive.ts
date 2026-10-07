import type { TrainingLanguage } from "./types";
export interface AudienceCharacter { id: string; name: string; role: string; voiceId: string; questionStyle: "supportive" | "skeptical" | "curious"; avatar: "audio-ring" | "animated" }
export interface ImmersiveScenario { id: string; language: TrainingLanguage; characters: AudienceCharacter[]; events: SceneEvent[] }
export interface SceneEvent { id: string; timestampMs: number; kind: "question" | "ambience" | "interruption" | "response"; characterId?: string; relatedTurnId?: string; text?: string; assetId?: string }
export interface AvatarRenderer { mount(container: HTMLElement): void; setAudioLevel(level: number): void; setCharacter(character: AudienceCharacter): void; dispose(): void }
export type AudioLayer = "ambience" | "effect" | "audience";
export interface SceneAudioTrack { pause(): void; cancel(): void; setVolume(volume: number): void }
// Scheduling and visuals are future adapters. These buses never expose a recognition input.
export class SceneAudioLayers {
  private tracks = new Map<AudioLayer, Set<SceneAudioTrack>>();
  private volumes: Record<AudioLayer, number> = { ambience: 0.25, effect: 0.4, audience: 1 };
  attach(layer: AudioLayer, track: SceneAudioTrack) {
    const tracks = this.tracks.get(layer) ?? new Set(); tracks.add(track); this.tracks.set(layer, tracks);
    track.setVolume(this.volumes[layer]); return () => tracks.delete(track);
  }
  setVolume(layer: AudioLayer, value: number) { this.volumes[layer] = Math.max(0, Math.min(1, value)); this.tracks.get(layer)?.forEach(t => t.setVolume(this.volumes[layer])); }
  pause() { this.tracks.forEach(tracks => tracks.forEach(t => t.pause())); }
  cancel(layer?: AudioLayer) {
    if (layer) { this.tracks.get(layer)?.forEach(t => t.cancel()); this.tracks.delete(layer); }
    else { this.tracks.forEach(tracks => tracks.forEach(t => t.cancel())); this.tracks.clear(); }
  }
}
