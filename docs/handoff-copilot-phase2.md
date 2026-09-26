# 运营副驾二期交接：写操作与确认闸门

读者：接手副驾二期的工程师/AI。假定你没参与一期，但能读 Go 和 React。

## 一期交付了什么

只读问答。管理员在 `/copilot` 提问，副驾调九个只读工具查库，把结果和结论
说回来。一行都不写业务表（只写自己的会话表 `copilot_sessions`）。

代码位置：

- `service/copilot/` — 循环、工具、prompt。**这一层不能 import `controller`**，会成环。
- `controller/copilot.go` — HTTP + SSE 入口。
- `controller/copilot_llm.go` — `Completer` 的实现（合成 `gin.Context` 走自家 relay）。
- `setting/copilot_setting/` — 模型、渠道等配置，管理员在系统设置页选。
- `web/src/features/copilot/` — 前端。

九个工具都在 `service/copilot/tools.go` 的 `BuildRegistry()` 里按序注册：
`search_models`、`get_model_pricing`、`list_channels`、`get_channel_cost`、
`query_margin`、`query_cost_overview`、`get_official_price`、`simulate_sell_price`、
`simulate_margin_impact`。前七个读库，后两个纯算（`tools_simulate.go`）。

## 用户已经定下的三条契约

这些不是待讨论项，是一期就定好、二期必须照做的：

1. **LLM 走自家 API 代理（Relay）**，不额外接外部 SDK。
2. **一期只读问答** — 已完成。
3. **每一次写改动都要人工点确认**。不是"危险操作才确认"，是每次。

## 闸门与模式：已经落地（2026-09-26）

一期留的接缝已经用掉了。下面是**现状**，不是待办：

- `Tool.Mutates` 是闸门的唯一判据（`service/copilot/types.go`）。不按工具名前缀 ——
  前缀约定一旦有人加个 `update_xxx` 就静默失守。
- 闸门在 `service/copilot/loop.go` 那个 `switch` 里，`case tool.Mutates &&
  opts.ApprovedTool != call.Name`，位置在 `Registry.Get` 之后、`runToolHandler` 之前。
  命中就发 `EventConfirmRequired`（带工具名和**参数原值**）然后 `return`。
- `RunOptions.ApprovedTool` 是**工具名**而不是 bool。一轮里模型可能调多个工具，而
  管理员在弹窗里看到并点头的只是其中一个；用 bool 会让「同意改这个渠道的成本价」
  顺带放行同一轮里另一个它自己决定的写操作。
- **确认 = 带 `ApprovedTool` 重放整轮**，不是续跑。SSE 是单向的，流已经在
  `confirm_required` 那里结束了。批准从请求体来，不落库、不进会话状态，下一轮不带
  就要重新点头。

模式（用户 2026-09-26 定的）：

- `BuildRegistryForMode(mode)`：只有 `ModeAct` 才追加写工具。`ModeAsk`、空字符串、
  任何其它值都按只读处理。**空字符串那条是给老客户端的** —— 它们不发 mode，升级
  后台不该让它们凭空获得写能力。
- 闸门和 mode 是**两层独立防线**：mode 让模型压根提不出写操作，闸门拦住万一提出来
  的。少任何一层都不行 —— 只有 mode 等于把安全寄托在「模型看不见就不会用」，只有
  闸门则意味着管理员想只读时仍要靠自觉不点同意。

第一个写工具是 `set_channel_markup`（`service/copilot/tools_write.go`），改渠道默认
利润率。选它是因为它只是记账字段：错了只影响毛利报表，不动真实流量，而且成本页有
「从日志重建」可以兜底。它复用模拟工具那份 `validateSimulateMarkup`，不另造边界；
并且在 handler 里**再校验一次** —— 批准只带工具名不带参数值，拿到批准不等于拿到了
合法参数。

`eval_test.go` 和 `tools_test.go` 里断言 `Mutates == false` 的两处**没有红**，因为
`BuildRegistry()` 仍然只返回只读工具。那两条断言的含义因此变成了「写工具没有漏进
默认工具表」，依然有效，不要删。

前端已完成的部分：`confirm_required` 帧解析（`lib/parse-frame.ts`）→ 归约成
`awaiting_confirmation` 状态和 `pendingWrite`（`lib/stream-reducer.ts`）→ 请求体带
`mode` / `approved_tool`（`hooks/use-copilot-stream.ts`）。

### 前端还差三件

1. **确认弹窗**：逐条显示参数原值，不做摘要 —— 摘要会和实际写进库的东西产生偏差。
   注意 `markup = 0` 是合法值（平进平出），按 falsy 处理会渲染成空白，让管理员对一个
   看不见数值的改动点同意。
2. **tab 解禁**并接上 mode 状态（`components/copilot-rail.tsx`，现在硬写成 `'qa'` +
   `disabled`）。
3. **七个语言的词条**。

