# dsh-token-dashboard

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的用量统计面板 —— 在**设置**里放一份 Codex 风格的 token 用量报告。

[English](README.md) | **中文**

![用量面板](docs/panel-dark.png)

> 截图是真实输出：`npm run preview` 折叠本机真实的会话日志，并用从 DSH shell 原样取出的主题变量渲染面板。见 [`scripts/preview.mjs`](scripts/preview.mjs)。

## 面板内容

自上而下：

| 区块 | 内容 |
|---|---|
| 身份 | 已登录 DeepSeek 账号的头像、昵称与账号名。未登录时整块隐藏。 |
| 五个数字 | `累计 Token 数` · `Token 使用峰值` · `最长任务用时` · `最长连续天数` · `当前连续天数` |
| `Token 活动` | 一整年的贡献格子，分上下两块、每块六个月，带 **每天 · 每周 · 累计总量** 三种模式与 `少 ▢▢▢▢▢ 多` 色阶 |
| `洞察` | `最常用的推理强度` · `最常用的模型` · `已探索技能数` · `使用的技能总数` · `总会话数` · `总轮次` · `缓存命中率` |
| `最常使用` | 调用最多的技能，写作 `$名称` 加运行次数 |

所有数字都是累计值，因此没有区间选择器 —— 热力图就是唯一的时间轴。

一年被拆成**上下两个六个月的分块**，而不是一条长行。单行需要 53 列，在能看清的格子尺寸下比设置面板还宽，必然出现横向滚动条；一分为二后每块约 26 列，格子仍然清楚，任何面板宽度下整年都能放下。

窗口按**周日对齐、且为偶数周**（`src/host/aggregate.ts` 的 `heatmapWindow`）。奇数总列数无法对半分 —— 必然有一块少一列，两块右边缘不齐，看起来就像下表少了一列。为此最多从窗口开头裁掉 6 天：放在一整年的历史里看不出来，比两行参差划算得多。

网格会向后补到本周结束，所以无论今天是星期几，每一列都是完整的七天。这些补出来的日子带 `future` 标记：占位、留空色，但**不声称任何东西** —— 不进无障碍树、没有 tooltip、不参与悬停读数。

**每一列都是一周。**「每天」每格画一天，「每周」把整列的总量铺满七格，「累计总量」则把累计值往前带。因此「每周」模式用一个日期命名格子时，用的是**那一周的周日**（`week of 3 May 2026` / `2026年5月3日 起的一周`），而不是它恰好落在的星期几。

### 尺寸由面板决定，不由写死的像素决定

热力图的宽度是推导出来的，不是写死的：

```css
width: min(100%, calc(var(--tdd-heat-columns) * (var(--tdd-heat-cell) + var(--tdd-heat-gap)) - var(--tdd-heat-gap)))
```

`--tdd-heat-columns` 由面板根据自己实际建出来的网格写入，所以 52 周和 53 周的年份都能算对，
格子、月份轴、以及"第 i 列的左边缘在哪"三者共用同一套推导。网格会一直填满面板，
直到格子达到上限尺寸才停 —— 于是在任何窗口宽度下，它都和上下两个区块对齐，
而不会因为一个写死的像素上限飘到一边去。

**面板自己不滚动。** 设置对话框本来就在滚自己的内容区，再叠一个
`height:100%; overflow-y:auto` 就会在对话框的滚动条里再套一条。纵向溢出归宿主管，
滚动不归面板管。

## 为什么长得像 Codex

面板复刻的是 Codex 的 **analytics Overview 报告**，也就是从 `/usage` 打开的那份
个人用量摘要。（Codex 一共有三个用量界面，`/status` 卡片是另一个，不是这个。）

每条格式化规则都是对某个具名 Rust 函数的移植，源码引在对应函数的文档注释里：

| 本包 | Codex 源码 |
|---|---|
| `compactAmount`、`countValue`、`formatDuration` | `tui/src/analytics/{data,summary_panel}.rs` |
| `formatTokensCompact` | `tui/src/status/helpers.rs` |
| `renderLimitProgressBar` | `tui/src/status/rate_limits.rs` |
| `percentOfContextWindowRemaining` | `tui/src/token_usage.rs` |
| `formatAbsoluteTime` | `tui/src/status/helpers.rs` |

其中 `compactAmount`、`countValue`、`formatDuration`、`formatAbsoluteTime` 是当前版式真正会渲染的；其余几个同样逐行移植自同一批 Rust 文件、并有单元测试守着，但当前没有界面调用它们。

热力图那套色阶是参考面板的**紫色**，五档从浅到深：`#ddd0fb` → `#5f21c9`。
`tools/sample-shot.mjs` 用零依赖的方式解 PNG，所以参考图里的色块可以被测量而不是靠肉眼。

