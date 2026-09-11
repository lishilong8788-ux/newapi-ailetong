# Token 进销存与毛利管理 — 设计方案

> 状态:设计稿 v2(已经两轮多 agent 调研 + 全量事实核查修订),待评审
> 日期:2026-09-10
> 范围:上游渠道成本核算、毛利监控、低毛利自动处置、额度库存与对账

## 1. 目标与边界

### 1.1 要解决的问题

当前系统只有"卖"的一半账:每笔请求扣用户多少额度记得清清楚楚,但这笔请求我们付给上游多少钱、赚了多少、哪个渠道在亏钱——全部空白。运营只能靠上游账单月底对总数,单渠道、单模型的毛利无法回答,更做不到"这个渠道毛利掉到 5% 了,先停掉"。

### 1.2 目标

1. **算得清**:每笔消费都带上游成本,毛利可下钻到渠道 × 模型 × 时间。
2. **管得住**:成本价可配置、可继承、可批量维护,新增渠道不必手填几十个模型。
3. **防得早**:毛利跌破阈值分级预警,而不是等月底看账单。
4. **关得安全**:自动处置必须有样本量门槛、冷却期、保底渠道保护——绝不能因为毛利告警把服务打挂。
5. **对得上**:上游预付余额作为"库存",采购、消耗、结存三方可对账。

### 1.3 明确不做

- 不做上游账单自动抓取与自动对账(各家格式差异过大,先做人工录入 + 差异提示)。
- 不做按成本实时选路(见 §7.5 的理由,这是高风险改动,单独立项)。
- 不做多币种成本(统一以 USD 为成本记账本位,人民币按配置汇率折算展示)。
- 不改任何售价逻辑。本方案只**读**售价,不动计费内核。

## 2. 现状盘点

### 2.1 额度单位体系

```
QuotaPerUnit = 500000        common/constants.go:22   (var,可运行时改)
1 quota      = $0.000002
model_ratio  单位 = quota/token,1 ratio == $2 / 1M tokens
model_price  单位 = USD/次
billingexpr 系数单位 = USD/1M tokens(真实标价,无 /2 约定)
USDExchangeRate = 7.3        setting/operation_setting/payment_setting_old.go:18
```

成本侧换算(本方案的基础公式):

```
costQuota      = upstreamUSDPer1M / 1e6 * tokens * QuotaPerUnit
costQuota_call = upstreamUSDPerCall * QuotaPerUnit
```

**成本绝不乘 groupRatio** —— 分组倍率是售价折扣,不影响上游账单。

### 2.2 已有地基

| 能力 | 位置 | 可复用度 |
|---|---|---|
| 渠道自动禁用 + 原因/时间落库 + 通知 root | `service/channel.go:19`、`model/channel.go` 写 `other_info.status_reason` | 高,直接扩展 |
| 前端已渲染"自动禁用"态 + 原因 tooltip | `web/src/features/channels/components/channels-columns.tsx:955` | 高,零改动 |
| `admin_info` 自动对非管理员剥离 | `model/log.go:123` `delete(otherMap,"admin_info")` | 高,成本数据免费拿到权限控制 |
| 计费表达式引擎(编译缓存/版本化/AST 内省/饱和转换) | `pkg/billingexpr/` | 高,成本公式直接复用语言 |
| 按渠道维度聚合的接口骨架 | `model/usedata_flow.go:61` `GROUP BY ... channel_id` | 中,报表可照抄 |
| 上游价格同步(models.dev) | `controller/ratio_sync.go` | 中,可作成本价初始来源 |
| 定时任务 + 通知 + 分级配置的既有范式 | `main.go`、`service/system_task.go`、`setting/` | 高 |

### 2.3 硬约束(设计必须绕开的坑)

1. **预扣费在选渠道之前**。`ModelPriceHelper` 在重试循环外算价(`controller/relay.go:156`),渠道由循环内 `getChannel` 才选出。所以**成本只能在结算阶段按实际渠道算**,预扣阶段无法知道成本。这是整个方案最重要的约束。

2. **`RecordConsumeLogParams` 上下文严重不足**。只有 `PromptTokens`/`CompletionTokens`(`model/log.go:328`),拿不到 cache/audio/reasoning/image 明细,也拿不到 `ChannelType`、`UpstreamModelName`。所以成本**必须在 service 层算**,不能在 model 层算。

3. **跨库 JOIN 不可行**。`LOG_DB` 可以是 ClickHouse,且全代码库只碰 `logs` 一张表。任何要 join `channels` 的报表,事实表必须落主库。

4. **`logs` 明细不可靠**。无定时归档,但有一键 `DELETE`(`model/log.go:703`)和 ClickHouse TTL(`model/main.go:434`)。长期毛利趋势必须自持日汇总表。

5. **`Other` 字段不能在 SQL 层解析**。四套方言(SQLite/MySQL/PG/ClickHouse)的 JSON 函数零交集,SQLite 纯 Go 驱动的 JSON1 还不保证可用。要聚合的量必须是独立 bigint 列。

6. **`quota_data` 的落库法有缺陷**,不要复刻。`First` + `Updates` 无唯一索引、无 upsert、探测与更新间无锁(`model/usedata.go:108`),多节点 flush 会插重复行。

7. **`batchUpdate` 不能用于账务**。`map[int]int` 表达不了 (channel, model, day) 复合键;flush 失败仅记一条日志即丢弃(`model/utils.go:87`),无重试、无退出补刷。

8. **一条扣钱路径不落日志**。`PreWssConsumeQuota`(`service/quota.go:89`)只 `PostConsumeQuota` 不 `RecordConsumeLog`,这条路的成本会永久缺失,需单独补落点。

9. **多 key 渠道成本只能到 channel 级**。`ChannelInfo.MultiKeyStatusList` 有 key 级状态,但额度消耗不区分 key。

10. **余额 ≤ 0 禁用渠道绕过了全局开关**(`controller/channel-billing.go:587`),只看渠道自身 `AutoBan`。新增的毛利处置不要复制这个不一致。

11. **`upstream_model_name` 只在映射时落日志**。`other.upstream_model_name` 仅在 `IsModelMapped == true` 时写入(`service/log_info_generate.go:86`),而 relay/channel 下 12 个文件、28 处对 `info.UpstreamModelName` 赋值发生在 mapping 之后(剥 `-thinking` 后缀等,`relay/channel/openai/adaptor.go:258` 等),其中相当部分不设 `IsModelMapped`,Claude 甚至用上游响应反写(`relay/channel/claude/relay-claude.go:108`)。成本 key 必须无条件落该字段,否则会错配价目。

12. **没有主节点选举,也没有分布式锁**。`common.IsMasterNode` 只是 `NODE_TYPE != "slave"` 的配置约定(`common/init.go:89`),`common/redis.go` 无 SetNX,运维忘设 env 时每个节点都是 master。项目唯一可靠的跨节点防重是 `SystemTask` 的数据库租约(唯一索引 ActiveKey + 带条件抢占 + 心跳续租,`model/system_task.go:268`)。任何周期性自动处置必须走这套,不能裸 goroutine。

13. **复用 status=3 会被健康检查拉回**。`ShouldEnableChannel` 只认 `status == ChannelStatusAutoDisabled`(`service/channel.go:74`),毛利禁用的渠道 API 测试必然通过,会被 `controller/channel-test.go:949` 立即重新启用。

14. **通知有硬限流**。`NotifyUser` 按 notify type 限流,默认每 10 分钟仅 2 条(`common/init.go:191`)。批量触发的告警必须把 channelId 和级别编进 type 字符串(照 `service/channel.go:14` 的 `formatNotifyType`),否则多渠道同时告警只有前 2 条能发出。

## 3. 核心概念与口径

口径先定死,后面所有代码、UI、告警都用同一套词。口径混乱是这类系统最常见的翻车原因。

### 3.1 三个金额

| 概念 | 定义 | 数据来源 | 存储单位 |
|---|---|---|---|
| **收入** revenue | 用户被扣的额度 | `Log.Quota`,现成 | quota |
| **成本** cost | 我们付给上游的钱 | 本方案新增 | quota(同单位,便于直接相减) |
| **毛利** margin | revenue − cost | 计算得出 | quota |

