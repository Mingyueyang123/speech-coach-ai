"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { MetricPoint } from "@/lib/types";
import { DEFAULT_DEVICES, mediaConstraints, recordingMimeType, type PracticeDevices } from "@/lib/media-devices";

interface MediaSessionState {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  cameraReady: boolean;
  recording: boolean;
  visionStatus: string;
  error: string;
  prepare: (devices?: PracticeDevices) => Promise<MediaStream>;
  startRecording: () => void;
  stopRecording: () => Promise<Blob | null>;
  stopCamera: () => void;
  getMetricTimeline: () => MetricPoint[];
}

export function useMediaSession(): MediaSessionState {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const pendingRef = useRef<Promise<MediaStream> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);
  const timelineRef = useRef<MetricPoint[]>([]);
  const frameHandleRef = useRef<number | null>(null);
  const faceRef = useRef<FaceLandmarker | null>(null);
  const poseRef = useRef<PoseLandmarker | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousWristRef = useRef<[number, number] | null>(null);
  const previousShoulderRef = useRef<number | null>(null);
  const lastSampleRef = useRef(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [visionStatus, setVisionStatus] = useState("视觉分析待机");
  const [error, setError] = useState("");

  const sampleFrame = useCallback(function sampleFrameLoop() {
    const video = videoRef.current;
    if (streamRef.current?.getVideoTracks().length && (!video || video.readyState < 2)) {
      frameHandleRef.current = requestAnimationFrame(sampleFrameLoop);
      return;
    }
    const now = performance.now();
    if (now - lastSampleRef.current >= 500) {
      lastSampleRef.current = now;
      let cameraFacing = 0;
      let expression = 0;
      let smile = 0;
      let handsVisible = 0;
      let gestureMovement = 0;
      let bodySway = 0;

      try {
        const faceResult = video && video.readyState >= 2 ? faceRef.current?.detectForVideo(video, now) : undefined;
        const landmarks = faceResult?.faceLandmarks[0];
        if (landmarks) {
          const nose = landmarks[1];
          const leftEye = landmarks[33];
          const rightEye = landmarks[263];
          const eyeMidpoint = (leftEye.x + rightEye.x) / 2;
          const eyeDistance = Math.max(0.01, Math.abs(rightEye.x - leftEye.x));
          cameraFacing = Math.abs(nose.x - eyeMidpoint) < eyeDistance * 0.22 ? 1 : 0;
          const categories = faceResult?.faceBlendshapes[0]?.categories ?? [];
          const score = (name: string) => categories.find((item) => item.categoryName === name)?.score ?? 0;
          smile = (score("mouthSmileLeft") + score("mouthSmileRight")) / 2;
          expression = Math.min(1, smile + score("browInnerUp") * 0.5 + score("jawOpen") * 0.25);
        }

        const poseResult = video && video.readyState >= 2 ? poseRef.current?.detectForVideo(video, now) : undefined;
        const pose = poseResult?.landmarks[0];
        if (pose) {
          const leftWrist = pose[15];
          const rightWrist = pose[16];
          const leftShoulder = pose[11];
          const rightShoulder = pose[12];
          const visibleHands = [leftWrist, rightWrist].filter((point) => point.visibility > 0.45).length;
          handsVisible = visibleHands / 2;
          const wristCenter: [number, number] = [(leftWrist.x + rightWrist.x) / 2, (leftWrist.y + rightWrist.y) / 2];
          if (previousWristRef.current) {
            gestureMovement = Math.min(1, Math.hypot(
              wristCenter[0] - previousWristRef.current[0],
              wristCenter[1] - previousWristRef.current[1],
            ) * 8);
          }
          previousWristRef.current = wristCenter;
          const shoulderCenter = (leftShoulder.x + rightShoulder.x) / 2;
          if (previousShoulderRef.current !== null) {
            bodySway = Math.min(1, Math.abs(shoulderCenter - previousShoulderRef.current) * 10);
          }
          previousShoulderRef.current = shoulderCenter;
        }
      } catch {
        // A single dropped frame should not stop recording.
      }

      let volume = 0;
      const analyser = analyserRef.current;
      if (analyser) {
        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / data.length);
        volume = Math.min(1, rms * 4);
      }
      timelineRef.current.push({
        timestampMs: Date.now(), volume, cameraFacing, expression, smile,
        handsVisible, gestureMovement, bodySway,
      });
    }
    frameHandleRef.current = requestAnimationFrame(sampleFrameLoop);
  }, []);

  const loadVision = useCallback(async (generation: number) => {
    let face: FaceLandmarker | undefined;
    let pose: PoseLandmarker | undefined;
    try {
      setVisionStatus("正在加载本地视觉模型");
      const { FilesetResolver, FaceLandmarker, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
      );
      if (generation !== generationRef.current) return;
      face = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      if (generation !== generationRef.current) { face.close(); return; }
      pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
      });
      if (generation !== generationRef.current) { face.close(); pose.close(); return; }
      faceRef.current = face;
      poseRef.current = pose;
      setVisionStatus("视觉分析仅在本机运行");
    } catch {
      face?.close(); pose?.close();
      if (generation === generationRef.current) setVisionStatus("视觉模型不可用，录像与语音仍可使用");
    }
  }, []);

  const prepare = useCallback(async (devices: PracticeDevices = DEFAULT_DEVICES) => {
    if (streamRef.current) return streamRef.current;
    if (pendingRef.current) return pendingRef.current;
    const generation = generationRef.current;
    setError("");
    const pending = (async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia(mediaConstraints(devices));
      if (generation !== generationRef.current) { mediaStream.getTracks().forEach(track => track.stop()); throw new Error("设备设置已变更，请重新开始。"); }
      streamRef.current = mediaStream;
      setStream(mediaStream);
      if (videoRef.current && mediaStream.getVideoTracks().length) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }
      if (generation !== generationRef.current) { mediaStream.getTracks().forEach(track => track.stop()); throw new Error("媒体接入已取消。"); }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(mediaStream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;
      audioContextRef.current = context;
      setCameraReady(mediaStream.getVideoTracks().length > 0);
      if (mediaStream.getVideoTracks().length) void loadVision(generation);
      else setVisionStatus("仅录音 · 未进行视觉分析");
      frameHandleRef.current = requestAnimationFrame(sampleFrame);
      return mediaStream;
    } catch (cause) {
      if (generation === generationRef.current) {
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null; setStream(null); setCameraReady(false);
      }
      const message = cause instanceof Error ? cause.message : "无法访问摄像头或麦克风。";
      setError(message);
      throw cause;
    }
    })();
    pendingRef.current = pending;
    try { return await pending; }
    finally { if (pendingRef.current === pending) pendingRef.current = null; }
  }, [loadVision, sampleFrame]);

  const startRecording = useCallback(() => {
    const mediaStream = streamRef.current;
    if (!mediaStream || recording) return;
    chunksRef.current = [];
    timelineRef.current = [];
    const mimeType = recordingMimeType(mediaStream.getVideoTracks().length > 0, type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type: recorder.mimeType || chunksRef.current[0].type }) : null;
      stopResolverRef.current?.(blob);
      stopResolverRef.current = null;
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setRecording(true);
  }, [recording]);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return null;
    return new Promise<Blob | null>((resolve) => {
      stopResolverRef.current = resolve;
      recorder.stop();
      setRecording(false);
    });
  }, []);

  const stopCamera = useCallback(() => {
    generationRef.current += 1;
    pendingRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setCameraReady(false);
    if (frameHandleRef.current !== null) cancelAnimationFrame(frameHandleRef.current);
    void audioContextRef.current?.close();
    faceRef.current?.close();
    poseRef.current?.close();
    faceRef.current = null;
    poseRef.current = null;
    setVisionStatus("视觉分析待机");
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  return {
    videoRef, stream, cameraReady, recording, visionStatus, error,
    prepare, startRecording, stopRecording, stopCamera,
    getMetricTimeline: () => [...timelineRef.current],
  };
}
