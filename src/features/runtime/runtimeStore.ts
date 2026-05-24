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
  boostActiveModifier: (instanceId: string, modifier: ModifierDefinition, durationMultiplier?: number) => ActiveModifierInstance | undefined;
  markKillerKilled: (instanceId: string) => ActiveModifierInstance | undefined;
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
  boostActiveModifier: (instanceId, modifier, durationMultiplier = 1) => {
    const current = get().activeModifiers.find((instance) => instance.instanceId === instanceId);
    if (!current) return undefined;
    const multiplier = Math.max(1, Math.min(6, Math.floor(durationMultiplier)));
    const repeatCount = Math.min(6, (current.repeatCount ?? 1) + 1);
    const maxEndsAt = current.startedAt + modifier.durationSeconds * 6 * 1000;
    const endsAt = Math.min(maxEndsAt, current.endsAt + modifier.durationSeconds * multiplier * 1000);
    const boosted = { ...current, repeatCount, endsAt };
    set((state) => ({
      activeModifiers: state.activeModifiers.map((instance) => (instance.instanceId === instanceId ? boosted : instance)),
    }));
    return boosted;
  },
  markKillerKilled: (instanceId) => {
    const current = get().activeModifiers.find((instance) => instance.instanceId === instanceId);
    if (!current) return undefined;
    const now = Date.now();
    const killed = {
      ...current,
      startedAt: now,
      endsAt: now + 30000,
      state: "killer-killed" as const,
      titleOverride: "Киллер",
      descriptionOverride: "Вы были устранены киллером.",
    };
    set((state) => ({
      activeModifiers: state.activeModifiers.map((instance) => (instance.instanceId === instanceId ? killed : instance)),
    }));
    return killed;
  },
  expireModifier: (instanceId) =>
    set((state) => ({
      activeModifiers: state.activeModifiers.filter((instance) => instance.instanceId !== instanceId),
    })),
  stopAllModifiers: () => set({ activeModifiers: [], isRolling: false }),
}));
