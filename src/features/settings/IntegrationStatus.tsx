import { Circle } from "lucide-react";

export function IntegrationStatus({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className="status-pill">
      <Circle size={10} fill={connected ? "#16a34a" : "#dc2626"} color={connected ? "#16a34a" : "#dc2626"} />
      <span>{label}: {connected ? "connected" : "disconnected"}</span>
    </div>
  );
}
