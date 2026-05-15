import { useEffect, useState } from "react";
import { randomInt } from "../../../shared/random";

export function LagLayer() {
  const [freezing, setFreezing] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer = 0;

    function scheduleFreeze() {
      if (stopped) return;
      timer = window.setTimeout(() => {
        if (stopped) return;
        setFreezing(true);
        window.setTimeout(() => {
          setFreezing(false);
          scheduleFreeze();
        }, randomInt(500, 1000));
      }, randomInt(2000, 5000));
    }

    scheduleFreeze();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  return <div className={`modifier-lag-layer ${freezing ? "is-freezing" : ""}`} />;
}
