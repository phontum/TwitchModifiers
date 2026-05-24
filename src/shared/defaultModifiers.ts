import type { AppConfig, KeyboardInputSfxSettings, ModifierDefinition, MouseInputSfxSettings, VisualLayerType } from "./types";

const defaultMouseInputSfx: MouseInputSfxSettings = {
  volume: 45,
  sounds: {
    leftClick: [],
    rightClick: [],
    middleClick: [],
    wheelUp: [],
    wheelDown: [],
  },
};

const defaultKeyboardInputSfx: KeyboardInputSfxSettings = {
  volume: 38,
  sounds: [],
};

export const defaultVisualLayerOrder: VisualLayerType[] = ["lag", "tunnel", "flashlight", "chat", "killer-cursor", "big-cursor", "sleeping-business", "video-corner"];

function normalizeVisualLayerOrder(order: VisualLayerType[] | undefined): VisualLayerType[] {
  const known = new Set(defaultVisualLayerOrder);
  const incoming = (order || []).filter((item): item is VisualLayerType => known.has(item as VisualLayerType));
  return [...incoming, ...defaultVisualLayerOrder.filter((item) => !incoming.includes(item))];
}

export const defaultModifiers: ModifierDefinition[] = [
  {
    id: "sound-modifier",
    title: "Звуковой модификатор",
    rarity: "rare",
    rollWeight: 14.5,
    color: "#3f83f8",
    durationSeconds: 10 * 60,
    type: "sound",
    enabled: true,
    allowRepeatWhileActive: true,
    volume: 35,
    description: "Фоновое видео со звуком.",
    variants: [
      { videoId: "-sj5wq4EIRg", videoUrl: "https://www.youtube.com/watch?v=-sj5wq4EIRg" },
      { videoId: "LCy0eDjNvzk", videoUrl: "https://www.youtube.com/watch?v=LCy0eDjNvzk" },
      { videoId: "L_6Q28__BCI", videoUrl: "https://www.youtube.com/watch?v=L_6Q28__BCI" },
      { videoId: "QGroZXx2eGM", videoUrl: "https://www.youtube.com/watch?v=QGroZXx2eGM" },
      { videoId: "oZAGNaLrTd0", videoUrl: "https://www.youtube.com/watch?v=oZAGNaLrTd0" },
    ],
  },
  {
    id: "tunnel-vision",
    title: "Зашоренный",
    rarity: "epic",
    rollWeight: 9,
    color: "#8b5cf6",
    durationSeconds: 5 * 60,
    type: "tunnel",
    enabled: true,
    allowRepeatWhileActive: false,
    description: "Виден только центр экрана.",
  },
  {
    id: "public-meeting",
    title: "Народное собрание",
    rarity: "uncommon",
    rollWeight: 20,
    color: "#10b981",
    durationSeconds: 10 * 60,
    type: "chat",
    enabled: true,
    allowRepeatWhileActive: false,
    description: "Сообщения Twitch-чата выводятся на экран.",
  },
  {
    id: "lag-spikes",
    title: "Лаги",
    rarity: "legendary",
    rollWeight: 2,
    color: "#f59e0b",
    durationSeconds: 5 * 60,
    type: "lag",
    enabled: true,
    allowRepeatWhileActive: false,
    description: "Случайные отключения картинки на 0.5-1 секунду.",
  },
  {
    id: "adhd",
    title: "СДВГ",
    rarity: "rare",
    rollWeight: 14.5,
    color: "#ec4899",
    durationSeconds: 10 * 60,
    type: "video-corner",
    enabled: true,
    allowRepeatWhileActive: true,
    volume: 15,
    maxActiveVideosEnabled: false,
    maxActiveVideos: 4,
    description: "Маленькое видео в углу экрана.",
    variants: [
      { videoId: "vTfD20dbxho", videoUrl: "https://youtu.be/vTfD20dbxho" },
      { videoId: "BQ9iEbKmhbg", videoUrl: "https://www.youtube.com/watch?v=BQ9iEbKmhbg" },
      { videoId: "J9dvPQuHz-I", videoUrl: "https://www.youtube.com/watch?v=J9dvPQuHz-I" },
    ],
  },
  {
    id: "mouse-input-sfx",
    title: "Кто кликает?",
    rarity: "uncommon",
    rollWeight: 20,
    color: "#0ea5e9",
    durationSeconds: 5 * 60,
    type: "mouse-input-sfx",
    enabled: true,
    allowRepeatWhileActive: false,
    description: "Глобальные звуки кликов и скролла мыши.",
  },
  {
    id: "big-cursor",
    title: "\u042d\u0442\u043e\u0442 \u043f\u0440\u0438\u0446\u0435\u043b \u043f\u0440\u043e\u0441\u0442\u043e \u0438\u043c\u0431\u0430",
    rarity: "rare",
    rollWeight: 8,
    color: "#84cc16",
    durationSeconds: 3 * 60,
    type: "big-cursor",
    enabled: true,
    allowRepeatWhileActive: false,
    description: "\u0411\u043e\u043b\u044c\u0448\u043e\u0439 \u0441\u0430\u043b\u0430\u0442\u043e\u0432\u044b\u0439 \u043a\u0432\u0430\u0434\u0440\u0430\u0442 \u043d\u0430 \u043a\u0443\u0440\u0441\u043e\u0440\u0435.",
  },
  {
    id: "killer-cursor",
    title: "\u041a\u0438\u043b\u043b\u0435\u0440",
    rarity: "epic",
    rollWeight: 5,
    color: "#ef4444",
    durationSeconds: 2 * 60,
    type: "killer-cursor",
    enabled: true,
    allowRepeatWhileActive: false,
    description: "\u0421\u043d\u0430\u0439\u043f\u0435\u0440\u0441\u043a\u0438\u0439 \u043f\u0440\u0438\u0446\u0435\u043b \u043f\u0440\u0435\u0441\u043b\u0435\u0434\u0443\u0435\u0442 \u043a\u0443\u0440\u0441\u043e\u0440. \u0414\u043e\u0433\u043e\u043d\u0438\u0442 - \u044d\u043a\u0440\u0430\u043d \u0433\u0430\u0441\u043d\u0435\u0442.",
  },
  {
    id: "flashlight",
    title: "\u0424\u043e\u043d\u0430\u0440\u0438\u043a",
    rarity: "epic",
    rollWeight: 7,
    color: "#facc15",
    durationSeconds: 4 * 60,
    type: "flashlight",
    enabled: true,
    allowRepeatWhileActive: false,
    description: "\u042d\u043a\u0440\u0430\u043d \u0442\u0435\u043c\u043d\u0435\u0435\u0442, \u0430 \u043d\u0435\u0431\u043e\u043b\u044c\u0448\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c \u043f\u043e\u0434 \u043a\u0443\u0440\u0441\u043e\u0440\u043e\u043c \u043e\u0441\u0432\u0435\u0449\u0430\u0435\u0442\u0441\u044f.",
  },
  {
    id: "keyboard-input-sfx",
    title: "ASMR клавиши",
    rarity: "uncommon",
    rollWeight: 20,
    color: "#22c55e",
    durationSeconds: 5 * 60,
    type: "keyboard-input-sfx",
    enabled: true,
    allowRepeatWhileActive: false,
    description: "Глобальные звуки нажатий клавиш.",
  },
  {
    id: "sleeping-business",
    title: "Спящий бизнес",
    rarity: "rare",
    rollWeight: 8,
    color: "#06b6d4",
    durationSeconds: 6 * 60,
    type: "sleeping-business",
    enabled: true,
    allowRepeatWhileActive: false,
    volume: 34,
    description: "Справа снизу появляются будильники и иногда звучат сигналы мессенджеров.",
  },
];

