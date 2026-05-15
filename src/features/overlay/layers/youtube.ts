export function createYoutubeEmbedUrl(videoId: string, autoplay: boolean, volume?: number): string {
  const params = new URLSearchParams({
    autoplay: autoplay ? "1" : "0",
    controls: "0",
    enablejsapi: "1",
    rel: "0",
    playsinline: "1",
    loop: "1",
    playlist: videoId,
  });
  if (typeof volume === "number") params.set("volume", String(Math.max(0, Math.min(100, volume))));
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}
