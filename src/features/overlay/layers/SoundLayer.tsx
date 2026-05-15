import { useEffect, useMemo, useRef } from "react";
import type { ModifierDefinition } from "../../../shared/types";
import { createYoutubeEmbedUrl } from "./youtube";
import { YoutubeIframe } from "./YoutubeIframe";
import { pickVariantWithoutImmediateRepeat, releaseVariant } from "./variantPlaybackRegistry";

export function SoundLayer({ modifier }: { modifier: ModifierDefinition }) {
  const variant = useMemo(() => pickVariantWithoutImmediateRepeat(modifier), [modifier]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => releaseVariant(modifier.id, variant);
  }, [modifier.id, variant]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = (modifier.volume ?? 35) / 100;
  }, [modifier.volume]);

  if (variant?.audioUrl) {
    return <audio ref={audioRef} className="modifier-background-audio" src={variant.audioUrl} autoPlay loop />;
  }

  if (!variant?.videoId) return null;

  return (
    <YoutubeIframe
      className="modifier-background-youtube"
      src={createYoutubeEmbedUrl(variant.videoId, true, modifier.volume ?? 35)}
      volume={modifier.volume ?? 35}
    />
  );
}
