/**
 * @fileoverview Frontend application logic for Antigravity Context Monitor.
 * Handles real-time polling, SVG gauge rendering, trajectory charting, and interaction.
 */

const sidecar = window.sidecar;
const $ = (id) => document.getElementById(id);

// State
let currentConvId = null;
let currentStats = null;
let activeRange = 'all'; // 'all' | '30' | '15'
let refreshTimer = null;
let appSettings = {
  autoRefresh: true,
  refreshIntervalMs: 2000,
  modelId: null,
  customLimit: null,
  alertEnabled: false
};

// ---------------------------------------------------------------------------
// Helpers & Formatters
// ---------------------------------------------------------------------------

function formatTokens(tokens) {
  if (typeof tokens !== 'number' || isNaN(tokens)) return '0';
  if (tokens >= 1000000) {
    const val = tokens / 1000000;
    return val >= 10 ? `${val.toFixed(1)}M` : `${val.toFixed(2)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}

function showToast(message, isError = false) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.style.backgroundColor = isError ? 'var(--color-critical, #d93025)' : '#1f1f1f';
  el.hidden = false;
  el.style.opacity = '1';
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.hidden = true; }, 200);
  }, 2500);
}

// ---------------------------------------------------------------------------
// API Communication
// ---------------------------------------------------------------------------

async function apiFetch(path, options = {}) {
  if (sidecar && typeof sidecar.fetch === 'function') {
    const res = await sidecar.fetch(path, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  }
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Conversation & Stats Loading
// ---------------------------------------------------------------------------

async function loadConversations() {
  try {
    const convs = await apiFetch('/api/conversations');
    const select = $('conv-select');
    select.innerHTML = '';

    if (!Array.isArray(convs) || convs.length === 0) {
      select.innerHTML = '<option value="">无可用会话</option>';
      return;
    }

    // Determine initial conversation ID:
    // 1) From window.sidecar.conversationId
    // 2) From current select
    // 3) First conversation in list
    const hostConvId = sidecar?.conversationId;
    if (hostConvId && convs.some((c) => c.conversationId === hostConvId)) {
      currentConvId = hostConvId;
    } else if (!currentConvId || !convs.some((c) => c.conversationId === currentConvId)) {
      currentConvId = convs[0].conversationId;
    }

    for (const c of convs) {
      const opt = document.createElement('option');
      opt.value = c.conversationId;
      const title = c.title ? c.title.slice(0, 36) : `会话 ${c.conversationId.slice(0, 8)}`;
      opt.textContent = `${title} (${c.stepCount}步)`;
      if (c.conversationId === currentConvId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
  } catch (err) {
    console.error('Failed to load conversations:', err);
  }
}

async function fetchStats() {
  if (!currentConvId) return;
  const indicator = $('live-indicator');

  try {
    const params = new URLSearchParams({ conversationId: currentConvId });
    if (appSettings.modelId) params.append('modelId', appSettings.modelId);
    if (appSettings.customLimit) params.append('limit', String(appSettings.customLimit));

    const stats = await apiFetch(`/api/stats?${params.toString()}`);
    if (stats.error) {
      console.warn('Stats warning:', stats.error);
      return;
    }

    currentStats = stats;
    renderAll(stats);

    if (indicator) {
      indicator.style.opacity = '1';
    }
  } catch (err) {
    console.error('Fetch stats failed:', err);
    if (indicator) {
      indicator.style.opacity = '0.5';
    }
  }
}

// ---------------------------------------------------------------------------
// Render Methods
// ---------------------------------------------------------------------------

function renderAll(stats) {
  renderGauge(stats);
  renderMetrics(stats);
  renderTrajectoryChart(stats.trajectory, stats.model.contextLimit);
  renderCulprits(stats.culprits);
  renderAdvisor(stats);
}

/**
 * Render Hero Semi-Circle SVG Gauge
 */
function renderGauge(stats) {
  const currentTokens = stats.current.contextTokens;
  const limitTokens = stats.model.contextLimit;
  const ratio = Math.min(currentTokens / limitTokens, 1.0);
  const percent = stats.current.percentUsed;

  // Arc path length for M 30 140 A 80 80 0 1 1 190 140 is PI * 80 ~= 251.32
  const totalLength = 251.32;
  const offset = totalLength * (1 - ratio);

  const fill = $('gauge-fill');
  if (fill) {
    fill.style.strokeDashoffset = offset;

    // Dynamically change color
    if (percent >= 85) {
      fill.style.stroke = 'var(--color-critical, #d93025)';
    } else if (percent >= 65) {
      fill.style.stroke = 'var(--color-warning, #f29900)';
    } else {
      fill.style.stroke = 'var(--color-healthy, #188038)';
    }
  }

  $('gauge-percent').textContent = `${percent.toFixed(1)}%`;
  $('gauge-sub').textContent = `${formatTokens(currentTokens)} / ${formatTokens(limitTokens)}`;

  // Model Badge in header
  $('model-badge').textContent = `${stats.model.name} (${formatTokens(limitTokens)})`;

  // Health Chip
  const healthChip = $('health-chip');
  healthChip.className = `health-chip ${stats.health.level}`;
  $('health-chip-text').textContent = stats.health.level === 'healthy' ? '状态健康' : (stats.health.level === 'warning' ? '额度偏高' : '额度告急');

  // Headroom
  $('headroom-val').textContent = formatTokens(stats.current.headroomTokens);
}

/**
 * Render 4 Metric Cards
 */
function renderMetrics(stats) {
  // Current active context
  $('val-current-context').textContent = formatTokens(stats.current.contextTokens);
  $('hint-current-context').textContent = `Prompt ${formatTokens(stats.current.inputTokens)} + Cache ${formatTokens(stats.current.cacheReadTokens)}`;

  // Cache hit rate
  $('val-cache-rate').textContent = `${stats.current.cacheHitRate.toFixed(1)}%`;
  $('hint-cache-tokens').textContent = `已缓存: ${formatTokens(stats.current.cacheReadTokens)} tokens`;

  // Output tokens of latest turn
  $('val-turn-output').textContent = formatTokens(stats.current.outputTokens);
  $('hint-turn-output').textContent = `第 ${stats.current.latestStepIndex} 步模型生成`;

  // Cumulative tokens
  $('val-cumulative').textContent = formatTokens(stats.cumulative.totalLifetimeTokens);
  $('hint-cumulative').textContent = `共 ${stats.cumulative.totalModelSteps} 轮交互消耗`;
}

/**
 * Render Trajectory SVG Chart
 */
function renderTrajectoryChart(trajectory, contextLimit) {
  const svg = $('trajectory-chart');
  if (!svg || !Array.isArray(trajectory) || trajectory.length === 0) return;

  // Filter based on active range
  let points = [...trajectory];
  if (activeRange === '30' && points.length > 30) {
    points = points.slice(-30);
  } else if (activeRange === '15' && points.length > 15) {
    points = points.slice(-15);
  }

  const width = 500;
  const height = 180;
  const padding = { top: 20, right: 20, bottom: 25, left: 45 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Determine max value for Y-axis
  const maxContext = Math.max(...points.map((p) => p.currentContext), 1000);
  const yMax = Math.max(maxContext * 1.15, 10000);

  // Clear existing
  svg.innerHTML = '';

  // Defs for gradients
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <linearGradient id="cacheGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#00acc1" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#00acc1" stop-opacity="0.05"/>
    </linearGradient>
    <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a73e8" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#1a73e8" stop-opacity="0.0"/>
    </linearGradient>
  `;
  svg.appendChild(defs);

  // Horizontal Grid Lines & Y Labels
  const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const yTicks = [0, yMax * 0.5, yMax];
  for (const t of yTicks) {
    const y = padding.top + chartH - (t / yMax) * chartH;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padding.left);
    line.setAttribute('y1', y);
    line.setAttribute('x2', width - padding.right);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', 'var(--border-color)');
    line.setAttribute('stroke-dasharray', '3 3');
    gridGroup.appendChild(line);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', padding.left - 6);
    text.setAttribute('y', y + 3);
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('font-size', '9');
    text.setAttribute('fill', 'var(--text-muted)');
    text.textContent = formatTokens(t);
    gridGroup.appendChild(text);
  }
  svg.appendChild(gridGroup);

  // Calculate coordinates
  const coords = points.map((p, idx) => {
    const x = padding.left + (idx / Math.max(points.length - 1, 1)) * chartW;
    const yTotal = padding.top + chartH - (p.currentContext / yMax) * chartH;
    const yCache = padding.top + chartH - (p.cacheReadTokens / yMax) * chartH;
    return { x, yTotal, yCache, data: p };
  });

  // Total Context Area Path
  let areaTotalD = `M ${coords[0].x} ${padding.top + chartH}`;
  coords.forEach((c) => { areaTotalD += ` L ${c.x} ${c.yTotal}`; });
  areaTotalD += ` L ${coords[coords.length - 1].x} ${padding.top + chartH} Z`;

  const totalArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  totalArea.setAttribute('d', areaTotalD);
  totalArea.setAttribute('fill', 'url(#totalGrad)');
  svg.appendChild(totalArea);

  // Cache Area Path
  let areaCacheD = `M ${coords[0].x} ${padding.top + chartH}`;
  coords.forEach((c) => { areaCacheD += ` L ${c.x} ${c.yCache}`; });
  areaCacheD += ` L ${coords[coords.length - 1].x} ${padding.top + chartH} Z`;

  const cacheArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  cacheArea.setAttribute('d', areaCacheD);
  cacheArea.setAttribute('fill', 'url(#cacheGrad)');
  svg.appendChild(cacheArea);

  // Total Line
  let lineTotalD = `M ${coords[0].x} ${coords[0].yTotal}`;
  coords.forEach((c) => { lineTotalD += ` L ${c.x} ${c.yTotal}`; });

  const totalLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  totalLine.setAttribute('d', lineTotalD);
  totalLine.setAttribute('fill', 'none');
  totalLine.setAttribute('stroke', '#1a73e8');
  totalLine.setAttribute('stroke-width', '2.5');
  totalLine.setAttribute('stroke-linecap', 'round');
  svg.appendChild(totalLine);

  // Cache Line
  let lineCacheD = `M ${coords[0].x} ${coords[0].yCache}`;
  coords.forEach((c) => { lineCacheD += ` L ${c.x} ${c.yCache}`; });

  const cacheLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  cacheLine.setAttribute('d', lineCacheD);
  cacheLine.setAttribute('fill', 'none');
  cacheLine.setAttribute('stroke', '#00acc1');
  cacheLine.setAttribute('stroke-width', '1.5');
  svg.appendChild(cacheLine);

  // Interactive Hover circles
  const tooltip = $('chart-tooltip');
  coords.forEach((c) => {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', c.x);
    dot.setAttribute('cy', c.yTotal);
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', '#1a73e8');
    dot.setAttribute('stroke', '#ffffff');
    dot.setAttribute('stroke-width', '1');
    dot.style.cursor = 'pointer';

    dot.addEventListener('mouseenter', () => {
      dot.setAttribute('r', '5');
      if (tooltip) {
        const d = c.data;
        const toolStr = d.tools && d.tools.length > 0 ? `<br>工具: ${d.tools.join(', ')}` : '';
        tooltip.innerHTML = `
          <strong>步骤 #${d.stepIndex}</strong><br>
          总上下文: ${formatTokens(d.currentContext)} (${d.currentContext.toLocaleString()})<br>
          缓存命中: ${formatTokens(d.cacheReadTokens)}<br>
          新输入: ${formatTokens(d.inputTokens)}<br>
          本步输出: ${formatTokens(d.outputTokens)}${toolStr}
        `;
        tooltip.hidden = false;
      }
    });

    dot.addEventListener('mouseleave', () => {
      dot.setAttribute('r', '3');
      if (tooltip) tooltip.hidden = true;
    });

    svg.appendChild(dot);
  });
}