成本也用 quota 存,不用 USD 浮点。理由:与收入同单位可直接整数相减,避免浮点误差累积,且复用现有 `common/quota_math.go` 的全套饱和转换。展示时再 `/QuotaPerUnit` 折成 USD/CNY。

### 3.2 毛利率 vs 加价率(必须区分)

这两个数国际上是两套口径,混用会让运营决策错得离谱:

```
毛利率 margin rate = (revenue - cost) / revenue      分母是收入
加价率 markup      = (revenue - cost) / cost         分母是成本

换算: margin = markup / (1 + markup)
      markup = margin / (1 - margin)
```

举例:成本 $100 卖 $130。加价率 30%,毛利率 23.1%。

**本方案的约定:**
- **配置时用加价率**。运营的心智模型是"在成本上加多少",`markup = 0.3` 直观。
- **报表和告警用毛利率**。这是财务和行业通用口径(SaaS 报表里的 gross margin 一律是收入口径)。
- UI 上两个数并排显示,标签写清楚,不给用户猜的机会。

### 3.3 进销存四账

| 账 | 含义 | 载体 |
|---|---|---|
| **进货** | 向上游充值/采购额度 | 新增 `channel_purchase` 表,人工录入 |
| **库存** | 上游账户未消耗的余额 | `channels.balance`(上游 API 抓取,真值)+ 采购推算值(对账用) |
| **销售** | 用户消耗 | `logs.quota`,现成 |
| **成本结转** | 每笔销售对应的上游成本 | 新增,本方案主体 |

**库存双轨制**:上游 API 抓的 `balance` 是真值但覆盖面有限(支持 11 种渠道类型,其中仅 Azure 是明确未实现的占位,其余未覆盖类型走 default 报错,`controller/channel-billing.go:455`);采购录入 − 累计成本 = 推算余额,覆盖全部渠道。两者都有时做差异提示,差异超阈值说明成本价配错了或有漏记。这是这套账最有价值的自校验机制。

## 4. 成本模型

### 4.1 成本价的维度:渠道 × 上游模型

这是与售价最大的结构性差异。售价的 key 是 `OriginModelName`(用户请求的模型名),成本的 key 必须是 `(channel_id, upstream_model_name)` —— 同一个 `claude-sonnet-4` 走官方直连和走中转商,成本可能差一倍。用 `origin_model` 当成本 key 是错的。

`upstream_model_name` 取 `relayInfo.UpstreamModelName` 在**落日志时刻的快照**(经 `model_mapping` 改写、再经 adaptor 二次改写后的真名),未映射时等于原名。

三条取值规则(来自选路调研的结论):

1. **无条件落库**。现在 `other.upstream_model_name` 只在 `IsModelMapped == true` 时写(`service/log_info_generate.go:86`、`service/task_billing.go:50`),而 adaptor 的后缀剥离不设该标记,`gpt-5-thinking → gpt-5` 这类请求会退化成 origin 名错配价目。必须去掉门控,这是**前置改造项**。
2. **不要在统计侧重放 mapping**。mapping 是 per-channel 的、重试后会变、链式改写有环检测特例、adaptor 改写完全在 mapping 之外——任何离线重放都会和线上不一致。日志是唯一真值源。
3. **重试换渠道后 mapping 自动重算**(`relay/common/relay_info.go:206` 每轮重置后 `ModelMappedHelper` 重跑),日志里的 `upstream_model_name` 天然与 `channel_id` 自洽,无需额外处理。

### 4.2 四级解析链

按优先级从高到低,命中即停:

```
1. 渠道模型精确价    channel_cost.models[upstream_model]     最准,人工/同步维护
2. 渠道默认加价率     channel_cost.default_markup            兜底,一个数搞定整个渠道
3. 上游报告真值      usage.Cost(OpenRouter 等)              准但覆盖窄
4. 官方价 × 折扣     official_prices × channel_discount       批量维护的主力
```

**官方价的数据通路已核实**:`controller/ratio_sync.go` 已从 models.dev 的 `/api.json` 抓取(`modelsDevCost{Input, Output, CacheRead}`,:817,单位就是 USD per 1M tokens),但目前**立即换算成 ratio 丢弃原值**(`model_ratio = input/2`,:899-960),且跨 provider 重名模型取最便宜候选。成本侧复用同一抓取骨架,但在换算前把 `Input/Output/CacheRead` 原值存进 `cost_setting.official_prices`,不经过 ratio 中转——官方价是成本侧四级链的源头,必须保留 USD/1M 原始口径。

**上游报告真值的覆盖面(已核实,比想象窄)**:`Usage.Cost`(`relaykit/dto/openai_response.go:243`,注释就写着 OpenRouter Params)只在 OpenRouter 系响应的 `usage.cost` 字段反序列化时填充,类型是 `any`(可能是 number 也可能是 object)。目前全仓有四处触碰:两处 relayconvert 格式转换透传、`service/quota.go:270`(OpenRouter cache-creation token 反算,`cost, _ := usage.Cost.(float64)` 直接断言失败得 0)、`service/text_quota.go:274`(反算的触发条件之一)——**现有计费已把这个字段当真值消费并影响扣费**。成本侧落 `upstream_cost_raw` 时必须与 `CalcOpenRouterCacheCreateTokens` 用同一套形态兜底逻辑(同时兜 number/object),否则同一响应被解析两次、口径不一致。第 3 级只对"上游恰好按 OpenRouter 格式返回 cost 字段"的渠道有效。

### 4.3 三种成本计价模式

| 模式 | 表达 | 适用 |
|---|---|---|
| `ratio` | 每类 token 一个 USD/1M 单价 | 绝大多数文本模型,最常见 |
| `per_call` | USD/次 | 图像、视频、MJ 等按次计费上游 |
| `expr` | 复用 billingexpr 表达式 | 阶梯价、长上下文双档、缓存分价 |

`ratio` 模式的字段与售价倍率一一对应,便于运营对照填:

```
input / output / cache_read / cache_write_5m / cache_write_1h
audio_input / audio_output / image_input / image_output / reasoning
```

单位统一 **USD per 1M tokens**,与 provider 官网标价同构,照抄即可。

### 4.4 复用 billingexpr 的可行性与红线

可行,语言完全够用(`p/c/len/cr/cc/cc1h/img/img_o/ai/ao` 十个变量 + `tier()` + 条件函数),系数单位已经是 USD/1M 真实标价,编译缓存/版本化/AST 内省/饱和转换全部现成。

但有四条红线:

1. **必须新开 option 键** `cost_setting.cost_expr`,绝不能与售价的 `billing_setting.billing_expr` 共用,否则售价配置会被成本覆盖。
2. **不能走 `TryTieredSettle` 的 quota 换算**,它在 `settle.go:28` 会乘 `snap.GroupRatio`。成本侧自己调 `RunExprWithRequest` + `rawCost/1e6*QuotaPerUnit`(照 `relay/helper/price.go:295` 那两行)。
3. **编译缓存要隔离**。`maxCacheSize = 256`(`pkg/billingexpr/compile.go:14`),满了整体 flush。渠道数 × 模型数很容易挤爆售价的槽位。给成本单独一份 cache 实例。
4. **求值失败记 `unknown` 不记 0**。记 0 会让毛利虚高到 100%,是最危险的静默错误。

### 4.5 成本置信度

每笔成本都带 `cost_source`,报表必须按它分层展示,不能把猜的和准的混在一起算总毛利率:

| source | 含义 | 置信度 |
|---|---|---|
| `exact` | 渠道模型精确价 | 高 |
| `reported` | 上游返回真值 | 高 |
| `markup` | 渠道默认加价率反推 | 中 |
| `official` | 官方价 × 折扣 | 中 |
| `unknown` | 无法确定 | 无 —— **不参与毛利计算**,单独统计"未定价流量占比" |

"未定价流量占比"是这套系统的健康度第一指标。超过 5% 说明成本表有大洞,此时任何毛利数字都不可信,告警必须先停掉自动处置。

