# 词易Token 渠道级差异化定价实现分析

> 分析对象：词易Token（tokease.cn），基于 new-api 二次开发的商业分发平台
> 分析日期：2026-08-23
> 分析方法：截图特征反推 + 本项目（new-api）源码交叉验证

## 一、问题的提出

在词易Token 的模型广场里，同一个模型 `deepseek-v4-pro` 出现了三个不同的价格，分别挂在 `uQ`、`al10`、`jd5` 三个标签下：

| 标签 | 输入（¥/M） | 输出（¥/M） | 输出/输入 | 折扣角标 |
| --- | --- | --- | --- | --- |
| 公有云 · uQ | 3.0008 | 6.0016 | 2.000 | 热门 |
| 公有云 · al10 | 3.030071 | 7.950155 | **2.624** | 2.5 折 |
| 公有云 · jd5 | 5.641503 | 11.283007 | 2.000 | 4.7 折 |

这与 new-api 的定价模型存在直接冲突：

- 模型定价是**全局按模型名**配置的，与渠道无关（`setting/ratio_setting/model_ratio.go`）
- 模型元信息表（`models`）里不含任何价格字段
- 分组倍率是**乘数**，同时作用于输入和输出

因此需要回答两个问题：

1. 同一模型的多渠道差异化定价是如何实现的？
2. 平台声称的"通用模型名：优先选择低价可用渠道；请求失败后自动切换至其他可用渠道"是如何实现的？

## 二、结论摘要

**核心手法：把渠道维度编码进模型名，使其成为独立的定价条目。**

`deepseek-v4-pro` 与 `deepseek-v4-pro/uQ`、`/al10`、`/jd5` 是**四个完全无关的模型名**，在 new-api 中各自拥有独立的 `model_ratio` 和 `completion_ratio`。它们之间没有父子关系、没有关联表、没有任何数据结构上的联系。唯一的交汇点在请求出口：各渠道的 `model_mapping` 把带后缀的名字改写回上游真名。

这套玩法**不需要修改任何后端核心代码**，是 new-api 原生能力的自然延伸。真正的二开集中在展示层和配置生成。

## 三、关键代码依据

### 3.1 模型名不做归一化，斜杠后缀天然是独立 key

`FormatMatchingModelName`（`setting/ratio_setting/model_ratio.go:702-719`）只对两类模型做名称归一化：

```go
func FormatMatchingModelName(name string) string {
    // gemini-2.5-* 系列的 thinking 变体归一到通配名
    if strings.HasPrefix(name, "gemini-2.5-flash-lite") { ... }
    // gpt-4-gizmo / gpt-4o-gizmo 归一到通配名
    if strings.HasPrefix(name, "gpt-4-gizmo") { name = "gpt-4-gizmo-*" }
    return name  // 其余原样返回
}
```

**除此之外的所有模型名原样透传。** `deepseek-v4-pro/uQ` 在倍率表里就是一个普通的独立 key，可以配自己的 `model_ratio`、`completion_ratio`、`cache_ratio` 等全部倍率。

数据库层面也无障碍：`abilities.model` 是 `varchar(255)`（`model/ability.go:20`），斜杠是合法字符。

### 3.2 定价条目按 abilities 里的模型名去重生成

`updatePricing`（`model/pricing.go:180-375`）的构建流程：

1. 拉取全部启用的 abilities，join channels 取渠道类型（`model/pricing.go:182`）
2. 聚合为 `模型名 → 分组集合`（`model/pricing.go:262-269`）
3. **遍历该 map，每个模型名生成一条 `Pricing`**（`model/pricing.go:356-362`）
4. 从 `models` 表贴元信息（描述、图标、标签、厂商），元信息 `status != 1` 的整条跳过
5. 缓存 1 分钟

第 3 步是整件事的枢纽：

```go
pricingMap = make([]Pricing, 0)
for model, groups := range modelGroupsMap {
    pricing := Pricing{
        ModelName:   model,
        EnableGroup: groups.Items(),
        ...
    }
```

