# 交接文档 · 逐渠道定价（卖价 = 该渠道进价 × 该渠道利润率）

> 日期：2026-09-23（下午更新）
> 关系：本文接续 `docs/handoff.md`（09-22），不替代它。09-22 那份描述的「渠道售价折扣」链路仍然存在，但**卖价现在优先于它**（见第五节）。

## 零、本轮已完成（2026-09-23 下午）

**定价口径已定：每条渠道各卖各价。** 不做站点统一价，因此第九节的 min/avg/max 基准决策**作废**。
四条渠道四个进价 → 四个卖价，各自 20% 利润率，一条不亏；路由挑最便宜的，客户拿到最低价。

已落地：

1. **修了 0% 利润率的 bug**（原 7.1）。`channel-form.ts` 的判据从「> 0」改成「有没有这个数」，0% 现在写入 `default_markup: 0`。
2. **加了缓存进价输入框**（原 7.2 的一半）。表格现在是 输入 / 输出 / 缓存读取 三列，`cache_read` 进入结构化往返。
   其余 7 个维度**仍然不给输入框**，因为 `SellPriceToRatios` 只输出三项倍率，填了不算钱（原 7.3 未修，见第七节）。
3. **卖价的纯算术下移到 `model/sell_price.go`**，`service/price_resolution.go` 留类型别名 + 转发。
4. **展示侧和路由侧接通了**：`resolveChannelPrice` 优先读卖价，`Source` 新增 `"cost"`；`buildChannelPriceRanks` 按卖价排名。
5. **四条渠道的进价已写库**（id 3/4/5/6，模型 `deepseek-v4-flash-0731`，利润率 20%）。

已实测（重编后端后 `curl /api/pricing/channels?model=deepseek-v4-flash-0731`）：