## 5. 数据模型

全部落**主库**(`DB`),不碰 `LOG_DB`。理由见 §2.3 的约束 3 与"ClickHouse 分支完全绕过 `AutoMigrate`"(`model/main.go:411`)。

### 5.1 渠道成本配置:不建表,用 JSON 列

成本配置写进 `channels.settings`(`Channel.OtherSettings`)的一个新子对象。理由:免迁移、免 join、且 `ChannelMeta.ChannelOtherSettings` 已经带进 `RelayInfo`,结算时读取路径已通。

```go
// relaykit/dto/channel_settings.go 的 ChannelOtherSettings 内新增
type ChannelCostSettings struct {
    Mode          string                       `json:"mode,omitempty"`           // ratio|per_call|expr
    DefaultMarkup *float64                     `json:"default_markup,omitempty"` // 加价率,如 0.3
    Discount      *float64                     `json:"discount,omitempty"`       // 相对官方价的折扣,如 0.85
    Models        map[string]ModelCostPrice    `json:"models,omitempty"`         // upstream_model -> 单价
    Expr          string                       `json:"expr,omitempty"`
    Currency      string                       `json:"currency,omitempty"`       // 预留,默认 USD
    UpdatedAt     int64                        `json:"updated_at,omitempty"`
}

type ModelCostPrice struct {
    Input, Output           *float64 `json:"input,omitempty"`  // USD per 1M tokens
    CacheRead, CacheWrite5m *float64 `json:"cache_read,omitempty"`
    CacheWrite1h            *float64 `json:"cache_write_1h,omitempty"`
    AudioIn, AudioOut       *float64 `json:"audio_in,omitempty"`
    ImageIn, ImageOut       *float64 `json:"image_in,omitempty"`
    Reasoning               *float64 `json:"reasoning,omitempty"`
    PerCall                 *float64 `json:"per_call,omitempty"`
}
```

全部指针 + `omitempty`,遵循项目"可选标量必须用指针"的规则,区分"未配置"与"配置为 0"(免费模型是合法的 0 成本)。

### 5.2 日汇总事实表(报表主力)

```go
type ChannelCostDaily struct {
    Id            int    `json:"id"`
    DayTs         int64  `json:"day_ts" gorm:"bigint;uniqueIndex:uk_ccd,priority:1;index:idx_ccd_ch_day,priority:2"`
    ChannelId     int    `json:"channel_id" gorm:"uniqueIndex:uk_ccd,priority:2;index:idx_ccd_ch_day,priority:1"`
    ModelName     string `json:"model_name" gorm:"type:varchar(128);uniqueIndex:uk_ccd,priority:3;default:''"`
    RequestCount  int    `json:"request_count" gorm:"default:0"`
    TokenUsed     int64  `json:"token_used" gorm:"bigint;default:0"`
    RevenueQuota  int64  `json:"revenue_quota" gorm:"bigint;default:0"`
    CostQuota     int64  `json:"cost_quota" gorm:"bigint;default:0"`
    UnknownCount  int    `json:"unknown_count" gorm:"default:0"`  // cost_source=unknown 的请求数
    UnknownQuota  int64  `json:"unknown_quota" gorm:"bigint;default:0"`
    ReportedQuota int64  `json:"reported_quota" gorm:"bigint;default:0"` // 上游报告值,偏差监控用
}
```

关键点:
- **唯一索引 `uk_ccd(day_ts, channel_id, model_name)`** —— 支持 `clause.OnConflict` upsert,这是 `quota_data` 缺的东西。
- **复合索引 `idx_ccd_ch_day(channel_id, day_ts)`** —— 正是 `logs` 和 `quota_data` 都缺、导致渠道×时间聚合退化的那个索引。
- 日桶在 Go 侧算(`dayTs = ts - ts%86400`),SQL 里只 `GROUP BY day_ts`,绕开跨库日期函数问题。
- `int64` 存 quota 累计值。单笔 quota 受 int32 限制,但**日累计必须 int64**,否则高流量渠道会溢出。
- 不用 `gorm:"default:true"`(AGENTS.md 明令),数值默认全 `default:0`。

### 5.3 采购单(进货账)

```go
type ChannelPurchase struct {
    Id           int     `json:"id"`
    ChannelId    int     `json:"channel_id" gorm:"index:idx_cp_ch_time,priority:1"`
    PurchasedAt  int64   `json:"purchased_at" gorm:"bigint;index:idx_cp_ch_time,priority:2"`
    AmountUSD    float64 `json:"amount_usd"`              // 实付金额,USD
    AmountLocal  float64 `json:"amount_local"`            // 实付本币,留档
    ExchangeRate float64 `json:"exchange_rate"`           // 当时汇率,留档
    BonusUSD     float64 `json:"bonus_usd"`               // 赠送额度(影响实际单位成本)
    Vendor       string  `json:"vendor" gorm:"type:varchar(128);default:''"`
    OrderNo      string  `json:"order_no" gorm:"type:varchar(128);index;default:''"`
    Note         string  `json:"note" gorm:"type:varchar(512);default:''"`
    OperatorId   int     `json:"operator_id"`
    CreatedAt    int64   `json:"created_at" gorm:"bigint"`
}
```

**赠送额度必须单独记**。充 $100 送 $20,实际单位成本是 `100/120 = 0.833`,不记 bonus 会把成本高估 20%。这是转售业务最常见的算错点。

### 5.4 明细层:塞进日志 `other.admin_info.cost`

不新建单请求明细表。理由:`logs` 已经有全部维度,再建一张一对一的表是纯冗余,且写入量翻倍。成本明细嵌进 `other.admin_info.cost`,自动获得管理员可见性(`model/log.go:123`)。

```json
{"cost_quota": 1234, "cost_source": "exact", "cost_reported": 1200,
 "cost_model": "claude-sonnet-4", "margin_quota": 866, "expr_hash": "ab12cd"}
```

若日后需要独立明细表做深度追溯,再单独立项并**从第一天给它保留策略**(参照 `perf_metrics` 的 `RetentionDays`),不要指望 `logs` 还在。

### 5.5 迁移

`ChannelCostDaily` 与 `ChannelPurchase` 加进 `model/main.go` 的 `AutoMigrate` 列表。两张都是新表,无 `ALTER COLUMN`,三库直接兼容。`channels.settings` 是已有 TEXT 列,加子对象零迁移。

## 6. 成本计算链路

### 6.1 注入点:与 `attachQuotaSaturation` 同构

新建 `service/cost_accounting.go`,在各计费路径的 `RecordConsumeLog` 前一行调用:

```go
func attachUpstreamCost(ctx *gin.Context, relayInfo *relaycommon.RelayInfo,
        inputs CostInputs, other map[string]interface{})
```

**为什么是这个位置而不是 hook 反转**:在 `PostTextConsumeQuota` 内部同时握有 `relayInfo`(channel_id、channel_type、upstream_model_name)、`summary`(全 token 明细)、`usage`(原始 `CompletionTokenDetails`、`usage.Cost`)。往下走到 `model` 层这些全没了(§2.3 约束 2)。而且 `RecordConsumeLog` 开头就 `if !LogConsumeEnabled { return }`(`model/log.go:344`),写在里面会被静默跳过。

这个形状与既有的 `attachQuotaSaturation`(`service/log_info_generate.go:40`)、`appendUsageBillingPathForLog`(`service/billing_usage.go:57`)完全一致,是本代码库的既定习惯,reviewer 不需要理解新概念。

### 6.2 需要挂钩的计费路径与流量口径

| # | 路径 | 挂钩位置 |
|---|---|---|
| 1 | 文本/流式/embedding/rerank/image | `service/text_quota.go:526` 前 |
| 2 | 音频 | `service/quota.go:368` 前 |
| 3 | WSS 终局 | `service/quota.go:245` 前 |
| 4 | **WSS 增量** | `service/quota.go:150` —— **需新增日志落点**,当前完全不落 |
| 5 | Task 提交 | `service/task_billing.go:55` 前 |
| 6 | Task 差额 | `service/task_billing.go:269` 前 |
| 7 | MJ | `relay/mjproxy_handler.go:276`、`:641` 前 |
| 8 | 违规费 | 跳过 —— 违规费是罚款不是销售,无对应上游成本 |
| 9 | 渠道测试 | **排除出毛利统计**(见下),但上游成本真实发生,记入运营成本桶 |

