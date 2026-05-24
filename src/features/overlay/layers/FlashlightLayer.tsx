import type { CSSProperties } from "react";
import { useCursorPosition } from "./useCursorPosition";

export function FlashlightLayer({ zIndex }: { zIndex?: number }) {
  const cursor = useCursorPosition();

  return (
    <div
      className="modifier-flashlight-layer"
      style={
        {
          zIndex,
          "--cursor-x": `${cursor.x}px`,
          "--cursor-y": `${cursor.y}px`,
        } as CSSProperties
      }
    />
  );
}