/**
 * Render Top 5 Token Culprits
 */
function renderCulprits(culprits) {
  const container = $('culprits-list');
  if (!container) return;
  container.innerHTML = '';

  if (!Array.isArray(culprits) || culprits.length === 0) {
    container.innerHTML = '<div class="empty-state">会话初期暂无显著的大额上下文激增。</div>';
    return;
  }

  for (const c of culprits) {
    const row = document.createElement('div');
    row.className = 'culprit-row';

    const toolNames = c.tools && c.tools.length > 0 ? c.tools.join(', ') : '模型对话推理';

    row.innerHTML = `
      <div class="culprit-left">
        <span class="culprit-step-tag">Step #${c.stepIndex}</span>
        <span class="culprit-tools" title="${toolNames}">${toolNames}</span>
      </div>
      <div class="culprit-right">
        <span class="culprit-delta">+${formatTokens(c.deltaTokens)}</span>
        <span class="culprit-total">当前: ${formatTokens(c.currentContext)}</span>
      </div>
    `;

    container.appendChild(row);
  }
}

/**
 * Render Advisor & Action Recommendations
 */
function renderAdvisor(stats) {
  const titleEl = $('advisor-title');
  const bodyEl = $('advisor-body');
  if (!titleEl || !bodyEl) return;

  titleEl.textContent = stats.health.title;
  bodyEl.textContent = stats.health.message;

  // Visual alert for critical
  if (appSettings.alertEnabled && stats.health.level === 'critical') {
    showToast('⚠️ 警告：当前会话上下文已超 85% 上限！', true);
  }
}