退款路径(`RefundTaskQuota`、`RefundMidjourneyQuota`)必须**同步冲减成本**,否则退款后毛利虚高。

**流量口径(毛利统计的过滤规则):**

- **渠道测试必须排除**。它是纯运营成本,与客户收入无关;算进毛利会系统性拉低毛利率,且偏差集中在"渠道刚被禁用后频繁重测"的时段——正好是 L3/L4 判定最敏感的时候,会形成「测试拉低毛利 → 触发降权 → 更多测试」的正反馈。它的上游成本记入单独的**运营成本桶**,在渠道成本报表可见但不进毛利分母。
- **playground 建议排除**,成本同样进运营成本桶。它真实扣了钱包、有真实成本,但走的是管理员分组倍率,不代表真实售价结构,混入会给小样本渠道带噪声。
- 识别一律用新增的 `traffic_source` 字段(§6.3),禁止用 `token_name` 字符串匹配(中文名硬编码、普通 token 前缀可伪造)。playground 的临时 token 名是服务端生成的 `playground-{UsingGroup}`(`controller/playground.go:59`),本身可靠,但更干净的做法是在 `/pg` 路由注入 context key。`traffic_source` 加进 `GenerateTextOtherInfo` 后,渠道测试日志自动继承(`buildTestLogOther` 复用它,`controller/channel-test.go:554`),只需写一处。

**重试成本口径(结构性现实:一次用户请求只产生一条 consume log,记成功渠道;下游计费也只发生一次,`controller/relay.go:167` 预扣在循环外):**

- 收入归成功渠道,与现状一致,不改。
- 失败尝试分两类:上游非 200 在 `DoResponse` 之前返回的(`relay/compatible_handler.go:198`),无 token 成本,按零成本计——这是正确近似。
- **`DoRequest` 失败(`relay/compatible_handler.go:190`)与 `DoResponse` 失败(`:209`)两类会重试,但请求可能已被上游计费而本地零记录**。这类"疑似有成本的失败"按不可核对成本计入 unknown 桶,并计入 `max_unknown_rate` 的分母。效果:超时频发的渠道天然抬高 unknown 率,从而被禁止自动处置——这是期望行为,超时频发的渠道恰恰是成本最不可知的渠道。
- 渠道报表单列「重试失败次数」指标,数据源 `other.admin_info.use_channel`(完整尝试链,`service/log_info_generate.go:97`)。

### 6.3 需要补齐的上下文字段

现在丢失、成本计算需要的:

```
channel_type              relayInfo.ChannelType,当前完全没落
upstream_model_name       现在只有 IsModelMapped 时才写,需无条件写(§4.1 前置改造)
completion_image_tokens   usage.CompletionTokenDetails.ImageTokens,丢失
completion_audio_tokens   文本路丢失
reasoning_tokens          全仓无人读,丢失
text_input / text_output  文本路丢失(音频路已有)
upstream_cost_raw         usage.Cost,真值但覆盖窄(仅 OpenRouter 系,见 §4.2),丢失
OtherRatios(含 n)        文本/图像路未落(task 路已平铺)
traffic_source            api|playground|channel_test,新增,毛利统计按此过滤
is_multi_key / multi_key_index   任务链路缺失,需补(文本路已有)
```

`traffic_source` 是新增字段里最便宜也最关键的一个:渠道测试的识别目前靠硬编码中文 `"模型测试"`(`controller/channel-test.go:503`),playground 靠 `token_name` 前缀(用户可伪造 token 名),都不可靠。在 `service/log_info_generate.go` 与 `controller/channel-test.go` 的测试日志两处写入,统计侧按它过滤,成本很低但决定毛利数据可不可信。

顺带修一个既有 bug:`other["image_output"]`(`service/text_quota.go:486`)写的其实是**输入**图片 token,键名与语义相反。

### 6.4 汇总写入:仿 `perf_metrics`,不仿 `batchUpdate`

```
内存桶 map[(dayTs,channelId,model)]aggregate
  → 定时 flush(默认 60s)
  → clause.OnConflict{Columns: uk_ccd, DoUpdates: gorm.Expr("x + ?")} 累加 upsert
  → flush 失败把 drained 数据加回桶(照 pkg/perf_metrics/flush.go:54)
  → main.go 退出路径补刷(照 main.go:244 的 SaveQuotaDataCache)
```

`batchUpdate` 不可用的三个理由已在 §2.3 约束 7 列明。**失败回填 + 退出补刷是账务数据的底线**,`batchUpdate` 两个都没有。

### 6.5 计费安全不变量(必须遵守)

1. 禁止裸 cast。全部走 `common/quota_math.go`:`QuotaFromFloatChecked` / `QuotaRoundChecked` / `QuotaFromDecimalChecked`。
2. clamp 上抛并审计,复用 `attachQuotaSaturationToOther` 路径。
3. **成本不得为负**。任何算出 < 0 的分支钳到 0 并 `common.SysError`。成本变负数 = 毛利虚高 = 自动处置误判。
4. 单价上界必检。成本单价从 JSON 配置读入,`*float64` 可以是任意大的数;设上限(如 10000 USD/1M)并拒绝 NaN/Inf。
5. 日累计用 int64,单笔用 int(受 int32 约束)。
6. 回归测试跟着边界放,`testify/require` + 表驱动。

## 7. 毛利守护(自动处置)

这是最容易做成事故的部分。直接"毛利 < X% 就关渠道"会在多种情况下打挂服务:样本量太小的统计噪声、成本价配错导致的假告警、关掉最后一个可用渠道、多节点重复执行、以及健康检查把渠道拉回来。设计原则是**分级、有门槛、可回滚、有保底、防重复**。

国际实践也支持保守方向(详见 §11.1):业界产品化的是「毛利进排序目标 + 硬性价格地板 + 例外走审批」;真正不可逆的自动下架只有 Amazon CRaP 这类自营采购场景,且其副作用被广泛记录(沃尔玛 2010 年砍品类后 2011 年被迫加回 8500 个 SKU)。电商排序的官方原语是 boost/bury/pin/hide 四档,不是二值开关——本方案的 L3 降权(bury)对应其中最常用的一档。

### 7.1 四级响应梯度

| 级别 | 触发 | 动作 | 可逆 |
|---|---|---|---|
| L1 观察 | 毛利率 < `warn_rate`(默认 20%) | 仅打标 + 报表高亮 | — |
| L2 告警 | 毛利率 < `alert_rate`(默认 10%) | 通知 root + 渠道页告警徽章 | — |
| L3 降权 | 毛利率 < `demote_rate`(默认 5%) | `priority` 下调(不改 status) | 自动恢复 |
| L4 停用 | 毛利率 < `disable_rate`(默认 0%,即亏损) | `status = 4` 毛利禁用 | 需人工或冷却后自动 |

**L3 降权是核心设计**。它比停用温和得多:渠道还在,只是优先级降低,流量自然流向毛利更好的渠道。业界原语叫 bury(压排序)而非 hide(下架),Adobe 官方措辞是 "slightly prioritize products with higher profit margins without compromising relevance"。

**L4 必须用新的 status 值 4,不能复用 3**。`ShouldEnableChannel` 只认 `status == ChannelStatusAutoDisabled`(`service/channel.go:74`),毛利禁用的渠道 API 测试必然通过(它没坏,只是不赚钱),复用 3 会被健康检查立即拉回,L4 形同虚设。新增值的配套改动必须逐个确认:

```
common/constants.go               新增 ChannelStatusCostDisabled = 4
service/channel.go:74             ShouldEnableChannel 保持只认 3,天然排除 4
controller/channel.go:1181        isManageableChannelStatus 允许人工把 4 拉回 1
model/channel.go:893              DeleteDisabledChannel 明确是否包含 4(建议不包含)
model/channel.go:703              handlerMultiKeyUpdate 的恢复路径要加 status==4 保护,
                                 否则多 key 渠道单 key 恢复会无条件拉回 Enabled,绕过毛利禁用
前端渠道状态映射                    CHANNEL_STATUS_CONFIG 加第 4 档
```

选路层天然兼容新值:选路只认 `== ChannelStatusEnabled`(`model/channel_cache.go:54`),`abilities.enabled` 的投影也自动为 false,不需要改选路代码。

**降权用 `priority` 而不是 `weight`**:`priority` 是分层选路的第一排序键,下调一层就能让流量优先走别的渠道,而 `weight` 只在同层内做加权随机。但降权的实现有三条硬约束:

1. **必须双表同写**。`channels.priority` 与 `abilities.priority` 是两个独立的真值源,内存缓存路径读前者(`model/channel_cache.go:73`),DB 路径(关缓存部署)只读后者(`model/ability.go:95`)。只改 channels 表,关缓存部署上降权完全无效。
2. **写完必须显式触发 `InitChannelCache()`**。否则最坏延迟 `SyncFrequency`(默认 60 秒)。现成先例:`BatchUpdateChannelStatus` 在 `changedCount > 0` 后显式调它(`controller/channel.go:1166`)。注意它是全量重载,不要放进秒级循环。
3. **不能用现有的 `UpdateAbilities`**(全删重建,并发下有短暂窗口渠道无 ability 行),新增窄函数 `UPDATE abilities SET priority=? WHERE channel_id=?` + channels 同步。
4. **status=4 的 abilities 投影是免费的**:走 `UpdateChannelStatus` 时其 defer 里的 `UpdateAbilityStatus(channelId, status == ChannelStatusEnabled)`(`model/channel.go:758`)自动把 abilities.enabled 置 false,不需要单独改 abilities 的状态。

原始 priority 与降权状态存 `channels.settings` 的成本子对象。**必须存原值、恢复时写回原值,不能用加减法**——两个节点并发读改写会互相污染。一个已知边界要写进文档:**单渠道短路**(`model/channel_cache.go:136`):某 (group, model) 只剩一个渠道时 priority/weight 全被忽略,降权对独占渠道是空操作——这与 §7.2 第 5 条保底保护是同一个边界。

### 7.2 六重触发门槛(防噪声与误伤)

任何级别的自动动作都必须**全部**满足:

```
1. 样本量门槛     窗口内请求数 >= min_requests(默认 100)
2. 金额门槛       窗口内收入 >= min_revenue_quota(默认等值 $1)
3. 定价覆盖门槛   unknown 占比 <= max_unknown_rate(默认 5%)
4. 冷却期        距上次自动动作 >= cooldown(默认 30 分钟,状态持久化)
5. 保底渠道保护   该渠道不是任何 (group, model) 的最后一个可用渠道
6. 豁免名单       渠道/模型不在 protect_list 里(见下)
```

第 3 条最关键:**成本数据不可信时,禁止任何自动处置**。

**第 5 条的实现**:不能用 `IsChannelEnabledForGroupModel`(它回答"渠道在不在列表里",逐渠道逐模型地问是查询风暴;且缓存路径下它读内存 map 不读 abilities)。正确做法是在 `model` 包内新增一次持锁快照:

```go
// 返回该渠道独占的 (group, model) 对;空 slice = 可安全停用
// group2model2channels 是包私有倒排索引,持 channelSyncLock.RLock 一次遍历
func GetSoleProviderPairs(channelID int) [][2]string
```

纯内存、O(group×model 启用组合数)、无 SQL,返回的 pair 列表正好填进通知文案「因保底保护未执行停用:group=X, model=Y」。两个已知偏差(都可接受,要写进实现文档):快照有 ≤60s 陈旧度;`CacheUpdateChannelStatus` 启用时不回填路由表(`model/channel_cache.go:280`),刚恢复的渠道暂时不在 map 里,可能误判"是最后一个"而放弃停用——偏保守方向。关缓存部署需要 DB 版本:`GROUP BY group, model HAVING COUNT(*)=1 AND MAX(channel_id)=?`(注意 `group` 保留字用 `commonGroupCol`)。

**第 6 条豁免名单来自零售业的 KVI 教训**:McKinsey 的数据是零售商约 1/5 的商品**按设计**就是低毛利(价格形象商品,消费者记价格的那些)。对应到 API 转售:引流模型(明显低于市场价的招牌模型)可能整体低毛利,但砍掉它用户就走了。`protect_list` 是渠道级 + 模型级两个名单,默认空,由运营维护。

### 7.3 评估窗口

滑动窗口,默认 1 小时,数据源是 `channel_cost_daily` 的当日行 + 内存桶未 flush 部分。不用 `logs` 明细做实时聚合——`logs` 没有 `(channel_id, created_at)` 复合索引。

窗口长度可配。短窗口反应快但噪声大,长窗口稳但滞后。默认 1 小时是折中;对流量小的渠道,样本量门槛会自动让它落不到触发条件(小流量渠道的毛利波动没有统计意义)。

**多实例部署下,巡检必须走 `ScheduledSystemTaskHandler` 而非裸 goroutine**。`IsMasterNode` 只是 `NODE_TYPE != "slave"` 的配置约定,没有选举、没有分布式锁(§2.3 约束 12)。裸 goroutine 的后果:N 节点 = N 倍降权/通知;并发读改写 `channels.settings` 会让原始 priority 永久污染。`SystemTask` 的数据库租约(ActiveKey 唯一索引 + 带条件抢占 + 心跳续租,`model/system_task.go:268`)天然解决,且免费获得运行历史与前端任务列表。

实现契约(漏一个方法会**静默**降级为"只能手动触发",无编译错误——`logCleanupHandler` 就是活例子,`service/system_task.go:269` 的类型断言失败即跳过):

```go
costGuardHandler 需实现全部 5 个方法:
  Type() string           "cost_guard"
  Run(ctx, task, runner)  巡检 + 分级处置,须调 model.FinishSystemTask 终结状态
  Enabled() bool          cost_setting.enabled && guard_enabled
  Interval() time.Duration 窗口周期
  NewPayload() any        巡检参数快照
```

**冷却期状态必须持久化**(DB 或 channels.settings),不能放内存——多节点各有一份内存状态等于没有冷却期。

### 7.4 通知与审计

**通知**:复用 `NotifyRootUser`(`service/user_notify.go:16`),但 notify type 必须把 channelId 和告警级别编进去(照 `formatNotifyType` 的手法,`service/channel.go:14`),因为限流桶就是按 type 字符串分的,默认每 10 分钟仅 2 条(`common/init.go:191`)。不编码的话,一次批量降权只有前 2 个渠道能通知到。新增 `relaykit/dto/notify.go` 的 `NotifyTypeCostAlert` 常量(注意 relaykit 是独立 module,改完要 `GOWORK=off go build` 验证)。

**审计**:`UpdateChannelStatus` 全程不写任何 Log 行,`other_info.status_reason` 是单槽位、会被下次状态变更覆盖,事后无法回答"上周三谁把这个渠道降权了"。每次自动处置(L2/L3/L4)必须显式写一条 `model.RecordOperationAuditLog`(`model/log.go:229`,action 用 `cost.auto_demote` / `cost.auto_disable`),并登记进 `controller/audit.go:18` 的模板表。这样自动处置与人工改价在同一张审计流里,时间线可对齐。人工写接口挂 AdminAuth 后,`middleware/auth.go:69` 的兜底审计自动留痕,无需额外埋点。

**与既有自动禁用的关系**:L4 复用 `service.DisableChannel` 的通知形状,但状态写 4(见 §7.1);且**必须同时**受全局开关与渠道自身 `AutoBan` 双重约束,不复制余额 ≤0 路径绕过全局开关的既有不一致(`controller/channel-billing.go:587`)。

