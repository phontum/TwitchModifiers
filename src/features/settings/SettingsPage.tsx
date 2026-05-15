import { useEffect, useState } from "react";
import { Moon, Pause, Play, PlugZap, Plus, Save, ShieldAlert, Sun, TestTube2, Trash2, Volume2 } from "lucide-react";
import type { AppConfig, AppLog, DisplayMonitor, KeyboardInputSfxSettings, ModifierDefinition, MouseInputSfxSettings } from "../../shared/types";
import { defaultConfig, normalizeConfig } from "../../shared/defaultModifiers";
import { makeId } from "../../shared/random";
import { isTauri, safeEmit, safeInvoke, safeListen } from "../runtime/tauri";
import { useRuntimeStore } from "../runtime/runtimeStore";
import { IntegrationStatus } from "./IntegrationStatus";
import { LogsPanel } from "./LogsPanel";
import { playInputSfx } from "../overlay/inputSfxAudio";

const mouseSoundRows: Array<{
  key: keyof MouseInputSfxSettings["sounds"];
  label: string;
  defaults: Parameters<typeof playInputSfx>[0]["defaultSounds"];
}> = [
  { key: "leftClick", label: "ЛКМ", defaults: ["default:mouse-left"] },
  { key: "rightClick", label: "ПКМ", defaults: ["default:mouse-right"] },
  { key: "middleClick", label: "Колесо", defaults: ["default:mouse-middle"] },
  { key: "wheelUp", label: "Скролл вверх", defaults: ["default:wheel-up"] },
  { key: "wheelDown", label: "Скролл вниз", defaults: ["default:wheel-down"] },
];

function isYoutubeUrl(value: string): boolean {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(value.trim());
}

function extractYoutubeVideoId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.hostname.includes("youtu.be")) return url.pathname.replace("/", "") || undefined;
    return url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop();
  } catch {
    return undefined;
  }
}

