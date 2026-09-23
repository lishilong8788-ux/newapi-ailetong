# 交接文档 · 统一定价（卖价 = 进价 × 利润率）

> 日期：2026-09-23
> 上一轮：Claude
> 关系：本文接续 `docs/handoff.md`（09-22），不替代它。09-22 那份描述的「渠道售价折扣」链路仍然存在且仍在生效，本文描述的是**要取代它的新链路**。

## 一、一句话现状

计费侧的「进价 × (1 + 利润率) = 卖价」**已经写完并挂上了**；展示侧和路由侧**完全没接**。
因为库里没有任何渠道填过进价，两者的分歧目前被掩盖着，**填进第一条进价的那一刻就会暴露**。

## 二、必须先读

- `docs/Token进销存与毛利管理-设计方案.md` — 成本侧四级链、官方价数据源的既有取舍
- `pkg/billingexpr/expr.md` — 表达式计费（与本方案并存，互不干扰）
- `AGENTS.md` 的「Billing safety invariants」 — 所有 quota 转换必须走 `common/quota_math.go`

## 三、工作区异常（接手第一件事）

**本轮发生过一次未经请求的 stash。** 会话开始时未提交变更 131 项，中途变为 42 项。
`web/src/features/channels/lib/channel-form.ts` 从「新版」（含 `markupPercentToFraction`、模型级 `markup`）回退到了 HEAD。

已定位，**变更没丢**：

```
stash@{0}  09-23 11:24:54  WIP on main: 566cf23b   —— 90 个文件（含 channel-form.ts 新版）
stash@{1}  09-22 22:10:50  WIP on main: 566cf23b   ——  9 个文件
```

验证方式（只读）：

```bash
git stash show --name-only 'stash@{0}' | wc -l          # 90
git show 'stash@{0}:web/src/features/channels/lib/channel-form.ts' | grep -n markupPercentToFraction
```

上一轮**没有**执行 stash/reset/checkout/restore，原因不明（用户另开终端、IDE 操作、后台 hook 均有可能）。

**接手动作**：先与用户确认 `git stash pop`（会改工作区，必须先问）。两个 stash 是否有重叠未核对，`stash@{1}` 的 9 个文件需要单独看。**在恢复之前不要动这 90 个文件中的任何一个**，否则会制造冲突。

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

渠道价（`resolveChannelPrice`，`model/channel_price_cache.go:294`）两条分支：配了折扣走 `官方价 × 折扣`，没配**回落到平台价**。实测 `/api/pricing/channels?model=deepseek-v4-flash-0731` 四条渠道 `price_source` 全为 `"fallback"`，倍率原样等于 ModelRatio —— 这就是渠道价和平台价显示相同的原因。

## 五、核心断点：卖价只接了计费，没接展示和路由

**已接通（计费侧）**

- `service/price_resolution.go:132` `ResolveSellPrice(cost, upstreamModel)` — 进价 × (1 + 利润率)，缺失维度用官方倍率从 input 推导
- `service/price_resolution.go:225` `SellPriceToRatios(price)` — 卖价换算成倍率三元组
- `relay/helper/price.go:86` `applyChannelSellPrice` — 改写 `priceData` 的 model/completion/cache 三项，并把 `GroupRatio` 置 1（卖价是绝对价，分组倍率不再参与；0 除外，那是免费开关）
- 挂载点：`ModelPriceHelper`（入口算价）+ `RepriceForChannel`（跨渠道重试后重算）

**未接通（展示侧 + 路由侧）**

- `model/channel_price_cache.go:294` `resolveChannelPrice` — 只读 `settings.Price`，**整个 `model` 包没有一处读 `settings.Cost`**（已 grep 确认）
- `model/channel_price_cache.go:401` `buildChannelPriceRanks` — 只吃 `priceSettings`，所以**填了进价不影响低价路由顺序**
- `model/pricing.go` 的 `Pricing.ModelRatio` — 仍是平台倍率，不是卖价

**后果**：填进第一条进价后，客户按 `进价×(1+利润率)` 扣费，广场展示 `ModelRatio`，两个数不一致。这与用户 09-22 报的「渠道价 ¥5.11 vs 平台价 ¥8.176」是同一根因。

**当前被掩盖的原因**：五个渠道 `settings.cost` 与 `settings.price` 全为 `null`（已实测）。

## 六、阻塞点：包依赖方向

要让展示侧读卖价，`model` 需要调用 `ResolveSellPrice`，但它在 `service`，而 `service` 已经 import `model` —— 反向 import 不成立。

`relaykit/dto` 也不行：卖价计算依赖 `ratio_setting.GetOfficialCompletionRatio` 和 `common.QuotaPerUnit`，都在根模块，而 `relaykit` 必须保持独立可构建（`AGENTS.md` 硬约束，验证命令 `cd relaykit && GOWORK=off go build ./...`）。

**既定解法（改动最小）**：把纯计算下移到 `model`。

