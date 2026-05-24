import { useEffect, useRef, useState } from "react";
import type { ModifierDefinition } from "../../../shared/types";

interface AlarmToast {
  id: string;
  appName: string;
  message: string;
  createdAt: number;
}

const appNames = ["WorkChat", "Team Call", "QuickPing", "Channel Desk"];
const messages = [
  "Reminder moved to now",
  "Missed alarm",
  "Follow-up due",
  "Standup starts soon",
  "Client message waiting",
  "Calendar alert",
];

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function makeToast(): AlarmToast {
  return {
    id: crypto.randomUUID(),
    appName: pickRandom(appNames),
    message: pickRandom(messages),
    createdAt: Date.now(),
  };
}

function playMessengerLikeSound(volume: number): void {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;

  const context = new AudioContextCtor();
  const normalizedVolume = Math.max(0, Math.min(0.45, volume / 100));
  const now = context.currentTime;
  const pattern = pickRandom([
    [880, 1175],
    [740, 988, 740],
    [1318, 1046],
    [659, 784, 988],
  ]);

  pattern.forEach((frequency, index) => {
    const start = now + index * 0.115;
    const duration = 0.085;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = index % 2 === 0 ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(frequency * randomBetween(0.98, 1.02), start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, normalizedVolume), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  });

  window.setTimeout(() => void context.close().catch(() => undefined), 900);
}

export function SleepingBusinessLayer({ modifier, zIndex }: { modifier: ModifierDefinition; zIndex: number }) {
  const [toasts, setToasts] = useState<AlarmToast[]>([]);
  const timeoutRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    const scheduleNext = () => {
      timeoutRef.current = window.setTimeout(() => {
        if (!aliveRef.current) return;
        const toast = makeToast();
        setToasts((current) => [...current.slice(-2), toast]);
        if (Math.random() < 0.72) playMessengerLikeSound(modifier.volume ?? 34);
        window.setTimeout(() => {
          setToasts((current) => current.filter((item) => item.id !== toast.id));
        }, 8200);
        scheduleNext();
      }, randomBetween(30000, 60000));
    };

    scheduleNext();

    return () => {
      aliveRef.current = false;
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [modifier.volume]);

  return (
    <section className="sleeping-business-layer" style={{ zIndex }}>
      {toasts.map((toast) => (
        <article className="sleeping-business-toast" key={toast.id}>
          <div className="sleeping-business-toast__icon" aria-hidden="true">
            <span />
          </div>
          <div>
            <strong>{toast.appName}</strong>
            <p>{toast.message}</p>
            <small>{new Date(toast.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
          </div>
        </article>
      ))}
    </section>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
