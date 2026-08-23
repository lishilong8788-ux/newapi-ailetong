# MiniMax-H3 接入方案

> 目标仓库：new-api v1.0.0-rc.25（commit `f116414`）
> 上游：chinadatapay `https://token.ai-galaxy.com`
> 编写日期：2026-08-21

---

## 一、结论摘要

| 项 | 决定 | 理由 |
| --- | --- | --- |
| 渠道号 | **61** | 59 已被 `ChannelTypeSub2API` 占用、60 被 `ChannelTypeNewAPI` 占用。参考的实现文档写的 59 是内部分支的旧编号 |
| 对外协议 | **`/v2/*` 专用路由** | 复用 `/v1/video/generations` 在结构上不可行，见第二节 |
| 计费方式 | **加法折算成 `h3_units` 单一乘数** | 框架 `OtherRatios` 是乘法链，H3 定价是加法 |
| 交付节奏 | **P1 可用闭环 → P2 补全** | 见第四节 |
| 是否必须改源码 | **是** | 视频任务渠道是硬编码 switch，无插件机制 |

必须改源码这点先说清楚：`AdvancedCustom`(58) 是唯一可能的配置化接入出路，但它只注册在
`GetAdaptor`（`relay/relay_adaptor.go:56`，对话类适配器），`GetTaskAdaptor`（同文件 `:144`）
的 switch 里没有它。异步任务类（视频）渠道全部是硬编码 case，一共 9 个分支。

---

## 二、为什么必须走 `/v2` 专用路由

`/v1/video/generations` 这条路的共享请求结构是 `relay/common/relay_info.go:868` 的
`TaskSubmitReq`：

```go
Prompt   string     // 顶层扁平 prompt
Image    string
Images   []string   // 扁平 URL 列表，无 role
Duration int
Metadata map[string]interface{}
```

H3 要的是带 role 的多模态数组：

```json
"content": [
  {"type":"text","text":"..."},
  {"type":"image_url","role":"first_frame","image_url":{"url":"..."}},
  {"type":"video_url","role":"reference_video","video_url":{"url":"..."}},
  {"type":"audio_url","role":"reference_audio","audio_url":{"url":"..."}}
]
```

三个硬冲突：

1. **`Images []string` 丢 role。** H3 有 6 种 role（`first_frame` / `last_frame` /
   `reference_image` / `reference_video` / `base_video` / `reference_audio`），而首尾帧与参考项
   互斥、超额图计费全靠 role 区分。现有的 vidu 适配器是拿图片*数量*猜 role
   （`relay/channel/task/vidu/adaptor.go:102`：`len(req.Images)==2` 当首尾帧、`>2` 当参考图），
   这种猜法在 H3 上直接出错。
2. **完全没有 video / audio 字段。** `reference_video` 参与计费（输入视频秒数 × 单价），
   `TaskSubmitReq` 里无处安放。
3. **`validatePrompt` 硬要求顶层非空 `prompt`**（`relay/common/relay_utils.go:137`）。
   H3 的提示词在 `content[]` 里，走共享校验器会导致每个请求都返回 400。

出路只有两条，都不划算：

- **扩 `TaskSubmitReq` 加 role-aware content**：该结构被 10 个渠道共用
  （ali / doubao / gemini / hailuo / jimeng / kling / sora / vertex / vidu + 公共校验），
  爆炸半径不可接受。
- **绕过共享校验器 + 把 content 塞进 `Metadata`**：客户端仍需手写 H3 原生 JSON，
  共享 DTO 一点便宜没占到，反而被 `/v1` 的路由形状和 `validatePrompt` 绑住。

补充一点：走独立路由不是给 H3 开特例。仓库里 `/mj/`、`/suno/`、`/kling/v1`、`/jimeng`
全都是独立路由组，`middleware/distributor.go:253` 的 `getModelRequest` 本来就是按协议族
分支的（suno 那段在 `:285`）。H3 加一个 `/v2/` 分支是顺着既有惯例走。

---

## 三、计费方案

### 3.1 为什么用 `h3_units`

H3 的定价是**加法**结构：

