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
import { BigCursorLayer } from "./layers/BigCursorLayer";
import { KillerCursorLayer } from "./layers/KillerCursorLayer";
import { FlashlightLayer } from "./layers/FlashlightLayer";
import { SleepingBusinessLayer } from "./layers/SleepingBusinessLayer";
import { findModifier } from "../runtime/modifierEngine";
import type { VisualLayerType } from "../../shared/types";

const visualLayerZIndexes: Record<VisualLayerType, number> = {
  lag: 430,
  tunnel: 420,
  chat: 410,
  "video-corner": 400,
  "big-cursor": 390,
  "killer-cursor": 390,
  flashlight: 390,
  "sleeping-business": 380,
};

export function OverlayApp() {
  const config = useRuntimeStore((state) => state.config);
  const setConfig = useRuntimeStore((state) => state.setConfig);
  const stopAllModifiers = useRuntimeStore((state) => state.stopAllModifiers);
  const markKillerKilled = useRuntimeStore((state) => state.markKillerKilled);
  const expireModifier = useRuntimeStore((state) => state.expireModifier);
  const activeModifiers = useRuntimeStore((state) => state.activeModifiers);
  const layerOrder = config.overlay.visualLayerOrder;
  const zIndexFor = (type: VisualLayerType) => {
    const index = layerOrder.indexOf(type);
    return index >= 0 ? 430 - index * 10 : visualLayerZIndexes[type];
  };

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

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      useRuntimeStore
        .getState()
        .activeModifiers.filter((instance) => instance.endsAt <= now)
        .forEach((instance) => expireModifier(instance.instanceId));
    }, 500);

    return () => window.clearInterval(timer);
  }, [expireModifier]);

  return (
    <main className="overlay-root">
      <RollLayer />
      {activeModifiers.map((instance) => {
        const modifier = findModifier(config.modifiers, instance.modifierId);
        if (!modifier) return null;
        if (modifier.type === "tunnel") return <TunnelLayer key={instance.instanceId} zIndex={zIndexFor("tunnel")} />;
        if (modifier.type === "lag") return <LagLayer key={instance.instanceId} zIndex={zIndexFor("lag")} />;
        if (modifier.type === "chat") return <ChatLayer key={instance.instanceId} zIndex={zIndexFor("chat")} />;
        if (modifier.type === "flashlight") return <FlashlightLayer key={instance.instanceId} zIndex={zIndexFor("flashlight")} />;
        if (modifier.type === "sleeping-business") {
          return <SleepingBusinessLayer key={instance.instanceId} modifier={modifier} zIndex={zIndexFor("sleeping-business")} />;
        }
        if (modifier.type === "big-cursor") return <BigCursorLayer key={instance.instanceId} instance={instance} zIndex={zIndexFor("big-cursor")} />;
        if (modifier.type === "killer-cursor") {
          return (
            <KillerCursorLayer
              key={instance.instanceId}
              zIndex={zIndexFor("killer-cursor")}
              killed={instance.state === "killer-killed"}
              onKilled={() => markKillerKilled(instance.instanceId)}
            />
          );
        }
        if (modifier.type === "video-corner") {
          return <VideoCornerLayer key={instance.instanceId} modifier={modifier} instance={instance} zIndex={zIndexFor("video-corner")} />;
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
