# dsh-token-dashboard

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的用量统计插件 —— 在**设置**里放一个 Codex 风格的 token 消耗面板。

[English](README.md) | 中文

![用量面板](docs/panel-dark.png)

> 截图是真实输出：`npm run preview` 折叠本机真实的会话日志，并用从 DSH shell 原样取出的主题变量渲染面板。见 [`scripts/preview.mjs`](scripts/preview.mjs)。

## 面板内容

| 行 | 取值 |
|---|---|
| `模型` / `模型提供方` | 所选区间内用得最多的那条路由 |
| `工作目录` | 用量最高的目录 |
| `会话` | 区间内的会话数与轮次 |
| `Token 用量` | `533.6M total  (2.02M input + 2.38M output)` |
| `上下文窗口` | `[████████████████░░░░] 82% left (180.4K used / 1M)` |
| `缓存` | `[███████████████░░░░░] 75% hit (529.2M read / 706.0M prompt)` |
| `推理` | 推理 token 及其占输出的比例 |
| `区间` | 与上一个等长区间的对比 |

卡片下方还有五个累计指标（`累计 token`、`单日峰值`、`最长对话`、`当前连续`、`最长连续`）、每日活动图、按模型 / 按目录的占比列表，以及最近的会话表。

区间可选：**今天 · 7 天 · 30 天 · 全部**。

## 为什么长得像 Codex

面板复刻的是 OpenAI Codex 的 `/status` 卡片。每条格式化规则都是对某个具名 Rust 函数的逐行移植，源码就引在对应函数的文档注释里：

| 本包 | Codex 源码 |
|---|---|
| `formatTokensCompact` | `tui/src/status/helpers.rs` |
| `compactAmount`、`countValue`、`formatDuration` | `tui/src/analytics/{data,summary_panel}.rs` |
| `renderLimitProgressBar` | `tui/src/status/rate_limits.rs` |
| `percentOfContextWindowRemaining` | `tui/src/token_usage.rs` |
| `formatAbsoluteTime` | `tui/src/status/helpers.rs` |
| 标签 / 取值两列网格 | `tui/src/status/format.rs` |

于是就有了 Codex 那套辨识度很高的写法：`1.2K` / `128.5K` / `1.2M`（小于 10 留两位、小于 100 留一位、再大不留，末尾零去掉）、20 格 `[███░░░]` 进度条、`{n}% left` 的措辞、暗色括号补充，以及按实际出现的标签动态计算的标签列宽。

**三处刻意的不一致**，因为照抄 Codex 在这里反而是错的：

1. **token 行始终显示。** Codex 对 ChatGPT 订阅用户隐藏该行，因为他们按速率窗口计费而非按 token。DSH 没有这种窗口，隐藏它就等于隐藏了整个面板的意义。
2. **不套用 12000 token 的上下文基线。** Codex 减掉固定 12K 是为了折抵它自己的系统提示词开销。DSH 的提示词开销是另一个量级，照搬这个常数只会得到一个"看起来很确定"的错误百分比。这里按原始值报告占用率。
3. **速率窗口进度条改成上下文占用条。** Codex 的进度条编码的是服务商配额，DSH 没有对应物。上下文占用是真实的 0–100% 剩余量，所以进度条被用回它原本的用途，而不是画在一个编造出来的分母上。

## 安装

```sh
dsh plugin add dsh-token-dashboard
```

然后打开 **设置 → 用量**。

手动安装：把包加进 profile，并在该 profile 的 `package.json` 的 `dsh.profile.bundles` 里登记。

## 工作原理

按 `dsh.client` 的声明，本包分两半：

**宿主半侧**（`lib/index.js`）读取 `$DSH_HOME/sessions/**/session.v*.jsonl.zstd`，解压并折叠出 token 用量，然后在 `ctx.webServer` 上注册唯一一条只读路由 `GET /dsh-token-dashboard/api/stats`。

**浏览器半侧**（`lib/client.js`）注册一个 `settings.section` 页面，把宿主算好的快照渲染出来，自己不做任何统计。

### 宿主半侧必须处理对的三件事

**会话日志是多帧 zstd。** 每次持久化刷盘都会追加一个独立的 zstd 帧，而 Node 的 `zstdDecompressSync`（以及 `createZstdDecompress`）只解第一帧就成功返回。天真写法会把一份 6 MB 的日志看成一行 196 字节的头部，统计结果为零。本包按帧魔数切分后逐帧解压，只把"最后一帧解不开"当作正常情况（正在写入的会话尾部本来就可能不完整）。

**日志格式版本号更高不等于更完整。** 同一个会话目录会累积 `session.v3`、`session.v4`……新版本是同一段对话的重写。但一次被中断的重写会留下一个*更短*、且带损坏帧的新文件。本插件的开发机上就有一个会话：健康的 `v3` 有 3563 个事件，而 `v4` 被截断到 245 个 —— 取最高版本会静默丢掉 **1.917 亿 token，占整机总量的 56%**。所以这里会把存在的每个版本都读一遍，取持久化序号 `seq` 最靠前的那个。

**用量样本是"替换"而非"累加"。** 一条流式助手消息可能对同一个 `(turn, step)` 上报多次用量，而 `llm/retry-started` 会关闭替换槽，让重试的那次单独计入。折叠逻辑与 DSH 自己的 `tokenUsage` 投影逐行对应。已用完整会话库验证：在四个桶上与独立求和的每条 `assistant/message` 记录完全一致，覆盖 2401 条记录。

### 开销

首次扫描 20 个会话、约 500 MB 的库需要约一秒。结果按 `(size, mtimeMs)` 记忆化，之后刷新只解压有变化的日志，快照本身还有 5 秒复用窗口。

### 隐私

只读。插件不写盘、不调用模型、不把提示词或消息内容发往任何地方 —— 它只读数值型的 `usage` 记录。HTTP 路由由 DSH GUI 本地的同一个 webserver 提供。

## 兼容性

- DSH 0.2.x（`@deepseek-ai/dsh-web-app`、`dsh-client-ui-settings`）
- Node ≥ 22.15（需要内置 zstd API）
- 无运行时依赖：宿主侧只 import `node:*`，浏览器侧从 shell 的模块表解析 React 与 UI 基础组件

## 开发

```sh
npm install
npm run build     # lib/index.js + lib/client.js + lib/types
npm run typecheck
npm test          # 浏览器包加载检查、Codex 格式渲染测试、真实日志交叉验证
npm run preview   # 用你自己的会话库生成 docs/panel.html
```

`tests/host-route.test.mjs` 会拿构建产物去跑你真实的 `$DSH_HOME/sessions`，并断言折叠结果与对同一批日志的独立求和一致；没有会话库时会干净跳过。

`tests/render.test.mjs` 用取自 Rust 源码的期望值校验 Codex 格式化规则，并渲染面板以检查卡片、进度条、头部指标、空态与错误态，以及两种语言的字典。

## 许可

MIT。此处复刻的 Codex 格式化规则源自 Apache-2.0 代码，详见 [LICENSE](LICENSE)。
