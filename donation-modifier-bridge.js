const http = require('http');

const HOST = '127.0.0.1';
const PORT = 17891;

let lastTrigger = {
  api: 'modifier-overlay',
  call: 'idle',
  id: null,
  source: 'bridge',
};
let pendingTrigger = null;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

const server = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  const url = new URL(request.url, `http://${HOST}:${PORT}`);

  if (url.pathname === '/roll') {
    lastTrigger = {
      api: 'modifier-overlay',
      call: 'roll',
      id: cryptoRandomId(),
      source: url.searchParams.get('source') || 'donationalerts',
      at: new Date().toISOString(),
    };
    pendingTrigger = lastTrigger;

    console.log(`[bridge] roll ${lastTrigger.id} from ${lastTrigger.source}`);
    sendJson(response, 200, lastTrigger);
    return;
  }

  if (url.pathname === '/state') {
    sendJson(response, 200, lastTrigger);
    return;
  }

  if (url.pathname === '/state.js') {
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/javascript; charset=utf-8',
    });
    response.end(`window.triggerModifierRollFromBridge(${JSON.stringify(lastTrigger)});`);
    return;
  }

  if (url.pathname === '/next.js') {
    const trigger = pendingTrigger;
    pendingTrigger = null;

    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/javascript; charset=utf-8',
    });

    if (trigger) {
      response.end(`window.triggerModifierRollFromBridge(${JSON.stringify(trigger)});`);
    } else {
      response.end('');
    }
    return;
  }

  sendJson(response, 404, { error: 'not_found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[bridge] listening on http://${HOST}:${PORT}`);
});

function cryptoRandomId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