**模型名不同即为不同条目，可以有完全独立的价格。** `deepseek-v4-pro` 和 `deepseek-v4-pro/uQ` 在这里是两条毫不相干的记录。

### 3.3 唯一的纽带：model_mapping 在出口处收敛

`ModelMappedHelper`（`relay/helper/model_mapped.go:32-53`）支持链式模型重定向并做环检测。请求的完整流转：

```
客户端发 deepseek-v4-pro/uQ
  ↓ abilities 查 (分组, "deepseek-v4-pro/uQ")
  ↓ 命中：只有 uQ 渠道一个候选
  ↓ uQ 渠道 model_mapping: {"deepseek-v4-pro/uQ": "deepseek-v4-pro"}
  ↓ UpstreamModelName = "deepseek-v4-pro"
  ↓ 发给上游的请求体里是真名
```

注意计费与路由用的都是客户端发的 `OriginModelName`（即带后缀的名字），只有发往上游的请求体被改写。所以：

- **计费**看到的是 `deepseek-v4-pro/uQ` → 用它的独立倍率
- **上游**看到的是 `deepseek-v4-pro` → 正常识别

### 3.4 "自动切换渠道"是原生重试，与后缀名无关

重试循环在 `controller/relay.go:194-244`：

```go
for ; retryParam.GetRetry() <= common.RetryTimes; retryParam.IncreaseRetry() {
    channel, channelErr := getChannel(c, relayInfo, retryParam)  // 每轮重新选渠道
    // ... 发起请求 ...
    if newAPIError == nil { return }   // 成功即返回
    processChannelError(...)            // 记录错误，可能触发渠道自动禁用
    if !shouldRetry(c, newAPIError, common.RetryTimes-retryParam.GetRetry()) {
        break
    }
}
```

`retry` 值传入 `getPriority`（`model/ability.go:63-91`）实现优先级降级：第一轮取最高优先级层，失败后取次高层，`retry` 超过层数则固定用最低层。同层内按 `weight + 10` 加权随机（`model/ability.go:126-141`）。

重试路径写入日志，格式为 `重试：3->7->12`（`controller/relay.go:246-250`），即渠道 ID 链。

**两种模型名走的是完全相同的这段代码，区别只在 abilities 候选集大小：**

| 模型名 | abilities 候选数 | 重试行为 |
| --- | --- | --- |
| `deepseek-v4-pro` | 3（配在三个渠道） | 逐层降级，在三个渠道间切换 |
| `deepseek-v4-pro/uQ` | 1（只配在 uQ） | 循环照跑，但每轮只能选到同一渠道 |

"指定渠道"不是一个功能开关，而是"候选集只有一个元素"的自然结果。

### 3.5 "优先选择低价"原生不存在

`getChannelQuery`（`model/ability.go:93-106`）的选择条件只有三项：`group`、`model`、`enabled`，排序只按 `priority`，同层按 `weight` 随机。

已在 `service/channel_select.go` 与 `model/ability.go` 中检索按价格排序的逻辑，**未发现任何价格参与渠道选择的代码路径**。

因此该宣传语有两种可能：

- 运营手工把低价渠道的 `priority` 设高（人工近似，非系统保证）
- 二开修改了 `GetChannel` 或在 `channel_select.go` 插入按倍率排序层（动路由核心）

从截图无法区分。若为后者，属于高风险改动。

## 四、二开范围判定

### 4.1 已确定：前端聚合展示（必须改）

原生模型广场是**一个模型名一张卡**。抽屉里的多张卡片来自 `GroupPriceCards`（`web/src/features/pricing/components/group-price-cards.tsx:50-57`），其注释明确写着：

> One card per group the viewer can actually reach

即**一张卡 = 一个分组**，不是一个渠道。卡片上"公有云 · uQ"是 `desc · group` 拼接（`web/src/components/group-badge.tsx:44-48`），`desc` 来自 `usable_group` map 的 value。