**颜色越深 = 消耗越大。** 第 1 档是最淡的紫，第 4 档最深、最饱和 —— 用量最重的那天
就是格子里最"重"的那一格。两个主题都是浅 → 深：深色主题**不会**随用量变亮，
这是相对参考面板的一处刻意偏离（它确实是变亮的），因为"越亮越多"和其他所有
配额表都反着来。测试断言的是这条**规则**而不是具体色值：每一档必须比下一档更深、
更饱和。第 0 档用各主题自己的素净嵌套表面色，而不是参考面板的 `#181818` ——
后者在 DSH 的深色底上几乎看不见。

### 数字跟随界面语言

这是照搬英文版会明显出错的地方。中文面板读的是 **`3.7亿`**、**`5317.1万`**，
不是 `370M`、`53.2M`；时长读的是 **`46分59秒`**，不是 `46m 59s`。
`localeCompact` / `localeDuration` / `localeCount` 负责这个分叉，
`tests/render.test.mjs` 用参考截图里的原值逐一断言。

### 四处刻意的不一致

这几处照抄 Codex 反而是错的：

1. **不编造 DSH 量不出来的东西。** Codex 面板会显示额度、套餐名、账号邮箱，以及
   5 小时 / 每周 / 每月速率窗口。DSH 一个都没有，所以这里一个都不放 —— 连"画一根
   分母是编出来的进度条"这种事也不做。留下来的每一项都有会话日志里真实存在的字段。
2. **修了英文单复数。** Codex 写死 `{days} days`，没有单数，于是连续一天会显示
   `1 days`。那是语法问题，不是设计。
3. **`最常用的模型` 按 token 排，不按回复条数。** 一百条便宜回复不该压过那个真正
   花掉预算的模型。
4. **颜色越深 = 用量越重，两个主题一致。** Codex 的深色主题是随用量变亮的，
   那和其他所有配额表都反着来，所以这里的深色色阶和浅色一样是浅 → 深。

## 安装

```sh
dsh plugin add dsh-token-dashboard
```

然后打开 **设置 → 用量**。

手动安装：把包加进 profile，并在该 profile 的 `package.json` 的 `dsh.profile.bundles` 里登记。

## 工作原理

按 `dsh.client` 的声明，本包分两半：

**宿主半侧**（`lib/index.js`）读取 `$DSH_HOME/sessions/**/session.v*.jsonl.zstd`，解压并折叠出用量，然后在 `ctx.webServer` 上注册唯一一条只读路由 `GET /dsh-token-dashboard/api/stats`。

**浏览器半侧**（`lib/client.js`）注册一个 `settings.section` 页面，把宿主算好的快照渲染出来，自己不做任何统计。

### 快照是一个公开类型

这条路由返回的是 `UsageSnapshot`，而这个形状从包根导出 —— 脚本、测试台、或者第二个面板都可以直接引用它，不必自己再抄一遍：

```ts
import type { UsageSnapshot, StatsQuery } from 'dsh-token-dashboard'
```

`lib/types/host/index.d.ts` 由 `src/host/index.ts` 生成，也就是 `lib/index.js` 打包的同一个模块；声明与代码对不上时构建会直接失败，而不是把不一致的声明发出去。浏览器半侧的导出（`buildHeatmap`、`heatCellDescription` 等）走 `./client` 子路径。

### 宿主半侧必须处理对的四件事

**会话日志是多帧 zstd。** 每次持久化刷盘都会追加一个独立的 zstd 帧，而 Node 的 `zstdDecompressSync`（以及 `createZstdDecompress`）只解第一帧就成功返回。天真写法会把一份 6 MB 的日志看成一行 196 字节的头部，统计结果为零。本包按帧魔数切分后逐帧解压，只把"最后一帧解不开"当作正常情况（正在写入的会话尾部本来就可能不完整）。

**日志格式版本号更高不等于更完整。** 同一个会话目录会累积 `session.v3`、`session.v4`……新版本是同一段对话的重写。但一次被中断的重写会留下一个*更短*、且带损坏帧的新文件。本插件的开发机上就有一个会话：健康的 `v3` 有 3563 个事件，而 `v4` 被截断到 245 个 —— 取最高版本会静默丢掉 **1.917 亿 token，占整机总量的 56%**。所以这里会把存在的每个版本都读一遍，取持久化序号 `seq` 最靠前的那个。