// ---------------------------------------------------------------------------
// Actions & Settings
// ---------------------------------------------------------------------------

async function startNewConversation() {
  if (sidecar && sidecar.agent && typeof sidecar.agent.startConversation === 'function') {
    try {
      await sidecar.agent.startConversation('开启全新阶段任务');
      showToast('已请求 Antigravity 开启新对话');
      setTimeout(loadConversations, 1500);
    } catch (err) {
      showToast(`开启失败: ${err.message}`, true);
    }
  } else {
    alert('请在 Antigravity 界面内点击左上角新建对话以重置上下文。');
  }
}

function copyReport() {
  if (!currentStats) return;
  const s = currentStats;
  const report = [
    `# Antigravity 上下文额度报告`,
    `- 会话 ID: ${s.conversationId}`,
    `- 选用模型: ${s.model.name} (上限: ${formatTokens(s.model.contextLimit)} tokens)`,
    `- 当前上下文占用: ${formatTokens(s.current.contextTokens)} (${s.current.percentUsed}%)`,
    `- 剩余安全余量: ${formatTokens(s.current.headroomTokens)} tokens`,
    `- 缓存命中率: ${s.current.cacheHitRate}% (已缓存: ${formatTokens(s.current.cacheReadTokens)})`,
    `- 最新步输出: ${formatTokens(s.current.outputTokens)} tokens`,
    `- 累计总处理: ${formatTokens(s.cumulative.totalLifetimeTokens)} tokens (${s.cumulative.totalModelSteps} 轮交互)`,
    `- 评估结论: ${s.health.title} - ${s.health.message}`,
    `- 导出时间: ${new Date().toLocaleString()}`
  ].join('\n');

  navigator.clipboard.writeText(report).then(() => {
    showToast('额度报告已成功复制到剪贴板！');
  }).catch(() => {
    showToast('复制失败，请手动选择复制', true);
  });
}

