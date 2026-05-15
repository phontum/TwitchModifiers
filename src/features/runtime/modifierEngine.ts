import type { ModifierDefinition } from "../../shared/types";

export function findModifier(modifiers: ModifierDefinition[], modifierId: string): ModifierDefinition | undefined {
  return modifiers.find((modifier) => modifier.id === modifierId);
}
