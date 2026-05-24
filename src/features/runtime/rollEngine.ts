import type { ActiveModifierInstance, ModifierDefinition } from "../../shared/types";
import { getVideoSlotCount, hasFreeVideoSlot } from "../overlay/layers/variantPlaybackRegistry";

export const ROLL_DURATION_MS = 5600;
export const ROLL_ITEM_WIDTH = 200;

export interface RollResult {
  sequence: ModifierDefinition[];
  targetIndex: number;
  winner: ModifierDefinition;
}

export function getAvailableModifiers(
  modifiers: ModifierDefinition[],
  activeModifiers: ActiveModifierInstance[],
): ModifierDefinition[] {
  return modifiers.filter((modifier) => {
    if (!modifier.enabled) return false;
    if (modifier.type === "video-corner") {
      const activeVideoCount = activeModifiers.filter((active) => active.modifierId === modifier.id).length;
      const maxActive = Math.max(1, modifier.maxActiveVideos ?? 4);
      if (modifier.maxActiveVideosEnabled && activeVideoCount >= maxActive) return false;
      if (!modifier.maxActiveVideosEnabled && activeVideoCount >= getVideoSlotCount()) return false;
      if (activeVideoCount >= (modifier.variants?.length ?? 0) && !hasFreeVideoSlot()) return false;
    }
    if (modifier.allowRepeatWhileActive) return true;
    return !activeModifiers.some((active) => active.modifierId === modifier.id);
  });
}

export function buildRoll(availableModifiers: ModifierDefinition[]): RollResult {
  const sequence = Array.from({ length: 72 }, () => pickWeightedModifier(availableModifiers));
  const targetIndex = 48 + Math.floor(Math.random() * 8);
  return {
    sequence,
    targetIndex,
    winner: sequence[targetIndex],
  };
}

function pickWeightedModifier(modifiers: ModifierDefinition[]): ModifierDefinition {
  const totalWeight = modifiers.reduce((sum, modifier) => sum + getRollWeight(modifier), 0);
  if (totalWeight <= 0) return modifiers[Math.floor(Math.random() * modifiers.length)];

  let cursor = Math.random() * totalWeight;
  for (const modifier of modifiers) {
    cursor -= getRollWeight(modifier);
    if (cursor <= 0) return modifier;
  }

  return modifiers[modifiers.length - 1];
}

function getRollWeight(modifier: ModifierDefinition): number {
  return Math.max(0, modifier.rollWeight ?? 1);
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes >= 1) return `${minutes} мин`;
  return `${seconds} сек`;
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