**自动恢复**:L3 在毛利回到 `warn_rate` 以上且持续一个窗口后自动写回原 `priority`。L4 **默认不自动恢复**(亏损是配置问题或上游涨价,需要人看一眼),但提供 `auto_recover_hours` 选项。注意恢复路径要走与人工启用相同的 `InitChannelCache()` 显式刷新——`EnableChannel` 走的 `CacheUpdateChannelStatus` 启用时**不回填路由表**(`model/channel_cache.go:280`),不刷缓存的恢复在 60 秒内选不到该渠道。

### 7.5 为什么不做按成本实时选路

技术上可行(在 `getChannel` 排序里插入成本维度),但有三个问题:

1. **预扣费在选渠道之前**(§2.3 约束 1),要按成本选路必须重构定价时机,动的是计费内核。
2. 会导致**流量雪崩**:所有请求瞬间涌向最便宜的渠道,触发其限流,再集体切换,产生振荡。真要做需要配合平滑/抽样机制。
3. **成本最低 ≠ 综合最优**:便宜渠道往往质量差、延迟高、失败率高,失败重试的成本可能高于差价。

结论:通过 L3 降权间接实现"倾向低成本渠道"已经能拿到大部分收益,风险低一个数量级。真正的成本感知路由单独立项,不在本方案范围。

## 8. 配置项

新建 `setting/cost_setting/config.go`,走 `config.GlobalConfig.Register("cost_setting", ...)` 的前缀式加载。范例照 `setting/perf_metrics_setting/config.go`(纯标量)与 `setting/operation_setting/monitor_setting.go`(开关+阈值+周期的组合形态,业务形态最接近)。

```
cost_setting.enabled                  bool    总开关,默认 false
cost_setting.guard_enabled            bool    自动处置开关,默认 false(独立于 enabled)
cost_setting.official_price_source    string  官方价来源:models_dev|manual
cost_setting.official_prices          json    模型 -> USD/1M 单价(map[string]float64)
cost_setting.default_discount         float   全局默认折扣,默认 1.0

cost_setting.warn_rate                float   0.20
cost_setting.alert_rate               float   0.10
cost_setting.demote_rate              float   0.05
cost_setting.disable_rate             float   0.00
cost_setting.demote_priority_delta    int     降权幅度,默认 10

cost_setting.window_minutes           int     60
cost_setting.min_requests             int     100
cost_setting.min_revenue_quota        int     500000($1)
cost_setting.max_unknown_rate         float   0.05
cost_setting.cooldown_minutes         int     30
cost_setting.auto_recover_hours       int     0 = 不自动恢复
cost_setting.protect_last_channel     bool    true
cost_setting.flush_interval_seconds   int     60
cost_setting.protect_channels         json    豁免渠道 ID 列表
cost_setting.protect_models           json    豁免模型名列表
```

**注册机制的关键点(漏了配置项就不存在):**

- 前缀式配置由 `handleConfigUpdate`(`model/option.go:637`)按 `.` 拆前缀自动接管,**不需要在任何 switch 里加 case**;`InitOptionMap` 经 `ExportAllConfigs()` 自动铺进 OptionMap。
- 但 `init()` 依赖包被 import 才会执行——**必须在 `main.go` 加空导入** `_ "…/setting/cost_setting"`(照 `main.go:32` 的 `performance_setting` 先例),否则配置项在 OptionMap 里根本不存在。
- 前端提交是**逐 key 单独 PUT**,多节点靠 `SyncOptions`(60s 轮询)传播。

两个开关分离是刻意的:`enabled` 只开核算与报表,`guard_enabled` 才开自动处置。**上线必须分两步**——先只核算,盯一周确认成本数据准了,再开处置。默认全 false,不影响任何现有部署。

**阈值校验必须是三件套,光有前端 `.refine()` 不够:**

1. 前端 zod `.refine()` 做跨字段校验(照 `agent-settings-form.ts:58`);
2. **前端保存顺序排序** `costOptionSaveOrder()`:把 `disable_rate` 排最前、`warn_rate` 排最后串行提交。因为后端一次只收一个 key,先到的 key 会拿新值与**尚未更新的旧值**比较,不排序会把合法修改误判为违反链式关系(这套先例在 `agent-settings-form.ts:88` + `agent-settings-section.tsx:102`);
3. 后端 per-key 兜底校验,写在 `controller/option.go` 的 `UpdateOption` switch 里(跨字段范例 `:366`,读内存里当前的其他阈值比较),每个 rate 还要独立的 `[0,1]` 范围 + NaN 检查。

链式约束:`disable_rate <= demote_rate <= alert_rate <= warn_rate`,且各值 ∈ [0,1]。

另有一个静默失败点要防:配置框架对 int 字段解析失败会 `continue` 静默保留旧值(`setting/config/config.go:212`),表现为「保存成功但没生效」——后端校验必须拒绝 NaN/非法数字,让保存直接报错而不是静默吞掉。

## 9. 接口

**权限分两档,不是全部 AdminAuth**:

```
查询类(AdminAuth,与 /log /data 同级):
GET  /api/cost/overview            总览:收入/成本/毛利/毛利率/未定价占比
GET  /api/cost/trend               趋势:按天/小时分桶
GET  /api/cost/channels            按渠道明细 + 排序分页
GET  /api/cost/models              按模型明细
GET  /api/cost/channel/:id         单渠道下钻(按模型)
GET  /api/cost/purchase            采购单列表
GET  /api/cost/inventory           库存对账:抓取余额 vs 推算余额 + 差异

写类(RootAuth,性质等同 /option 与渠道敏感写):
PUT  /api/cost/channel/:id/price   保存渠道成本配置
POST /api/cost/channel/batch-price 批量设置成本(按 tag/type 筛选)
POST /api/cost/purchase            录入采购单
POST /api/cost/recalculate         按时间范围重算汇总(改了成本价后回溯)
```

理由:`batch-price` 一次改几十个渠道的成本、`recalculate` 重写历史汇总、改价直接改变计费口径——这些是 root 级动作;毛利报表是运营日常,给 admin。挂 AdminAuth 及以上后,`middleware/auth.go:69` 的兜底审计自动留痕。更细的粒度照渠道敏感写的模式:渠道敏感写不是 RootAuth,而是 `AdminAuth()` 组上再挂 `RequirePermission(ChannelSensitiveWrite)`(`router/channel-router.go:22`),且 `ActionSensitiveWrite` 不给 `DefaultRoles`,默认连 admin 都没有、仅 root 豁免(`service/authz/resources_channel.go:45`)。成本写接口推荐同样注册 `service/authz/resources_cost.go` 的 `cost:read` / `cost:write` 权限点,`ActionSensitiveWrite` 留空即默认不授予。

`batch-price` 是运营刚需。按 `tag` 或 `type` 批量设折扣/加价率,否则几十个渠道 × 几十个模型的成本表没人愿意维护 —— 这也是同类产品最常被吐槽的地方。

`recalculate` 从 `logs` 明细重算指定窗口的 `channel_cost_daily`。改了成本价后历史毛利需要回溯修正。注意它依赖 `logs` 还在(§2.3 约束 4),UI 上要提示可回溯范围;大范围重算可能跑很久,复用 `system_task` 机制任务化。

## 10. 前端

### 10.1 新页面 `/cost-analytics`

以 `web/src/features/agent-analytics/` 为模板(最新的分析页,结构最干净)。

```
routes/_authenticated/cost-analytics/index.tsx   beforeLoad 查 ROLE.ADMIN
features/cost-analytics/
  index.tsx            SectionPageLayout + 时间窗 Tabs
  api.ts  types.ts  constants.ts
  lib/{analytics,format}.ts + lib/__tests__/
  components/
    overview-cards.tsx              StatCard:收入/成本/毛利/毛利率/未定价占比
    profit-trend-chart.tsx          抄 commission-trend-chart(双轴 area+line)
    channel-margin-ranking.tsx      抄 agent-ranking-chart(横向 bar,数据要 reverse)
    cost-revenue-stacked.tsx        抄 dashboard/lib/charts.ts 的 stack:true bar
    cost-detail-columns.tsx / cost-detail-table.tsx
```