```
视频类：费用 = 出片秒数 × 输出秒单价
            + 输入视频秒数 × 输入视频秒单价
            + max(0, 输入图片数 − 5) × 超额图单价

IR 类：费用 = 输入 tokens × 5.80/百万 + 输出 tokens × 23.00/百万
```

而框架的 `PriceData.OtherRatios` 是**乘法链**，塞不进多项相加。解法是把加法结果折算成
相对基准价的倍数：

```go
units := yuan / basePrice        // basePrice 取 info.PriceData.ModelPrice
return map[string]float64{"h3_units": units}
```

`basePrice` 在这里自己约掉了，所以管理员改 ModelPrice 不会让账算歪。

已确认 `pkg/billingexpr/` 走不通：它支持加法表达式，但变量全是 token 维度
（`p` / `c` / `cr` / `img` / `ai` / `ao`），没有视频秒数维度。

### 3.2 价格常量

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `BasePricePerSec` | 0.50 | 768P 基准 元/秒 |
| `Price2KPerSec` | 0.80 | 2K 元/秒 |
| `RegenPricePerSec` | 0.30 | 再生成 元/秒 |
| `ExtraImageYuan` | 0.20 | generation 超额图 元/张 |
| `RegenExtraImageYuan` | 0.15 | 再生成超额图 元/张 |
| `IRInputYuanPerMillion` | 5.80 | IR 输入 元/百万 token |
| `IROutputYuanPerMillion` | 23.00 | IR 输出 元/百万 token |
| `FreeImageCount` | 5 | 免费图张数 |
| `VideoInputPrechargeSeconds` | 15 | 视频输入预扣保守秒数 |
| `MinDuration` / `MaxDuration` | 4 / 15 | duration 合法区间 |

### 3.3 结算链路

框架的 `service/task_polling.go:643` `settleTaskBillingOnComplete` 已有三层优先级，
和我们的需求正好吻合，不用改：

```
0. PerCallBilling=true          → 跳过结算
1. adaptor.AdjustBillingOnComplete > 0 → RecalculateTaskQuota   ← H3 走这条
2. taskResult.TotalTokens > 0   → RecalculateTaskQuotaByTokens
3. 都不满足                      → 保持预扣
```

因此 H3 必须**关掉** `PerCallBilling`，否则第 0 条会直接短路掉差额结算。

### 3.4 抽检表（groupRatio=1, discount=1, ModelPrice=0.5）

| 场景 | yuan | h3_units | 预扣额度 |
| --- | --- | --- | --- |
| 6s / 768P / 无视频 | 3.00 | 6 | 1,500,000 |
| 6s / 2K / 有视频输入(+15s) | 21×0.80 = 16.80 | 33.6 | 8,400,000 |
| 6s / 768P / 6 张图 | 3.00+0.20 = 3.20 | 6.4 | 1,600,000 |
| IR duration=6 | 3.00 | 6 | 1,500,000 |
| 再生成 6s | 6×0.30 = 1.80 | 3.6 | 900,000 |

---

## 四、改动清单

### P1 —— 可用闭环

目标：能提交视频生成任务、轮询拿结果、预扣与终态结算都正确、错误码符合契约。

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `constant/channel.go` | 注册 61 + BaseURL + Name | 已完成 |
| `model/task.go` | `TaskPrivateData` 加 5 字段 | 已完成 |
| `relay/relay_adaptor.go` | `GetTaskAdaptor` 加 case | 待做 |
| `relay/channel/task/minimaxh3/constants.go` | 常量 | 已完成 |
| `relay/channel/task/minimaxh3/types.go` | 请求/响应/usage 结构 | 待做 |
| `relay/channel/task/minimaxh3/path.go` | V2 路径识别 | 待做 |
| `relay/channel/task/minimaxh3/validate.go` | 解析与校验 | 待做 |
| `relay/channel/task/minimaxh3/billing.go` | 预扣估算 + 完成结算 | 待做 |
| `relay/channel/task/minimaxh3/query.go` | 状态映射 + 响应整形 | 待做 |
| `relay/channel/task/minimaxh3/adaptor.go` | 10 个接口方法 | 待做 |
| `router/video-router.go` | `POST /v2/video_generation`、`GET /v2/query/video_generation/:task_id` | 待做 |
| `middleware/distributor.go` | `/v2/` 分支，设 relay_mode | 待做 |
| `dto/task.go` + `controller/relay.go` | 错误信封 2 字段 + `respondTaskError` 分支 + 关闭 `PerCallBilling` | 待做 |
| `setting/ratio_setting/model_ratio.go` | 默认价 0.5 | 待做 |
| `*_test.go` | 计费不变量回归（AGENTS.md 硬要求） | 待做 |

