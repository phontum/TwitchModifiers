var CONFIG = {
  rewardId: '24d8f450-a511-4c1d-a985-9198821d035f',
  rewardPrompt: 'MODIFIER:REWARD',
  rewardTitle: 'Прокрут модификатора',
  rollDurationMs: 5600,
  itemWidth: 260,
  modifiers: [
    {
      id: 'sound-modifier',
      title: 'Звуковой модификатор',
      rarity: 'rare',
      color: '#8fb3ff',
      durationSeconds: 10 * 60,
      type: 'youtube-background',
      allowRepeatWhileActive: true,
      description: 'Фоновое видео со звуком.',
      variants: [
        { videoId: '-sj5wq4EIRg', videoUrl: 'https://www.youtube.com/watch?v=-sj5wq4EIRg' },
      ],
      actionText: 'Если autoplay заблокирован, видео откроется отдельной вкладкой.',
    },
    {
      id: 'tunnel-vision',
      title: 'Зашоренный',
      rarity: 'epic',
      color: '#c77dff',
      durationSeconds: 5 * 60,
      type: 'visual',
      allowRepeatWhileActive: false,
      description: 'Виден только центр экрана.',
      visual: { mode: 'tunnel' },
    },
    {
      id: 'public-meeting',
      title: 'Народное собрание',
      rarity: 'uncommon',
      color: '#33d17a',
      durationSeconds: 10 * 60,
      type: 'chat',
      allowRepeatWhileActive: false,
      description: 'Сообщения Twitch-чата выводятся на экран.',
    },
    {
      id: 'lag-spikes',
      title: 'Лаги',
      rarity: 'legendary',
      color: '#ffb02e',
      durationSeconds: 5 * 60,
      type: 'lag',
      allowRepeatWhileActive: false,
      description: 'Случайные отключения картинки на 0.5-1 секунду.',
    },
    {
      id: 'adhd',
      title: 'СДВГ',
      rarity: 'rare',
      color: '#f06595',
      durationSeconds: 10 * 60,
      type: 'video-corner',
      allowRepeatWhileActive: true,
      description: 'Маленькое видео в углу экрана.',
      volume: 35,
      variants: [
        { videoId: 'vTfD20dbxho', videoUrl: 'https://youtu.be/vTfD20dbxho' },
      ],
    },
  ],
};

var state = {
  rolling: false,
  activeModifiers: [],
  activePanelStack: null,
  chatLayers: [],
  activeSoundUrls: [],
  cornerVideoOffset: 0,
};

console.log('[modifier-overlay] loaded');
injectStyles();
window.testModifierRoll = startModifierRoll;
waitForStreamerbotClient();

function waitForStreamerbotClient() {
  if (window.client && typeof window.client.on === 'function') {
    registerStreamerbotEvents();
    return;
  }

  setTimeout(waitForStreamerbotClient, 250);
}

function registerStreamerbotEvents() {
  console.log('[modifier-overlay] connected to Streamer.bot client');

  window.client.on('Twitch.RewardRedemption', function(message) {
    var data = message && message.data ? message.data : {};
    var reward = data.reward || data;
    var id = reward.id || reward.rewardId || data.rewardId || '';
    var title = reward.title || data.title || '';
    var prompt = reward.prompt || reward.description || data.prompt || '';

    console.log('[modifier-overlay] reward redemption', { id: id, title: title, prompt: prompt });

    if (id === CONFIG.rewardId || prompt === CONFIG.rewardPrompt || title === CONFIG.rewardTitle) {
      startModifierRoll();
    }
  });

  window.client.on('Twitch.ChatMessage', function(message) {
    if (state.chatLayers.length === 0) return;
    appendChatMessage(message);
  });
}

