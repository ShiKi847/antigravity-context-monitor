/**
 * @fileoverview Real-time file watcher and event broadcaster for live conversation updates.
 */

import { EventEmitter } from 'node:events';
import { existsSync, watch } from 'node:fs';
import { getConversationPaths, parseConversationStats } from './parser.mjs';

export class ConversationMonitor extends EventEmitter {
  /**
   * @param {string} conversationId
   * @param {object} [options]
   * @param {number} [options.debounceMs=150]
   * @param {string} [options.modelId]
   * @param {number} [options.customLimit]
   */
  constructor(conversationId, options = {}) {
    super();
    this.conversationId = conversationId;
    this.debounceMs = options.debounceMs ?? 150;
    this.modelId = options.modelId || null;
    this.customLimit = options.customLimit || null;

    this._fsWatcher = null;
    this._debounceTimer = null;
    this._lastStats = null;
    this._running = false;
  }

  /**
   * Start watching the conversation transcript file.
   */
  start() {
    if (this._running) return;
    this._running = true;

    // Send initial snapshot
    this._lastStats = parseConversationStats(this.conversationId, this.modelId, this.customLimit);
    this.emit('stats', this._lastStats);

    const { transcriptPath, brainDir } = getConversationPaths(this.conversationId);

    // Watch transcript if exists, otherwise watch brainDir until transcript appears
    const targetPath = existsSync(transcriptPath) ? transcriptPath : (existsSync(brainDir) ? brainDir : null);

    if (targetPath) {
      try {
        this._fsWatcher = watch(targetPath, { persistent: false }, () => {
          this._scheduleUpdate();
        });

        this._fsWatcher.on('error', (err) => {
          this.emit('error', err);
        });
      } catch (err) {
        console.warn('Could not watch path:', targetPath, err.message);
      }
    }
  }

  /**
   * Set model preset or custom limit and recalculate stats.
   * @param {string|null} modelId
   * @param {number|null} customLimit
   */
  updateConfig(modelId, customLimit) {
    this.modelId = modelId;
    this.customLimit = customLimit;
    this._lastStats = parseConversationStats(this.conversationId, this.modelId, this.customLimit);
    this.emit('stats', this._lastStats);
  }

  /**
   * Switch the active conversation being monitored.
   * @param {string} newConversationId
   */
  switchConversation(newConversationId) {
    if (this.conversationId === newConversationId) return;
    this.stop();
    this.conversationId = newConversationId;
    this.start();
  }

  _scheduleUpdate() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      try {
        const stats = parseConversationStats(this.conversationId, this.modelId, this.customLimit);
        this._lastStats = stats;
        this.emit('stats', stats);
      } catch (err) {
        this.emit('error', err);
      }
    }, this.debounceMs);
  }

  /**
   * Get latest cached stats.
   * @returns {object|null}
   */
  getLatestStats() {
    if (!this._lastStats) {
      this._lastStats = parseConversationStats(this.conversationId, this.modelId, this.customLimit);
    }
    return this._lastStats;
  }

  /**
   * Stop watching.
   */
  stop() {
    this._running = false;
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._fsWatcher) {
      try {
        this._fsWatcher.close();
      } catch {}
      this._fsWatcher = null;
    }
  }
}
