import { useEffect, useRef, useState } from "react";
import { useCursorPosition } from "./useCursorPosition";

interface Point {
  x: number;
  y: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function KillerCursorLayer({
  zIndex,
  killed,
  onKilled,
}: {
  zIndex?: number;
  killed: boolean;
  onKilled: () => void;
}) {
  const cursor = useCursorPosition();
  const cursorRef = useRef(cursor);
  const [target, setTarget] = useState<Point>(() => ({
    x: typeof window === "undefined" ? 0 : window.innerWidth * 0.12,
    y: typeof window === "undefined" ? 0 : window.innerHeight * 0.18,
  }));
  const killedRef = useRef(killed);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    killedRef.current = killed;
  }, [killed]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();

    function tick(now: number) {
      if (killedRef.current) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      const deltaSeconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      setTarget((current) => {
        const chaseSpeed = 170;
        const cursorNow = cursorRef.current;
        const dx = cursorNow.x - current.x;
        const dy = cursorNow.y - current.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const step = Math.min(length, chaseSpeed * deltaSeconds);
        const next = {
          x: current.x + (dx / length) * step,
          y: current.y + (dy / length) * step,
        };
        if (distance(next, cursorNow) < 34) {
          killedRef.current = true;
          onKilled();
          return {
            x: Math.max(40, window.innerWidth - 90),
            y: Math.max(40, window.innerHeight - 90),
          };
        }
        return next;
      });
      frame = window.requestAnimationFrame(tick);
    }

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [onKilled]);

  return (
    <>
      {!killed && <div className="modifier-killer-reticle" style={{ left: target.x, top: target.y, zIndex }} />}
      {killed && <div className="modifier-killer-blackout" style={{ zIndex: (zIndex ?? 0) + 1 }} />}
    </>
  );
}
