import { useEffect, useState } from "react";
import { safeListen } from "../../runtime/tauri";

interface MouseInputPayload {
  kind: string;
  x?: number | null;
  y?: number | null;
}

export interface CursorPosition {
  x: number;
  y: number;
}

export function useCursorPosition(): CursorPosition {
  const [position, setPosition] = useState<CursorPosition>(() => ({
    x: typeof window === "undefined" ? 0 : window.innerWidth / 2,
    y: typeof window === "undefined" ? 0 : window.innerHeight / 2,
  }));

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    const onLocalMove = (event: MouseEvent) => {
      setPosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener("mousemove", onLocalMove);
    safeListen<MouseInputPayload>("input:mouse", (payload) => {
      if (!active || payload.kind !== "move" || typeof payload.x !== "number" || typeof payload.y !== "number") return;
      setPosition({ x: payload.x, y: payload.y });
    }).then((nextUnsubscribe) => {
      unsubscribe = nextUnsubscribe;
      if (!active) unsubscribe();
    });

    return () => {
      active = false;
      unsubscribe?.();
      window.removeEventListener("mousemove", onLocalMove);
    };
  }, []);

  return position;
}
