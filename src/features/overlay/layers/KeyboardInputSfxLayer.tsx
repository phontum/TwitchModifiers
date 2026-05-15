import { useEffect, useRef } from "react";
import type { KeyboardInputSfxSettings } from "../../../shared/types";
import { safeInvoke, safeListen } from "../../runtime/tauri";
import { playInputSfx } from "../inputSfxAudio";

interface KeyboardInputPayload {
  keyCode?: string;
}

export function KeyboardInputSfxLayer({ settings }: { settings: KeyboardInputSfxSettings }) {
  const settingsRef = useRef(settings);
  const lastPlayedRef = useRef(0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    safeListen<KeyboardInputPayload>("input:keyboard", () => {
      if (!active) return;
      const now = performance.now();
      if (now - lastPlayedRef.current < 32) return;
      lastPlayedRef.current = now;

      const current = settingsRef.current;
      playInputSfx({
        userSounds: current.sounds,
        defaultSounds: ["default:keyboard"],
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