1. 新建 `model/sell_price.go`，搬 `service/price_resolution.go:47-264` 的 `ModelSellPrice` / `CoversTokens` / `sellPriceMarkup` / `maxSellMarkup` / `ResolveSellPrice` / `SellPriceRatios` / `SellPriceToRatios`。依赖齐备：`model` 已 import `ratio_setting` 与 `common`。
2. `service/price_resolution.go` 留类型别名 + 转发函数，`relay/helper/price.go` 和 40 处测试引用一行不改。
3. 先只做这一步并跑 `go build ./... && go test ./service/... ./relay/...`，确认零行为变化再提交。

引用分布（已统计）：`service/price_resolution_test.go` 40 处、`service/price_resolution.go` 21 处、`service/cost_accounting.go` 3 处、`relay/helper/price.go` 3 处、`service/cost_accounting_test.go` 1 处。

## 七、已确认的 Bug（三个，都还没修）

### 7.1 利润率填 0% 时卖价整链失效 —— 会直接卡住用户的平进平出测试

`web/src/features/channels/lib/channel-form.ts:950`（HEAD 版本行号；stash 版本在 :897）

```ts
const hasMarkup = markup > 0        // 0% 时 false
...
if (hasMarkup) { cost.default_markup = ... }   // 不写入
```

`default_markup` 不进 JSON → 后端 `sellPriceMarkup`（`service/price_resolution.go:96`）取不到利润率 → 返回 ok=false → **整条卖价链静默失效**。

同文件里模型级 markup 判的是 `!= null && >= 0`，是对的；渠道级这一行漏了。修法：把判据改为「未配置」而非「等于 0」。

### 7.2 进价维度缺输入框

`ModelCostPrice`（`relaykit/dto/channel_settings.go:111`）定义了 11 个维度：`input` / `output` / `cache_read` / `cache_write_5m` / `cache_write_1h` / `audio_in` / `audio_out` / `image_in` / `image_out` / `reasoning` / `per_call`。

表单只认 3 个（`STRUCTURED_COST_MODEL_KEYS = {input, output, markup}`），表格只画输入/输出两列。**缓存进价、按次进价填不进去。**

按秒进价更严重：`ModelCostPrice` **没有 `PerSecond` 字段**，要动 DTO + 卖价换算，比前两项大一档。注意 `ModelPriceUnit`（按秒单价）在定价侧已存在（commit 566cf23b），成本侧缺。

### 7.3 卖价换算丢维度

`SellPriceToRatios` 只输出 `ModelRatio` / `CompletionRatio` / `CacheRatio` 三项；`applyChannelSellPrice` 也只改写这三项。`ResolveSellPrice` 算出的 `CacheWrite5m` / `CacheWrite1h` / `AudioIn` / `AudioOut` / `ImageIn` / `ImageOut` / `Reasoning` 七个维度**只用于 `CoversTokens` 判断够不够覆盖，不参与实际定价**。

即：运营填了这七个维度的进价，钱不会按它们算。修 7.2 时必须同时修这里，否则加了输入框等于骗人。

## 八、数据问题：官方价采集错了（非代码 bug）

`deepseek-v4-flash-0731` 的 `OfficialModelRatio = 0.04`（¥0.584/M），但用户四条渠道的**进价**是 ¥0.96 ~ ¥1.85/M。**进价高于官方价，商业上不成立。**

根因：同步任务的 models.dev 分支对同名模型取「最便宜候选」（`docs/Token进销存与毛利管理-设计方案.md` 第 740 行列为已知取舍），这个模型撞上了别的价格档。

影响面：官方价是折扣徽章和毛利报表的分母，错了会让所有折扣显示错误。**不影响计费。**

缺口：官方价没有手填入口。`PUT /api/option` 接受这三个 key（`model/option.go:618`），但 `loadOfficialRatioMap` 是**整表替换**（先 `Clear()` 再 load），只 PUT 一个模型等于删掉其余 3130 个；且下次同步会覆盖手填值。**需要一个独立的覆盖层（新 option key），读取时叠加在同步表之上。**

另：用户贴的「4.8折 / 6.4折」等折扣率**不是本系统算的**。`缓存读取高于官方价` 这句文案在代码和 i18n 里都不存在。反推 ¥0.959999 ÷ 0.48 = ¥2.0/M，是 DeepSeek 官网人民币价目表口径，与本站官方价（¥0.584/M）基准差 3.4 倍。**配置时只能用绝对值（¥/M），折扣率要丢掉。**

## 九、未决决策：卖价基准取哪个成本

四条渠道四个进价，卖价只能有一个，必须收敛成一个数。上一轮我推荐了 min，用户批准的理由是「我们的成本价格都差不多」——**但用户自己贴的数据不支持这个前提，我当时没核对。**

实测（输入维度，利润率 20%）：