function stepCustomLimit(direction) {
  const input = $('setting-custom-limit');
  if (!input) return;
  const currentVal = Number(input.value) || 500000;
  const step = 50000;
  const nextVal = Math.max(10000, Math.min(10000000, currentVal + direction * step));
  input.value = nextVal;
  updateChipHighlight();
}

function updateChipHighlight() {
  const input = $('setting-custom-limit');
  const currentVal = input ? Number(input.value) : 0;
  document.querySelectorAll('.preset-chip').forEach((chip) => {
    const val = Number(chip.getAttribute('data-tokens'));
    chip.classList.toggle('active', val === currentVal);
  });
}

function openSettingsModal() {
  const modal = $('settings-modal');
  if (!modal) return;

  const currentModel = appSettings.modelId || currentStats?.model?.id || 'gemini-3.8-flash';
  $('setting-model-select').value = currentModel;
  $('setting-custom-limit').value = appSettings.customLimit || (currentModel === 'custom' ? (currentStats?.model?.contextLimit || 500000) : '');
  const isCustom = currentModel === 'custom';
  const groupCustom = $('group-custom-limit');
  if (groupCustom) {
    groupCustom.hidden = !isCustom;
    groupCustom.style.display = isCustom ? 'flex' : 'none';
  }

  $('setting-interval').value = appSettings.refreshIntervalMs || 2000;
  $('interval-display').textContent = `${(appSettings.refreshIntervalMs / 1000).toFixed(1)}s`;
  $('setting-autorefresh').checked = appSettings.autoRefresh;
  $('setting-alert').checked = appSettings.alertEnabled;

  modal.hidden = false;
  modal.style.display = 'flex';
  updateChipHighlight();
}