function startModifierRoll() {
  var availableModifiers = getAvailableModifiers();
  if (state.rolling || availableModifiers.length === 0) return;

  state.rolling = true;

  var roll = buildRoll(availableModifiers);
  var overlay = createRollOverlay(roll.sequence);
  document.body.appendChild(overlay.root);

  var startIndex = 8;
  var frameCenter = overlay.frame.clientWidth / 2;
  var startTravel = startIndex * CONFIG.itemWidth - frameCenter + CONFIG.itemWidth / 2;
  var endTravel = roll.targetIndex * CONFIG.itemWidth - frameCenter + CONFIG.itemWidth / 2;

  overlay.track.style.transitionDuration = '0ms';
  overlay.track.style.transform = 'translateX(' + (-startTravel) + 'px)';
  overlay.track.offsetHeight;

  setTimeout(function() {
    overlay.track.style.transitionDuration = CONFIG.rollDurationMs + 'ms';
    overlay.track.style.transform = 'translateX(' + (-endTravel) + 'px)';
  }, 90);

  setTimeout(function() {
    overlay.root.classList.add('is-complete');
    overlay.winner.textContent = roll.winner.title;
    overlay.meta.textContent = formatModifierMeta(roll.winner);

    setTimeout(function() {
      overlay.root.parentNode.removeChild(overlay.root);
      state.rolling = false;
      activateModifier(roll.winner);
    }, 2400);
  }, CONFIG.rollDurationMs + 300);
}

function buildRoll(availableModifiers) {
  var sequence = [];
  var targetIndex = 48 + Math.floor(Math.random() * 8);

  for (var i = 0; i < 72; i += 1) {
    sequence.push(pickRandom(availableModifiers));
  }

  return {
    sequence: sequence,
    targetIndex: targetIndex,
    winner: sequence[targetIndex],
  };
}

function getAvailableModifiers() {
  var available = [];

  for (var i = 0; i < CONFIG.modifiers.length; i += 1) {
    var modifier = CONFIG.modifiers[i];
    if (modifier.allowRepeatWhileActive === false && isModifierActive(modifier.id)) continue;
    available.push(modifier);
  }

  return available;
}

function isModifierActive(id) {
  for (var i = 0; i < state.activeModifiers.length; i += 1) {
    if (state.activeModifiers[i].modifierId === id) return true;
  }

  return false;
}

function createRollOverlay(sequence) {
  var root = document.createElement('section');
  root.className = 'modifier-roll';

  var frame = document.createElement('div');
  frame.className = 'modifier-roll__frame';

  var marker = document.createElement('div');
  marker.className = 'modifier-roll__marker';

  var track = document.createElement('div');
  track.className = 'modifier-roll__track';

  for (var i = 0; i < sequence.length; i += 1) {
    var modifier = sequence[i];
    var item = document.createElement('article');
    item.className = 'modifier-roll__item';
    item.style.setProperty('--modifier-color', modifier.color);
    item.innerHTML =
      '<span class="modifier-roll__rarity">' + escapeHtml(modifier.rarity) + '</span>' +
      '<strong>' + escapeHtml(modifier.title) + '</strong>' +
      '<small>' + escapeHtml(formatDuration(modifier.durationSeconds)) + '</small>';
    track.appendChild(item);
  }

  var result = document.createElement('div');
  result.className = 'modifier-roll__result';

  var winner = document.createElement('strong');
  winner.textContent = '...';

  var meta = document.createElement('span');
  meta.textContent = '';

  result.appendChild(winner);
  result.appendChild(meta);
  frame.appendChild(marker);
  frame.appendChild(track);
  root.appendChild(frame);
  root.appendChild(result);

  return { root: root, frame: frame, track: track, winner: winner, meta: meta };
}

