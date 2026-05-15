import { OverlayApp } from "./features/overlay/OverlayApp";
import { SettingsPage } from "./features/settings/SettingsPage";

export function App() {
  const params = new URLSearchParams(window.location.search);
  const route = params.get("mode") || window.location.hash.replace("#/", "") || "main";
  return route === "overlay" ? <OverlayApp /> : <SettingsPage />;
}