图表库是 `@visactor/vchart`(`recharts` 在 deps 里但业务零使用)。三件套:`LazyVChart` + `useChartTheme()` + `VCHART_OPTION`,外壳 `PanelWrapper` + `ChartFrame`。

格式化复用现成 helper,别自己写:
- 成本/毛利(quota)→ `formatQuota`;高精度小额 → `formatLogQuota`
- 成本(USD)→ `formatBillingCurrencyFromUSD`(成本是计费语义,TOKENS 模式下不该变 token 数)
- 毛利率(0-1 分数)→ 抄 `agent-analytics/lib/format.ts:55` 的 `formatRate`。**别用 `@/lib/format` 的 `formatPercent`**,它要 0-100,会把 0.153 显示成 0.15%

### 10.2 渠道页扩展

加三列(成本/毛利/毛利率),金额单元格抄 `BalanceCell`(`channels-columns.tsx:329`,含 tooltip 精确值 + 超长转紧凑记数)。毛利率负值用 `StatusBadge variant='danger'`。

`header` 用字符串就自动获得排序 UI。要排序必须同步三处白名单,漏一处会静默降级:
```
web/.../channels-table.tsx:75   CHANNEL_SORTABLE_COLUMNS
web/.../types.ts:259            ChannelSortBy
model/channel.go:78             channelSortColumns   ← 后端漏了参数会被丢
```

成本配置 UI 加进编辑抽屉的 advanced 区。**注意抽屉是左侧锚点导航 + 长滚动,不是 Tabs**,硬塞 Tabs 会和 `web/src/features/channels/components/drawers/channel-mutate-drawer.tsx:1788` 的滚动侦测冲突。新增 section 照 `drawers/sections/` 的既有薄壳写法。

表单字段改动链(`lib/channel-form.ts`):schema `:199` → 默认值 `:404` → 反解 `:466` → 提交 `buildSettingsJSON :635`(成本存 `settings` 列)。成本视为敏感信息,加进 `use-channel-mutate-form.ts:46` 的 `SENSITIVE_UPDATE_FIELDS`。

### 10.3 设置页

`system-settings/billing/section-registry.tsx` 的 `BILLING_SECTIONS` 加一项"成本与毛利"。复用 `SettingsSection` + `SettingsFormGrid` + `safeNumberFieldProps`(数值输入必用,否则空值给 `NaN` 会让保存按钮像卡死)+ `useSettingsForm`。

百分比字段抄 `general/agent-settings-form.ts:74` 的 `commissionRateToPercent` / `percentToCommissionRate` 往返转换。

### 10.4 i18n

`bun run i18n:sync` 不扫源码,把各语种对齐到 base 语种——base 是**自动检测**的「translation 下叶子键最多的语种」(`web/scripts/sync-i18n.mjs:245`),当前恰好是 en。流程:手工把新键写进 `en.json`(顶层 `{"translation":{...}}`,追加到尾部别重排)+ `zh.json` + `zh-TW.json`(繁体,既定译法:連結/預設/資訊)→ 跑 sync 让 fr/ja/ru/vi 拿英文兜底 → `constants.ts` 里的动态键登记进 `i18n/static-keys.ts`。

### 10.5 测试注意

jsdom 下渲染挂载 Base UI 菜单的组件会因 popup store 无限循环而崩(项目注释原话 "Base UI dropdown, whose popup store loops under jsdom",`invoices-table.test.tsx:49`),影响 `DataTableRowActionMenu` 和**可排序列的表头下拉**。项目的规避写法是挑不触发菜单的 fixture 状态,并在 fixture 上写注释说明原因(照 `agents-table.test.tsx:49`)。

## 11. 国际主流做法对照

### 11.1 定价与毛利守护的成熟实践

行业里"按毛利自动降权/剔除"是成熟实践,但**成熟的形态不是自动下架**,而是三件事:毛利喂进排序/优化目标、硬性价格地板(不得低于成本)、低于地板走审批例外流。关键出处:

| 机制 | 出处 | 对本方案的映射 |
|---|---|---|
| 排序原语是四档 boost/bury/pin/hide,不是二值 | Adobe Commerce Merchandising Rules 官方文档 | L3 降权(bury)作为主力动作 |
| 降权要带相关性约束 | Adobe 官方措辞 "slightly prioritize higher-margin products **without compromising relevance**" | 降权只动 priority,不下架 |
| 自动化必须有硬地板:价格 ≥ 成本,且留 ≥5% 调整空间 | Google Merchant Center Automated discounts 的 `auto_pricing_min_price >= cost_of_goods` | L4 只对亏损开,且默认关 |
| 自动化上线有数据覆盖门槛 | Google 要求 COGS 覆盖 ≥20% 曝光;Amazon 出价规则要求 ≥10 天且 ≥10 转化 | 六重门槛之样本量 + unknown 率 |
| 低于地板 → 审批例外流,不自动执行 | Vendavo "route exceptions through guided approvals";Simon-Kucher escalation thresholds | L2 告警优先于 L3/L4 |
| 豁免名单必需:约 1/5 SKU 按设计低毛利(KVI 价格形象商品) | McKinsey 零售定价研究 | `protect_channels` / `protect_models` |
| 目标函数用总贡献额,不用毛利率% | McKinsey:只扩毛利不增长的公司 TSR 6.2% vs 两者兼顾 13.9% | 报表同时展示毛利额与毛利率 |
| 口径不统一是最常见执行陷阱 | Umbrex:deal desk 里 "margin" 有 4 种含义 | §3.2 先定死口径 |
| 砍长尾被顶级咨询明确反对 | McKinsey "cutting the tail is suboptimal";Bain "treats the symptom" | 不做"批量砍低毛利模型" |
| 砍品类的反噬有实证 | 沃尔玛 2010 砍品类后 2011 加回 8500 个 SKU(+11%/店),CBS 用词 "overzealous" | 处置必须可逆 |
| 算法互激会失控 | Amazon $23.7M 书籍事件;death spiral | 降权幅度固定值,不做反馈式连降 |

### 11.2 同类产品的成本管理能力

| 产品 | 成本价来源 | 毛利 | 成本路由 | 告警 |
|---|---|---|---|---|
| LiteLLM Proxy | 内置 `model_prices_and_context_window.json` + 手工覆盖,`spend_logs` 落库 | 无(自用定位) | 无 | per-key/user budget |
| Helicone | 内置价格表按模型推算 | 无 | 无 | 用量告警 |
| Langfuse | 内置价格表 + 自定义 model price | 无 | 无 | 无 |
| OpenRouter | credits 制,响应返回真实 generation cost | 平台自己赚差价,不对外暴露 | 有(provider preferences,含价格偏好) | 无 |
| Portkey | 内置 + 虚拟 key 预算 | 无 | 有(conditional routing) | 预算告警 |
| Cloudflare AI Gateway | 内置估算 | 无 | 无 | 无 |

**关键观察:开源网关普遍只做到"成本可见",没有一个做完整的毛利管理与自动处置。** 原因是它们的定位是自用代理,不是转售平台。毛利管理属于转售场景的商业化能力。

可借鉴的:内置价格表是标配(本方案 `official_prices` 对应);上游返回真值要接(`usage.Cost`);成本路由有先例但都是"偏好"不是"强制",印证 §7.5 的保守判断;预算/告警是用量维度,毛利维度是本方案增量,所以 §7.2 门槛要更重。

### 11.3 商业口径

- 毛利率一律用收入口径(gross margin),财报语言;加价率(markup)只在内部定价讨论用——§3.2 的约定。
- API 转售的健康毛利率区间通常 20%–40%;低于 15% 说明定价或采购有问题,低于 0 是紧急事件。这是默认阈值的来源。
- 虚拟商品库存核算用**加权平均成本(WAC)** 而非 FIFO。token 额度无批次差异,WAC 简单且不需要批次队列。本方案"采购净额 ÷ 采购总量"就是 WAC。

## 12. 落地分期

### P0 — 成本可见(约 3 天)

只读不动,风险最低,先把数据跑起来看准不准。

