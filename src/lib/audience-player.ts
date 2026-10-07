import type { TrainingLanguage } from "./types";
import { routeAudio } from "./media-devices";

export class AudiencePlayer {
  private controller?: AbortController;
  private audio?: HTMLAudioElement;
  private url?: string;
  cancel() {
    this.controller?.abort(); this.controller = undefined;
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load(); this.audio = undefined; }
    if (this.url) { URL.revokeObjectURL(this.url); this.url = undefined; }
  }
  async play(text: string, language: TrainingLanguage, outerSignal?: AbortSignal, outputId = "") {
    this.cancel(); const controller = new AbortController(); this.controller = controller;
    const abort = () => this.cancel(); outerSignal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch("/api/speech/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language }), signal: outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal });
      if (!response.ok) throw new Error((await response.json()).error || "配音失败，问题文本已保留");
      const blob = await response.blob(); controller.signal.throwIfAborted();
      this.url = URL.createObjectURL(blob); this.audio = new Audio(this.url);
      this.audio.onended = () => { if (this.controller === controller) this.cancel(); };
      await routeAudio(this.audio, outputId);
      controller.signal.throwIfAborted();
      await this.audio.play();
    } catch (cause) { if (this.controller === controller) this.cancel(); throw cause; }
    finally { outerSignal?.removeEventListener("abort", abort); }
  }
}
