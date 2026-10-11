# Antigravity Context Monitor (上下文额度实时监视器)

> **达到谷歌第一方品质的 Antigravity 上下文额度与 Token 消耗实时监控系统**  
> 兼具 **Antigravity 原生辅助面板 (UI Extension / Auxiliary Pane)** 与 **独立 Web 仪表盘** 双运行模式，高精度呈现活跃窗口占用率、缓存命中率、交互历史增长轨迹及大文件消耗排行。

---

## 🌟 核心特性 (Features)

### 1. 谷歌 Material Design 3 视觉系统
- **动态无缝双主题适配**：完全继承 Antigravity 原生 CSS 变量（`--background`, `--card`, `--foreground`, `--primary`, `--border` 等），无论明亮或深色主题均完美契合。
- **高精度半圆仪表盘 (Semi-Circle Gauge)**：采用流畅 SVG 动态弧线与颜色自适应进阶（健康绿 `<65%` → 预警橙 `65%~85%` → 临界红 `>85%`），直观呈现实时百分比、已用/上限比例与剩余安全余量。
- **动态脉冲状态灯 (LIVE Indicator)**：呼吸式微动效，实时反映与 Antigravity 会话日志的毫秒级同步状态。

### 2. 全方位 Token 构成与指标卡片
- ⚡ **当前活跃上下文 (Current Context)**：精确计算最新一轮送入模型的总 Prompt 上下文（`input_tokens + cache_read_tokens`）。
- 🎯 **上下文缓存命中率 (Cache Hit Rate)**：实时呈现 Google Gemini 缓存命中百分比与已缓存 Token 数，量化延迟与开销节省。
- ✍️ **单轮生成输出 (Output Tokens)**：最新一轮回复所产生的 Token 数量及步数标记。
- 📊 **会话全生命周期累计 (Cumulative Lifetime Tokens)**：统计该对话历经的所有交互轮次总吞吐量。

### 3. 上下文增长轨迹与速率曲线 (Trajectory Area Chart)
- **多层渐变堆叠面积图**：清晰解构每一轮交互中「缓存基底（Cyan）」与「新输入 Prompt（Blue）」的增长演进。
- **多维度时间跨度切换**：支持「全部历史」、「近 30 步」、「近 15 步」视图切换。
- **高精度悬停交互十字准星**：鼠标悬停任意交互步即可查看详细指标（步骤编号、总上下文、新输入、缓存读取、输出及调用的工具名称）。

### 4. 消耗大户排行分析 (Token Culprits Inspector)
- 自动捕捉单步增量最大的前 5 个操作（例如大文件读取 `view_file`、长终端输出 `run_command` 等）。
- 标注步骤编号、操作工具标签与单步激增 Token 数，帮助开发者迅速定位“上下文膨胀”元凶。

### 5. 智能健康诊断与快捷操作 (AI Health Insights & Actions)
- **智能诊断建议**：根据剩余额度与消耗速率提供前瞻性建议。
- **一键开启新对话**：通过 `window.sidecar.agent.startConversation` 无缝重启干净上下文。
- **一键复制额度报告**：一键生成格式化 Markdown 报告并存入系统剪贴板。

### 6. 多会话随时切换与模型预设
- **多会话支持**：自动同步 Antigravity 当前会话，同时支持通过下拉菜单即时切换查看历史或并行会话。
- **多主流模型上限预设**：内置 Gemini 3.8 / 1.5 Flash (1M)、Gemini 1.5 / 2.0 Pro (2M)、Claude 3.5 / 3.7 Sonnet (200k)、GPT-4o (128k) 及自定义 Token 上限。

---

## 🏗️ 架构与双模式运行 (Architecture)

```
antigravity-context-monitor/
├── assets/
│   └── logo.svg                 # Google M3 风格应用徽标
├── plugin.json                  # Antigravity 插件配置清单
├── sidecars/
│   └── panel/                   # UI Extension 侧边栏面板服务
│       ├── sidecar.json         # 注册为 SIDECAR_UI_ENTRYPOINT_AUX_PANE
│       ├── package.json
│       ├── main.mjs             # 双模式自适应后端服务
│       ├── index.html           # M3 响应式界面
│       ├── app.js               # 前端实时逻辑与 SVG 渲染引擎
│       └── styles.css           # M3 动态主题与响应式样式
├── src/
│   ├── parser.mjs               # 核心解析引擎 (解析 transcript.jsonl / SQLite)
│   ├── monitor.mjs              # 实时文件感知与事件流
│   └── models.mjs               # 模型预设规格与健康评估算法
├── test/                        # 单元测试与端到端测试
│   ├── parser.test.mjs
│   └── monitor.test.mjs
├── scripts/
│   └── install-plugin.mjs       # 一键安装至 Antigravity 全局插件目录
├── server.mjs                   # 统一启动入口
└── package.json
```

---

## 🚀 使用指南 (Getting Started)

### 方式一：作为 Antigravity 内置右侧侧边栏面板（推荐）

1. **安装插件**：
   运行内置脚本，将插件复制到 Antigravity 全局插件目录：
   ```bash
   npm run install-plugin
   ```
   *(或直接执行 `node scripts/install-plugin.mjs`)*

2. **在 Antigravity 中启用**：
   - 打开 Antigravity 左侧边栏的 **Customizations (自定义)** 页面。
   - 切换到 **Installed (已安装)** 选项卡。
   - 找到 **`antigravity-context-monitor`** 并点击启用（侧边进程将自动启动）。

3. **打开面板**：
   - 进入任意对话，点击右上角 **⋮ (三点菜单)**。
   - 在 **Extensions** 菜单中选择 **Context Monitor**，即可在右侧辅助面板实时查看！
   - 或者点击对话中的快捷药丸链接：
     `[Context Monitor](sidecar://antigravity-context-monitor/panel/)`

---

### 方式二：作为独立 Web 仪表盘在浏览器中打开

无需打开侧边栏，直接在本地启动独立服务：
```bash
npm start
```
服务将在 `http://127.0.0.1:3847` 启动，浏览器打开即可在独立窗口或副屏中随时监控任意对话的实时额度。

---

## 🧪 自动化测试验证 (Testing)

本项目配备完整的单元测试，覆盖 Token 格式化、健康预警算法、会话解析器及实时监视器：

```bash
npm test
```

---

## 📌 版本管理提示 (Git)

本项目已初始化 Git 仓库。遵循用户需求，所有更改均**未自动 commit**，请由您在终端中检查并进行 commit：
```bash
git status
git add .
git commit -m "feat: complete Google-quality Antigravity Context Monitor"
```
