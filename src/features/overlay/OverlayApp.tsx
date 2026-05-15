import { useEffect } from "react";
import type { AppConfig, TriggerEvent } from "../../shared/types";
import { defaultConfig, normalizeConfig } from "../../shared/defaultModifiers";
import { safeListen } from "../runtime/tauri";
import { useRuntimeStore } from "../runtime/runtimeStore";
import { RollLayer } from "./RollLayer";
import { ActiveModifiersPanel } from "./ActiveModifiersPanel";
import { TunnelLayer } from "./layers/TunnelLayer";
import { LagLayer } from "./layers/LagLayer";
import { ChatLayer } from "./layers/ChatLayer";
import { VideoCornerLayer } from "./layers/VideoCornerLayer";
import { SoundLayer } from "./layers/SoundLayer";
import { MouseInputSfxLayer } from "./layers/MouseInputSfxLayer";
import { KeyboardInputSfxLayer } from "./layers/KeyboardInputSfxLayer";
import { findModifier } from "../runtime/modifierEngine";

export function OverlayApp() {
  const config = useRuntimeStore((state) => state.config);
  const setConfig = useRuntimeStore((state) => state.setConfig);
  const stopAllModifiers = useRuntimeStore((state) => state.stopAllModifiers);
  const activeModifiers = useRuntimeStore((state) => state.activeModifiers);

  useEffect(() => {
    setConfig(defaultConfig);
    const unsubs: Array<() => void> = [];
    let mounted = true;
    const addUnsub = (unsub: () => void) => {
      if (mounted) unsubs.push(unsub);
      else unsub();
    };

    safeListen<AppConfig>("app:config-loaded", (nextConfig) => setConfig(normalizeConfig(nextConfig))).then(addUnsub);
    safeListen("modifier:stop-all", stopAllModifiers).then(addUnsub);
    safeListen<TriggerEvent>("trigger:received", () => {}).then(addUnsub);

    return () => {
      mounted = false;
      unsubs.forEach((unsub) => unsub());
    };
  }, [setConfig, stopAllModifiers]);

  return (
    <main className="overlay-root">
      <RollLayer />
      {activeModifiers.map((instance) => {
        const modifier = findModifier(config.modifiers, instance.modifierId);
        if (!modifier) return null;
        if (modifier.type === "tunnel") return <TunnelLayer key={instance.instanceId} />;
        if (modifier.type === "lag") return <LagLayer key={instance.instanceId} />;
        if (modifier.type === "chat") return <ChatLayer key={instance.instanceId} />;
        if (modifier.type === "video-corner") {
          return <VideoCornerLayer key={instance.instanceId} modifier={modifier} />;
        }
        if (modifier.type === "sound") return <SoundLayer key={instance.instanceId} modifier={modifier} />;
        if (modifier.type === "mouse-input-sfx") {
          return <MouseInputSfxLayer key={instance.instanceId} settings={config.mouseInputSfx} />;
        }
        if (modifier.type === "keyboard-input-sfx") {
          return <KeyboardInputSfxLayer key={instance.instanceId} settings={config.keyboardInputSfx} />;
        }
        return null;
      })}
      <ActiveModifiersPanel />
    </main>
  );
}