`ChannelTypeDummy` 是隐式 iota 计数哨兵，61 必须插在它**前面**，否则渠道总数会算错。

### P2 —— 补全

| 内容 | 涉及改动 |
| --- | --- |
| `/v2/h3_context_ir` | text modality + token 结算分支 |
| `/v2/video_regeneration` | 要改 `relay/relay_task.go:38` `ResolveOriginTask`（现在只服务 Sora remix） |
| 列表 `GET /v2/query/video_generation` | 新增 `controller/h3_video_task.go`，纯本地查询不打上游 |
| 取消/删除 `DELETE /v2/video_generation/:task_id` | 同上 + 上游取消 |
| 终态回调 | `callback.go` + `OnVideoTaskTerminal` 钩子（**当前 main 上 0 命中，需新写进公共层**）|
| 防双退 | `ClaimQuotaForRefund`（**同样 0 命中，需新写**）|

这么切的理由：P2 各项都是独立的任务类型或独立生命周期动作，不打通 P1 主干就并行做，
风险叠在一起不好定位。回调缺位时轮询本来就是兜底，不影响可用性。

参考量级：现有 vidu adaptor 301 行、kling 418 行。H3 因为有三种任务类型和加法计费会更大些。

---

## 五、需要你决定的 4 个契约点

这 4 处两份文档自相矛盾，是对外契约，代码和客户端都依赖，**动手前必须冻结**。

### 5.1 `ratio` 是否必填

- 接口文档 §3：可选，未传由上游取默认值
- 实现文档 §6.3：纯文生视频时必填且不能是 `adaptive`

客户端照接口文档做纯文生视频不传 `ratio` 会吃 400。这是最容易踩的一条。

**建议：按可选处理，不做本地强制校验**，让上游自己报错。理由是我们没有上游的真实约束
文档，本地校验比上游严会误杀合法请求；宽松放过最多多一次上游往返。

### 5.2 `aigc_watermark` 传 `false` 的语义

- 接口文档 §3：显式传 `false` 会原样下发
- 实现文档 §7.2：仅非 IR 且为 `true` 时透传（即 `false` 与不传等效）

**建议：按接口文档来**，用 `*bool` 区分"未传"与"显式 false"，显式值原样下发。这符合
AGENTS.md 里"可选标量必须用指针 + omitempty，保留显式零值"的硬规则。

### 5.3 `running` 状态能否取消

接口文档 §8 自相矛盾：表格写 `queued`/`running` → 取消并全额退款；同节末尾又写
"上游对 `running` 状态的任务不支持删除，此时会透传上游错误"。

**建议：以上游实际行为为准，透传上游错误。** 详见第六节第 1 条，这里有资损风险。

### 5.4 content 模式再生成的预扣口径

接口文档 §5 说 `duration` 不接收；实现文档 §6.3 说 content 模式无 duration 时直接用
`MaxDuration=15` 当出片秒数算，即 2K 再生成预扣 15×0.30 = 4.5 元。

**建议：保留 15 秒保守预扣，但在接口文档里写明。** 终态会多退少补，但预扣额度差好几倍，
余额刚够的请求会被直接拒掉，客户需要提前知道。

---

## 六、必须堵的 4 个风险

这几个不在参考的实现文档里，等写完再补会很痛。

### 6.1 上游取消失败仍本地退款（资损）

实现文档 §10.2 的流程是"调上游取消 → CAS 改 CANCELLED → 退款"，但没写
`CancelUpstreamTask` 返回非 2xx 怎么办。上游取消失败还在继续出片，本地已退款并标记
cancelled，用户白拿视频。而接口文档自己也说"上游对 running 状态的任务不支持删除"，
说明这是常态不是异常。

**处理：上游取消失败就不改本地状态、不退款，把上游错误透传给调用方。**

### 6.2 usage 全 0 时按预扣收满