价格计算（`web/src/features/pricing/lib/price-comparison.ts:179-195`）：

```
输入价 = model_ratio × group_ratio × 单位换算
输出价 = model_ratio × completion_ratio × group_ratio
```

**关键推论：** `completion_ratio` 是模型级标量，`group_ratio` 同时乘在输入和输出上会被约掉。所以同一模型的所有分组卡片，输出/输入比值**必须完全相同**。

而 `use-pricing-data.ts:60` 把**全局**的 `data.group_ratio` 原样赋给每个 model：

```ts
group_ratio: data.group_ratio,
```

说明本项目所有模型共享同一份分组倍率，不存在 per-model 的二维倍率。

**对照截图数据：** uQ = 2.000、jd5 = 2.000、al10 = **2.624**。al10 对不上，证明它读的是**另一个定价条目**。

因此可以断定：词易Token 把 `deepseek-v4-pro/*` 系列变体聚合到 `deepseek-v4-pro` 一张卡下，伪装成"渠道选择"展示。原生 `Pricing` 结构体没有任何字段能表达"我是某模型的变体"，这个聚合必须自己实现：识别后缀 → 按前缀分组 → 折叠进父卡 → 单独渲染变体列表。

另一种可能是他们改了后端让 `group_ratio` 变为 per-model 二维（`PricingModel.group_ratio` 这个可选字段本项目后端不填，二开可以填）。两种都是改动。

### 4.2 命名伪装

分组名故意起成 `uQ`、`al10`、`jd5`、`tx3`、`jd4`、`fw`、`um` 这类供应商代号风格，配上"公有云"、"企业中转站"之类的 `desc`，视觉上让用户以为在选供应商。截图里的 `tx3`（腾讯？）、`jd5`（京东？）暗示了对应关系，但系统层面它们只是分组名字符串。

### 4.3 大概率有：配置批量生成工具

每增加一个"渠道变体"，需要同步配置四处：

1. 目标渠道 `models` 字段追加 `模型名/后缀`
2. 目标渠道 `model_mapping` 追加一条 `{"模型名/后缀": "模型名"}`
3. `model_ratio` 追加一个 key
4. `completion_ratio` 追加一个 key

截图左侧显示 73 个模型。若每个模型平均挂 3 个渠道变体，需维护约 219 组配置、438 个倍率 key。手工维护不现实，多半有批量生成脚本或后台批量功能。

### 4.4 已确定：运营 UI 重做

截图中以下元素原生不具备或形态差异很大：

- "2 选 1 复制使用"的 BaseURL 切换器
- 右侧三步式接入引导（接口地址 → 选择模型名 → 复制 API Key）
- 卡片上的"热门"角标与"5 折 / 6.8 折 / 6 折"折扣标签
- 按厂商分栏的模型类型筛选（DeepSeek 8、Minimax 4、Vidu 1、千问 6……）
- "平台价/M、官方价/M、折扣"三列对比表
- 首页轮播 banner 与企业资质展示

原生 `web/src/features/pricing/` 有基础卡片和表格，但长不成这个形态。

### 4.5 未改动：全部计费与路由内核

以下机制完全使用原生实现，无需修改：

- abilities 表展平（`model/ability.go:196-200`）
- priority 分层 + weight 加权随机选渠道（`model/ability.go:93-141`）
- `RetryTimes` 重试循环与优先级降级（`controller/relay.go:194-244`）
- `model_mapping` 链式改写与环检测（`relay/helper/model_mapped.go`）
- 分组倍率乘算与 `GroupGroupRatio` 覆盖（`relay/helper/price.go:59-67`）
- 预扣费与结算差额（`relay/helper/price.go`、`service/quota.go`）

## 五、复刻方案

若要在本项目实现同等能力，按改动成本排序：

### 方案 A：纯配置实现（零代码改动）

**能得到：** 渠道级差异化定价、指定渠道调用、通用名自动容灾。

