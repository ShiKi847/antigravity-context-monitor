/**
 * @fileoverview Backend for Antigravity Context Monitor.
 * Supports both native Antigravity Sidecar environment and Standalone Web mode.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_SPECS } from '../../src/models.mjs';
import { listAllConversations, parseConversationStats } from '../../src/parser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DATA_DIR = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || join(HERE, '.data');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');
const STARTED_AT = Date.now();

// Static file reader (live read for immediate hot reload of UI)
const readLocal = (name) => readFileSync(join(HERE, name), 'utf8');

function loadSettings() {
  if (!existsSync(SETTINGS_FILE)) {
    return {
      autoRefresh: true,
      refreshIntervalMs: 2000,
      modelId: null,
      customLimit: null,
      theme: 'auto',
      compactMode: false
    };
  }
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return { autoRefresh: true, refreshIntervalMs: 2000 };
  }
}

function saveSettings(settings) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Run in Antigravity Sidecar Mode
// ---------------------------------------------------------------------------
async function startSidecarMode() {
  const { Response, SidecarApp } = await import('sidecar_sdk');
  const app = new SidecarApp();

  // Pages
  app.page('/', () => readLocal('index.html'));
  app.page('/app.js', () => readLocal('app.js'));
  app.api('/styles.css', () => new Response(readLocal('styles.css'), { contentType: 'text/css' }), 'GET');
  app.api('/assets/logo.svg', () => {
    const logoPath = join(ROOT, 'assets', 'logo.svg');
    const svg = existsSync(logoPath) ? readFileSync(logoPath, 'utf8') : '';
    return new Response(svg, { contentType: 'image/svg+xml' });
  }, 'GET');

  // APIs
  app.api('/api/status', () => ({
    status: 'running',
    mode: 'sidecar',
    node: process.version,
    platform: `${platform()} ${release()}`,
    uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000)
  }), 'GET');

  app.api('/api/conversations', () => {
    return listAllConversations();
  }, 'GET');

  app.api('/api/models', () => {
    return Object.entries(MODEL_SPECS).map(([id, spec]) => ({
      id,
      name: spec.name,
      contextLimit: spec.contextLimit,
      family: spec.family,
      description: spec.description
    }));
  }, 'GET');

  app.api('/api/stats', (query) => {
    const convId = query.conversationId || query.convId || process.env.ANTIGRAVITY_CONVERSATION_ID;
    if (!convId) {
      const all = listAllConversations();
      if (all.length > 0) {
        return parseConversationStats(all[0].conversationId, query.modelId, query.limit ? Number(query.limit) : null);
      }
      return { error: 'No active conversation found' };
    }
    const limit = query.limit ? Number(query.limit) : null;
    return parseConversationStats(convId, query.modelId, limit);
  }, 'GET');

  app.api('/api/settings', () => loadSettings(), 'GET');

  app.api('/api/settings', (body) => {
    const current = loadSettings();
    const updated = { ...current, ...body };
    saveSettings(updated);
    return updated;
  });

  app.run();
  console.log('[Context Monitor] Antigravity Sidecar started successfully');
}

// ---------------------------------------------------------------------------
// Run in Standalone Web Mode (for external browser / developer preview)
// ---------------------------------------------------------------------------
function startStandaloneMode(port = 3847) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // CORS & Cache control
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Sidecar-Token');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET') {
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readLocal('index.html'));
        return;
      }
      if (url.pathname === '/app.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(readLocal('app.js'));
        return;
      }
      if (url.pathname === '/styles.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(readLocal('styles.css'));
        return;
      }
      if (url.pathname === '/assets/logo.svg') {
        const logoPath = join(ROOT, 'assets', 'logo.svg');
        const svg = existsSync(logoPath) ? readFileSync(logoPath, 'utf8') : '';
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end(svg);
        return;
      }
      if (url.pathname === '/preload.js') {
        // Standalone polyfill for window.sidecar
        const polyfill = `
          window.sidecar = {
            conversationId: null,
            standalone: true,
            fetch: (url, opts = {}) => fetch(url, opts),
            getWorkspaceUris: async () => [],
            onWorkspaceChange: () => () => {},
            agent: {
              sendMessage: async () => { alert('In standalone mode. Use inside Antigravity to message agent.'); },
              startConversation: async () => { alert('In standalone mode. Use inside Antigravity to start conversation.'); },
              getConversationMetadata: async () => ({})
            },
            ui: {
              toggleAuxPane: () => {},
              toggleConversation: () => {}
            }
          };
        `;
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(polyfill);
        return;
      }
      if (url.pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'running',
          mode: 'standalone',
          node: process.version,
          platform: `${platform()} ${release()}`,
          uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000)
        }));
        return;
      }
      if (url.pathname === '/api/conversations') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(listAllConversations()));
        return;
      }
      if (url.pathname === '/api/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Object.entries(MODEL_SPECS).map(([id, spec]) => ({
          id,
          name: spec.name,
          contextLimit: spec.contextLimit,
          family: spec.family,
          description: spec.description
        }))));
        return;
      }
      if (url.pathname === '/api/stats') {
        const convId = url.searchParams.get('conversationId') || url.searchParams.get('convId');
        const modelId = url.searchParams.get('modelId');
        const limitStr = url.searchParams.get('limit');
        const limit = limitStr ? Number(limitStr) : null;

        let targetId = convId;
        if (!targetId) {
          const all = listAllConversations();
          if (all.length > 0) targetId = all[0].conversationId;
        }

        const data = targetId ? parseConversationStats(targetId, modelId, limit) : { error: 'No conversations found' };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
      }
      if (url.pathname === '/api/settings') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(loadSettings()));
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/settings') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const current = loadSettings();
          const updated = { ...current, ...parsed };
          saveSettings(updated);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[Context Monitor] Standalone Dashboard running at http://127.0.0.1:${port}`);
  });
}

// ---------------------------------------------------------------------------
// Entry point selector
// ---------------------------------------------------------------------------
if (process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
  startSidecarMode();
} else {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3847;
  startStandaloneMode(port);
}
