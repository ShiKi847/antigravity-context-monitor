/**
 * @fileoverview High-performance parser for Antigravity conversation transcripts and databases.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_MODEL_ID, evaluateContextHealth, MODEL_SPECS } from './models.mjs';

/**
 * Resolves Antigravity App Data Directory across platforms.
 * @returns {string}
 */
export function getAntigravityDataDir() {
  const home = homedir();
  return join(home, '.gemini', 'antigravity');
}

/**
 * Returns paths for a given conversation.
 * @param {string} conversationId
 * @returns {{ brainDir: string, transcriptPath: string, dbPath: string }}
 */
export function getConversationPaths(conversationId) {
  const appDataDir = getAntigravityDataDir();
  return {
    brainDir: join(appDataDir, 'brain', conversationId),
    transcriptPath: join(appDataDir, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl'),
    dbPath: join(appDataDir, 'conversations', `${conversationId}.db`)
  };
}

/**
 * Detect model name from conversation database's gen_metadata or antigravity_state.pbtxt.
 * @param {string} conversationId
 * @returns {string}
 */
export function detectModelForConversation(conversationId) {
  const { dbPath } = getConversationPaths(conversationId);
  if (existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db.prepare('SELECT data FROM gen_metadata WHERE data IS NOT NULL ORDER BY idx DESC LIMIT 10').all();
      for (const row of rows) {
        if (!row.data) continue;
        const text = row.data.toString('utf8');
        // Look for model name strings in protobuf
        const match = text.match(/(gemini-[a-zA-Z0-9.-]+|claude-[a-zA-Z0-9.-]+|gpt-[a-zA-Z0-9.-]+)/i);
        if (match && match[1]) {
          const modelKey = match[1].toLowerCase();
          if (MODEL_SPECS[modelKey]) {
            return modelKey;
          }
          // Normalize prefix
          for (const key of Object.keys(MODEL_SPECS)) {
            if (modelKey.startsWith(key) || key.startsWith(modelKey)) {
              return key;
            }
          }
        }
      }
    } catch {
      // Ignore database read errors
    }
  }

  // Fallback to global state pbtxt
  const appDataDir = getAntigravityDataDir();
  const statePath = join(appDataDir, 'antigravity_state.pbtxt');
  if (existsSync(statePath)) {
    try {
      const content = readFileSync(statePath, 'utf8');
      if (content.includes('MODEL_PLACEHOLDER_M319') || content.includes('gemini-3.8-flash')) {
        return 'gemini-3.8-flash';
      }
    } catch {
      // Ignore
    }
  }

  return DEFAULT_MODEL_ID;
}

/**
 * List all available conversations from conversation_summaries.db or directory listing.
 * @returns {Array<{ conversationId: string, title: string, preview: string, stepCount: number, lastModified: string }>}
 */
export function listAllConversations() {
  const appDataDir = getAntigravityDataDir();
  const summaryDbPath = join(appDataDir, 'conversation_summaries.db');
  const results = [];

  if (existsSync(summaryDbPath)) {
    try {
      const db = new DatabaseSync(summaryDbPath, { readOnly: true });
      const rows = db.prepare(`
        SELECT conversation_id, title, preview, step_count, last_modified_time
        FROM conversation_summaries
        ORDER BY last_modified_time DESC
        LIMIT 50
      `).all();

      for (const r of rows) {
        results.push({
          conversationId: r.conversation_id,
          title: r.title || 'Untitled Conversation',
          preview: r.preview || '',
          stepCount: r.step_count || 0,
          lastModified: r.last_modified_time || ''
        });
      }
      return results;
    } catch (err) {
      console.warn('Failed to query conversation_summaries.db:', err.message);
    }
  }

  // Fallback: list db files in conversations folder
  const convDir = join(appDataDir, 'conversations');
  if (existsSync(convDir)) {
    try {
      const files = readdirSync(convDir);
      for (const file of files) {
        if (file.endsWith('.db') && !file.includes('-shm') && !file.includes('-wal')) {
          const id = file.replace(/\.db$/, '');
          results.push({
            conversationId: id,
            title: `Session ${id.slice(0, 8)}`,
            preview: '',
            stepCount: 0,
            lastModified: ''
          });
        }
      }
    } catch {
      // Ignore
    }
  }

  return results;
}

/**
 * Parse transcript.jsonl and compute context window stats.
 * @param {string} conversationId
 * @param {string} [customModelId]
 * @param {number} [customLimit]
 * @returns {object|null}
 */
