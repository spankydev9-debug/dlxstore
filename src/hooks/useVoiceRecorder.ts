"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "error";

/** Stable, translation-friendly error identifiers. The caller maps these to
    localized copy; the hook never produces user-facing English/French strings. */
export type VoiceRecorderErrorCode =
  | "unsupported"
  | "denied"
  | "no-device"
  | "failed";

export interface VoiceClip {
  file: File;
  durationMs: number;
  mimeType: string;
}

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

/** Hard cap parallel to the 10MB upload limit: Opus/Vorbis at speech bitrates
    stays far under 10MB for 5 minutes, and a runaway recording can never fill
    the device. */
const MAX_DURATION_MS = 5 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 90;
const MAX_SAMPLES = 48;
const MIN_CLIP_MS = 400;

/** Feature detection for the recorder entry point. Safari gained MediaRecorder
    in 14.1 and getUserMedia is gated behind a secure context, so this must be
    checked before offering the microphone affordance. */
export function isVoiceRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== "undefined"
  );
}

function pickMimeType(): string | undefined {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") {
    return undefined;
  }
  const recorder = window.MediaRecorder as typeof MediaRecorder & {
    isTypeSupported?: (type: string) => boolean;
  };
  if (typeof recorder.isTypeSupported !== "function") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => recorder.isTypeSupported!(type));
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("aac") || mimeType.includes("m4a")) {
    return "m4a";
  }
  return "webm";
}

function classifyError(error: unknown): VoiceRecorderErrorCode {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-device";
  return "failed";
}

export interface UseVoiceRecorderResult {
  status: VoiceRecorderStatus;
  errorCode: VoiceRecorderErrorCode | null;
  elapsedMs: number;
  /** Rolling amplitude samples (0..1) used to paint a live waveform. */
  samples: number[];
  start: () => Promise<boolean>;
  stop: () => Promise<VoiceClip | null>;
  cancel: () => void;
  reset: () => void;
}

export function useVoiceRecorder(): UseVoiceRecorderResult {
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [errorCode, setErrorCode] = useState<VoiceRecorderErrorCode | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [samples, setSamples] = useState<number[]>([]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const samplerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const cancelledRef = useRef(false);
  const resolveStopRef = useRef<((clip: VoiceClip | null) => void) | null>(null);
  const mountedRef = useRef(true);

  const releaseHardware = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (samplerRef.current) {
      clearInterval(samplerRef.current);
      samplerRef.current = null;
    }
    if (maxDurationRef.current) {
      clearTimeout(maxDurationRef.current);
      maxDurationRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        /* already disconnected */
      }
      analyserRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      // Stopping the recorder here is best-effort: the unmount path must still
      // tear the microphone down even if MediaRecorder never fires onstop.
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      } catch {
        /* noop */
      }
      releaseHardware();
    };
  }, [releaseHardware]);

  const reset = useCallback(() => {
    setStatus("idle");
    setErrorCode(null);
    setElapsedMs(0);
    setSamples([]);
  }, []);

  const startSampler = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      samplerRef.current = setInterval(() => {
        if (!mountedRef.current || !analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) {
          const centered = (buffer[i] - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / buffer.length);
        const normalized = Math.min(1, Math.max(0.06, rms * 3.2));
        setSamples((current) => {
          const next = current.length >= MAX_SAMPLES ? current.slice(1) : current.slice();
          next.push(normalized);
          return next;
        });
      }, SAMPLE_INTERVAL_MS);
    } catch {
      analyserRef.current = null;
      audioCtxRef.current = null;
    }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!isVoiceRecordingSupported()) {
      setErrorCode("unsupported");
      setStatus("error");
      return false;
    }

    setStatus("requesting");
    setErrorCode(null);
    setElapsedMs(0);
    setSamples([]);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      if (mountedRef.current) {
        setErrorCode(classifyError(error));
        setStatus("error");
      }
      return false;
    }

    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new window.MediaRecorder(stream, { mimeType })
        : new window.MediaRecorder(stream);
    } catch {
      try {
        recorder = new window.MediaRecorder(stream);
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        if (mountedRef.current) {
          setErrorCode(classifyError(error));
          setStatus("error");
        }
        return false;
      }
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    cancelledRef.current = false;
    startedAtRef.current = Date.now();

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      cancelledRef.current = true;
      const resolve = resolveStopRef.current;
      resolveStopRef.current = null;
      releaseHardware();
      if (mountedRef.current) {
        setStatus("error");
        setErrorCode("failed");
        setElapsedMs(0);
        setSamples([]);
      }
      resolve?.(null);
    };

    recorder.onstop = () => {
      const wasCancelled = cancelledRef.current;
      const durationMs = Date.now() - startedAtRef.current;
      const chunks = chunksRef.current.slice();
      const resolvedType = recorderRef.current?.mimeType || mimeType || "audio/webm";
      const resolve = resolveStopRef.current;
      resolveStopRef.current = null;
      cancelledRef.current = false;

      releaseHardware();

      if (!mountedRef.current) {
        resolve?.(null);
        return;
      }

      setStatus("idle");
      setErrorCode(null);
      setElapsedMs(0);
      setSamples([]);

      if (!resolve) return;
      if (wasCancelled || chunks.length === 0 || durationMs < MIN_CLIP_MS) {
        resolve(null);
        return;
      }

      const blob = new Blob(chunks, { type: resolvedType });
      const extension = extensionForMimeType(resolvedType);
      const file = new File([blob], `voice-note-${Date.now()}.${extension}`, {
        // MediaRecorder reports a parameterized type (`audio/webm;codecs=opus`).
        // Store the base mime on the File so the chat-media allowlist matches.
        type: resolvedType.split(";")[0].trim(),
      });
      resolve({ file, durationMs, mimeType: resolvedType });
    };

    try {
      recorder.start(250);
    } catch (error) {
      releaseHardware();
      if (mountedRef.current) {
        setErrorCode(classifyError(error));
        setStatus("error");
      }
      return false;
    }

    setStatus("recording");
    startSampler(stream);

    timerRef.current = setInterval(() => {
      if (mountedRef.current) setElapsedMs(Date.now() - startedAtRef.current);
    }, 200);

    maxDurationRef.current = setTimeout(() => {
      // Auto-stop at the cap; the clip is still delivered via stop()'s promise.
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      } catch {
        /* noop */
      }
    }, MAX_DURATION_MS);

    return true;
  }, [releaseHardware, startSampler]);

  const stop = useCallback(async (): Promise<VoiceClip | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      releaseHardware();
      if (mountedRef.current) setStatus("idle");
      return null;
    }
    setStatus("stopping");
    return new Promise<VoiceClip | null>((resolve) => {
      resolveStopRef.current = resolve;
      try {
        recorder.stop();
      } catch {
        resolveStopRef.current = null;
        releaseHardware();
        if (mountedRef.current) setStatus("idle");
        resolve(null);
      }
    });
  }, [releaseHardware]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    cancelledRef.current = true;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
        return;
      } catch {
        /* fall through to hardware release */
      }
    }
    releaseHardware();
    if (mountedRef.current) setStatus("idle");
  }, [releaseHardware]);

  return { status, errorCode, elapsedMs, samples, start, stop, cancel, reset };
}
