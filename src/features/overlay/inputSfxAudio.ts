import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../runtime/tauri";

type DefaultPreset =
  | "default:mouse-left"
  | "default:mouse-right"
  | "default:mouse-middle"
  | "default:wheel-up"
  | "default:wheel-down"
  | "default:keyboard";

interface PlayInputSfxOptions {
  userSounds: string[];
  defaultSounds: DefaultPreset[];
  volume: number;
  pitchMin?: number;
  pitchMax?: number;
  onWarning?: (message: string) => void;
}

const audioContext = { current: null as AudioContext | null };

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

function getAudioContext(): AudioContext | null {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext.current) audioContext.current = new AudioContextCtor();
  if (audioContext.current.state === "suspended") {
    void audioContext.current.resume().catch(() => undefined);
  }
  return audioContext.current;
}

function playPresetSound(preset: DefaultPreset, volume: number, playbackRate: number): void {
  const context = getAudioContext();
  if (!context) return;

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const baseFrequency: Record<DefaultPreset, number> = {
    "default:mouse-left": 520,
    "default:mouse-right": 390,
    "default:mouse-middle": 455,
    "default:wheel-up": 650,
    "default:wheel-down": 310,
    "default:keyboard": 740,
  };
  const duration: Record<DefaultPreset, number> = {
    "default:mouse-left": 0.035,
    "default:mouse-right": 0.045,
    "default:mouse-middle": 0.05,
    "default:wheel-up": 0.035,
    "default:wheel-down": 0.04,
    "default:keyboard": 0.028,
  };

  oscillator.type = preset === "default:keyboard" ? "triangle" : "square";
  oscillator.frequency.setValueAtTime(baseFrequency[preset] * playbackRate, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration[preset]);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration[preset] + 0.01);
}

function resolveFileSrc(path: string): string {
  if (!isTauri) return path;
  return convertFileSrc(path);
}

async function playUserSound(path: string, volume: number, playbackRate: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(resolveFileSrc(path));
    audio.volume = volume;
    audio.playbackRate = playbackRate;
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error(`Audio file unavailable: ${path}`));
    audio.play().then(() => undefined).catch(reject);
  });
}

export function playInputSfx({
  userSounds,
  defaultSounds,
  volume,
  pitchMin = 0.92,
  pitchMax = 1.08,
  onWarning,
}: PlayInputSfxOptions): void {
  const normalizedVolume = Math.max(0, Math.min(1, volume / 100));
  const playbackRate = randomBetween(pitchMin, pitchMax);
  const userSound = pickRandom(userSounds.filter(Boolean));
  const defaultSound = pickRandom(defaultSounds);

  if (userSound) {
    void playUserSound(userSound, normalizedVolume, playbackRate).catch((error) => {
      onWarning?.(String(error));
      if (defaultSound) playPresetSound(defaultSound, normalizedVolume, playbackRate);
    });
    return;
  }

  if (defaultSound) playPresetSound(defaultSound, normalizedVolume, playbackRate);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