export function parseConversationStats(conversationId, customModelId = null, customLimit = null) {
  if (!conversationId) return null;
  const { transcriptPath } = getConversationPaths(conversationId);
  if (!existsSync(transcriptPath)) {
    return {
      conversationId,
      error: 'Transcript not found for this conversation',
      notFound: true
    };
  }

  let content;
  try {
    content = readFileSync(transcriptPath, 'utf8');
  } catch (err) {
    return {
      conversationId,
      error: `Could not read transcript: ${err.message}`
    };
  }

  const lines = content.trim().split('\n');
  const modelSteps = [];
  const toolUsageMap = {};
  let totalAllSteps = 0;
  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    totalAllSteps++;

    let step;
    try {
      step = JSON.parse(line);
    } catch {
      continue;
    }

    // Collect tools
    if (step.tool_calls && Array.isArray(step.tool_calls)) {
      for (const tc of step.tool_calls) {
        const name = tc.name || 'unknown_tool';
        toolUsageMap[name] = (toolUsageMap[name] || 0) + 1;
      }
    }

    if (
      step.input_tokens !== undefined ||
      step.cache_read_tokens !== undefined ||
      step.output_tokens !== undefined
    ) {
      const inp = step.input_tokens || 0;
      const cache = step.cache_read_tokens || 0;
      const out = step.output_tokens || 0;
      const currentContext = inp + cache;

      totalInputTokens += inp;
      totalCacheReadTokens += cache;
      totalOutputTokens += out;

      const tools = (step.tool_calls || []).map((t) => t.name || '');

      modelSteps.push({
        stepIndex: step.step_index ?? i,
        createdAt: step.created_at || new Date().toISOString(),
        inputTokens: inp,
        cacheReadTokens: cache,
        outputTokens: out,
        currentContext,
        tools
      });
    }
  }

  // Model identification & limits
  const detectedModelId = customModelId || detectModelForConversation(conversationId);
  const modelSpec = MODEL_SPECS[detectedModelId] || MODEL_SPECS[DEFAULT_MODEL_ID];
  const contextLimit = customLimit && customLimit > 0 ? customLimit : modelSpec.contextLimit;

  // Latest model step
  const latestStep = modelSteps.length > 0 ? modelSteps[modelSteps.length - 1] : null;
  const currentContextTokens = latestStep ? latestStep.currentContext : 0;
  const currentInputTokens = latestStep ? latestStep.inputTokens : 0;
  const currentCacheReadTokens = latestStep ? latestStep.cacheReadTokens : 0;
  const currentOutputTokens = latestStep ? latestStep.outputTokens : 0;

  const cacheHitRate = currentContextTokens > 0
    ? +((currentCacheReadTokens / currentContextTokens) * 100).toFixed(1)
    : 0;

  const percentUsed = contextLimit > 0
    ? +((currentContextTokens / contextLimit) * 100).toFixed(2)
    : 0;

  const headroomTokens = Math.max(0, contextLimit - currentContextTokens);

  // Calculate culprits (steps with largest positive delta in context)
  const stepDeltas = [];
  for (let j = 0; j < modelSteps.length; j++) {
    const cur = modelSteps[j];
    const prevContext = j > 0 ? modelSteps[j - 1].currentContext : 0;
    const delta = cur.currentContext - prevContext;
    stepDeltas.push({
      stepIndex: cur.stepIndex,
      createdAt: cur.createdAt,
      deltaTokens: delta,
      currentContext: cur.currentContext,
      inputTokens: cur.inputTokens,
      cacheTokens: cur.cacheReadTokens,
      outputTokens: cur.outputTokens,
      tools: cur.tools
    });
  }

  // Top 5 heaviest context additions
  const culprits = [...stepDeltas]
    .sort((a, b) => b.deltaTokens - a.deltaTokens)
    .slice(0, 5)
    .filter((c) => c.deltaTokens > 0);

  // Health diagnosis
  const health = evaluateContextHealth(currentContextTokens, contextLimit, cacheHitRate);

  // Sample trajectory for charts (if steps are many, keep max 100 points evenly spaced)
  const trajectory = sampleTrajectory(modelSteps, 80);

  return {
    conversationId,
    timestamp: new Date().toISOString(),
    model: {
      id: detectedModelId,
      name: modelSpec.name,
      contextLimit,
      family: modelSpec.family,
      description: modelSpec.description
    },
    current: {
      contextTokens: currentContextTokens,
      inputTokens: currentInputTokens,
      cacheReadTokens: currentCacheReadTokens,
      outputTokens: currentOutputTokens,
      cacheHitRate,
      percentUsed,
      headroomTokens,
      latestStepIndex: latestStep ? latestStep.stepIndex : 0,
      updatedAt: latestStep ? latestStep.createdAt : new Date().toISOString()
    },
    cumulative: {
      totalInputTokens,
      totalCacheReadTokens,
      totalOutputTokens,
      totalLifetimeTokens: totalInputTokens + totalCacheReadTokens + totalOutputTokens,
      totalModelSteps: modelSteps.length,
      totalAllSteps
    },
    trajectory,
    culprits,
    health,
    toolUsage: toolUsageMap
  };
}

/**
 * Reduce trajectory point count while keeping key inflection points and latest step.
 * @param {Array} steps
 * @param {number} maxPoints
 * @returns {Array}
 */
function sampleTrajectory(steps, maxPoints = 80) {
  if (steps.length <= maxPoints) return steps;
  const sampled = [];
  const stepSize = (steps.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints - 1; i++) {
    const idx = Math.round(i * stepSize);
    sampled.push(steps[idx]);
  }
  // Ensure the latest step is always included
  sampled.push(steps[steps.length - 1]);
  return sampled;
}
