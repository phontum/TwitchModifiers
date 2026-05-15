import { create } from "zustand";
import { defaultConfig } from "../../shared/defaultModifiers";
import type { ActiveModifierInstance, AppConfig, AppLog, ModifierDefinition } from "../../shared/types";
import { makeId } from "../../shared/random";

interface RuntimeStore {
  config: AppConfig;
  isPlaying: boolean;
  isRolling: boolean;
  activeModifiers: ActiveModifierInstance[];
  logs: AppLog[];
  setConfig: (config: AppConfig) => void;
  setPlaying: (isPlaying: boolean) => void;
  setRolling: (isRolling: boolean) => void;
  appendLog: (level: AppLog["level"], message: string) => void;
  activateModifier: (modifier: ModifierDefinition, durationMultiplier?: number) => ActiveModifierInstance;
  expireModifier: (instanceId: string) => void;
  stopAllModifiers: () => void;
}

export const useRuntimeStore = create<RuntimeStore>((set, get) => ({
  config: defaultConfig,
  isPlaying: false,
  isRolling: false,
  activeModifiers: [],
  logs: [],
  setConfig: (config) => set({ config }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setRolling: (isRolling) => set({ isRolling }),
  appendLog: (level, message) =>
    set((state) => ({
      logs: [
        { id: makeId("log"), level, message, createdAt: new Date().toISOString() },
        ...state.logs,
      ].slice(0, 50),
    })),
  activateModifier: (modifier, durationMultiplier = 1) => {
    const startedAt = Date.now();
    const multiplier = Math.max(1, Math.min(6, Math.floor(durationMultiplier)));
    const instance: ActiveModifierInstance = {
      instanceId: makeId("modifier"),
      modifierId: modifier.id,
      startedAt,
      endsAt: startedAt + modifier.durationSeconds * multiplier * 1000,
    };
    set({ activeModifiers: [...get().activeModifiers, instance] });
    return instance;
  },
  expireModifier: (instanceId) =>
    set((state) => ({
      activeModifiers: state.activeModifiers.filter((instance) => instance.instanceId !== instanceId),
    })),
  stopAllModifiers: () => set({ activeModifiers: [], isRolling: false }),
}));