function activateModifier(modifier) {
  var durationMs = modifier.durationSeconds * 1000;
  var panel = createActivePanel(modifier);
  getActivePanelStack().appendChild(panel.root);

  var teardown = function() {};

  if (modifier.type === 'visual') teardown = applyVisualModifier(modifier);
  if (modifier.type === 'chat') teardown = applyChatModifier();
  if (modifier.type === 'lag') teardown = applyLagModifier();
  if (modifier.type === 'video-corner') teardown = playCornerVideo(modifier);
  if (modifier.type === 'youtube-background') teardown = playBackgroundYoutube(modifier, panel.root);

  var instance = {
    modifierId: modifier.id,
    timer: null,
    stop: function() {
      if (instance.timer) clearTimeout(instance.timer);
      teardown();
      if (panel.root && panel.root.parentNode) panel.root.parentNode.removeChild(panel.root);
      removeActiveModifier(instance);
    },
  };

  state.activeModifiers.push(instance);

  var startedAt = Date.now();
  function tick() {
    var remainingMs = Math.max(0, durationMs - (Date.now() - startedAt));
    panel.timer.textContent = formatClock(remainingMs);

    if (remainingMs > 0) {
      instance.timer = setTimeout(tick, 500);
    } else {
      instance.stop();
    }
  }

  tick();
}

function getActivePanelStack() {
  if (state.activePanelStack && state.activePanelStack.parentNode) {
    return state.activePanelStack;
  }

  var stack = document.createElement('section');
  stack.className = 'modifier-active-stack';
  document.body.appendChild(stack);
  state.activePanelStack = stack;
  return stack;
}

function removeActiveModifier(instance) {
  var next = [];
  for (var i = 0; i < state.activeModifiers.length; i += 1) {
    if (state.activeModifiers[i] !== instance) next.push(state.activeModifiers[i]);
  }
  state.activeModifiers = next;

  if (state.activeModifiers.length === 0 && state.activePanelStack && state.activePanelStack.parentNode) {
    state.activePanelStack.parentNode.removeChild(state.activePanelStack);
    state.activePanelStack = null;
  }
}

function createActivePanel(modifier) {
  var root = document.createElement('section');
  root.className = 'modifier-active';
  root.style.setProperty('--modifier-color', modifier.color);

  var title = document.createElement('strong');
  title.textContent = modifier.title;

  var description = document.createElement('span');
  description.textContent = modifier.actionText || modifier.description || '';

  var timer = document.createElement('b');
  timer.textContent = formatClock(modifier.durationSeconds * 1000);

  root.appendChild(title);
  root.appendChild(description);
  root.appendChild(timer);
  return { root: root, timer: timer };
}

function applyVisualModifier(modifier) {
  var layer = document.createElement('div');
  layer.className = 'modifier-visual-layer';

  if (modifier.visual && modifier.visual.mode) {
    layer.className += ' modifier-visual-layer--' + modifier.visual.mode;
  }

  document.body.appendChild(layer);
  return function() {
    if (layer.parentNode) layer.parentNode.removeChild(layer);
  };
}

function applyChatModifier() {
  var layer = document.createElement('div');
  layer.className = 'modifier-chat-layer';
  state.chatLayers.push(layer);
  document.body.appendChild(layer);

  return function() {
    var next = [];
    for (var i = 0; i < state.chatLayers.length; i += 1) {
      if (state.chatLayers[i] !== layer) next.push(state.chatLayers[i]);
    }
    state.chatLayers = next;
    if (layer.parentNode) layer.parentNode.removeChild(layer);
  };
}

function appendChatMessage(message) {
  var data = message && message.data ? message.data : {};
  var msg = data.message || {};
  var text = typeof msg === 'string' ? msg : (msg.message || msg.text || data.text || '');
  var emotes = msg.emotes || data.emotes || [];

  var bubble = document.createElement('div');
  bubble.className = 'modifier-chat-message';

  var body = document.createElement('span');
  body.textContent = text;
  bubble.appendChild(body);

  for (var i = 0; i < emotes.length && i < 8; i += 1) {
    var src = emotes[i].imageUrl || emotes[i].url || emotes[i].src;
    if (!src) continue;
    var img = document.createElement('img');
    img.src = src;
    bubble.appendChild(img);
  }

  for (var layerIndex = 0; layerIndex < state.chatLayers.length; layerIndex += 1) {
    var targetLayer = state.chatLayers[layerIndex];
    var messageNode = layerIndex === 0 ? bubble : bubble.cloneNode(true);
    messageNode.style.left = randomInt(2, 72) + 'vw';
    messageNode.style.top = randomInt(10, 82) + 'vh';
    targetLayer.appendChild(messageNode);

    setTimeout((function(node) {
      return function() {
        if (node.parentNode) node.parentNode.removeChild(node);
      };
    })(messageNode), 12000);
  }
}