export const defaultConfig: AppConfig = {
  twitch: {
    enabled: false,
    clientId: "",
    accessToken: null,
    refreshToken: null,
    broadcasterId: null,
    broadcasterLogin: null,
    rewardId: "",
    rewardRollsEnabled: true,
    subscriptionRollsEnabled: true,
    subscriptionMinTier: "2000",
    giftMinCount: 5,
    giftMinTier: "2000",
    rewardTitle: "Прокрут модификатора",
  },
  donationAlerts: {
    enabled: false,
    clientId: "",
    useBuiltinClientId: true,
    clientSecret: "",
    redirectHost: "127.0.0.1",
    accessToken: null,
    refreshToken: null,
    userId: null,
    socketConnectionToken: null,
    minAmount: 0,
  },
  overlay: {
    monitorIndex: 0,
    alwaysOnTop: true,
    clickThrough: true,
    visualLayerOrder: defaultVisualLayerOrder,
  },
  theme: "dark",
  mouseInputSfx: defaultMouseInputSfx,
  keyboardInputSfx: defaultKeyboardInputSfx,
  modifiers: defaultModifiers,
};

function normalizeModifier(modifier: ModifierDefinition): ModifierDefinition {
  const defaultModifier = defaultModifiers.find((item) => item.id === modifier.id);
  const legacyVariant =
    !modifier.variants && ((modifier as ModifierDefinition & { videoUrl?: string; videoId?: string }).videoUrl || (modifier as ModifierDefinition & { videoUrl?: string; videoId?: string }).videoId)
      ? [
          {
            videoUrl: (modifier as ModifierDefinition & { videoUrl?: string; videoId?: string }).videoUrl,
            videoId: (modifier as ModifierDefinition & { videoUrl?: string; videoId?: string }).videoId,
          },
        ]
      : undefined;
  return {
    ...(defaultModifier || modifier),
    ...modifier,
    maxActiveVideosEnabled: modifier.maxActiveVideosEnabled ?? defaultModifier?.maxActiveVideosEnabled ?? false,
    maxActiveVideos: Math.max(1, Math.min(24, modifier.maxActiveVideos ?? defaultModifier?.maxActiveVideos ?? 4)),
    variants: modifier.variants || legacyVariant || defaultModifier?.variants || [],
  };
}

export function normalizeConfig(config: Partial<AppConfig> | null | undefined): AppConfig {
  const incomingModifiers = config?.modifiers || [];
  const mergedModifiers = [
    ...incomingModifiers.map(normalizeModifier),
    ...defaultModifiers.filter((modifier) => !incomingModifiers.some((item) => item.id === modifier.id)),
  ];

  return {
    ...defaultConfig,
    ...config,
    twitch: { ...defaultConfig.twitch, ...config?.twitch },
    donationAlerts: { ...defaultConfig.donationAlerts, ...config?.donationAlerts },
    overlay: {
      ...defaultConfig.overlay,
      ...config?.overlay,
      visualLayerOrder: normalizeVisualLayerOrder(config?.overlay?.visualLayerOrder),
    },
    theme: config?.theme === "light" ? "light" : config?.theme === "dark" ? "dark" : defaultConfig.theme,
    mouseInputSfx: {
      ...defaultMouseInputSfx,
      ...config?.mouseInputSfx,
      sounds: {
        ...defaultMouseInputSfx.sounds,
        ...config?.mouseInputSfx?.sounds,
      },
    },
    keyboardInputSfx: {
      ...defaultKeyboardInputSfx,
      ...config?.keyboardInputSfx,
      sounds: config?.keyboardInputSfx?.sounds || [],
    },
    modifiers: mergedModifiers,
  };
}
