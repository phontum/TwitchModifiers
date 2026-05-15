import { emit, listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export const isTauri = "__TAURI_INTERNALS__" in window;

export async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri) return null;
  return invoke<T>(command, args);
}

export async function safeEmit<T>(event: string, payload?: T): Promise<void> {
  if (!isTauri) {
    window.dispatchEvent(new CustomEvent(event, { detail: payload }));
    return;
  }
  await emit(event, payload);
}

export async function safeListen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!isTauri) {
    const listener = (nativeEvent: globalThis.Event) => handler((nativeEvent as CustomEvent<T>).detail);
    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  }

  return listen<T>(event, (tauriEvent: TauriEvent<T>) => handler(tauriEvent.payload));
}
