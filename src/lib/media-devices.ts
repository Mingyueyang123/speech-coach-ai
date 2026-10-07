export interface PracticeDevices {
  microphoneId: string;
  cameraId: string;
  outputId: string;
  cameraEnabled: boolean;
}

export const DEFAULT_DEVICES: PracticeDevices = { microphoneId: "", cameraId: "", outputId: "", cameraEnabled: true };

export function mediaConstraints(devices: PracticeDevices): MediaStreamConstraints {
  return {
    audio: { echoCancellation: true, noiseSuppression: true, ...(devices.microphoneId ? { deviceId: { exact: devices.microphoneId } } : {}) },
    video: devices.cameraEnabled ? { width: { ideal: 1280 }, height: { ideal: 720 }, ...(devices.cameraId ? { deviceId: { exact: devices.cameraId } } : { facingMode: "user" }) } : false,
  };
}

export function recordingMimeType(hasVideo: boolean, supported: (type: string) => boolean): string | undefined {
  return (hasVideo ? ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"] : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]).find(supported);
}

export async function routeAudio(element: HTMLMediaElement, outputId: string) {
  if (!outputId) return;
  if (typeof element.setSinkId !== "function") throw new Error("当前浏览器的音频输出由系统管理，请在控制中心选择耳机。");
  await element.setSinkId(outputId);
}
