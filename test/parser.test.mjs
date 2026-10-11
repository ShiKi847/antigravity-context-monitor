/**
 * @fileoverview Unit tests for parser and models.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatTokens, evaluateContextHealth, MODEL_SPECS } from '../src/models.mjs';
import { parseConversationStats, listAllConversations } from '../src/parser.mjs';

describe('Models and Formatters', () => {
  it('formats token counts correctly', () => {
    assert.strictEqual(formatTokens(0), '0');
    assert.strictEqual(formatTokens(500), '500');
    assert.strictEqual(formatTokens(1500), '1.5k');
    assert.strictEqual(formatTokens(24800), '24.8k');
    assert.strictEqual(formatTokens(1048576), '1.05M');
    assert.strictEqual(formatTokens(2000000), '2.00M');
  });

  it('evaluates context health thresholds', () => {
    // Healthy
    const h1 = evaluateContextHealth(50000, 1000000, 90);
    assert.strictEqual(h1.level, 'healthy');
    assert.ok(h1.message.includes('90.0%'));

    // Warning
    const h2 = evaluateContextHealth(700000, 1000000, 50);
    assert.strictEqual(h2.level, 'warning');

    // Critical
    const h3 = evaluateContextHealth(900000, 1000000, 50);
    assert.strictEqual(h3.level, 'critical');
  });

  it('contains valid presets for major models', () => {
    assert.ok(MODEL_SPECS['gemini-3.8-flash'].contextLimit >= 1000000);
    assert.ok(MODEL_SPECS['gemini-3.1-pro'].contextLimit >= 2000000);
    assert.ok(MODEL_SPECS['claude-opus-5.5'].contextLimit >= 1000000);
    assert.ok(MODEL_SPECS['claude-sonnet-5.5'].contextLimit >= 1000000);
    assert.ok(MODEL_SPECS['gpt-oss-120b'].contextLimit === 128000);
  });
});

describe('Conversation Parser Engine', () => {
  it('can list all local conversations', () => {
    const list = listAllConversations();
    assert.ok(Array.isArray(list));
    assert.ok(list.length > 0, 'Should find at least 1 conversation');
    assert.ok(list[0].conversationId, 'Conversation has ID');
  });

  it('can parse stats for existing conversation', () => {
    const list = listAllConversations();
    const currentConv = list[0];
    const stats = parseConversationStats(currentConv.conversationId);

    assert.ok(stats);
    assert.strictEqual(stats.conversationId, currentConv.conversationId);
    assert.ok(stats.current.contextTokens > 0);
    assert.ok(stats.current.percentUsed >= 0);
    assert.ok(stats.cumulative.totalInputTokens > 0);
    assert.ok(Array.isArray(stats.trajectory));
    assert.ok(Array.isArray(stats.culprits));
    assert.ok(stats.health.level);
  });

  it('handles invalid conversation ID gracefully', () => {
    const res = parseConversationStats('non-existent-id-xyz');
    assert.ok(res.notFound || res.error);
  });
});