- **前置改造**(独立于本方案也有价值):`upstream_model_name` 无条件落库(去 `IsModelMapped` 门控,`service/log_info_generate.go:86` + `service/task_billing.go:50`);新增 `traffic_source` 字段两处写入
- `setting/cost_setting/` 配置骨架(含 `main.go` 空导入)+ 默认全关
- `ChannelCostSettings` 结构 + `channels.settings` 读写
- `service/cost_accounting.go`:四级解析 + ratio/per_call 两种模式
- 挂钩路径 1(文本)与 5/6(task),先覆盖 80% 流量
- 补齐 §6.3 的丢失字段
- 成本写进 `other.admin_info.cost`
- **验收**:日志详情能看到单笔成本与毛利,`unknown` 占比可统计

### P1 — 报表与库存(约 3 天)

- `ChannelCostDaily` 表 + 内存桶 flush(含失败回填 + 退出补刷)
- `ChannelPurchase` 表 + 录入 UI
- `/api/cost/*` 只读接口
- `/cost-analytics` 页面(总览卡 + 趋势 + 渠道排行)
- 渠道页三列
- 库存对账页(抓取余额 vs 推算余额差异)
- **验收**:毛利率与人工核算的上游账单误差 < 5%

### P2 — 毛利守护(约 2 天,测试成本高于开发)

- `costGuardHandler`(全部 5 个方法,走 `ScheduledSystemTaskHandler` 调度)
- 四级响应 + 六重门槛
- `GetSoleProviderPairs` 保底判定(model 包内持锁快照)
- status=4 及其全部配套点(§7.1 清单)
- L3 降权:双表同写 + 显式刷缓存 + 原值存取
- 冷却期持久化 + 通知 type 编码(channelId + 级别)
- 自动处置审计(`RecordOperationAuditLog` + 模板登记)
- 通知类型 + 渠道页告警徽章
- **验收**:构造亏损渠道验证 L1→L4 逐级触发;构造"最后一个渠道"验证保底保护生效;构造高 unknown 率验证处置被抑制;构造多节点部署验证 DB 租约防重;构造健康检查循环验证 status=4 不被拉回

### P3 — 补全与增强

- 剩余计费路径(音频、WSS、MJ)
- WSS 增量路径补日志落点
- `expr` 成本模式
- 批量成本配置
- `recalculate` 回溯
- 官方价从 `ratio_sync.go` 自动灌入

## 13. 测试要点

**必须有的**(遵循 AGENTS.md 的后端测试质量要求,表驱动 + `testify`):

1. 成本换算精度:USD/1M → quota 的往返,边界值 0 / 极小 / 极大 / NaN / Inf
2. 四级解析链的优先级与 fallback,含"配置为 0"与"未配置"的区分
3. 成本不为负:构造异常输入验证钳制 + 审计日志
4. 毛利率与加价率的换算恒等式;**免费模型(收入 0)与纯亏损(收入<成本)时 margin_rate 的定义**——分母为 0 必须返回哨兵值(如 NaN/nil)并在报表层特殊渲染,禁止除零 panic
5. 赠送额度对单位成本的影响(WAC 计算)
6. 六重门槛各自独立生效 + 组合生效
7. 保底渠道保护:`GetSoleProviderPairs` 返回非空时只降级为 L2;关缓存部署的 DB 版本
8. 阈值顺序校验:三件套(前端 refine / 保存排序 / 后端 per-key)各自拦截配反配置
9. upsert 幂等:同一 (day, channel, model) 重复 flush 不重复累加;flush 失败回填后重试不丢数
10. 退款冲减成本后毛利正确;退款跨天边界时冲减落在退款日而非原消费日(口径:冲减记入退款发生日)
11. status=4 的全部配套点:健康检查不拉回、多 key 恢复不绕过、人工可管理、批量删除不含
12. L3 降权:双表一致性(channels.priority == abilities.priority)、恢复写回原值、单渠道短路场景降权为 no-op 而非错误
13. 通知 type 编码:不同渠道/级别的限流桶互不影响
14. 重试成本口径:`use_channel` 链解析、DoRequest/DoResponse 失败计 unknown

**不要写的**:随机输入的伪 fuzz、大循环压测、只验证代码能跑的覆盖率测试、断言私有常量或字段列表的测试。

## 14. 待确认项

1. **成本记账本位币**:方案默认 USD。若上游主要是人民币结算的中转商,需要确认是否改为 CNY 本位(影响汇率波动的归属)。
2. **默认阈值**:20%/10%/5%/0% 是行业通用值,需按实际定价策略调整。
3. **L4 停用是否默认开启**:方案建议默认只开到 L3 降权,L4 需显式打开。
4. **采购单是否需要审批流**:当前设计是管理员直接录入,无审批。
5. **`logs` 保留期**:回溯重算依赖明细,需确认运维是否有清理习惯。
6. **官方价同步的取舍**:models.dev 跨 provider 重名模型取"最便宜候选"(`ratio_sync.go` 的既有策略),这对售价合理,对成本**偏乐观**——同一模型名在不同 provider 价差可能很大,官方价本身只是"市场参考价"而非"某渠道真实成本"。一期先接受这个口径(它只影响第 4 级 fallback),报表里 `cost_source=official` 的流量要单独标注"估算值"。
7. **豁免名单的初始内容**:上线前由运营圈定引流模型/战略渠道。
8. **Key 级成本归因**:一期不做。`multi_key_index` 是位置下标,删 key 会导致历史归因平移,要做需存 key 指纹——明确列入二期。

## 15. 相关源码索引

```
成本注入点范式        service/log_info_generate.go:40   attachQuotaSaturation
额度换算              common/quota_math.go              全套饱和转换
渠道自动禁用          service/channel.go:19             DisableChannel
禁用原因落库/渲染      model/channel.go / channels-columns.tsx:955
admin_info 剥离       model/log.go:123
计费表达式            pkg/billingexpr/expr.md
汇总 flush 范式        pkg/perf_metrics/flush.go:26      含失败回填
upsert 范式           model/perf_metric.go:33           clause.OnConflict
跨库时间桶            model/usedata_rankings.go:51      MySQL FLOOR 分支
按渠道聚合骨架         model/usedata_flow.go:61
上游价格同步          controller/ratio_sync.go
上游报告成本          relaykit/dto/openai_response.go:243  usage.Cost
分析页模板            web/src/features/agent-analytics/

—— 以下为本轮二轮调研新增 ——

选路:内存缓存路径      model/channel_cache.go:114        priority 分层 + weight 加权
选路:DB 路径          model/ability.go:93               读 abilities.priority/enabled
重试循环              controller/relay.go:194           每轮重选渠道,use_channel 记尝试链
model_mapping 链式改写  relay/helper/model_mapped.go:32   取链尾,环检测
adaptor 二次改写       relay/channel/openai/adaptor.go:258 等 15 处,剥后缀不设 IsModelMapped
多 key 语义            model/channel.go:199              GetNextEnabledKey;index 是位置下标
状态机                common/constants.go:244           0/1/2/3;本方案新增 4
健康检查自动恢复        service/channel.go:67             只认 status==3 —— 新值 4 的动机
启用不回填路由表        model/channel_cache.go:280        CacheUpdateChannelStatus 不对称
配置:前缀式注册        setting/config/config.go:28       GlobalConfig.Register
配置:前缀式接管        model/option.go:637               handleConfigUpdate,免 switch
配置:空导入先例        main.go:32                        performance_setting
配置跨字段校验三件套    agent-settings-form.ts:58/88 + controller/option.go:366
调度器                service/system_task.go:42         ScheduledSystemTaskHandler 五方法契约
DB 租约防重            model/system_task.go:268          ActiveKey 唯一索引 + 抢占 + 心跳
主节点假保护           common/init.go:89                 IsMasterNode 只是 env 约定
通知限流              common/init.go:191                10 分钟 2 条;type 编码绕开(服务/channel.go:14)
审计                  model/log.go:229                  RecordOperationAuditLog
权限惯例              router/api-router.go              查询 AdminAuth / 写 RootAuth
```