function closeSettingsModal() {
  const modal = $('settings-modal');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
}

async function saveSettingsFromModal() {
  const modelSelect = $('setting-model-select').value;
  const customLimit = $('setting-custom-limit').value ? Number($('setting-custom-limit').value) : null;
  const interval = Number($('setting-interval').value);
  const autoRefresh = $('setting-autorefresh').checked;
  const alertEnabled = $('setting-alert').checked;

  appSettings.modelId = modelSelect;
  appSettings.customLimit = modelSelect === 'custom' ? customLimit : null;
  appSettings.refreshIntervalMs = interval;
  appSettings.autoRefresh = autoRefresh;
  appSettings.alertEnabled = alertEnabled;

  // Immediately close modal
  closeSettingsModal();

  try {
    await apiFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify(appSettings)
    });
    showToast('设置已保存');
  } catch (err) {
    console.warn('Persist settings error:', err);
    showToast('设置已生效');
  }

  restartPolling();
  fetchStats();
}

function restartPolling() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (appSettings.autoRefresh) {
    refreshTimer = setInterval(fetchStats, appSettings.refreshIntervalMs || 2000);
  }
}

// ---------------------------------------------------------------------------
// Context Compaction Logic
// ---------------------------------------------------------------------------

function openCompactModal() {
  const modal = $('compact-modal');
  if (!modal) return;
  modal.hidden = false;
  modal.style.display = 'flex';
}

function closeCompactModal() {
  const modal = $('compact-modal');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
}

