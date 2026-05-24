import type { ModifierDefinition } from "../../../shared/types";
import type { CSSProperties } from "react";
import { pickRandom } from "../../../shared/random";

type ModifierVariant = NonNullable<ModifierDefinition["variants"]>[number];

const activeVariantKeys = new Map<string, Set<string>>();
const usedVariantKeys = new Map<string, Set<string>>();
const activeVideoSlots = new Set<number>();

export function variantKey(variant: ModifierVariant): string {
  return variant.videoUrl || variant.videoId || variant.audioUrl || variant.title || JSON.stringify(variant);
}

function getSet(registry: Map<string, Set<string>>, modifierId: string): Set<string> {
  const existing = registry.get(modifierId);
  if (existing) return existing;
  const next = new Set<string>();
  registry.set(modifierId, next);
  return next;
}

export function pickVariantWithoutImmediateRepeat(modifier: ModifierDefinition): ModifierVariant | undefined {
  const variants = modifier.variants || [];
  if (variants.length === 0) return undefined;

  const active = getSet(activeVariantKeys, modifier.id);
  const used = getSet(usedVariantKeys, modifier.id);
  let available = variants.filter((variant) => !active.has(variantKey(variant)) && !used.has(variantKey(variant)));

  if (available.length === 0) {
    used.clear();
    active.forEach((key) => used.add(key));
    available = variants.filter((variant) => !active.has(variantKey(variant)));
  }

  if (available.length === 0) {
    available = variants;
  }

  const variant = pickRandom(available);
  const key = variantKey(variant);
  active.add(key);
  used.add(key);
  return variant;
}

export function pickInactiveVariant(modifier: ModifierDefinition): ModifierVariant | undefined {
  const variants = modifier.variants || [];
  if (variants.length === 0) return undefined;

  const active = getSet(activeVariantKeys, modifier.id);
  const used = getSet(usedVariantKeys, modifier.id);
  let available = variants.filter((variant) => !active.has(variantKey(variant)) && !used.has(variantKey(variant)));

  if (available.length === 0) {
    used.clear();
    active.forEach((key) => used.add(key));
    available = variants.filter((variant) => !active.has(variantKey(variant)));
  }

  if (available.length === 0) return undefined;

  const variant = pickRandom(available);
  const key = variantKey(variant);
  active.add(key);
  used.add(key);
  return variant;
}

export function reserveVariant(modifierId: string, variant: ModifierVariant | undefined): void {
  if (!variant) return;
  const key = variantKey(variant);
  getSet(activeVariantKeys, modifierId).add(key);
  getSet(usedVariantKeys, modifierId).add(key);
}

export function releaseVariant(modifierId: string, variant: ModifierVariant | undefined): void {
  if (!variant) return;
  activeVariantKeys.get(modifierId)?.delete(variantKey(variant));
}

export function releaseVariantKey(modifierId: string, key: string | undefined): void {
  if (!key) return;
  activeVariantKeys.get(modifierId)?.delete(key);
}

interface VideoSlot {
  left: number;
  top: number;
}

function buildVideoSlots(): VideoSlot[] {
  const width = 360;
  const height = 203;
  const gap = 14;
  const margin = 22;
  const topSafe = 92;
  const viewportWidth = Math.max(width + margin * 2, window.innerWidth);
  const viewportHeight = Math.max(height + topSafe + margin, window.innerHeight);
  const cols = Math.max(1, Math.floor((viewportWidth - margin * 2 + gap) / (width + gap)));
  const rows = Math.max(1, Math.floor((viewportHeight - topSafe - margin + gap) / (height + gap)));
  const all: VideoSlot[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      all.push({
        left: margin + col * (width + gap),
        top: topSafe + row * (height + gap),
      });
    }
  }

  const cornerIndexes = [
    all.findIndex((slot) => slot.left === margin + (cols - 1) * (width + gap) && slot.top === topSafe + (rows - 1) * (height + gap)),
    all.findIndex((slot) => slot.left === margin && slot.top === topSafe + (rows - 1) * (height + gap)),
    all.findIndex((slot) => slot.left === margin + (cols - 1) * (width + gap) && slot.top === topSafe),
    all.findIndex((slot) => slot.left === margin && slot.top === topSafe),
  ].filter((index, offset, indexes) => index >= 0 && indexes.indexOf(index) === offset);

  const ordered = cornerIndexes.map((index) => all[index]);
  all.forEach((slot, index) => {
    if (!cornerIndexes.includes(index)) ordered.push(slot);
  });
  return ordered;
}

export function getVideoSlotCount(): number {
  return buildVideoSlots().length;
}

export function hasFreeVideoSlot(): boolean {
  return activeVideoSlots.size < getVideoSlotCount();
}

export function acquireVideoSlot(): { slotIndex: number; style: CSSProperties } {
  const slots = buildVideoSlots();
  let slotIndex = slots.findIndex((_, index) => !activeVideoSlots.has(index));
  if (slotIndex < 0) slotIndex = 0;
  activeVideoSlots.add(slotIndex);
  return { slotIndex, style: slots[slotIndex] };
}

export function getVideoSlotStyle(slotIndex: number | undefined): CSSProperties {
  const slots = buildVideoSlots();
  return slots[Math.max(0, Math.min(slotIndex ?? 0, slots.length - 1))] || { left: 22, top: 92 };
}

export function releaseVideoSlot(slotIndex: number): void {
  activeVideoSlots.delete(slotIndex);
}