function applyLagModifier() {
  var layer = document.createElement('div');
  layer.className = 'modifier-lag-layer';
  document.body.appendChild(layer);

  var stopped = false;
  var timer = null;

  function scheduleFreeze() {
    if (stopped) return;
    timer = setTimeout(function() {
      if (stopped) return;
      layer.classList.add('is-freezing');
      setTimeout(function() {
        layer.classList.remove('is-freezing');
        scheduleFreeze();
      }, randomInt(500, 1000));
    }, randomInt(2000, 5000));
  }

  scheduleFreeze();

  return function() {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (layer.parentNode) layer.parentNode.removeChild(layer);
  };
}

function playCornerVideo(modifier) {
  var variant = pickRandom(modifier.variants || [{ videoId: modifier.videoId, videoUrl: modifier.videoUrl }]);
  var wrap = document.createElement('div');
  wrap.className = 'modifier-corner-video';

  var offset = state.cornerVideoOffset;
  state.cornerVideoOffset = (state.cornerVideoOffset + 28) % 168;
  wrap.style.right = 22 + offset + 'px';
  wrap.style.bottom = 22 + offset + 'px';

  var handle = document.createElement('div');
  handle.className = 'modifier-corner-video__handle';
  handle.textContent = 'СДВГ';

  var iframe = createYoutubeIframe(variant.videoId, true, false);
  iframe.className = 'modifier-corner-video__iframe';

  wrap.appendChild(handle);
  wrap.appendChild(iframe);
  document.body.appendChild(wrap);
  makeDraggable(wrap, handle);
  setYoutubeVolume(iframe, modifier.volume);

  return function() {
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
  };
}

function makeDraggable(root, handle) {
  var dragging = false;
  var startX = 0;
  var startY = 0;
  var startLeft = 0;
  var startTop = 0;

  handle.addEventListener('mousedown', function(event) {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = root.offsetLeft;
    startTop = root.offsetTop;
    root.style.left = startLeft + 'px';
    root.style.top = startTop + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    event.preventDefault();
  });

  document.addEventListener('mousemove', function(event) {
    if (!dragging) return;
    root.style.left = Math.max(0, Math.min(window.innerWidth - root.offsetWidth, startLeft + event.clientX - startX)) + 'px';
    root.style.top = Math.max(0, Math.min(window.innerHeight - root.offsetHeight, startTop + event.clientY - startY)) + 'px';
  });

  document.addEventListener('mouseup', function() {
    dragging = false;
  });
}

function setYoutubeVolume(iframe, volume) {
  var safeVolume = Math.max(0, Math.min(100, Number(volume) || 0));
  var attempts = 0;
  var timer = setInterval(function() {
    attempts += 1;
    try {
      iframe.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: 'setVolume',
        args: [safeVolume],
      }), '*');
    } catch (error) {}

    if (attempts >= 12) clearInterval(timer);
  }, 500);
}

function playBackgroundYoutube(modifier, panelRoot) {
  var variant = pickAvailableSoundVariant(modifier);
  if (!variant) {
    panelRoot.querySelector('span').textContent = 'Все варианты звука уже активны.';
    return function() {};
  }

  state.activeSoundUrls.push(variant.videoUrl);

  var opened = null;
  try {
    opened = window.open(variant.videoUrl, '_blank');
    if (opened && opened.blur) opened.blur();
    if (window.focus) window.focus();
  } catch (error) {
    console.log('[modifier-overlay] window.open failed', error);
  }

  return function() {
    releaseActiveSoundUrl(variant.videoUrl);
    try {
      if (opened && opened.close) opened.close();
    } catch (error) {}
  };
}

function pickAvailableSoundVariant(modifier) {
  var variants = modifier.variants || [];
  var available = [];

  for (var i = 0; i < variants.length; i += 1) {
    if (state.activeSoundUrls.indexOf(variants[i].videoUrl) === -1) {
      available.push(variants[i]);
    }
  }

  if (available.length === 0) return null;
  return pickRandom(available);
}

