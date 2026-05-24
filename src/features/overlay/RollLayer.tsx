import { useEffect, useMemo, useRef, useState } from "react";
import type { ModifierDefinition, TriggerEvent } from "../../shared/types";
import { makeId } from "../../shared/random";
import { safeEmit, safeInvoke, safeListen } from "../runtime/tauri";
import { useRuntimeStore } from "../runtime/runtimeStore";
import { buildRoll, formatDuration, getAvailableModifiers, ROLL_DURATION_MS, ROLL_ITEM_WIDTH } from "../runtime/rollEngine";
import { acquireVideoSlot, pickInactiveVariant, variantKey } from "./layers/variantPlaybackRegistry";

interface ActiveRoll {
  sequence: ModifierDefinition[];
  targetIndex: number;
  winner: ModifierDefinition;
  durationMultiplier: number;
  complete: boolean;
}

export function RollLayer() {
  const config = useRuntimeStore((state) => state.config);
  const activeModifiers = useRuntimeStore((state) => state.activeModifiers);
  const isRolling = useRuntimeStore((state) => state.isRolling);
  const setRolling = useRuntimeStore((state) => state.setRolling);
  const activateModifier = useRuntimeStore((state) => state.activateModifier);
  const boostActiveModifier = useRuntimeStore((state) => state.boostActiveModifier);
  const expireModifier = useRuntimeStore((state) => state.expireModifier);
  const appendLog = useRuntimeStore((state) => state.appendLog);
  const [roll, setRoll] = useState<ActiveRoll | null>(null);
  const [trackOffset, setTrackOffset] = useState(0);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rollingRef = useRef(isRolling);
  const configRef = useRef(config);
  const activeModifiersRef = useRef(activeModifiers);
  const timersRef = useRef<number[]>([]);
  const handledTriggerIdsRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<TriggerEvent[]>([]);

  useEffect(() => {
    rollingRef.current = isRolling;
  }, [isRolling]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    activeModifiersRef.current = activeModifiers;
  }, [activeModifiers]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    let mounted = true;

    function clearTimers() {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
    }

    function runNextRoll() {
      if (rollingRef.current) return;
      const trigger = queueRef.current.shift();
      if (!trigger) return;

      const available = getAvailableModifiers(configRef.current.modifiers, activeModifiersRef.current);
      if (available.length === 0) {
        appendLog("warn", "No available modifiers to roll");
        void safeEmit("log:append", { level: "warn", message: "No available modifiers to roll" });
        window.setTimeout(runNextRoll, 0);
        return;
      }

      const result = buildRoll(available);
      const durationMultiplier = Math.max(1, Math.min(6, Math.floor(trigger.durationMultiplier ?? 1)));
      const frameCenter = Math.min(window.innerWidth * 0.58, 820) / 2;
      const startIndex = 8;
      const startTravel = startIndex * ROLL_ITEM_WIDTH - frameCenter + ROLL_ITEM_WIDTH / 2;
      const endTravel = result.targetIndex * ROLL_ITEM_WIDTH - frameCenter + ROLL_ITEM_WIDTH / 2;

      appendLog("info", `Roll requested: ${trigger.source}`);
      rollingRef.current = true;
      setRolling(true);
      setRoll({ ...result, durationMultiplier, complete: false });
      setTrackOffset(-startTravel);
      void safeEmit("roll:started", trigger);

      timersRef.current.push(
        window.setTimeout(() => setTrackOffset(-endTravel), 90),
        window.setTimeout(() => {
          setRoll((current) => (current ? { ...current, complete: true } : current));
          void safeEmit("roll:finished", result.winner);
        }, ROLL_DURATION_MS + 300),
        window.setTimeout(() => {
          setRoll(null);
          rollingRef.current = false;
          setRolling(false);
          const instance = activateWinner(result.winner, durationMultiplier);
          if (instance) {
            appendLog("info", `Activated modifier: ${result.winner.title}${durationMultiplier > 1 ? ` x${durationMultiplier}` : ""}`);
            void safeEmit("modifier:activate", { instance, modifier: result.winner });
            timersRef.current.push(
              window.setTimeout(() => {
                const latest = activeModifiersRef.current.find((item) => item.instanceId === instance.instanceId);
                if (latest && Date.now() < latest.endsAt) {
                  timersRef.current.push(
                    window.setTimeout(() => expireModifier(latest.instanceId), Math.max(0, latest.endsAt - Date.now())),
                  );
                  return;
                }
                expireModifier(instance.instanceId);
                void safeEmit("modifier:expired", instance);
              }, Math.max(0, instance.endsAt - Date.now())),
            );
          }
          window.setTimeout(runNextRoll, 250);
        }, ROLL_DURATION_MS + 2700),
      );
    }

    function activateWinner(modifier: ModifierDefinition, durationMultiplier: number) {
      if (modifier.type !== "video-corner") {
        const instance = activateModifier(modifier, durationMultiplier);
        activeModifiersRef.current = [...activeModifiersRef.current, instance];
        return instance;
      }

      const variant = pickInactiveVariant(modifier);
      if (!variant?.videoId) {
        const active = activeModifiersRef.current.filter((instance) => instance.modifierId === modifier.id && instance.variantKey);
        if (active.length === 0) return undefined;
        const target = active[Math.floor(Math.random() * active.length)];
        const boosted = boostActiveModifier(target.instanceId, modifier, durationMultiplier);
        if (boosted) {
          activeModifiersRef.current = activeModifiersRef.current.map((instance) => (instance.instanceId === boosted.instanceId ? boosted : instance));
        }
        return boosted;
      }

      const slot = acquireVideoSlot();
      const instance = {
        ...activateModifier(modifier, durationMultiplier),
        variantKey: variantKey(variant),
        variantVideoId: variant.videoId,
        videoSlotIndex: slot.slotIndex,
        repeatCount: 1,
      };
      activeModifiersRef.current = [...activeModifiersRef.current.filter((item) => item.instanceId !== instance.instanceId), instance];
      useRuntimeStore.setState((state) => ({
        activeModifiers: state.activeModifiers.map((item) => (item.instanceId === instance.instanceId ? instance : item)),
      }));
      return instance;
    }

    function enqueueTrigger(trigger: TriggerEvent) {
      if (handledTriggerIdsRef.current.has(trigger.id)) return;
      handledTriggerIdsRef.current.add(trigger.id);
      if (handledTriggerIdsRef.current.size > 100) {
        handledTriggerIdsRef.current = new Set(Array.from(handledTriggerIdsRef.current).slice(-50));
      }

      void safeInvoke("ack_roll_queued", { triggerId: trigger.id });
      if (rollingRef.current) {
        queueRef.current.push(trigger);
        appendLog("info", `Roll queued: ${trigger.source} (${queueRef.current.length} waiting)`);
        return;
      }

      queueRef.current.push(trigger);
      runNextRoll();
    }

    safeInvoke<TriggerEvent[]>("get_pending_rolls").then((pendingRolls) => {
      pendingRolls?.forEach(enqueueTrigger);
    });

    safeListen<TriggerEvent>("roll:requested", (trigger) => {
      enqueueTrigger(trigger);
    }).then((unsub) => {
      if (mounted) unsubs.push(unsub);
      else unsub();
    });

    safeListen("modifier:stop-all", () => {
      clearTimers();
      queueRef.current = [];
      setRoll(null);
      rollingRef.current = false;
      setRolling(false);
    }).then((unsub) => {
      if (mounted) unsubs.push(unsub);
      else unsub();
    });

    return () => {
      mounted = false;
      clearTimers();
      queueRef.current = [];
      unsubs.forEach((unsub) => unsub());
    };
  }, [activateModifier, appendLog, boostActiveModifier, expireModifier, setRolling]);

  const style = useMemo(
    () => ({
      transform: `translateX(${trackOffset}px)`,
      transitionDuration: roll ? `${ROLL_DURATION_MS}ms` : "0ms",
    }),
    [roll, trackOffset],
  );

  if (!roll) return null;

  return (
    <section className={`modifier-roll ${roll.complete ? "is-complete" : ""}`}>
      <div className="modifier-roll__frame" ref={frameRef}>
        <div className="modifier-roll__marker" />
        <div className="modifier-roll__track" style={style}>
          {roll.sequence.map((modifier, index) => (
            <article className="modifier-roll__item" style={{ "--modifier-color": modifier.color } as React.CSSProperties} key={`${modifier.id}-${index}-${makeId("roll")}`}>
              <span className="modifier-roll__rarity">{modifier.rarity}</span>
              <strong>{modifier.title}</strong>
              <small>{formatDuration(modifier.durationSeconds)}</small>
            </article>
          ))}
        </div>
      </div>
      <div className="modifier-roll__result">
        <strong>{roll.complete ? roll.winner.title : "..."}</strong>
        <span>{roll.complete ? `${formatDuration(roll.winner.durationSeconds * roll.durationMultiplier)} - ${roll.winner.description}` : ""}</span>
      </div>
    </section>
  );
}