配置步骤（以 `deepseek-v4-pro` 挂 uQ / al10 / jd5 三渠道为例）：

| 配置项 | uQ 渠道 | al10 渠道 | jd5 渠道 |
| --- | --- | --- | --- |
| `models` | `deepseek-v4-pro,deepseek-v4-pro/uQ` | `deepseek-v4-pro,deepseek-v4-pro/al10` | `deepseek-v4-pro,deepseek-v4-pro/jd5` |
| `model_mapping` | `{"deepseek-v4-pro/uQ":"deepseek-v4-pro"}` | `{"deepseek-v4-pro/al10":"deepseek-v4-pro"}` | `{"deepseek-v4-pro/jd5":"deepseek-v4-pro"}` |
| `priority` | 按成本排，低价渠道设高 | | |

倍率配置（`model_ratio` / `completion_ratio`）：

```json
{
  "deepseek-v4-pro": 0.5,
  "deepseek-v4-pro/uQ": 0.5,
  "deepseek-v4-pro/al10": 0.505,
  "deepseek-v4-pro/jd5": 0.94
}
```

**代价：** 模型广场会多出 N 倍条目（每个变体一张独立卡），观感差。用户看到的是一堆 `deepseek-v4-pro/xxx` 平铺，而非按父模型收纳。

**局限：** "优先低价"只能靠 `priority` 人工近似。

### 方案 B：A + 前端聚合（推荐）

在方案 A 基础上改前端展示：

1. 在 `web/src/features/pricing/lib/model-helpers.ts` 增加变体识别：按分隔符（如 `/`）切分 `model_name`，前缀为父模型、后缀为渠道标识
2. 在 `use-pricing-data.ts` 的 `models` memo 里把变体折叠进父模型，挂成 `variants: PricingModel[]`
3. `model-card-grid.tsx` 只渲染父模型
4. 新增变体卡片组件（可复用 `group-price-cards.tsx` 的卡片样式），在抽屉里渲染 `variants`
5. `model-details-api.tsx` 增加"通用名 / 指定渠道名"双份复制按钮

**注意：** 变体的 `enable_groups` 由 abilities 自动算出（`model/pricing.go:262-269`），无需额外配置。分组过滤（`controller/pricing.go:58-59`）对变体同样生效，所以不同等级用户看到的变体列表天然不同。

**代价：** 纯前端改动，不碰计费和路由，风险低。约 5 个文件。

### 方案 C：B + 按价格选渠道（高风险）

若确实需要"通用名自动选最低价渠道"，需在渠道选择层插入排序。**不建议**，理由：

- `GetChannel`（`model/ability.go:108-147`）是全站最热的查询路径，加价格排序意味着每次请求都要读倍率表并对候选集排序
- 价格最低的渠道通常也是质量最差/最容易失败的，无脑选最低价会拉高整体失败率
- 与 `priority` 语义冲突：运维会同时面对两套优先级概念

**替代做法：** 用 auto 分组。`GetUserAutoGroup`（`service/group.go:56-70`）返回的候选列表是有序的，`CacheGetRandomSatisfiedChannel`（`service/channel_select.go:89-142`）按顺序逐个分组尝试。把分组按倍率从低到高排进 auto 列表，即可得到"按价格递增尝试"的效果，且这是原生能力。

### 方案 D：批量配置工具（运维必需）

方案 A 的配置量随 `模型数 × 渠道数` 增长。建议提供批量能力：

- 输入：模型名列表 + 渠道列表 + 各渠道倍率
- 输出：自动写入各渠道 `models`、`model_mapping`，并合并写入 `model_ratio` / `completion_ratio`
- 需注意 `model_mapping` 是覆盖写，批量时必须先读现有映射再合并
- 修改渠道后须触发 abilities 重建与定价缓存失效（`model.InvalidatePricingCache()`）

## 六、风险与注意事项

### 6.1 模型名分隔符的选择

