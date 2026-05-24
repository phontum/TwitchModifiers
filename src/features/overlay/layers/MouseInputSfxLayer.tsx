import { useEffect, useRef } from "react";
import type { MouseInputSfxSettings } from "../../../shared/types";
import { safeInvoke, safeListen } from "../../runtime/tauri";
import { playInputSfx } from "../inputSfxAudio";

type MouseInputKind = "leftDown" | "rightDown" | "middleDown" | "wheelUp" | "wheelDown";

interface MouseInputPayload {
  kind: string;
}

const cooldowns: Record<MouseInputKind, number> = {
  leftDown: 40,
  rightDown: 50,
  middleDown: 60,
  wheelUp: 70,
  wheelDown: 70,
};

const defaultSounds = {
  leftDown: ["default:mouse-left"],
  rightDown: ["default:mouse-right"],
  middleDown: ["default:mouse-middle"],
  wheelUp: ["default:wheel-up"],
  wheelDown: ["default:wheel-down"],
} as const;

export function MouseInputSfxLayer({ settings }: { settings: MouseInputSfxSettings }) {
  const settingsRef = useRef(settings);
  const lastPlayedRef = useRef<Record<MouseInputKind, number>>({
    leftDown: 0,
    rightDown: 0,
    middleDown: 0,
    wheelUp: 0,
    wheelDown: 0,
  });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    safeListen<MouseInputPayload>("input:mouse", (payload) => {
      if (!active) return;
      if (!["leftDown", "rightDown", "middleDown", "wheelUp", "wheelDown"].includes(payload.kind)) return;
      const kind = payload.kind as MouseInputKind;
      const now = performance.now();
      if (now - lastPlayedRef.current[kind] < cooldowns[kind]) return;
      lastPlayedRef.current[kind] = now;

      const current = settingsRef.current;
      const userSounds = {
        leftDown: current.sounds.leftClick,
        rightDown: current.sounds.rightClick,
        middleDown: current.sounds.middleClick,
        wheelUp: current.sounds.wheelUp,
        wheelDown: current.sounds.wheelDown,
      }[kind];

      playInputSfx({
        userSounds,
        defaultSounds: [...defaultSounds[kind]],
        volume: current.volume,
        onWarning: (message) => void safeInvoke("append_log", { level: "warn", message }),
      });
    }).then((unsub) => {
      unsubscribe = unsub;
      if (!active) {
        unsubscribe();
        unsubscribe = null;
      }
      return undefined;
    });

    return () => {
      active = false;
      unsubscribe?.();
      unsubscribe = null;
    };
  }, []);

  return null;
}
