/* Mono PCM16 capture only. Never connects playback or camera tracks to recognition. */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = []; this.position = 0; this.frame = new Int16Array(1600); this.offset = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    this.samples.push(...channel);
    const step = sampleRate / 16000;
    while (this.position + step < this.samples.length) {
      // Average each source interval for anti-aliasing when downsampling.
      const start = Math.floor(this.position), end = Math.max(start + 1, Math.floor(this.position + step));
      let sum = 0;
      for (let i = start; i < end; i++) sum += this.samples[i];
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      this.frame[this.offset++] = sample < 0 ? sample * 32768 : sample * 32767;
      this.position += step;
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]); this.frame = new Int16Array(1600); this.offset = 0;
      }
    }
    const consumed = Math.floor(this.position); this.samples.splice(0, consumed); this.position -= consumed;
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