function fileLabel(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [monitors, setMonitors] = useState<DisplayMonitor[]>([]);
  const isPlaying = useRuntimeStore((state) => state.isPlaying);
  const setPlaying = useRuntimeStore((state) => state.setPlaying);
  const logs = useRuntimeStore((state) => state.logs);
  const appendLog = useRuntimeStore((state) => state.appendLog);

  useEffect(() => {
    safeInvoke<AppConfig>("load_config").then((loaded) => {
      const nextConfig = normalizeConfig(loaded || defaultConfig);
      setConfig(normalizeConfig(nextConfig));
      void safeEmit("app:config-loaded", nextConfig);
    });
    safeInvoke<DisplayMonitor[]>("list_monitors").then((loadedMonitors) => {
      if (loadedMonitors?.length) setMonitors(loadedMonitors);
    });

    const unsubs: Array<() => void> = [];
    safeListen<AppConfig>("app:config-loaded", (nextConfig) => {
      setConfig(nextConfig);
    }).then((unsub) => unsubs.push(unsub));
    safeListen<AppLog>("log:append", (log) => appendLog(log.level, log.message)).then((unsub) => unsubs.push(unsub));
    safeListen("runtime:started", () => setPlaying(true)).then((unsub) => unsubs.push(unsub));
    safeListen("runtime:stopped", () => setPlaying(false)).then((unsub) => unsubs.push(unsub));
    return () => unsubs.forEach((unsub) => unsub());
  }, [appendLog, setPlaying]);

  useEffect(() => {
    document.documentElement.dataset.theme = config.theme;
  }, [config.theme]);

  async function saveConfig(nextConfig = config) {
    const normalized = normalizeConfig(nextConfig);
    setConfig(normalized);
    await safeInvoke("save_config", { config: normalized });
    await safeEmit("app:config-loaded", normalized);
    appendLog("info", "Настройки сохранены");
  }

  function updateModifier(modifierId: string, patch: Partial<ModifierDefinition>) {
    setConfig({
      ...config,
      modifiers: config.modifiers.map((modifier) => (modifier.id === modifierId ? { ...modifier, ...patch } : modifier)),
    });
  }

  async function connectTwitch() {
    if (!isTauri) {
      appendLog("warn", "Twitch OAuth работает только в desktop Tauri app, не в браузере Vite");
      return;
    }
    try {
      await saveConfig();
      await safeInvoke("connect_twitch");
    } catch (error) {
      appendLog("error", `Twitch connect failed: ${String(error)}`);
    }
  }

  async function connectDonationAlerts() {
    if (!isTauri) {
      appendLog("warn", "DonationAlerts OAuth работает только в desktop Tauri app, не в браузере Vite");
      return;
    }
    try {
      await saveConfig();
      await safeInvoke("connect_donationalerts");
    } catch (error) {
      appendLog("error", `DonationAlerts connect failed: ${String(error)}`);
    }
  }

  async function startRuntime() {
    await saveConfig();
    await safeInvoke("start_runtime");
    if (!isTauri) await safeEmit("runtime:started");
    setPlaying(true);
    if (!isTauri) appendLog("info", "Runtime started");
  }

  async function stopRuntime() {
    await safeInvoke("stop_runtime");
    await safeEmit("modifier:stop-all");
    if (!isTauri) await safeEmit("runtime:stopped");
    setPlaying(false);
    if (!isTauri) appendLog("info", "Runtime stopped");
  }

  async function panicStop() {
    await safeInvoke("panic_stop");
    await safeEmit("modifier:stop-all");
    appendLog("warn", "Panic Stop выполнен");
  }

  async function testRoll() {
    await safeInvoke("test_roll");
    if (!isTauri) {
      await safeEmit("roll:requested", {
        id: makeId("test"),
        source: "test",
        createdAt: new Date().toISOString(),
        message: "Manual Test Roll",
      });
    }
  }

  async function addMouseSounds(action: keyof MouseInputSfxSettings["sounds"]) {
    const copied = await safeInvoke<string[]>("add_user_sound_files", { category: "mouse" });
    if (!copied?.length) return;
    await saveConfig({
      ...config,
      mouseInputSfx: {
        ...config.mouseInputSfx,
        sounds: {
          ...config.mouseInputSfx.sounds,
          [action]: [...config.mouseInputSfx.sounds[action], ...copied],
        },
      },
    });
  }

  async function removeMouseSound(action: keyof MouseInputSfxSettings["sounds"], path: string) {
    await safeInvoke("remove_user_sound_file", { path });
    await saveConfig({
      ...config,
      mouseInputSfx: {
        ...config.mouseInputSfx,
        sounds: {
          ...config.mouseInputSfx.sounds,
          [action]: config.mouseInputSfx.sounds[action].filter((item) => item !== path),
        },
      },
    });
  }

  async function addKeyboardSounds() {
    const copied = await safeInvoke<string[]>("add_user_sound_files", { category: "keyboard" });
    if (!copied?.length) return;
    await saveConfig({
      ...config,
      keyboardInputSfx: {
        ...config.keyboardInputSfx,
        sounds: [...config.keyboardInputSfx.sounds, ...copied],
      },
    });
  }

  async function removeKeyboardSound(path: string) {
    await safeInvoke("remove_user_sound_file", { path });
    await saveConfig({
      ...config,
      keyboardInputSfx: {
        ...config.keyboardInputSfx,
        sounds: config.keyboardInputSfx.sounds.filter((item) => item !== path),
      },
    });
  }

  return (
    <main className="settings-root">
      <header className="settings-header">
        <div>
          <h1>Twitch Modifiers MVP</h1>
          <p>Для игр используйте Borderless Windowed / Windowed Fullscreen. В exclusive fullscreen overlay может быть не виден.</p>
        </div>
        <div className="status-grid">
          <IntegrationStatus label="Twitch" connected={config.twitch.enabled && Boolean(config.twitch.accessToken)} />
          <IntegrationStatus label="DonationAlerts" connected={config.donationAlerts.enabled && Boolean(config.donationAlerts.accessToken)} />
          <IntegrationStatus label="Runtime" connected={isPlaying} />
        </div>
      </header>

      <section className="toolbar">
        <button
          onClick={() => saveConfig({ ...config, theme: config.theme === "dark" ? "light" : "dark" })}
          title="Переключить тему"
        >
          {config.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          {config.theme === "dark" ? "Light" : "Dark"}
        </button>
        <button onClick={connectTwitch}><PlugZap size={16} />Connect Twitch</button>
        <button onClick={connectDonationAlerts}><PlugZap size={16} />Connect DonationAlerts</button>
        <button className="primary" onClick={startRuntime}><Play size={16} />Start / Play</button>
        <button onClick={stopRuntime}><Pause size={16} />Stop</button>
        <button onClick={testRoll}><TestTube2 size={16} />Test Roll</button>
        <button className="danger" onClick={panicStop}><ShieldAlert size={16} />Panic Stop</button>
      </section>

      <section className="settings-grid">
        <section className="panel">
          <h2>Twitch settings</h2>
          <label>
            Client ID
            <input
              value={config.twitch.clientId}
              onChange={(event) => setConfig({ ...config, twitch: { ...config.twitch, clientId: event.target.value } })}
            />
          </label>
          <label>
            Reward id
            <input
              value={config.twitch.rewardId}
              onChange={(event) => setConfig({ ...config, twitch: { ...config.twitch, rewardId: event.target.value } })}
            />
          </label>
          <label>
            Reward title
            <input
              value={config.twitch.rewardTitle}
              onChange={(event) => setConfig({ ...config, twitch: { ...config.twitch, rewardTitle: event.target.value } })}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={config.twitch.subscriptionRollsEnabled}
              onChange={(event) =>
                setConfig({
                  ...config,
                  twitch: { ...config.twitch, subscriptionRollsEnabled: event.target.checked },
                })
              }
            />
            Roll on Twitch subscriptions
          </label>
          <label>
            Minimum paid sub tier
            <select
              value={config.twitch.subscriptionMinTier}
              onChange={(event) =>
                setConfig({
                  ...config,
                  twitch: { ...config.twitch, subscriptionMinTier: event.target.value as "1000" | "2000" | "3000" },
                })
              }
            >
              <option value="1000">Tier 1</option>
              <option value="2000">Tier 2</option>
              <option value="3000">Tier 3</option>
            </select>
          </label>
          <label>
            Minimum gift sub tier
            <select
              value={config.twitch.giftMinTier}
              onChange={(event) =>
                setConfig({
                  ...config,
                  twitch: { ...config.twitch, giftMinTier: event.target.value as "1000" | "2000" | "3000" },
                })
              }
            >
              <option value="1000">Tier 1</option>
              <option value="2000">Tier 2</option>
              <option value="3000">Tier 3</option>
            </select>
          </label>
          <label>
            Minimum gift count
            <input
              type="number"
              min="1"
              value={config.twitch.giftMinCount}
              onChange={(event) =>
                setConfig({
                  ...config,
                  twitch: { ...config.twitch, giftMinCount: Math.max(1, Number(event.target.value)) },
                })
              }
            />
          </label>
          <button onClick={() => saveConfig()}><Save size={16} />Save Twitch</button>
        </section>

        <section className="panel">
          <h2>DonationAlerts settings</h2>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={config.donationAlerts.useBuiltinClientId}
              onChange={(event) =>
                setConfig({
                  ...config,
                  donationAlerts: { ...config.donationAlerts, useBuiltinClientId: event.target.checked },
                })
              }
            />
            Use app DonationAlerts client
          </label>
          <label>
            Client ID override
            <input
              value={config.donationAlerts.clientId}
              onChange={(event) => setConfig({ ...config, donationAlerts: { ...config.donationAlerts, clientId: event.target.value } })}
            />
          </label>
          <label className="hidden-field">
            Client Secret
            <input
              type="password"
              value={config.donationAlerts.clientSecret}
              onChange={(event) => setConfig({ ...config, donationAlerts: { ...config.donationAlerts, clientSecret: event.target.value } })}
            />
          </label>
          <label>
            Redirect host
            <select
              value={config.donationAlerts.redirectHost}
              onChange={(event) =>
                setConfig({
                  ...config,
                  donationAlerts: {
                    ...config.donationAlerts,
                    redirectHost: event.target.value as "127.0.0.1" | "localhost",
                  },
                })
              }
            >
              <option value="127.0.0.1">127.0.0.1</option>
              <option value="localhost">localhost</option>
            </select>
          </label>
          <label>
            Minimum amount
            <input
              type="number"
              min="0"
              value={config.donationAlerts.minAmount}
              onChange={(event) => setConfig({ ...config, donationAlerts: { ...config.donationAlerts, minAmount: Number(event.target.value) } })}
            />
          </label>
          <button onClick={() => saveConfig()}><Save size={16} />Save DonationAlerts</button>
        </section>

        <section className="panel">
          <h2>Overlay</h2>
          <label>
            Monitor
            <select
              value={config.overlay.monitorIndex}
              onChange={(event) =>
                setConfig({
                  ...config,
                  overlay: { ...config.overlay, monitorIndex: Number(event.target.value) },
                })
              }
            >
              {(monitors.length ? monitors : [{ index: 0, name: null, x: 0, y: 0, width: 0, height: 0, scaleFactor: 1 }]).map((monitor) => (
                <option value={monitor.index} key={monitor.index}>
                  {monitor.name || `Monitor ${monitor.index + 1}`}
                  {monitor.width && monitor.height ? ` (${monitor.width}x${monitor.height})` : ""}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => saveConfig()}><Save size={16} />Save Overlay</button>
        </section>

        <section className="panel">
          <h2>MVP modifiers</h2>
          <div className="modifier-list">
            {config.modifiers.map((modifier) => (
              <div className="modifier-card" key={modifier.id}>
                <label className="modifier-toggle">
                  <input
                    type="checkbox"
                    checked={modifier.enabled}
                    onChange={(event) => updateModifier(modifier.id, { enabled: event.target.checked })}
                  />
                  <span style={{ borderColor: modifier.color }}>
                    <b>{modifier.title}</b>
                    <small>{modifier.description}</small>
                  </span>
                </label>
                {(modifier.type === "sound" || modifier.type === "video-corner") && (
                  <YoutubeLinksEditor
                    modifier={modifier}
                    onChange={(variants) => updateModifier(modifier.id, { variants })}
                    onVolumeChange={(volume) => updateModifier(modifier.id, { volume })}
                  />
                )}
                {modifier.type === "lag" && (
                  <DurationEditor
                    seconds={modifier.durationSeconds}
                    onChange={(durationSeconds) => updateModifier(modifier.id, { durationSeconds })}
                  />
                )}
              </div>
            ))}
          </div>
          <button onClick={() => saveConfig()}><Save size={16} />Save Modifiers</button>
        </section>

        <section className="panel">
          <h2>Input SFX</h2>
          <label>
            Mouse input volume
            <input
              type="range"
              min="0"
              max="100"
              value={config.mouseInputSfx.volume}
              onChange={(event) =>
                setConfig({
                  ...config,
                  mouseInputSfx: { ...config.mouseInputSfx, volume: Number(event.target.value) },
                })
              }
            />
          </label>
          <div className="sound-groups">
            {mouseSoundRows.map((row) => (
              <SoundListEditor
                key={row.key}
                title={row.label}
                sounds={config.mouseInputSfx.sounds[row.key]}
                onAdd={() => addMouseSounds(row.key)}
                onRemove={(path) => removeMouseSound(row.key, path)}
                onTest={() =>
                  playInputSfx({
                    userSounds: config.mouseInputSfx.sounds[row.key],
                    defaultSounds: row.defaults,
                    volume: config.mouseInputSfx.volume,
                  })
                }
              />
            ))}
          </div>

          <label>
            Keyboard input volume
            <input
              type="range"
              min="0"
              max="100"
              value={config.keyboardInputSfx.volume}
              onChange={(event) =>
                setConfig({
                  ...config,
                  keyboardInputSfx: { ...config.keyboardInputSfx, volume: Number(event.target.value) },
                })
              }
            />
          </label>
          <SoundListEditor
            title="Клавиатура"
            sounds={config.keyboardInputSfx.sounds}
            onAdd={addKeyboardSounds}
            onRemove={removeKeyboardSound}
            onTest={() =>
              playInputSfx({
                userSounds: config.keyboardInputSfx.sounds,
                defaultSounds: ["default:keyboard"],
                volume: config.keyboardInputSfx.volume,
              })
            }
          />
          <button onClick={() => saveConfig()}><Save size={16} />Save Input SFX</button>
        </section>

        <LogsPanel logs={logs} />
      </section>
    </main>
  );
}

function DurationEditor({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }) {
  return (
    <label className="compact-field">
      Default duration, minutes
      <input
        type="number"
        min="1"
        max="120"
        value={Math.max(1, Math.round(seconds / 60))}
        onChange={(event) => {
          const minutes = Math.max(1, Math.min(120, Number(event.target.value) || 1));
          onChange(minutes * 60);
        }}
      />
    </label>
  );
}

function YoutubeLinksEditor({
  modifier,
  onChange,
  onVolumeChange,
}: {
  modifier: ModifierDefinition;
  onChange: (variants: NonNullable<ModifierDefinition["variants"]>) => void;
  onVolumeChange: (volume: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const variants = modifier.variants || [];
  const links = variants.map((variant) => variant.videoUrl || "").filter(Boolean);
  const [error, setError] = useState("");

  function addLink() {
    const value = draft.trim();
    if (!value) {
      setError("Добавьте YouTube-ссылку");
      return;
    }
    if (!isYoutubeUrl(value)) {
      setError("Ссылка должна быть похожа на YouTube URL");
      return;
    }
    const videoId = extractYoutubeVideoId(value);
    if (!videoId) {
      setError("Не удалось найти YouTube video id");
      return;
    }
    if (links.includes(value)) {
      setError("Такая ссылка уже есть");
      return;
    }

    onChange([...variants, { videoId, videoUrl: value }]);
    setDraft("");
    setError("");
  }

  function removeLink(link: string) {
    onChange(variants.filter((variant) => variant.videoUrl !== link));
  }

  return (
    <details className="compact-details">
      <summary>Все YouTube-ссылки ({links.length})</summary>
      <div className="link-list">
        {links.length === 0 && <p className="empty-state">Ссылок пока нет. Добавьте YouTube-ссылку.</p>}
        {links.map((link) => (
          <div className="list-row" key={link}>
            <span title={link}>{link}</span>
            <button className="icon-button danger-subtle" onClick={() => removeLink(link)} title="Удалить">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="inline-form">
        <input placeholder="https://www.youtube.com/watch?v=..." value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button onClick={addLink}><Plus size={16} />Добавить ссылку</button>
      </div>
      {error && <p className="field-error">{error}</p>}
      <label>
        Volume
        <input
          type="number"
          min="0"
          max="100"
          value={modifier.volume ?? (modifier.type === "sound" ? 35 : 15)}
          onChange={(event) => {
            const volume = Math.max(0, Math.min(100, Number(event.target.value)));
            onVolumeChange(volume);
          }}
        />
      </label>
    </details>
  );
}

function SoundListEditor({
  title,
  sounds,
  onAdd,
  onRemove,
  onTest,
}: {
  title: string;
  sounds: string[];
  onAdd: () => void;
  onRemove: (path: string) => void;
  onTest: () => void;
}) {
  return (
    <div className="sound-list">
      <div className="sound-list__header">
        <strong>{title}</strong>
        <div>
          <button className="icon-button" onClick={onTest} title="Тест"><Volume2 size={15} /></button>
          <button onClick={onAdd}><Plus size={16} />Добавить mp3</button>
        </div>
      </div>
      {sounds.length === 0 ? (
        <p className="empty-state">Пользовательские звуки не добавлены. Используются звуки по умолчанию.</p>
      ) : (
        <div className="file-list">
          {sounds.map((path) => (
            <div className="list-row" key={path}>
              <span title={path}>{fileLabel(path)}</span>
              <button className="icon-button danger-subtle" onClick={() => onRemove(path)} title="Удалить">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
