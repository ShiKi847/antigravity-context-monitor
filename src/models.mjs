/**
 * @fileoverview Model specifications, context window limits and advisory rules.
 */

export const MODEL_SPECS = {
  // Official Antigravity current lineup
  'gemini-3.8-flash': {
    name: 'Gemini 3.8 Flash',
    contextLimit: 1048576, // 1M tokens
    maxOutputTokens: 65536,
    family: 'gemini',
    tag: '默认',
    description: 'Antigravity 当前主力高速 1M 上下文模型'
  },
  'gemini-3.8-flash-n': {
    name: 'Gemini 3.8 Flash',
    contextLimit: 1048576,
    maxOutputTokens: 65536,
    family: 'gemini',
    tag: '默认',
    description: 'Antigravity 当前主力高速 1M 上下文模型'
  },
  'gemini-3.7-flash': {
    name: 'Gemini 3.7 Flash',
    contextLimit: 1048576,
    maxOutputTokens: 65536,
    family: 'gemini',
    tag: '即将停用',
    description: '上一代 1M 上下文多模态推理模型 (Leaving Soon)'
  },
  'gemini-3.6-flash': {
    name: 'Gemini 3.6 Flash',
    contextLimit: 1048576,
    maxOutputTokens: 65536,
    family: 'gemini',
    tag: '即将停用',
    description: '上一代 1M 上下文工作模型 (Leaving Soon)'
  },
  'gemini-3.1-pro': {
    name: 'Gemini 3.1 Pro',
    contextLimit: 2097152, // 2M tokens
    maxOutputTokens: 65536,
    family: 'gemini',
    tag: '即将停用',
    description: '旗舰级 2M 超长上下文深度推理模型 (Leaving Soon)'
  },
  'claude-opus-5.5': {
    name: 'Claude Opus 5.5',
    contextLimit: 1048576, // 1M tokens
    maxOutputTokens: 128000,
    family: 'claude',
    tag: '新建',
    description: 'Anthropic 最新顶级旗舰 1M 超大上下文推理编程模型'
  },
  'claude-sonnet-5.5': {
    name: 'Claude Sonnet 5.5',
    contextLimit: 1048576, // 1M tokens
    maxOutputTokens: 64000,
    family: 'claude',
    tag: '新建',
    description: 'Anthropic 最新均衡高性价比 1M 上下文编程模型'
  },
  'gpt-oss-120b': {
    name: 'GPT-OSS 120B (Medium)',
    contextLimit: 128000, // 128k tokens
    maxOutputTokens: 16384,
    family: 'openai',
    tag: 'Notice',
    description: '开放权重 120B 参数级大模型'
  },

  // Legacy / Fallback Aliases
  'gemini-2.0-flash': {
    name: 'Gemini 2.0 Flash',
    contextLimit: 1048576,
    maxOutputTokens: 8192,
    family: 'gemini',
    description: 'Legacy 1M context model'
  },
  'gemini-1.5-flash': {
    name: 'Gemini 1.5 Flash',
    contextLimit: 1048576,
    maxOutputTokens: 8192,
    family: 'gemini',
    description: 'Legacy 1M context model'
  },
  'gemini-1.5-pro': {
    name: 'Gemini 1.5 Pro',
    contextLimit: 2097152,
    maxOutputTokens: 8192,
    family: 'gemini',
    description: 'Legacy 2M context flagship model'
  },
  'gemini-2.0-pro': {
    name: 'Gemini 2.0 Pro',
    contextLimit: 2097152,
    maxOutputTokens: 8192,
    family: 'gemini',
    description: 'Legacy 2M context model'
  },
  'claude-3-7-sonnet': {
    name: 'Claude 3.7 Sonnet',
    contextLimit: 200000,
    maxOutputTokens: 64000,
    family: 'claude',
    description: 'Legacy Claude model'
  },
  'claude-3-5-sonnet': {
    name: 'Claude 3.5 Sonnet',
    contextLimit: 200000,
    maxOutputTokens: 8192,
    family: 'claude',
    description: 'Legacy Claude model'
  },
  'gpt-4o': {
    name: 'GPT-4o',
    contextLimit: 128000,
    maxOutputTokens: 16384,
    family: 'openai',
    description: 'Legacy GPT-4o model'
  },
  'custom': {
    name: '自定义额度 (Custom Limit)',
    contextLimit: 1048576,
    maxOutputTokens: 65536,
    family: 'custom',
    description: 'User-specified context window limit'
  }
};

export const DEFAULT_MODEL_ID = 'gemini-3.8-flash';

/**
 * Format token count with human-readable suffix (e.g. 1.2k, 1.05M).
 * @param {number} tokens
 * @param {number} precision
 * @returns {string}
 */
export function formatTokens(tokens, precision = 1) {
  if (typeof tokens !== 'number' || isNaN(tokens)) return '0';
  if (tokens >= 1000000) {
    const val = tokens / 1000000;
    return val >= 10 ? `${val.toFixed(precision)}M` : `${val.toFixed(2)}M`;
  }
  if (tokens >= 1000) {
    const val = tokens / 1000;
    return `${val.toFixed(precision)}k`;
  }
  return tokens.toLocaleString();
}

/**
 * Evaluate health level and recommendations based on current context usage.
 * @param {number} currentContextTokens
 * @param {number} limitTokens
 * @param {number} cacheHitRate
 * @returns {{ level: 'healthy'|'warning'|'critical', percent: number, title: string, message: string }}
 */
export function evaluateContextHealth(currentContextTokens, limitTokens, cacheHitRate = 0) {
  const safeLimit = limitTokens > 0 ? limitTokens : 1048576;
  const ratio = Math.min(currentContextTokens / safeLimit, 1.0);
  const percent = +(ratio * 100).toFixed(1);

  if (percent >= 85) {
    return {
      level: 'critical',
      percent,
      title: '上下文额度告急 (Critical)',
      message: `已占用 ${percent}% (${formatTokens(currentContextTokens)} / ${formatTokens(safeLimit)})。模型可能会截断记忆或丢失早期上下文，强烈建议开启新对话。`
    };
  }

  if (percent >= 65 || currentContextTokens >= 250000) {
    return {
      level: 'warning',
      percent,
      title: '上下文偏高 (Attention)',
      message: `当前上下文已达 ${formatTokens(currentContextTokens)} (${percent}%)。建议总结当前阶段任务成果，或将新任务迁移至独立对话。`
    };
  }

  const cacheNote = cacheHitRate >= 80
    ? `缓存命中率高达 ${cacheHitRate.toFixed(1)}%，请求加速且消耗极优。`
    : '额度充裕，上下文交互流畅。';

  return {
    level: 'healthy',
    percent,
    title: '上下文状态极佳 (Healthy)',
    message: `当前已使用 ${percent}% (${formatTokens(currentContextTokens)} / ${formatTokens(safeLimit)})。${cacheNote}`
  };
}