function releaseActiveSoundUrl(videoUrl) {
  var next = [];
  for (var i = 0; i < state.activeSoundUrls.length; i += 1) {
    if (state.activeSoundUrls[i] !== videoUrl) next.push(state.activeSoundUrls[i]);
  }
  state.activeSoundUrls = next;
}

function createYoutubeIframe(videoId, autoplay, hiddenSoundOnly) {
  var iframe = document.createElement('iframe');
  var params = [
    'autoplay=' + (autoplay ? '1' : '0'),
    'controls=0',
    'enablejsapi=1',
    'rel=0',
    'playsinline=1',
    'loop=1',
    'playlist=' + encodeURIComponent(videoId),
  ].join('&');

  iframe.src = 'https://www.youtube.com/embed/' + encodeURIComponent(videoId) + '?' + params;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
  iframe.frameBorder = '0';
  iframe.setAttribute('allowfullscreen', 'true');

  if (hiddenSoundOnly) {
    iframe.width = '1';
    iframe.height = '1';
  }

  return iframe;
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function formatModifierMeta(modifier) {
  return formatDuration(modifier.durationSeconds) + ' · ' + modifier.description;
}

function formatDuration(seconds) {
  var minutes = Math.round(seconds / 60);
  if (minutes >= 1) return minutes + ' мин';
  return seconds + ' сек';
}

function formatClock(ms) {
  var totalSeconds = Math.ceil(ms / 1000);
  var minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  var seconds = String(totalSeconds % 60).padStart(2, '0');
  return minutes + ':' + seconds;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function injectStyles() {
  var style = document.createElement('style');
  style.textContent = `
    .modifier-roll {
      position: fixed;
      top: 30px;
      left: 0;
      right: 0;
      z-index: 10000;
      display: grid;
      justify-items: center;
      gap: 10px;
      color: #f8fafc;
      font-family: Inter, Segoe UI, Arial, sans-serif;
      pointer-events: none;
    }

    .modifier-roll__frame {
      position: relative;
      width: calc(100vw - 80px);
      max-width: 1180px;
      height: 112px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 8px;
      background: rgba(8, 12, 20, 0.9);
      box-shadow: 0 18px 55px rgba(0, 0, 0, 0.45);
    }

    .modifier-roll__frame::before,
    .modifier-roll__frame::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      z-index: 2;
      width: 18%;
      pointer-events: none;
    }

    .modifier-roll__frame::before {
      left: 0;
      background: linear-gradient(90deg, rgba(8, 12, 20, 1), rgba(8, 12, 20, 0));
    }

    .modifier-roll__frame::after {
      right: 0;
      background: linear-gradient(270deg, rgba(8, 12, 20, 1), rgba(8, 12, 20, 0));
    }

    .modifier-roll__marker {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      z-index: 3;
      width: 3px;
      background: #ffffff;
      box-shadow: 0 0 18px rgba(255, 255, 255, 0.85);
      transform: translateX(-50%);
    }

    .modifier-roll__track {
      display: flex;
      height: 100%;
      transform: translateX(0);
      transition-property: transform;
      transition-timing-function: cubic-bezier(0.08, 0.72, 0.04, 1);
      will-change: transform;
    }

    .modifier-roll__item {
      flex: 0 0 ${CONFIG.itemWidth}px;
      display: grid;
      align-content: center;
      gap: 6px;
      width: ${CONFIG.itemWidth}px;
      min-width: ${CONFIG.itemWidth}px;
      max-width: ${CONFIG.itemWidth}px;
      height: 112px;
      padding: 14px 18px;
      border-right: 1px solid rgba(255, 255, 255, 0.1);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent), rgba(255, 255, 255, 0.04);
      box-shadow: inset 0 4px 0 var(--modifier-color);
      box-sizing: border-box;
    }

    .modifier-roll__item strong {
      font-size: 20px;
      line-height: 1.1;
      overflow-wrap: anywhere;
    }

    .modifier-roll__item small,
    .modifier-roll__rarity,
    .modifier-roll__result span {
      color: #cbd5e1;
      font-size: 13px;
    }

    .modifier-roll__rarity {
      color: var(--modifier-color);
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .modifier-roll__result {
      display: none;
      width: calc(100vw - 80px);
      max-width: 760px;
      padding: 12px 16px;
      border-left: 4px solid #fff;
      border-radius: 8px;
      background: rgba(8, 12, 20, 0.92);
      box-shadow: 0 14px 38px rgba(0, 0, 0, 0.38);
    }

    .modifier-roll__result strong,
    .modifier-roll__result span {
      display: block;
    }

    .modifier-roll__result strong {
      margin-bottom: 4px;
      font-size: 22px;
    }

    .modifier-roll.is-complete .modifier-roll__result {
      display: block;
      animation: modifier-pop 260ms ease-out;
    }

    .modifier-active-stack {
      position: fixed;
      top: 22px;
      right: 22px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      width: calc(100vw - 44px);
      max-width: 340px;
      pointer-events: none;
    }

    .modifier-active {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) auto;
      gap: 2px 10px;
      width: 100%;
      padding: 8px 10px;
      border-left: 4px solid var(--modifier-color);
      border-radius: 8px;
      background: rgba(8, 12, 20, 0.9);
      color: #f8fafc;
      font-family: Inter, Segoe UI, Arial, sans-serif;
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
      box-sizing: border-box;
      pointer-events: none;
    }

    .modifier-active strong {
      grid-column: 1;
      font-size: 14px;
      line-height: 1.15;
    }

    .modifier-active span {
      grid-column: 1 / -1;
      color: #cbd5e1;
      font-size: 11px;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }

    .modifier-active b {
      grid-column: 2;
      grid-row: 1;
      color: var(--modifier-color);
      font-size: 16px;
      font-variant-numeric: tabular-nums;
    }

    .modifier-visual-layer,
    .modifier-lag-layer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 1;
      pointer-events: none;
    }

    .modifier-visual-layer--tunnel {
      background: radial-gradient(circle at center, transparent 0 20%, rgba(0, 0, 0, 0.72) 30%, rgba(0, 0, 0, 0.96) 48%, #000 100%);
    }

    .modifier-chat-layer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 9998;
      pointer-events: none;
      font-family: Inter, Segoe UI, Arial, sans-serif;
    }

    .modifier-chat-message {
      position: absolute;
      max-width: 560px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(8, 12, 20, 0.86);
      color: #f8fafc;
      font-size: 20px;
      line-height: 1.25;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
      animation: modifier-chat-in 180ms ease-out;
    }

    .modifier-chat-message img {
      width: 30px;
      height: 30px;
      object-fit: contain;
      vertical-align: middle;
      margin-left: 4px;
    }

    .modifier-lag-layer {
      display: none;
      background: #000;
    }

    .modifier-lag-layer.is-freezing {
      display: block;
    }

    .modifier-corner-video {
      position: fixed;
      z-index: 9997;
      width: 360px;
      height: 226px;
      overflow: hidden;
      border: 2px solid rgba(255, 255, 255, 0.8);
      border-radius: 8px;
      background: #000;
      box-shadow: 0 16px 46px rgba(0, 0, 0, 0.5);
      pointer-events: auto;
      user-select: none;
    }

    .modifier-corner-video__handle {
      height: 24px;
      display: flex;
      align-items: center;
      padding: 0 10px;
      background: rgba(8, 12, 20, 0.96);
      color: #f8fafc;
      cursor: move;
      font: 700 12px/1 Inter, Segoe UI, Arial, sans-serif;
    }

    .modifier-corner-video iframe {
      width: 100%;
      height: 202px;
      pointer-events: none;
    }

    .modifier-background-youtube {
      position: fixed;
      left: -20px;
      top: -20px;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }

    @keyframes modifier-pop {
      from { opacity: 0; transform: translateY(-8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes modifier-chat-in {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

  `;
  document.head.appendChild(style);
}
