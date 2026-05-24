import { useEffect, useState } from "react";
import { useRuntimeStore } from "../runtime/runtimeStore";
import { findModifier } from "../runtime/modifierEngine";
import { formatClock } from "../runtime/rollEngine";

export function ActiveModifiersPanel() {
  const config = useRuntimeStore((state) => state.config);
  const activeModifiers = useRuntimeStore((state) => state.activeModifiers);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  if (activeModifiers.length === 0) return null;

  const densityClass =
    activeModifiers.length >= 7 ? "modifier-active-stack--dense" : activeModifiers.length >= 4 ? "modifier-active-stack--compact" : "";

  return (
    <section className={`modifier-active-stack ${densityClass}`}>
      {activeModifiers.map((instance) => {
        const modifier = findModifier(config.modifiers, instance.modifierId);
        if (!modifier) return null;
        return (
          <section className="modifier-active" style={{ "--modifier-color": modifier.color } as React.CSSProperties} key={instance.instanceId}>
            <strong>{instance.titleOverride || modifier.title}</strong>
            <span>{instance.descriptionOverride || modifier.description}</span>
            <b>{formatClock(instance.endsAt - now)}</b>
          </section>
        );
      })}
    </section>
  );
}