**用量样本是"替换"而非"累加"。** 一条流式助手消息可能对同一个 `(turn, step)` 上报多次用量，而 `llm/retry-started` 会关闭替换槽，让重试的那次单独计入。折叠逻辑与 DSH 自己的 `tokenUsage` 投影逐行对应。已用完整会话库验证：在四个桶上与独立求和的每条 `assistant/message` 记录完全一致，覆盖 2600 多条记录。响应次数遵循同一条规则：**一个结算槽在任何口径下都只算一次响应** —— 会话总量、按天、按路由三者必然相等 —— 所以流式重报是"搬走"一次计数而不是新增一次，只有重试的那一步才算第二次。

**一天是一天，不是一个会话。** `Token 使用峰值` 取的是**聚合后**每日桶的最大值。改成读各会话自己最忙的那天，在这台机器上会少报 53% —— 因为有一天有两个会话在跑。

### 更新时

两侧不会一起重载。模块系统会热替换浏览器包，但宿主半侧是 Node 进程里被缓存的 ES
模块，只有重启 DSH 才会换掉。浏览器侧一旦读到旧宿主发来的快照，会直接提示
**"插件已更新，需要重启 DSH"**，而不是去取一个不存在的字段、把整个设置面板弄白。

### 开销

首次扫描 20 个会话、约 600 MB 的库需要约一秒。结果按 `(size, mtimeMs)` 记忆化，之后刷新只解压有变化的日志，快照本身还有 5 秒复用窗口。身份区块背后的账号查询缓存 5 分钟，且在没有账号服务时会被完全跳过。

### 隐私

只读。插件不写盘、不调用模型、不把提示词或消息内容发往任何地方 —— 它只读数值型的 `usage` 记录。HTTP 路由由 DSH GUI 本地的同一个 webserver 提供。

## 兼容性

- DSH 0.2.x（`@deepseek-ai/dsh-web-app`、`dsh-client-ui-settings`）
- Node ≥ 22.18（`engines` 字段；内置 zstd API 只需 22.15，但测试与预览脚本直接 import `src/**/*.ts`，需要默认开启的类型擦除）
- 无运行时依赖：宿主侧只 import `node:*`，浏览器侧从 shell 的模块表解析 React 与 UI 基础组件

## 开发

```sh
npm install
npm run build            # lib/index.js + lib/client.js + lib/types
npm run typecheck
npm test                 # 折叠单元测试、格式与渲染测试、浏览器包加载检查、真实日志交叉验证
npm run preview          # 用你自己的会话库生成 docs/panel.html
npm run check:layout     # 在无头 Chrome 里实测面板几何
npm run refresh:profile  # 重新打包并装进 app 实际加载的 profile
```

**改 `src/` 不等于改了 app 跑的东西。** profile 是用打好包的 tgz 安装本插件的，
所以 app 加载的是它自己那份 `<profile>/node_modules/dsh-token-dashboard/`。
在那份被刷新之前，修复是不可见的 —— 这正是"滚动条明明修好了却还在"的原因。
`npm run refresh:profile` 负责重新打包并覆盖安装，之后刷新页面即可。
（改动宿主半侧还需要重启 DSH，因为被替换的 ES 模块会缓存在 Node 进程里。）
见 [`tools/README.md`](tools/README.md)。

`tests/host-route.test.mjs` 会拿构建产物去跑你真实的 `$DSH_HOME/sessions`，并断言折叠结果与对同一批日志的独立求和一致；没有会话库时会干净跳过。

`tests/fold.test.mjs` 补的是真实会话库覆盖不到的部分：DSH 每个 step 只写一条 `assistant/message`，所以替换分支与它的响应计数在真机上从不执行。这里用合成事件跑流式重报、必须计两次的重试、跨本地日的替换、只存在于结算流里的用量、以及没有时间戳的事件。

`tests/render.test.mjs` 用取自 Rust 源码的期望值校验格式化规则、用参考面板的原值校验本地化单位，然后完整渲染一遍报告，检查身份区、五格数字条、热力图的周对齐与三种模式、洞察区、空态与错误态，以及两种语言的字典。

`npm run check:layout` 补的是标记断言看不到的那一层：它在无头 Chrome 里渲染并**实测**面板。两条滚动条的问题、以及热力图没铺满面板、与上下区块对不齐的问题，都躲过了 DOM 检查 —— 只有浏览器解完网格、flex 列和对话框滚动几何之后它们才存在。把它指向 `docs/panel.html` 就能用你自己的数据测量。见 [`tools/README.md`](tools/README.md)。

`tools/sample-shot.mjs` 用零依赖的方式解 PNG，好让截图能被测量而不是靠肉眼 —— 色阶就是从那里来的。

## 许可

MIT。此处复刻的 Codex 格式化规则源自 Apache-2.0 代码，详见 [LICENSE](LICENSE)。
