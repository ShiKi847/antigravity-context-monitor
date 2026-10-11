/**
 * @fileoverview Tests for ConversationMonitor.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ConversationMonitor } from '../src/monitor.mjs';
import { listAllConversations } from '../src/parser.mjs';

describe('ConversationMonitor', () => {
  it('emits initial stats and supports config updates', (t, done) => {
    const list = listAllConversations();
    const conv = list[0];
    const monitor = new ConversationMonitor(conv.conversationId, { debounceMs: 50 });

    let emittedCount = 0;
    monitor.on('stats', (stats) => {
      emittedCount++;
      assert.ok(stats);
      assert.strictEqual(stats.conversationId, conv.conversationId);

      if (emittedCount === 1) {
        // Trigger config update
        monitor.updateConfig('gemini-1.5-pro', 2000000);
      } else if (emittedCount === 2) {
        assert.strictEqual(stats.model.contextLimit, 2000000);
        monitor.stop();
        done();
      }
    });

    monitor.start();
  });
});