用 `/` 有隐患：部分客户端和 SDK 会对模型名做 URL 编码或路径拼接。Bedrock、Vertex 等厂商的原生模型 ID 本身含 `/`，可能冲突。建议评估 `@`、`:`、`#` 或纯连字符后缀。

### 6.2 计费口径必须一致

变体的 `model_ratio` 若配错，会出现同一上游模型不同变体价差异常。由于四个名字在系统里毫无关联，**不存在任何一致性校验**。建议：

- 批量工具生成时统一校验变体价 ≥ 成本价
- 在 `models` 元信息表给变体建档并统一 `name_rule`，便于批量核对

### 6.3 日志与统计会被打散

消费日志记录的是 `OriginModelName`，即带后缀的名字。这意味着：

- 按模型统计用量时，`deepseek-v4-pro` 和它的三个变体是四行
- 需要在 dashboard 侧做前缀聚合，否则报表失真

### 6.4 未建元信息的变体会显示为裸名

`updatePricing` 第 4 步会给条目贴 `models` 表元信息，未建档的变体没有图标和描述。若采用方案 B 的前端聚合，变体卡片可继承父模型元信息规避此问题；若走方案 A，需为每个变体建档，或用 `name_rule = NameRulePrefix` 让一条父模型记录覆盖整族（`model/pricing.go:211-219`）。

### 6.5 元信息 status 会整条隐藏

`models` 表里 `status != 1` 的条目在 `updatePricing` 中被 `continue` 跳过（`model/pricing.go:366-370`），整个定价条目都不返回前端。用 `name_rule` 前缀匹配覆盖变体时要留意：禁用父模型元信息会连带隐藏所有变体。

## 七、核对清单

拿去和开发确认的要点：

1. 四个模型名在系统里完全平级无关，无父子结构、无关联表，唯一交汇是各渠道 `model_mapping` 把后缀名改写回上游真名
2. 通用名的自动切换 = 原生 `RetryTimes` 重试 + 优先级降级，因为它在 abilities 里有多个渠道候选；后缀名只有一个候选，所以天然锁定单渠道
3. 原生路由不按价格选渠道，"优先低价"只能靠人工调 `priority`，或改用 auto 分组按倍率排序
4. 计费与路由用 `OriginModelName`（带后缀），只有发往上游的请求体被 `model_mapping` 改写
5. al10 的输出/输入比 2.624 与另两个的 2.000 不一致，是其为独立定价条目的直接证据
6. 定价条目按 abilities 里的模型名去重生成，模型名不同即为不同条目，这是整套手法成立的根基

## 八、相关源码索引

| 主题 | 位置 |
| --- | --- |
| 模型名归一化 | `setting/ratio_setting/model_ratio.go:702-719` |
| 定价条目构建 | `model/pricing.go:180-375` |
| 条目去重生成 | `model/pricing.go:356-362` |
| 模型→分组聚合 | `model/pricing.go:262-269` |
| 定价接口与分组过滤 | `controller/pricing.go:36-77` |
| abilities 表定义 | `model/ability.go:18-26` |
| abilities 展平 | `model/ability.go:196-200` |
| 渠道查询与排序 | `model/ability.go:93-106` |
| 加权随机选渠道 | `model/ability.go:126-141` |
| 优先级降级 | `model/ability.go:63-91` |
| 重试循环 | `controller/relay.go:194-244` |
| 模型名改写 | `relay/helper/model_mapped.go:32-53` |
| 分组倍率解析 | `relay/helper/price.go:44-74` |
| 计费公式 | `service/quota.go:50-87` |
| auto 分组选择 | `service/channel_select.go:83-142` |
| 分组卡片组件 | `web/src/features/pricing/components/group-price-cards.tsx` |
| 价格展示计算 | `web/src/features/pricing/lib/price-comparison.ts:119-195` |
| 前端数据装配 | `web/src/features/pricing/hooks/use-pricing-data.ts:40-76` |