| 渠道 | 进价 | min 基准卖价 ¥1.152 | 平均基准卖价 ¥1.692 |
|---|---|---|---|
| xy | ¥0.959999 | +0.192 | +0.732 |
| hs5 | ¥1.28 | −0.128 | +0.412 |
| ql2 | ¥1.55 | −0.398 | +0.142 |
| jd6 | ¥1.85 | −0.698 | −0.158 |
| **亏损渠道数** | | **3 条** | **1 条** |

最贵是最便宜的 **1.93 倍**，不是「差不多」。

- **min**：对外价最低，但四条里三条亏，jd6 毛利率 −60%。路由顺序只能保证「优先走便宜的」，保证不了「永远不走贵的」——前三条限流/超时/熔断时 jd6 会接量，那笔就是实亏。
- **平均**：只有最贵的 jd6 微亏，卖价比 min 高 47%。
- **max**：零亏损，卖价比 min 高 93%。

**上一轮倾向改为「平均」**，但用户最后一条消息提出了新问题（固定利润 vs 平均值是否做成可切换），**尚未确认**。

**建议实现方式**：把基准做成一个站点级下拉（最低价 / 平均价 / 最高价，默认平均），而不是写死。三种算法在同一个函数里差一行，一次做完三个，用户可以自己试，不用再回来改代码。利润率（20%）本身与基准无关，两者不是「两种模式」，是一个乘数 + 一个被乘数。

**注意**：利润率对所有维度统一生效，这一点现有代码已经是对的（`ResolveSellPrice` 里 `multiplier` 对每个维度同样相乘），无需改动。

## 十、执行顺序（每步可独立验证，不留半成品）

**第 0 步** 恢复 stash（需用户确认）

**第 1 步** 解锁用户测试 —— 修 7.1 的 0% bug + 加 `cache_read` 输入框
验证：填四条渠道进价 + 利润率 0，查库 `settings.cost` 是否落盘

**第 2 步** 接展示与路由（阻塞点见第六节）
1. `model/sell_price.go` 下移纯计算，`service` 留转发，跑全量测试确认零行为变化
2. `parseChannelPriceMetadata` 增返 `settings.Cost`，改两个调用点
3. 渠道缓存 sync 时算全站卖价（按第九节决定的基准），存入新的 `model2sellPrice`
4. `resolveChannelPrice` 优先读卖价，`Source` 新增 `"cost"` 值
5. `buildChannelPriceRanks` 改按进价升序
6. 重新审视 `RepriceForChannel`：卖价若是全站统一的，跨渠道重试就不该改价，这个函数可能整体删除 —— 它的注释描述的正是「拿 A 的卖价卖 B 的成本」，与统一卖价互斥

**第 3 步** 官方价手填覆盖层（第八节）
新 option key + 读取优先级（覆盖 > 同步 > 无）+ 模型定价页加输入列
验证：手填后跑一次同步，确认不被覆盖

**第 4 步** 补全维度 —— `PerSecond` 进 DTO、`SellPriceToRatios` 输出全维度、`applyChannelSellPrice` 改写全维度、表单补九个维度（折叠区）

**第 5 步** 毛利报表 —— `channel_cost_daily` 字段够用（`ChannelId` / `ModelName` / `CostQuota` / `SellQuota` / `Requests`），毛利 = `SellQuota - CostQuota`。min 基准下非最低价渠道毛利为负是**设计结果**，报表要能正确显示负值并按渠道排序。注意 `ModelName` 存的是**上游模型名**，卖价按**客户端模型名**算，报表需同时展示两个名字，否则运营看不出 `gpt-5.5-thinking` 的亏损对应对外的 `gpt-5.5`。

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

# 后端常驻在 3001（无需重启，SyncOptions 默认 60s 会捡到新配置）
curl -s "http://127.0.0.1:3001/api/pricing/channels?model=deepseek-v4-flash-0731"
```

## 十二、端到端验收标准

填四条渠道进价（¥0.96 / ¥1.28 / ¥1.55 / ¥1.85），利润率 20%：

1. 广场展示的卖价 = 基准进价 × 1.2，四条渠道显示**同一个卖价**
2. 折扣 = 卖价 ÷ 官方价（官方价需先修，见第八节）
3. 智能路由优先命中最便宜的 xy
4. 真实请求的扣费 = 广场展示的卖价（**这是整件事的验收核心**）
5. 手工指定渠道（`<模型>/<线路码>`）时扣费不变
6. 毛利报表按渠道显示正负毛利

## 十三、边界（不要动）

- `service/text_quota.go` 的计费恒等式 `quota = tokens × modelRatio × groupRatio` 不改，只在配置与内核之间加换算层
- 表达式计费（`billing_mode == tiered_expr`）与本方案并存，走 `modelPriceHelperTiered`，不受影响
- 进价绝不能出现在对外响应里。`ChannelRoute` 喂的是公开页面可未登录访问的端点，注释已明确列出禁止字段
- `group_ratio` 不参与卖价（卖价是绝对价）。唯一例外是 0：那是把整个分组关成免费的开关，改成 1 等于开始向免费分组收钱
- 受保护标识（new-api / QuantumNous）一律不动

