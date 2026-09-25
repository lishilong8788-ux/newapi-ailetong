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

## 二期的接缝在哪

一期已经为二期留好了位置，不需要你重新设计：

- `service/copilot/types.go:29` 有 `Tool.Mutates bool`，目前全部工具为 `false`。
  注释（`types.go:26-28`）写明：**闸门要按这个字段判，不要按工具名前缀约定** ——
  前缀约定一旦有人加个 `update_xxx` 就静默失守。
- `service/copilot/loop.go:111-121`，`Registry.Get` 拿到工具、`runToolHandler` 执行
  之前，就是闸门该插进去的地方。现在这中间没有任何检查。
- 断言 `Mutates == false` 的两处测试在 `service/copilot/eval_test.go:212` 和
  `tools_test.go:64`。你加写工具时这两处会红，那是预期的，改断言而不是改字段。

SSE 事件类型在 `types.go:132-147`，注释写着"值一旦发布就不能改"。确认流程要新增
事件（比如 `confirm_required`）就往这个枚举里加，前端 `web/src/features/copilot/`
按字符串分发。

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

### 2. 切天口径不一致（未修，已知）

日汇总按 UTC 零点切（`service/cost_flush.go` 的 `currentCostDayTs`），而交易账本/日志
页按服务器本地时区渲染。UTC+8 下本地 00:00-08:00 的请求落进前一天，两个页面按"某一天"
对账天然差一截。

没擅自改：口径一换所有历史行都得跟着重算。注释留在 `cost_flush.go:37-44`。如果二期要
让副驾报"今天的毛利"，这件事就绕不过去了，先跟用户确认再动。

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

## 仓库当前状态

`main` 分支，最后一个提交是 `286dcdf2`，之后有 116 个文件未提交（74 改动 + 42 新增），
一期副驾和定价那一摊都在里面。

**两个 AI 同时改同一棵树、又没有提交边界，很容易互相冲掉对方的工作。** 开工前先把现有
改动提交或分支隔离。另外 `web/` 不要跑 `format:check`，它会写盘并回滚并发的改动，在
HEAD 上本来就是红的（约 24 个文件）。

验证命令：后端 `go build ./...` + `go vet ./...` + `go test ./service/... ./controller/ ./model/`；
前端在 `web/` 下 `npm run typecheck` 和 `bun run build`。改到 `relaykit/` 要单独跑
`cd relaykit && GOWORK=off go build ./...`。