**这三件做完之前不要上线**：现在副驾在智能操作模式下要改利润率，后端会拦住并发
`confirm_required`，前端能把它变成 `awaiting_confirmation`，但界面上没有弹窗呈现它，
那一轮会停住而看不到原因。

## 开工前必须先处理的两件事

### 1. 库里的历史毛利数据是虚高的

`service/cost_flush.go` 的 `drainCostBuckets` 原来只复制不清零，而
`UpsertChannelCostDaily` 是加法式 upsert（`col + ?`），所以每 60 秒一轮刷盘都把
**累计总量**再加一遍。31 笔真实交易在库里读出来是 9,327 笔。

写入路径已经修好（含回归测试 `service/cost_flush_test.go`），**但已落库的历史行没动**。

这对二期是硬前提：二期的工具会去改价。副驾拿着虚高的毛利去建议/执行调价，比它只是
报错一个数字严重得多。所以顺序是——先修数据，再开写工具。

修法：`POST /api/cost/recalculate`（`router/api-router.go:427`，RootAuth，从 `logs`
删后重写）。跑之前先确认日志保留窗口覆盖到你要对账的日期，否则会把有数据的日子重算
成 0。**这条要等用户点头再跑，它删历史行。**

### 2. 切天口径 —— 已修（2026-09-26 复核）

文档原先说这条未修，那是过时的。现在 `service/cost_flush.go` 的 `costDayTs` 按
`time.Local` 零点切，不是 UTC；日期标签也由服务端下发（`model/cost_daily.go` 的
`fillLocalDayLabels`），前端不再拿裸时间戳按浏览器时区反推 —— 那会在时区不一致时让
整列日期错一天。

副驾报「今天的毛利」这条路因此是通的，不用再绕。

## 这个代码库会绊你的地方

都是踩过的，按项目规则写在 `AGENTS.md` 里的不重复：

- **算账不要自己乘。** 卖价一律走 `model.ResolveSellPrice` + `model.SellPriceToRatios`。
  原因不是省事，是口径分叉：那两个函数还管着"缺失维度按官方倍率从 input 推导"
  "按次价与按量价互斥""非法进价按未配置处理"，副驾这边省掉任何一条，模拟出的数就和真实
  计费不是一个数，而运营会照着模拟值去配。见 `tools_simulate.go:15-21`。
- **模拟不要就地改配置。** `costSettingsWithMarkup` 复制一份再改，入参那份来自渠道缓存，
  就地改会把一次"模拟"变成对线上定价的静默修改。写模型级 `Markup` 而不是 `DefaultMarkup`，
  因为模型级优先。
- **工具返回值会原样进 LLM 上下文。** 列表类一律封顶（`maxListLimit = 100`），超界报错而
  不是静默钳制——模型看到 `limit=1000` 的回答里只有 100 行会以为剩下的不存在。
- **`markup = 0` 是合法值**，含义是平进平出。把 0 当"没配"是 7.1 那个 bug 的形状。
- **图片走相对路径，不走 base64。** MySQL `text` 上限 64 KB，压缩后的截图 base64 有
  130-270 KB，存进去会被截断。落盘在 `service/copilot_image.go`，service 层不持有图片
  字节，读盘转 data URL 发生在 `controller/copilot_llm.go`。
- **看板是纯 Bearer 头鉴权**，没有 cookie 兜底。前端取图只能 blob 拉取再转 object URL，
  `<img src>` 认不了。

## 仓库当前状态（2026-09-26 更新）

`main` 干净，与 origin 同步。闸门那两个提交是 `745e4a78`（后端）和 `baf3f688`
（前端管道）。

**两个 AI 同时改同一棵树、又没有提交边界，很容易互相冲掉对方的工作。** 开工前先把现有
改动提交或分支隔离。

### 验证命令

后端：`go build ./...`、`go vet ./...`、`go test ./service/... ./controller/ ./model/`、
`gofmt -l`。改到 `relaykit/` 要单独跑 `cd relaykit && GOWORK=off go build ./...`。

前端在 `web/` 下：`bun run typecheck`。单文件格式化用
`./node_modules/.bin/oxfmt -c .oxfmtrc.json <file>`。

**格式化工具是 `oxfmt` 不是 prettier**（配置在 `web/.oxfmtrc.json`，`semi: false` +
`singleQuote: true`）。跑裸 `bunx prettier` 会按 prettier 自己的默认值把整个文件改成
双引号加分号，一个几十行的新增会变成上百行的 diff，顺手重排掉别人的代码。

`bun run format:check` **名字叫 check 但会写盘**，会回滚并发的改动，而且在 HEAD 上
本来就是红的（约 24 个文件）。并行改前端时不要跑它。

`bun run test` 跑全量（约 1190 条，4 分钟）。**HEAD 上本来就有约 5 条失败**，在
`pricing`、`agent-management`、`keys`、`channels`，耗时 5-7 秒、像超时抖动。改副驾时
只跑副驾那一片：`bunx vitest run --config vitest.config.ts src/features/copilot`
（9 文件 59 条，约 38 秒）。不要把那 5 条当成自己改坏的。

