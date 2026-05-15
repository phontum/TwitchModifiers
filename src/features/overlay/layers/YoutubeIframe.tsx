import { useEffect, useRef } from "react";

interface YoutubeIframeProps {
  className: string;
  src: string;
  volume: number;
  allowFullScreen?: boolean;
}

export function YoutubeIframe({ className, src, volume, allowFullScreen }: YoutubeIframeProps) {
  const ref = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const safeVolume = Math.max(0, Math.min(100, volume));
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const contentWindow = ref.current?.contentWindow;
      if (!contentWindow) return;
      contentWindow.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [safeVolume] }), "*");
      contentWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "*");
      if (attempts >= 20) window.clearInterval(timer);
    }, 350);

    return () => window.clearInterval(timer);
  }, [volume, src]);

  return (
    <iframe
      ref={ref}
      className={className}
      src={src}
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen={allowFullScreen}
    />
  );
}
