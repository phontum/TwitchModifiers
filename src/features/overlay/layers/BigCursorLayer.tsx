import { useEffect } from "react";
import type { ActiveModifierInstance } from "../../../shared/types";
import { safeInvoke } from "../../runtime/tauri";

export function BigCursorLayer({ instance, zIndex: _zIndex }: { instance: ActiveModifierInstance; zIndex?: number }) {
  useEffect(() => {
    const durationMs = Math.max(250, instance.endsAt - Date.now());
    void safeInvoke("append_log", { level: "info", message: `Enabling system cursor modifier for ${durationMs}ms` });
    void safeInvoke("enable_system_cursor_modifier", {
      cursorThemeIdOrPath: "lime-square",
      durationMs,
    }).catch((error) => {
      void safeInvoke("append_log", { level: "warn", message: `Cursor modifier invoke failed: ${String(error)}` });
    });
    return () => {
      void safeInvoke("restore_system_cursors").catch((error) => {
        void safeInvoke("append_log", { level: "warn", message: `Cursor restore invoke failed: ${String(error)}` });
      });
    };
  }, [instance.endsAt]);

  return null;
}
