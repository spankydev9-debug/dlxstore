"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Mic, AlertTriangle, Loader2 } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/** Received messages carry no client-side waveform, so synthesise a stable one
    from the URL. It is decorative only (bars are not samples), which keeps every
    voice note visually consistent without persisting extra data. */
function syntheticWaveform(seed: string): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < 32; i += 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const value = 0.22 + ((hash >>> 8) % 1000) / 1000 * 0.78;
    bars.push(Number(value.toFixed(3)));
  }
  return bars;
}

export function VoiceNotePlayer({
  src,
  durationSeconds,
  waveform,
  isMine,
}: {
  src: string;
  durationSeconds?: number;
  waveform?: number[];
  isMine?: boolean;
}) {
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [rate, setRate] = useState(1);

  const bars = useMemo(
    () => (waveform && waveform.length > 0 ? waveform : syntheticWaveform(src)),
    [waveform, src]
  );

  useEffect(() => {
    setPlaying(false);
    setBuffering(false);
    setFailed(false);
    setCurrent(0);
    setDuration(durationSeconds ?? 0);
  }, [src, durationSeconds]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || failed) return;
    if (playing) {
      audio.pause();
      return;
    }
    try {
      setBuffering(true);
      await audio.play();
    } catch {
      setFailed(true);
    } finally {
      setBuffering(false);
    }
  };

  const seek = (ratio: number) => {
    const audio = audioRef.current;
    if (!audio || failed) return;
    const target = Math.max(0, Math.min(1, ratio));
    const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    if (!total) return;
    audio.currentTime = total * target;
    setCurrent(audio.currentTime);
  };

  const cycleRate = () => {
    const audio = audioRef.current;
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audio) audio.playbackRate = next;
  };

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const foreground = isMine ? "text-primary-foreground" : "text-foreground";
  const mutedBar = isMine ? "bg-primary-foreground/35" : "bg-foreground/25";
  const activeBar = isMine ? "bg-primary-foreground" : "bg-primary";

  if (failed) {
    return (
      <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${foreground}`}>
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{t.chatVoiceUnavailable}</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 rounded-xl py-1 ${foreground}`} data-voice-note>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onError={() => {
          setBuffering(false);
          setFailed(true);
        }}
      />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t.chatVoicePause : t.chatVoicePlay}
        data-voice-note-toggle
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          isMine ? "bg-primary-foreground/20" : "bg-primary/10"
        }`}
      >
        {buffering ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          aria-label={t.chatVoiceSeek}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            if (rect.width > 0) seek((event.clientX - rect.left) / rect.width);
          }}
          className="flex h-6 items-center gap-[2px]"
        >
          {bars.map((value, index) => {
            const played = index / bars.length <= progress;
            return (
              <span
                key={index}
                className={`w-[3px] shrink-0 rounded-full ${played ? activeBar : mutedBar}`}
                style={{ height: `${Math.max(12, Math.round(value * 100))}%` }}
              />
            );
          })}
        </button>
        <div className="flex items-center gap-2 text-[10px] opacity-80">
          <Mic className="h-3 w-3" />
          <span className="tabular-nums">
            {playing || current > 0 ? formatDuration(current) : formatDuration(duration)}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={cycleRate}
        aria-label={t.chatVoiceSpeed}
        data-voice-note-rate
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          isMine ? "bg-primary-foreground/20" : "bg-primary/10"
        }`}
      >
        {rate}x
      </button>
    </div>
  );
}
