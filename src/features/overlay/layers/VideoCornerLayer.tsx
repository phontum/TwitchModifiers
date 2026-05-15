import { useEffect, useMemo } from "react";
import type { ModifierDefinition } from "../../../shared/types";
import { createYoutubeEmbedUrl } from "./youtube";
import { YoutubeIframe } from "./YoutubeIframe";
import {
  acquireVideoSlot,
  pickVariantWithoutImmediateRepeat,
  releaseVariant,
  releaseVideoSlot,
} from "./variantPlaybackRegistry";

export function VideoCornerLayer({ modifier }: { modifier: ModifierDefinition }) {
  const variant = useMemo(() => pickVariantWithoutImmediateRepeat(modifier), [modifier]);
  const { slotIndex, style } = useMemo(() => acquireVideoSlot(), []);

  useEffect(() => {
    return () => {
      releaseVariant(modifier.id, variant);
      releaseVideoSlot(slotIndex);
    };
  }, [modifier.id, slotIndex, variant]);

  if (!variant?.videoId) return null;

  return (
    <div className="modifier-corner-video" style={style}>
      <YoutubeIframe
        className="modifier-corner-video__iframe"
        src={createYoutubeEmbedUrl(variant.videoId, true, modifier.volume ?? 15)}
        volume={modifier.volume ?? 15}
        allowFullScreen
      />
    </div>
  );
}
