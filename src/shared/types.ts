export type ModifierType =
  | "sound"
  | "tunnel"
  | "chat"
  | "lag"
  | "video-corner"
  | "mouse-input-sfx"
  | "keyboard-input-sfx"
  | "big-cursor"
  | "killer-cursor"
  | "flashlight"
  | "sleeping-business";

export type VisualLayerType = "lag" | "tunnel" | "chat" | "video-corner" | "big-cursor" | "killer-cursor" | "flashlight" | "sleeping-business";

export interface MouseInputSfxSettings {
  volume: number;
  sounds: {
    leftClick: string[];
    rightClick: string[];
    middleClick: string[];
    wheelUp: string[];
    wheelDown: string[];
  };
}

export interface KeyboardInputSfxSettings {
  volume: number;
  sounds: string[];
}

export interface ModifierDefinition {
  id: string;
  title: string;
  description: string;
  type: ModifierType;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  rollWeight?: number;
  color: string;
  enabled: boolean;
  durationSeconds: number;
  allowRepeatWhileActive: boolean;
  volume?: number;
  maxActiveVideosEnabled?: boolean;
  maxActiveVideos?: number;
  variants?: Array<{
    videoId?: string;
    videoUrl?: string;
    audioUrl?: string;
    title?: string;
  }>;
}

export interface TriggerEvent {
  id: string;
  source: "test" | "twitch" | "donationalerts";
  viewerName?: string;
  amount?: number;
  currency?: string;
  rewardId?: string;
  rewardTitle?: string;
  message?: string;
  durationMultiplier?: number;
  createdAt: string;
}

export interface ActiveModifierInstance {
  instanceId: string;
  modifierId: string;
  startedAt: number;
  endsAt: number;
  state?: "killer-chasing" | "killer-killed";
  titleOverride?: string;
  descriptionOverride?: string;
  variantKey?: string;
  variantVideoId?: string;
  videoSlotIndex?: number;
  repeatCount?: number;
}

export interface AppRuntimeState {
  isPlaying: boolean;
  isRolling: boolean;
  activeModifiers: ActiveModifierInstance[];
  logs: AppLog[];
}

export interface AppLog {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface ChatMessageEvent {
  id: string;
  source: "twitch";
  viewerName: string;
  message: string;
  createdAt: string;
}

export interface AppConfig {
  twitch: {
    enabled: boolean;
    clientId: string;
    accessToken: string | null;
    refreshToken: string | null;
    broadcasterId: string | null;
    broadcasterLogin: string | null;
    rewardId: string;
    rewardTitle: string;
    rewardRollsEnabled: boolean;
    subscriptionRollsEnabled: boolean;
    subscriptionMinTier: "1000" | "2000" | "3000";
    giftMinCount: number;
    giftMinTier: "1000" | "2000" | "3000";
  };
  donationAlerts: {
    enabled: boolean;
    clientId: string;
    useBuiltinClientId: boolean;
    clientSecret: string;
    redirectHost: "127.0.0.1" | "localhost";
    accessToken: string | null;
    refreshToken: string | null;
    userId: string | null;
    socketConnectionToken: string | null;
    minAmount: number;
  };
  overlay: {
    monitorIndex: number;
    alwaysOnTop: boolean;
    clickThrough: boolean;
    visualLayerOrder: VisualLayerType[];
  };
  theme: "light" | "dark";
  mouseInputSfx: MouseInputSfxSettings;
  keyboardInputSfx: KeyboardInputSfxSettings;
  modifiers: ModifierDefinition[];
}

export interface DisplayMonitor {
  index: number;
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}