实现文档 §8.2 第 5 点：usage 全 0 保持预扣不退不补。单独看合理，但和 5.4 的
"content 模式按 15 秒预扣"叠起来就是：用户实际出 5 秒，上游没返 usage，按 15 秒收满且不退。

**处理：记 warn 并落审计日志**，按 AGENTS.md 的做法挂到 `other.admin_info` 下，别静默。

### 6.3 多段参考视频预扣不足

实现文档 §7.1 用 `hasRefVideo` 布尔判断，预扣只加一次 15 秒。传两段以上时预扣偏低，
终态补扣，余额边缘用户会在结算时透支。

**处理：按实际参考视频段数累加预扣秒数。**

### 6.4 H3 自己的秒数上限要收紧

框架通用上限 `relaycommon.MaxTaskDurationSeconds = 3600`（`relay/common/relay_utils.go:146`），
对 H3 太松，它的 duration 上限是 15。上游返回的秒数同样要按 H3 自己的上限钳制，
不能直接用 3600。

**处理：`clampSeconds` 用 `MaxDuration` 而非框架通用值。**

### 6.5 AGENTS.md 的计费不变量（非可选）

以下是项目硬规则，实现时逐条对齐：

- 所有用户控制的乘数（duration、imageCount、视频输入秒数）在校验层与结算层双重钳制
- 额度转换只用 `common/quota_math.go` 的助手，禁止裸 `int(...)` 强转
- 用 `*Checked` 变体捕获饱和事件，挂到 `relayInfo.QuotaClamp`，落日志时经
  `attachQuotaSaturation` 归到 `other.admin_info.quota_saturation`
- 倍率写入必须走 `PriceData.AddOtherRatio`（它会拒绝非正、NaN、+Inf）
- 预扣与结算都不能因溢出产生负数（信用）
- CAS 持久化 + 防双退，避免重叠轮询/多实例导致重复退款

---

## 七、验收方式

| 层次 | 手段 | 前置条件 |
| --- | --- | --- |
| 编译 | `go build ./...` + `cd relaykit && GOWORK=off go build ./...` | 无 |
| 单测 | 计费边界、校验分支、状态映射的表驱动测试 | 无 |
| 集成 | mock 上游 httptest server 跑完整提交→轮询→结算 | 无 |
| 端到端 | 真实提交一个 4 秒 768P 任务，核对扣费 | **需要上游 token** |

基线注意：`service` 包有 2 个测试是上游自带失败
（`TestObserveChannelAffinityUsageCacheByRelayFormat_MixedMode` 和 `_UnsupportedModeKeepsEmpty`，
测试间全局状态泄漏，单独跑能过）。判断是否引入回归时要排除这两个。

---

## 八、还需要你提供的信息

1. **第五节的 4 个契约点** —— 确认我的建议值，或给出你们的口径
2. **上游 token** —— 不阻塞开发，但决定验收能到"mock 集成"还是"端到端跑通"
3. **客户端技术栈** —— 你们同时要写下游调用方。从机器上的 `m2-repository`、
   `springboot3.0` 推测是 Java/Spring Boot，需要确认。建议等 P1 契约稳定后再写，避免返工

---

## 附：不需要做的事

| 方案 | 现状 | 结论 |
| --- | --- | --- |
| Seedance 1.0 / 1.5 / 2.0 | 已支持（`relay/channel/task/doubao/constants.go`，含分辨率/视频输入价格表）| 无需改动 |
| Seedance 2.5 | 不支持，目前最高 2.0 | 如确需，加模型名 + 价格表即可，不用写新 adaptor（同协议族）。但需先确认上游真有此模型号和定价 |
| MiniMax Hailuo 系列 | 已支持（渠道 35，hailuo adaptor）| 无需改动 |
| MiniMax-H3 | **不支持，全仓库零命中** | 本方案的全部工作 |

注意一个容易误判的点：MiniMax 渠道（35）已经存在，但**在它的模型列表里加一行
`MiniMax-H3` 是不行的**。hailuo 打的是 `/v1/video_generation`，H3 是 `/v2/video_generation`，
请求结构完全不同（hailuo 用扁平 `prompt` + `first_frame_image`，H3 用带 role 的
`content[]`）。协议不同族，必须独立 adaptor。
