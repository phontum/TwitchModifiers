import { useEffect, useMemo } from "react";
import type { ActiveModifierInstance, ModifierDefinition } from "../../../shared/types";
import { createYoutubeEmbedUrl } from "./youtube";
import { YoutubeIframe } from "./YoutubeIframe";
import { getVideoSlotStyle, releaseVariantKey, releaseVideoSlot } from "./variantPlaybackRegistry";

export function VideoCornerLayer({
  modifier,
  instance,
  zIndex,
}: {
  modifier: ModifierDefinition;
  instance: ActiveModifierInstance;
  zIndex?: number;
}) {
  const slotIndex = instance.videoSlotIndex ?? 0;
  const scale = Math.max(1, Math.min(6, instance.repeatCount ?? 1));
  const style = useMemo(() => getVideoSlotStyle(slotIndex), [slotIndex]);

  useEffect(() => {
    return () => {
      releaseVariantKey(modifier.id, instance.variantKey);
      releaseVideoSlot(slotIndex);
    };
  }, [instance.variantKey, modifier.id, slotIndex]);

  if (!instance.variantVideoId) return null;

  return (
    <div className="modifier-corner-video" style={{ ...style, zIndex, "--video-scale": scale } as React.CSSProperties}>
      <YoutubeIframe
        className="modifier-corner-video__iframe"
        src={createYoutubeEmbedUrl(instance.variantVideoId, true, modifier.volume ?? 15)}
        volume={modifier.volume ?? 15}
        allowFullScreen
      />
    </div>
  );
}