async function executeContextCompaction() {
  const selected = document.querySelector('input[name="compact-strategy"]:checked');
  const strategy = selected ? selected.value : 'in-place';

  closeCompactModal();

  if (strategy === 'in-place') {
    const compactPrompt = `【系统指令：手动压缩上下文】
请对当前对话的历史上下文进行深度总结与压缩，提炼以下关键信息：
1. 核心目标与已完成的关键进展
2. 关键架构设计与重要技术决策
3. 修改的文件清单与当前代码状态
4. 待解决事项与下一步规划
请精炼总结，去除历史长输出与冗余推理过程，以释放活跃上下文空间。`;

    if (sidecar && sidecar.agent && typeof sidecar.agent.sendMessage === 'function') {
      try {
        await sidecar.agent.sendMessage(compactPrompt, currentConvId || sidecar.conversationId);
        showToast('已向 Agent 发送深度压缩指令，正在精简历史记忆...');
      } catch (err) {
        showToast(`发送压缩指令失败: ${err.message}`, true);
      }
    } else {
      navigator.clipboard.writeText(compactPrompt).then(() => {
        showToast('已复制压缩指令到剪贴板，可粘贴至 Antigravity 对话框执行！');
      }).catch(() => {
        alert(compactPrompt);
      });
    }
  } else {
    // fork-new
    const initialPrompt = `继续推进项目任务。请参考前期阶段成果，在干净上下文中执行后续任务。`;
    if (sidecar && sidecar.agent && typeof sidecar.agent.startConversation === 'function') {
      try {
        await sidecar.agent.startConversation(initialPrompt, '新阶段任务');
        showToast('已开启全新干净会话！');
        setTimeout(loadConversations, 1500);
      } catch (err) {
        showToast(`开启新会话失败: ${err.message}`, true);
      }
    } else {
      alert('请在 Antigravity 界面新建对话以彻底重置上下文。');
    }
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function init() {
  // Load persisted settings
  try {
    const saved = await apiFetch('/api/settings');
    if (saved && typeof saved === 'object') {
      appSettings = { ...appSettings, ...saved };
    }
  } catch {}

  // Event Listeners
  $('conv-select').addEventListener('change', (e) => {
    currentConvId = e.target.value;
    fetchStats();
  });

  // Chart range tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeRange = btn.getAttribute('data-range');
      if (currentStats) {
        renderTrajectoryChart(currentStats.trajectory, currentStats.model.contextLimit);
      }
    });
  });

  // Action buttons
  $('btn-compact-context').addEventListener('click', openCompactModal);
  $('btn-new-conv').addEventListener('click', startNewConversation);
  $('btn-copy-report').addEventListener('click', copyReport);
  $('btn-force-refresh').addEventListener('click', fetchStats);

  // Compact Modal controls
  $('compact-modal-close').addEventListener('click', closeCompactModal);
  $('compact-modal-cancel').addEventListener('click', closeCompactModal);
  $('compact-modal-submit').addEventListener('click', executeContextCompaction);

  const compactModal = $('compact-modal');
  if (compactModal) {
    compactModal.addEventListener('click', (e) => {
      if (e.target === compactModal) closeCompactModal();
    });
  }

  // Radio card select styling
  document.querySelectorAll('.compact-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.compact-option').forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      const radio = opt.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });

  // Settings Modal controls
  $('btn-settings').addEventListener('click', openSettingsModal);
  $('modal-close').addEventListener('click', closeSettingsModal);
  $('modal-cancel').addEventListener('click', closeSettingsModal);
  $('modal-save').addEventListener('click', saveSettingsFromModal);

  // Backdrop click to dismiss settings modal
  const modal = $('settings-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSettingsModal();
    });
  }

  // Escape key to dismiss modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettingsModal();
      closeCompactModal();
    }
  });

  // Model select change
  $('setting-model-select').addEventListener('change', (e) => {
    const isCustom = e.target.value === 'custom';
    const groupCustom = $('group-custom-limit');
    if (groupCustom) {
      groupCustom.hidden = !isCustom;
      groupCustom.style.display = isCustom ? 'flex' : 'none';
    }
    if (isCustom && !$('setting-custom-limit').value) {
      $('setting-custom-limit').value = 500000;
    }
    updateChipHighlight();
  });

  // Stepper controls
  const btnDown = $('btn-step-down');
  const btnUp = $('btn-step-up');
  if (btnDown) btnDown.addEventListener('click', () => stepCustomLimit(-1));
  if (btnUp) btnUp.addEventListener('click', () => stepCustomLimit(1));

  // Custom limit input & chips
  const customInput = $('setting-custom-limit');
  if (customInput) {
    customInput.addEventListener('input', updateChipHighlight);
  }

  document.querySelectorAll('.preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const val = chip.getAttribute('data-tokens');
      if (customInput && val) {
        customInput.value = val;
        updateChipHighlight();
      }
    });
  });

  $('setting-interval').addEventListener('input', (e) => {
    $('interval-display').textContent = `${(Number(e.target.value) / 1000).toFixed(1)}s`;
  });

  // Initial load
  await loadConversations();
  await fetchStats();
  restartPolling();
}

init();