| 线路 | price_source | 卖价 输入 ¥/M | = 进价 × 1.2 |
|---|---|---|---|
| xy (#3) | cost | 1.1520 | 0.959999 × 1.2 ✓ |
| hs5 (#4) | cost | 1.5360 | 1.28 × 1.2 ✓ |
| ql2 (#5) | cost | 1.8600 | 1.55 × 1.2 ✓ |
| jd6 (#6) | cost | 2.2200 | 1.85 × 1.2 ✓ |

`auto_route.ranked = true`（改之前四条全 `fallback`，只会是 false）。

**还差的两件事（都要人来做，不是代码）**：

- **低价路由的站点开关还是关的**：`auto_route.enabled = false`。位置在系统设置 → 模型与路由（`models/routing-reliability`）。
  默认 off 是刻意的（`setting/route_setting/config.go:12`：升级不能静默改变生产路由）。
- **只有 #3 配了 `line_code`（`xy`）**，4/5/6 是 null，所以 `<模型>/<线路码>` 只能拿 xy 测。

### 验收陷阱（会让人误判路由通了）

四条渠道的手动 priority 是 **10/9/8/7 递减，刚好与价格从低到高一致**。
所以「请求命中了 xy」这件事，在开关关着时也成立 —— 那是手动优先级的结果，不是价格排的。
要证明价格排名生效，看 `auto_route.ranked`，或者把某条便宜渠道的 priority 调低再测。

## 一、一句话现状

计费侧、展示侧、路由侧的卖价**已经是同一段算术**（`model/sell_price.go`），
`relay/helper/sell_price_test.go` 的 `TestModelPriceHelper_BilledRatioMatchesPublishedRatio` 把两侧钉在一起。

## 二、必须先读

- `docs/Token进销存与毛利管理-设计方案.md` — 成本侧四级链、官方价数据源的既有取舍
- `pkg/billingexpr/expr.md` — 表达式计费（与本方案并存，互不干扰）
- `AGENTS.md` 的「Billing safety invariants」 — 所有 quota 转换必须走 `common/quota_math.go`

## 三、工作区状态（已消解）

上一轮描述的「未经请求的 stash」已经不成问题：那 131 项变更已提交为 `286dcdf2`，
`stash@{0}`（09-23 11:24 那条 90 文件）也已被 pop 并包含在该 commit 里。

现在 `git stash list` 只剩一条 **`stash@{0}: WIP on main: 566cf23b`**，即上一轮文档里的 `stash@{1}`（09-22 22:10，9 个文件）。
**未核对它与已提交内容是否重叠。** 接手时如果不需要它，可以留着不管；要用先 `git stash show --name-only 'stash@{0}'` 看清楚再说。

## 四、三个价格字段，谁写谁读（已实测，非推断）

数据来自 `bin/one-api.db`，模型 `deepseek-v4-flash-0731`。换算基准：倍率 1 ≡ $2/M（`common.QuotaPerUnit = 500000`），汇率 7.3。

| 广场显示 | option key | 实测值 | 折算 | 写入方 | 读取方 |
|---|---|---|---|---|---|
| 平台价 输入 ¥14.6 | `ModelRatio` | 0.9999995 | $2/M | 模型定价页 | `model/pricing.go:408` |
| 平台价 输出 ¥58.4 | `CompletionRatio` | 4.0000015 | $8/M | 模型定价页 | 同上 |
| 平台价 缓存 ¥0.292 | `CacheRatio` | 0.01999951 | $0.04/M | 模型定价页 | 同上 |
| 官方价 输入 ¥0.584 | `OfficialModelRatio` | 0.04 | $0.08/M | **仅官方价同步任务** | `model/pricing.go:434` |
| 官方价 输出 ¥0.73 | `OfficialCompletionRatio` | 1.25 | $0.1/M | 同上 | 同上 |
| 官方价 缓存 ¥0.0219 | `OfficialCacheRatio` | 0.0375 | $0.003/M | 同上 | 同上 |

`OfficialRatioSyncedAt = 1789388269`（2026-09-14），9 天未更新。

**用户最初的困惑点**：模型定价页没有「官方价」输入框（`model-pricing-sheet.tsx` 已确认），所以在那里改任何数都不会动官方价。**模型定价页写的就是平台价。**

## 五、卖价链路（已全线接通）

**一处算术，三方共用** —— `model/sell_price.go`：

- `ResolveSellPrice(cost, upstreamModel)` — 进价 × (1 + 利润率)。缺失维度用**官方倍率**从 input 推导（不用平台倍率：那是售价口径，用它推进价等于用卖价猜成本）。
- `SellPriceToRatios(price)` — 卖价 → 倍率三元组。依据 `service/text_quota.go` 的恒等式：`modelRatio = P × QuotaPerUnit ÷ 1e6`，当前 QuotaPerUnit=500000，即倍率 1 ≡ $2/M。

为什么住在 `model` 而不是 `service`：展示侧和路由侧都在 `model` 包里，而 `service` 已 import `model`，反向不成立；
`relaykit/dto` 也放不下（要读 `ratio_setting` 和 `common.QuotaPerUnit`，都在根模块，而 relaykit 必须独立可构建）。
`service/price_resolution.go` 留了类型别名 + 转发，68 处既有引用一行未改。

**三个读取方**

| 侧 | 入口 | 行为 |
|---|---|---|
| 计费 | `relay/helper/price.go` `applyChannelSellPrice` | 改写 priceData 的 model/completion/cache，并把 `GroupRatio` 置 1（卖价是绝对价；0 除外，那是分组免费开关）。挂在 `ModelPriceHelper` + `RepriceForChannel` |
| 展示 | `model/channel_price_cache.go` `resolveChannelPrice` | 卖价**优先于**折扣（因为卖价才是实际计费的那个），`Source = "cost"`，`Discount` 保持 nil |
| 路由 | `model/channel_price_cache.go` `buildChannelPriceRanks` | 按卖价倍率升序建档位，最便宜的 rank 最高 |

**`RepriceForChannel` 必须保留。** 上一轮怀疑它该删（前提是全站统一价），但逐渠道定价下它是必需的：
跨渠道重试落到新渠道后不重算，就是拿 A 的卖价卖 B 的成本。点名线路的请求不重算（价格在入口已许诺）。

**优先级顺序有讲究**（`resolveChannelPrice` 四个分支，顺序与计费严格对齐）：

1. 按次价（`GetModelPrice`）→ 短路。`ModelPriceHelper` 命中它就走 per-call 路径，**从不调用 `applyChannelSellPrice`**，所以这里也必须无视进价。
2. 卖价（`settings.cost`）→ `Source = "cost"`。
3. 折扣（`settings.price`）→ `官方价 × 折扣`。
4. 平台倍率 → `Source = "fallback"`。

**`ChannelPrice.Comparable()`** 是「这个价能不能用来排序」的唯一判据，路由档位、广场排序、`auto_route.ranked` 三处共用。
fallback 不可比（所有渠道同一个数，排出来是按常量排）；per-call 不可比（USD/次 与 倍率不同单位）。

## 七、Bug 状态

### 7.1 利润率填 0% 时卖价整链失效 —— **已修**

`channel-form.ts` `buildCostFromStructuredFields` 原判据 `markup > 0` 把 0% 当成「没配」，`default_markup` 不进 JSON，
后端 `sellPriceMarkup` 取不到利润率 → 整条卖价链静默退回老倍率计费。

现在的判据是「这个数存在且合法」而不是「大于 0」。另有一条边界：**利润率 0 且没有任何模型进价时仍然不写 `cost`** ——
那与表单默认值无法区分，否则任何人打开抽屉点保存都会在渠道上留一个空 cost 配置。
回归测试在 `channel-cost-settings.test.ts`（`a 0 channel markup is stored once a model is priced`）和
`model/channel_sell_price_display_test.go`（`TestResolveChannelPrice_ZeroMarkupSellsAtCost`）。

### 7.2 进价维度缺输入框 —— **补了 cache_read，其余 7 个仍缺（有意为之）**

`ModelCostPrice`（`relaykit/dto/channel_settings.go`）定义 11 个维度。表格现在认 4 个：
`STRUCTURED_COST_MODEL_KEYS = {input, output, cache_read, markup}`。

**没给其余维度加输入框是刻意的**，理由见 7.3：填了不算钱。它们仍然走 raw JSON 逃生口，
`expandCostConfigToForm` 会把带这些键的模型留在 JSON 框里而不是拍平进表格（回归测试：`a kind the table cannot bill still stays in the raw JSON box`）。

按秒进价：`ModelCostPrice` 仍**没有 `PerSecond` 字段**（定价侧的 `ModelPriceUnit` 在 566cf23b 已有，成本侧缺）。本次未做。

### 7.3 卖价换算丢维度 —— **未修**

`SellPriceToRatios` 只输出 `ModelRatio` / `CompletionRatio` / `CacheRatio`；`applyChannelSellPrice` 也只改写这三项。
`ResolveSellPrice` 算出的 `CacheWrite5m` / `CacheWrite1h` / `AudioIn` / `AudioOut` / `ImageIn` / `ImageOut` / `Reasoning`
七个维度**只参与 `CoversTokens` 的覆盖判断，不参与实际计费**。

注意 `CoversTokens` **目前没有任何生产调用方**（只有测试在调）——它是为这一步预留的钩子，别当成已生效的护栏。
`applyChannelSellPrice` 的注释说明了现状：这几个维度保留平台倍率，因为它们本就是「相对 input 的倍数」，换了 input 基准照样成立。

**加这七个维度的输入框之前必须先修这里**，否则填进去的数不算钱，等于骗用户。

## 八、数据问题：官方价采集错了（非代码 bug）

`deepseek-v4-flash-0731` 的 `OfficialModelRatio = 0.04`（¥0.584/M），但用户四条渠道的**进价**是 ¥0.96 ~ ¥1.85/M。**进价高于官方价，商业上不成立。**

根因：同步任务的 models.dev 分支对同名模型取「最便宜候选」（`docs/Token进销存与毛利管理-设计方案.md` 第 740 行列为已知取舍），这个模型撞上了别的价格档。

影响面：官方价是折扣徽章和毛利报表的分母，错了会让所有折扣显示错误。**不影响计费。**

缺口：官方价没有手填入口。`PUT /api/option` 接受这三个 key（`model/option.go:618`），但 `loadOfficialRatioMap` 是**整表替换**（先 `Clear()` 再 load），只 PUT 一个模型等于删掉其余 3130 个；且下次同步会覆盖手填值。**需要一个独立的覆盖层（新 option key），读取时叠加在同步表之上。**

另：用户贴的「4.8折 / 6.4折」等折扣率**不是本系统算的**。`缓存读取高于官方价` 这句文案在代码和 i18n 里都不存在。反推 ¥0.959999 ÷ 0.48 = ¥2.0/M，是 DeepSeek 官网人民币价目表口径，与本站官方价（¥0.584/M）基准差 3.4 倍。**配置时只能用绝对值（¥/M），折扣率要丢掉。**

## 九、定价口径：逐渠道，不统一（已定）

**用户 2026-09-23 下午明确：「每个价格，我们要单独卖！单独计算卖价」**，先做固定利润率，平均利润率模式以后再加。
所以上一轮纠结的 min/avg/max 基准**不存在了**，也不需要站点级下拉。

| 渠道 | 进价 ¥/M | 卖价 ¥/M（×1.2） | 毛利 |
|---|---|---|---|
| xy | 0.959999 | 1.1520 | +0.192 |
| hs5 | 1.28 | 1.5360 | +0.256 |
| ql2 | 1.55 | 1.8600 | +0.310 |
| jd6 | 1.85 | 2.2200 | +0.370 |

**一条不亏**，这是逐渠道定价相对统一价的全部好处：统一价必然让某些渠道亏（最贵是最便宜的 1.93 倍），
而路由只能保证「优先走便宜的」，保证不了「永远不走贵的」——限流/超时/熔断时贵的那条会接量。

代价：**客户的单价随命中哪条线波动**。这是接受的取舍，缓解手段是线路码（`<模型>/<线路码>`）——
客户想锁价就指定线路。因此上一轮验收标准里「四条渠道显示同一个卖价」那条**作废**，
改成「每条渠道显示自己的卖价，且等于自己的进价 × 1.2」。

**后续要加「平均利润率」模式时**：它是另一种基准，不是另一套利润率语义。利润率对所有维度统一生效这一点不用动
（`ResolveSellPrice` 的 `multiplier` 对每个维度同样相乘）。

## 十、剩余待办

**第 1 步** 官方价手填覆盖层（第八节）
新 option key + 读取优先级（覆盖 > 同步 > 无）+ 模型定价页加输入列
验证：手填后跑一次同步，确认不被覆盖

**第 2 步** 补全维度 —— 顺序不能颠倒：先 `SellPriceToRatios` 输出全维度 + `applyChannelSellPrice` 改写全维度（修 7.3），
再给表单补那 7 个维度的输入框。`PerSecond` 进 DTO 是独立的一块。

**第 3 步** 给 #4/#5/#6 配 `line_code`（现在只有 #3 有 `xy`），否则这三条线客户无法指定。

**第 4 步** 毛利报表 —— `channel_cost_daily` 字段够用（`ChannelId` / `ModelName` / `CostQuota` / `SellQuota` / `Requests`），毛利 = `SellQuota - CostQuota`。
逐渠道定价下每条线毛利率都应等于 `markup ÷ (1 + markup)`（20% 加价 = 16.7% 毛利率），
所以报表里出现负毛利就是**真有问题**（进价填错、或走了没配进价的渠道回落到老计费），不再是设计结果。
注意 `ModelName` 存的是**上游模型名**，卖价按**客户端模型名**算，报表需同时展示两个名字，否则运营看不出 `gpt-5.5-thinking` 的亏损对应对外的 `gpt-5.5`。

日志里怎么认这笔走了哪条链：`other.admin_info.price.price_source`。
卖价生效时它现在是 `"cost"`（本轮改的——之前它只报折扣链的三个值，卖价计费的流量会被算进 `fallback`，
正好盖掉要观察的灰度进度）。同一节点还有 `sell_markup` 和 `sell_input_price` 可以把 `charged_quota` 拆回「进价多少、加了多少」。

## 十一、验证命令

```bash
# relaykit 独立构建（改了 dto 必跑，AGENTS.md 硬约束）
cd relaykit && GOWORK=off go build ./...

# 根模块
go build ./... && go test ./service/... ./relay/... ./model/...

# 前端
cd web && bun run build
# 注意：不要跑 bun run format:check —— 它会写盘并回滚并发改动，
# 且在 HEAD 本来就是红的（约 24 个文件）

# 查库（只读，Node 26 自带 node:sqlite，本机无 sqlite3 CLI）
node -e "const{DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('E:/newapi-ailetong/bin/one-api.db',{readOnly:true});
for(const r of db.prepare('SELECT id,name,settings FROM channels').all()){
  let s={};try{s=JSON.parse(r.settings||'{}')}catch{}
  console.log('#'+r.id,r.name,JSON.stringify(s.cost||null));}"

# 看渠道卖价。倍率 → 人民币：ratio × 2 × 7.3
curl -s "http://127.0.0.1:3020/api/pricing/channels?model=deepseek-v4-flash-0731"
```

**改了 Go 代码一定要重编后端。** `settings.cost` 是新字段，旧二进制读不到它，
curl 出来会是一片 `fallback`，很容易误判成「代码没生效」（参见 `bin/` 里那一堆 `new-api.stale*.exe`）。

```bash
export PATH="/c/Program Files/Go/bin:$PATH"       # Go 不在 PATH
go build -o bin/new-api.new.exe .                 # 先编到新文件，别覆盖正在跑的
netstat -ano | grep -i LISTENING | grep -E ":3020\s"   # 行尾是真 pid，不要用 $!
taskkill //PID <pid> //F
cp bin/new-api.new.exe bin/new-api.exe
cd bin && SQLITE_PATH="E:/newapi-ailetong/bin/one-api.db?_busy_timeout=30000" PORT=3020 \
  nohup ./new-api.exe > logs/dev-backend.log 2>&1 &
```

完整启动规程见 `docs/dev-startup.md`。

## 十二、端到端验收标准

四条渠道进价（¥0.96 / ¥1.28 / ¥1.55 / ¥1.85），利润率 20%：

| # | 验收项 | 状态 |
|---|---|---|
| 1 | 每条渠道展示**自己的**卖价 = 自己的进价 × 1.2 | ✅ 已实测（第零节表格） |
| 2 | `auto_route.ranked = true`（价格档位建起来了） | ✅ 已实测 |
| 3 | 智能路由优先命中最便宜的 xy | ⏳ 需先开站点开关；注意第零节的验收陷阱 |
| 4 | 真实请求的扣费 = 广场展示的卖价（**核心**） | ⏳ 需真实请求。代码侧已由 `TestModelPriceHelper_BilledRatioMatchesPublishedRatio` 钉住 |
| 5 | 手工指定渠道（`<模型>/<线路码>`）时扣费不变 | ⏳ 只有 xy 有线路码 |
| 6 | 利润率留空/填 0 时卖价 = 进价（平进平出） | ✅ 已由测试覆盖 |
| 7 | 毛利报表按渠道显示毛利 | ⏳ 未验

## 十三、边界（不要动）

- `service/text_quota.go` 的计费恒等式 `quota = tokens × modelRatio × groupRatio` 不改，只在配置与内核之间加换算层
- 表达式计费（`billing_mode == tiered_expr`）与本方案并存，走 `modelPriceHelperTiered`，不受影响
- 进价绝不能出现在对外响应里。`ChannelRoute` 喂的是公开页面可未登录访问的端点，注释已明确列出禁止字段
- `group_ratio` 不参与卖价（卖价是绝对价）。唯一例外是 0：那是把整个分组关成免费的开关，改成 1 等于开始向免费分组收钱
- 受保护标识（new-api / QuantumNous）一律不动

