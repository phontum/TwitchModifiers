import { useEffect, useState } from "react";
import { makeId, pickRandom, randomInt } from "../../../shared/random";
import type { ChatMessageEvent } from "../../../shared/types";
import { isTauri, safeListen } from "../../runtime/tauri";

interface ChatBubble {
  id: string;
  text: string;
  left: number;
  top: number;
}

const fakeMessages = [
  "what is happening",
  "modifier!",
  "streamer hold on",
  "press forward",
  "that was close",
  "chat decides",
];

export function ChatLayer() {
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);

  useEffect(() => {
    const addBubble = (text: string, id = makeId("chat")) => {
      const bubble: ChatBubble = {
        id,
        text,
        left: randomInt(2, 72),
        top: randomInt(10, 82),
      };

      setBubbles((current) => [...current.slice(-24), bubble]);
      window.setTimeout(() => {
        setBubbles((current) => current.filter((item) => item.id !== bubble.id));
      }, 12000);
    };

    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    safeListen<ChatMessageEvent>("chat:message", (event) => {
      if (disposed || !event?.message) return;
      const author = event.viewerName?.trim() || "chat";
      addBubble(`${author}: ${event.message}`, event.id || makeId("chat"));
    }).then((nextUnsubscribe) => {
      unsubscribe = nextUnsubscribe;
    });

    if (isTauri) {
      return () => {
        disposed = true;
        unsubscribe?.();
      };
    }

    const timer = window.setInterval(() => {
      addBubble(pickRandom(fakeMessages));
    }, 1400);

    return () => {
      disposed = true;
      unsubscribe?.();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="modifier-chat-layer">
      {bubbles.map((bubble) => (
        <div
          className="modifier-chat-message"
          style={{ left: `${bubble.left}vw`, top: `${bubble.top}vh` }}
          key={bubble.id}
        >
          <span>{bubble.text}</span>
        </div>
      ))}
    </div>
  );
}
