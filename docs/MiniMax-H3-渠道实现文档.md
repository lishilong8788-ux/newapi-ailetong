# MiniMax-H3 渠道实现文档

> 对应 commit：`d8de1098` / merge `ea64e450`
> 上游：chinadatapay `https://token.ai-galaxy.com`
> 渠道类型：`ChannelTypeMiniMaxH3 = 59`
> 业务范围：视频生成（generation / regeneration）、上下文 IR（`h3_context_ir`）

---

## 1. 背景与定位

本次改动把 **MiniMax-H3** 独立成正式渠道（编号 59），并补齐完整的下游 V2 接口、任务管理、按官方规则计费、回调与测试。

- **现在**：新建独立包 `relay/channel/task/minimaxh3/`，H3 成为「一等公民渠道」。

下游对外接口与 chinadatapay 官方 V2 文档**原样对齐**（不是 new-api 自有的 `/v1/video/tasks` Seedance 风格）。

---

## 2. 代码地图

```
后端
├─ constant/channel.go                 注册 ChannelTypeMiniMaxH3=59、BaseURL、Name
├─ router/video-router.go              注册 /v2/* 路由
├─ middleware/distributor.go            识别 V2 路径、设 relay_mode
├─ controller/relay.go                 RelayTask 入口、PerCallBilling 关闭、错误信封
├─ controller/h3_video_task.go         列表 / DELETE 控制器
├─ relay/relay_adaptor.go              GetTaskAdaptor 注册 minimaxh3.TaskAdaptor
├─ relay/relay_task.go                 提交流程 RelayTaskSubmit、ResolveOriginTask
├─ relay/common/relay_info.go          TaskRelayInfo 新增 H3 字段
├─ service/task_polling.go             轮询/结算/退款主路径
├─ service/error.go                    TaskErrorFromAPIError 修复
├─ setting/ratio_setting/model_ratio.go 默认价 MiniMax-H3 = 0.5 元/秒
├─ main.go                             注入 OnVideoTaskTerminal（终态回调）
├─ dto/task.go                         TaskError 新增 H3LocalEnvelope / PassthroughBody
├─ types/error.go                      错误码
└─ relay/channel/task/minimaxh3/       adaptor 本体（10 个文件）
   ├─ adaptor.go     渠道接口实现（10 个方法）
   ├─ validate.go    请求解析与三类任务校验
   ├─ billing.go     预扣估算 + 完成结算
   ├─ query.go       状态映射 + 响应包装
   ├─ callback.go    上游取消 + 终态回调投递
   ├─ list.go        列表查询参数解析
   ├─ path.go        V2 路径识别
   ├─ constants.go   常量（路径、价格、分辨率、时长上下限）
   ├─ types.go       请求/响应/usage 数据结构
   └─ *_test.go      各模块测试

前端 / 文档
├─ web/src/features/channels/constants.ts      渠道下拉
├─ web/src/features/channels/lib/channel-utils.ts
├─ web/src/i18n/locales/{en,zh,zh-TW,fr,ja,ru,vi}.json
└─ docs/channel/minimax-h3-video-billing.md    计费规则文档
```

---



## 3. 渠道注册

`constant/channel.go`：

```go
ChannelTypeMiniMaxH3 = 59
ChannelBaseURLs[59] = "https://token.ai-galaxy.com"
ChannelTypeNames[59] = "MiniMaxH3"
```

`relay/relay_adaptor.go` 的 `GetTaskAdaptor`：

```go
case constant.ChannelTypeMiniMaxH3:
    return &minimaxh3.TaskAdaptor{}
```

Adaptor 结构体：

```go
type TaskAdaptor struct {
    taskcommon.BaseBilling          // 复用通用计费基类
    ChannelType int
    apiKey      string
    baseURL     string
}
```

`Init(info)` 仅填充 `ChannelType/baseURL/apiKey`，保持 adaptor 无状态。

---



## 4. 路由与请求分发



### 4.1 路由（`router/video-router.go`）

```
不选渠道（列表/删除）:
  GET    /v2/query/video_generation          → controller.RelayH3VideoTaskList
  DELETE /v2/video_generation/:task_id      → controller.RelayH3VideoTaskDelete

选渠道（提交/查询）:
  POST   /v2/video_generation                → controller.RelayTask
  POST   /v2/h3_context_ir                   → controller.RelayTask
  POST   /v2/video_regeneration              → controller.RelayTask
  GET    /v2/query/video_generation/:task_id → controller.RelayTaskFetch
```

所有 V2 路由都挂 `TokenAuth()`；提交/单查询额外挂 `Distribute()`（选渠道）。

### 4.2 Distributor 识别（`middleware/distributor.go`）

`getModelRequest` 里新增 `minimaxh3.IsV2Path(path)` 分支：


| 方法 + 路径                                     | relay_mode                | 是否选渠道               | model 来源   |
| ------------------------------------------- | ------------------------- | ------------------- | ---------- |
| POST + 任意 V2 提交路径                           | `RelayModeVideoSubmit`    | 是                   | body.model |
| GET + `/v2/query/video_generation/:task_id` | `RelayModeVideoFetchByID` | 否（用 task.ChannelId） | 原 task 模型  |
| 其它（list/delete）                             | `RelayModeUnknown`        | 否                   | —          |


`path.go` 的 `IsV2Path` 用 `strings.Contains` 识别四条路径，`IsV2SubmitPath` 用 `HasSuffix` 识别三条提交路径（用于错误透传分支判断）。

---



## 5. 提交主流程（`RelayTask` → `RelayTaskSubmit`）

入口在 `controller/relay.go:RelayTask`，主体逻辑在 `relay/relay_task.go:RelayTaskSubmit`。流程：

1. `info.InitChannelMeta(c)` — 把渠道上下文刷进 RelayInfo（本次新增调用）。
2. `ResolveOriginTask(c, info)` — 仅 `/v2/video_regeneration` 且带 `source_task_id` 时走此路径：
  - `peekH3SourceTaskID` 从 body 偷看 `source_task_id`（避免完整反序列化两次）；
  - 若原任务不存在/已软删/超出 7 天窗口 → 返回 `h3LocalNotFound()`；
  - 锁定到原任务渠道（`info.LockedChannel`），重试时复用同渠道轮换 key。
3. `adaptor.Init(info)` **+** `ValidateRequestAndSetAction` — 见第 6 节。
4. `ModelPriceHelperPerCall` — 取 `ModelPrice`（默认 0.5 元/秒）。
5. `adaptor.EstimateBilling` — 见第 7.1 节，返回 `OtherRatios["h3_units"]`。
6. `ApplyOtherRatiosToFloat` **+** `QuotaFromFloatChecked` — 饱和转换防溢出，clamp 写进 `info.QuotaClamp`。
7. `PreConsumeBilling`（仅首次）— 预扣 `info.PriceData.Quota`。
8. `adaptor.BuildRequestBody` — 见 7.2。
9. `adaptor.DoRequest` — 通用 `channel.DoTaskApiRequest`。
10. **非 200 透传**：`IsV2SubmitPath` 为真 → `minimaxh3.PassthroughError(status, body)`，原样回上游 body；否则走旧 `fail_to_fetch_task`。
11. `c.Header("X-New-Api-Other-Ratios", ratiosJSON)` — 在写 body 前下发。
12. `adaptor.DoResponse` — 见 7.3。
13. `adaptor.AdjustBillingOnSubmit` — 提交后调整（H3 不用，基类返回 nil）。
14. 落库：`task.PrivateData` 写入 `CallbackURL / TaskType / Modality / H3SourceDuration`；`task.Quota = result.Quota`。

`PerCallBilling` 关键判定（`controller/relay.go`）：

```go
PerCallBilling: !isMiniMaxH3Channel(relayInfo) &&
    (common.StringsContains(constant.TaskPricePatches, ...) || relayInfo.PriceData.UsePrice)
```

H3 必须把 `PerCallBilling` 关掉，才能在轮询阶段走 `AdjustBillingOnComplete` 做差额结算。

---



## 6. 请求校验（`validate.go: parseAndValidateRequest`）



### 6.1 任务类型识别

`taskTypeFromPath` 按路径后缀识别：


| 路径                       | TaskType        | Modality |
| ------------------------ | --------------- | -------- |
| `/v2/video_generation`   | `generation`    | `video`  |
| `/v2/h3_context_ir`      | `h3_context_ir` | `text`   |
| `/v2/video_regeneration` | `regeneration`  | `video`  |




### 6.2 通用解析

body 反序列化为 `map[string]any`（用 `common.UnmarshalBodyReusable` 支持重读），逐字段提取到 `createRequest`：

- `model` 必须是 `MiniMax-H3`（`isH3Model` 大小写/空格不敏感），否则 400。
- `duration` 走 `parseOptionalInt`，支持 float64/int/int64/json.Number/string，非整数报错；同时记 `HasDuration` 区分「未传」与「显式 0」。
- `resolution`、`ratio`、`callback_url`、`source_task_id` 字符串。
- `aigc_watermark` 走 `parseOptionalBool`，仅接受真布尔，写成 `*bool` + `HasWatermark`。
- `content` 必须是数组，二次 marshal/unmarshal 到强类型 `[]ContentItem`；同时统计 `ImageCount` / `HasRefVideo`。



### 6.3 三类业务校验

- **generation**：
  - 必须有非空 `text` 项；
  - `duration` 必填且 ∈ [4, 15]；
  - `resolution` ∈ {768P, 2K}；
  - `first_frame/last_frame` 与 `reference_*` 角色互斥；
  - 纯文生视频时 `ratio` 必填且不能是 `adaptive`。
- **h3_context_ir**：必须有非空 text + duration + 角色互斥。
- **regeneration**：`source_task_id` 与 `content` **二选一**（同时有或都没有 → 400）；`resolution` 必须 2K；若走 content 模式且无 duration → 用 `MaxDuration=15`；若走 source 模式 → `lookupOwnedTask` 查原任务，从 `task.Data` 或 `PrivateData.H3SourceDuration` 推导 duration，并把原任务的 `UpstreamTaskID` 写到 `req.UpstreamSourceTaskID`。

校验完毕把 `task_type/modality/callback_url/duration` 写进 `info.Action / info.H3TaskType / info.H3Modality / info.CallbackURL / info.H3SourceDuration`，供后续计费与落库使用。

### 6.4 可见性窗口

`taskVisible` / `h3TaskInWindow`：任务创建时间必须在最近 `QueryWindowSeconds = 7 天`内，否则按 404 处理（list/delete/fetch/regeneration source 一致）。

---



## 7. Adaptor 接口实现（`adaptor.go`）



### 7.1 `EstimateBilling`（预扣估算）

```go
basePrice := info.PriceData.ModelPrice
if basePrice <= 0 { basePrice = BasePricePerSec }  // 0.50
units := estimateH3Units(req, basePrice)          // = yuan / basePrice
return map[string]float64{"h3_units": units}
```

设计动机：价格由「秒 × 单价 + 超额图 × 单价 + 视频输入时长 × 单价」等多项相加构成，无法塞进 `OtherRatios` 的单一乘法，所以折算成**相对基准价的倍数** `h3_units`，让 `ApplyOtherRatiosToFloat` 一次乘进去。

`estimateYuan` 按任务类型分支（见 `billing.go`）：

- **generation**：`seconds = duration + (hasRefVideo ? 15 : 0)`；`secPrice = basePrice × resolutionRatio(resolution)`；`yuan = seconds × secPrice + max(0, imageCount-5) × 0.20`。
- **regeneration**：`yuan = duration × 0.30 + (hasRefVideo ? 15×0.30 : 0) + max(0, imageCount-5) × 0.15`。
- **h3_context_ir**：`yuan = duration × basePrice`（按 768P 锚定，终态按 token 多退少补）。

`resolutionRatio`：`2K → Price2KPerSec/BasePricePerSec = 0.80/0.50 = 1.6`；其它 = 1.0。

### 7.2 `BuildRequestBody`

按 task_type 组装上游 body：

- 通用：`model`；非空 `content`。
- regeneration：`source_task_id`（优先用 `req.UpstreamSourceTaskID`，没有则现查原任务）、可选 `resolution`；**不传 duration**（上游按原任务）。
- 其它：`duration`；generation 传 `resolution`。
- 通用可选：`ratio`、`aigc_watermark`（仅非 IR 且为 true 时透传）。

`common.Marshal` 转成 `bytes.NewReader`。

### 7.3 `DoResponse`

1. 读 body；非 200 → `PassthroughError(status, body)`（保留原 body）。
2. 反序列化 `createResponse{task_id}`；`task_id` 空 → 502 本地错误。
3. `c.JSON(200, {"task_id": info.PublicTaskID})` —— **对外只暴露网关** `task_` **前缀 ID**，上游真实 ID 仅存 `task.PrivateData.UpstreamTaskID`。
4. 返回 `(parsed.TaskID, responseBody, nil)`，调用方落库。



### 7.4 `FetchTask`（轮询上游）

`GET {baseURL}/v2/query/video_generation/{task_id}`，Bearer 鉴权，`service.GetHttpClientWithProxy` 走代理。

### 7.5 `ParseTaskResult`

解析 `queryEnvelope{task: queryTask}`，状态走 `MapUpstreamStatus`：

- `queued/pending` → `Queued`（progress 10%）
- `running/processing` → `InProgress`（50%）
- `succeeded/success` → `Success`（100%），从 `content.url` 取结果 URL；**IR 任务**才读 `prompt_tokens / completion_tokens` 填 `CompletionTokens / TotalTokens`。
- `failed/fail/failure` → `Failure`（100%），`error.message` → `Reason`。
- `cancelled/canceled` → `Cancelled`。
- 未知状态 → `InProgress` + `30%`（保守等待，不判失败）。



### 7.6 `ConvertToOpenAIVideo`

OpenAI Video API 格式（`/v1/videos/...`）适配，用 `dto.NewOpenAIVideo()` 输出 `id/task_id/status/progress/metadata.url/created_at/completed_at/model`。

### 7.7 `AdjustBillingOnComplete`

```go
if quota, ok := settleQuotaFromTask(task); ok { return quota }
if task.Quota > 0 { return task.Quota }  // usage 不可用时保持预扣
return 0
```

详见第 8 节。

---



## 8. 计费（`billing.go`）



### 8.1 价格常量（`constants.go`）


| 常量                           | 值      | 含义                |
| ---------------------------- | ------ | ----------------- |
| `BasePricePerSec`            | 0.50   | 768P 基准元/秒        |
| `Price2KPerSec`              | 0.80   | 2K 元/秒            |
| `RegenPricePerSec`           | 0.30   | 再生成元/秒            |
| `ExtraImageYuan`             | 0.20   | generation 超额图元/张 |
| `RegenExtraImageYuan`        | 0.15   | 再生成超额图元/张         |
| `IRInputYuanPerMillion`      | 5.80   | IR 输入 token 元/百万  |
| `IROutputYuanPerMillion`     | 23.00  | IR 输出 token 元/百万  |
| `FreeImageCount`             | 5      | 免费图张数             |
| `VideoInputPrechargeSeconds` | 15     | 视频输入预扣额外秒数        |
| `MinDuration / MaxDuration`  | 4 / 15 | duration 合法区间     |




### 8.2 完成结算 `settleQuotaFromTask`

从 `task.Data`（上游完成响应）解析 `usage`，按官方公式算 yuan：

- **generation**：`yuan = (output_seconds + input_seconds) × secPriceFor(resolution, basePrice) + max(0, inputImageCount-5) × 0.20`
- **regeneration**：`yuan = (output_seconds + input_seconds) × 0.30 + max(0, inputImageCount-5) × 0.15`
- **h3_context_ir**：`yuan = prompt_tokens × 5.80/1e6 + completion_tokens × 23.00/1e6`

关键工程细节：

1. `basePrice / groupRatio` 从 `task.PrivateData.BillingContext` 快照取，避免运行期价格变动影响已提交任务。
2. `discount` 从 `model.GetModelDiscount` 取（∈ [0,1]）。
3. `clampSeconds` 把所有用户/上游控制的秒数钳到 `[0, relaycommon.MaxTaskDurationSeconds]`，防「秒数爆炸」导致 quota 溢出。
4. `output_seconds` **缺失时回退** `duration`（不同上游响应字段差异兼容）。
5. **usage 全 0 → 返回** `(0, false)`：保持预扣不退不补，**不**回落 token 结算。
6. `common.QuotaFromFloatStrict` 饱和转换：`yuan × QuotaPerUnit(500000) × groupRatio × discount` 钳到 int32 范围，防溢出产生负数（信用）。
7. `parseUsageFromTaskData` 同时兼容 `{task:{usage:...}}` envelope 和扁平 `{usage:...}` 两种上游返回格式；`fillUsageMap` + `intFromAny` 处理 float64/int/int64/json.Number 多类型。



### 8.3 三层结算优先级（`service/task_polling.go:settleTaskBillingOnComplete`）

```go
1. PerCallBilling=true → 直接返回，不结算
2. adaptor.AdjustBillingOnComplete 返回 >0 → RecalculateTaskQuota
3. taskResult.TotalTokens > 0                  → RecalculateTaskQuotaByTokens
4. 都不满足                                      → 保持预扣
```

H3 走第 2 条；`RecalculateTaskQuota` 算 `delta = actualQuota - task.Quota`，正数补扣、负数退款、零不动。

### 8.4 失败 / 取消

`updateVideoSingleTask`：

- `FAILURE` 且 `task.Quota != 0` → `RefundTaskQuota` 全额退预扣。
- `CANCELLED` 同上。
- 即便上游返回 `usage` 非零，失败/取消也**不**走结算（`shouldSettle` 仅在 `SUCCESS` 为真）。

---



## 9. 状态轮询（`service/task_polling.go`）

`RunTaskPollingOnce` 每轮：

1. `sweepTimedOutTasks` 超时清理（`TaskTimeoutMinutes` 分钟，旧系统遗留任务不退款）。
2. `sweepUnrefundedFailedTasks` 对账已失败但 quota 未退的任务（带 30s 宽限期 + `ClaimQuotaForRefund` 防双退）。
3. 取所有未完成任务按 platform 分组。
4. `DispatchPlatformUpdate` → 非 Suno/MJ 走 `UpdateVideoTasks`，按渠道并发 `updateVideoTasks`。
5. 单任务 `updateVideoSingleTask`：
  - `adaptor.FetchTask` 拉上游状态；
  - 先尝试按 new-api 标准响应格式解析，失败再走 `adaptor.ParseTaskResult`；
  - 写回 `task.Data = redactVideoResponseBody(...)`（裁剪 base64/视频字节，防 DB 爆炸）；
  - **CAS 持久化** `UpdateWithStatus(prevStatus)`：只有从非终态 → 终态的胜者才结算/退款，防重叠轮询/多实例/重试导致重复退款；
  - SUCCESS 时若上游没给 URL 且**不是 H3** 才构造代理 URL（H3 走上游原始 `content.url`，避免代理链接失效）；
  - `OnVideoTaskTerminal`（main.go 注入）触发 H3 终态回调投递。

`main.go` 注入：

```go
service.OnVideoTaskTerminal = func(ctx, task) {
    if string(task.Platform) != strconv.Itoa(constant.ChannelTypeMiniMaxH3) { return }
    copied := *task
    gopool.Go(func() { minimaxh3.DeliverCallback(context.Background(), &copied) })
}
```

---



## 10. 列表 / 删除（`controller/h3_video_task.go`）



### 10.1 `RelayH3VideoTaskList`（`GET /v2/query/video_generation`）

- `ParseListQuery` 解析 `page_num/page_size/filter.{status,task_type,model,task_ids}`；
- 仅查本账号、未软删、最近 7 天（`ExcludeDeleted + StartTimestamp = now - 7d`）；
- `model` 不是 H3 → 直接返回空集（`EmptyResult`）；
- `status` / `task_ids` 映射到 `model.SyncTaskQueryParams`；
- 调 `model.TaskCountAllUserTask / TaskGetAllUserTask`，每条用 `minimaxh3.BuildQueryTask` 包装输出。
- **不打上游列表接口**，纯本地查询。



### 10.2 `RelayH3VideoTaskDelete`（`DELETE /v2/video_generation/:task_id`）

- 找任务；不存在/已软删/超 7 天 → 404（H3 错误信封）。
- **进行中**（NOT_START/SUBMITTED/QUEUED/IN_PROGRESS）：
  1. `cancelH3Upstream`：取渠道 → `CancelUpstreamTask`（`DELETE /v2/video_generation/{upstream_id}`）；
  2. CAS 改 `CANCELLED` + `FinishTime` + `Progress=100%`；
  3. 胜者 → `RefundTaskQuota` 全额退 + `scheduleH3Callback`；
  4. 返回 `{task_id, action:"cancelled", status:"cancelled"}`。
- **终态**（SUCCESS/FAILURE/CANCELLED）：仅 `DeletedAt = now` 软删，查询/列表当 404；返回 `{task_id, action:"deleted"}`。

`scheduleH3Callback` 在 `gopool.Go` 里跑 `DeliverCallback`，不阻塞响应。

---



## 11. 回调（`callback.go`）



### 11.1 `CancelUpstreamTask`

`DELETE {baseURL}/v2/video_generation/{upstream_id}`，Bearer + 代理。

### 11.2 `DeliverCallback`

- 仅当 `task.PrivateData.CallbackURL` 非空、`http(s)://` 开头时投递。
- 触发条件：终态 `succeeded/failed/cancelled`。
- 幂等：`task.PrivateData.CallbackPushedStatus == status` 时跳过。
- body = `BuildQueryEnvelope(task)`（与单查询响应一致）。
- HTTP POST，10s 超时，最多 3 次重试，指数退避（1s/2s）。
- 2xx 成功 → 持久化 `CallbackPushedStatus`；失败记 warn，不影响计费。
- `callback_url` 仅存本地 PrivateData，**不转上游**。

---



## 12. 查询响应包装（`query.go: BuildQueryTask`）

把内部 `*model.Task` 整形成 chinadatapay V2 文档的 `{task:{...}}` 形态：

1. 从 `task.Data` 抽取上游原始 `task` 字段（兼容 `{task:...}` envelope 与扁平 `{id:...}`）。
2. 覆盖关键字段：
  - `id` = `task.TaskID`（网关 ID），删 `task_id`；
  - `model` / `status`（`MapInternalStatus`）/ `task_type` / `modality` 用本地值，确保与对外契约一致；
  - `created_at` / `updated_at` 优先 `task.CreatedAt/UpdatedAt`，回退 `SubmitTime/FinishTime`。
3. **content 归一化**：`content.video_url` → `content.url`；删 `video_url`；若没 url 且无 prompt，用 `task.GetResultURL()` 填。
4. **error 兜底**：FAILURE 时补占位 `{code:"upstream_error_detail_missing", message:"upstream did not return error detail"}` 或 `task.FailReason`；非 FAILURE 删 `error` 字段。
5. `dropEmptyOptional` 删空 `content/usage/resolution/duration/ratio`。

`MapInternalStatus`：`Success→succeeded, Failure→failed, Cancelled→cancelled, InProgress→running, Queued/Submitted/NotStart→queued`。

---



## 13. 错误信封（`dto/task.go` + `controller/relay.go`）

`TaskError` 新增两个字段：

```go
H3LocalEnvelope bool    // 本地错误 → chinadatapay 信封
PassthroughBody []byte   // 上游错误 → 原样透传
```

`respondTaskError` 输出优先级：

1. `PassthroughBody` 非空 → `c.Data(status, "application/json", body)` 原样回。
2. `H3LocalEnvelope` 为真 → `c.JSON(status, {error_code, status_code, message})`。
3. 429 且**非** V2 路径 → 旧逻辑改写「分组上游负载饱和」；V2 路径 429 原样返回（不重写，避免破坏官方语义）。
4. 其它 → 旧 `c.JSON(status, taskErr)`。

本地错误统一通过 `localError(...)` 构造（自动带 `H3LocalEnvelope=true`）；上游错误走 `PassthroughError(...)`（带 `PassthroughBody`）。

`service/error.go` 修复：`TaskErrorFromAPIError` 把 `apiErr.Err.Error()` 改成 `apiErr.Error()`，避免 `Err` 为 nil 时 panic（H3 透传路径会触发）。

---



## 14. 关键数据结构



### 14.1 `createRequest`（`types.go`）

强类型 + `Has*` 标志位区分「未传」与「显式零值」——这是 relay 通用规则（可选标量必须用指针 + omitempty，避免零值被静默丢弃）。

### 14.2 `queryEnvelope / queryTask`

上游查询响应结构。`Content map[string]any` 和 `Usage map[string]any` 用 `map[string]any` 而非强类型，因为上游字段集合会随 task_type 变化，灵活兼容。

### 14.3 `parsedUsage`

结算中间结构，`HasSeconds / HasTokens` 区分「真没数据」与「值为 0」。

### 14.4 `TaskRelayInfo`（`relay/common/relay_info.go`）新增字段

```go
CallbackURL      string
H3TaskType       string
H3Modality       string
H3SourceDuration int
```

这些字段在 `parseAndValidateRequest` 里写入，在 `RelayTask` 落库时拷进 `task.PrivateData`，供后续结算/回调使用。

---



## 15. 配置指南（运维侧）

1. 渠道类型选 **59 MiniMaxH3**（**不要**用 35 MiniMax 或 54 DoubaoVideo）。
2. 模型列表只填 `MiniMax-H3`。
3. **模型价格 ModelPrice = 0.5**（对应官方 768P 0.50 元/秒）。
4. **不要配模型倍率 ModelRatio**（会和按秒计价冲突）。
5. 分组倍率 / 模型折扣按业务配（预扣、结算都会乘）。
6. `QuotaPerUnit = 500000`（1 元 = 50 万额度）。
7. 客户端调 `POST /v2/video_generation`，body 含 `model=MiniMax-H3` / `duration` / `resolution` / `ratio`（文生视频必填，不能 adaptive）/ `content`。



### 抽检表（groupRatio=1, discount=1, ModelPrice=0.5）


| 场景                    | yuan           | h3_units | 预扣额度      |
| --------------------- | -------------- | -------- | --------- |
| 6s / 768P / 无视频       | 3.00           | 6        | 1,500,000 |
| 6s / 2K / 有视频输入(+15s) | 21×0.80=16.80  | 33.6     | 8,400,000 |
| 6s / 768P / 6 张图      | 3.00+0.20=3.20 | 6.4      | 1,600,000 |
| IR duration=6         | 3.00           | 6        | 1,500,000 |
| 再生成 6s                | 6×0.30=1.80    | 3.6      | 900,000   |


---



## 16. 与相邻渠道差异


|     | MiniMax-H3 (59)                | Seedance (54)               | hailuo (35)       |
| --- | ------------------------------ | --------------------------- | ----------------- |
| 接口  | `/v2/*` 文档原样                   | `/v1/video/tasks`           | Hailuo V1         |
| 预扣  | yuan 折 `h3_units`；视频输入 +15s    | token 单价相对倍率                | 仅模型价/倍率           |
| 完成  | generation 按秒 + 超额图；IR 按 token | `total_tokens × modelRatio` | 按次保持预扣            |
| URL | 上游原始 `content.url`             | 代理 URL                      | 代理 URL            |
| 错误  | chinadatapay 信封 / 上游透传         | new-api TaskError           | new-api TaskError |


---



## 17. 计费安全不变量（符合 AGENTS.md）

- 所有用户控制的乘数（duration、imageCount、video 输入秒数）在 `validate.go` 与 `clampSeconds` 双重钳制。
- `QuotaFromFloatStrict` 饱和转换，防 int32 溢出成负数（信用）。
- `PriceData.AddOtherRatio` 校验非正/NaN/+Inf（`h3_units` 来自 `yuan/basePrice`，`yuan<=0` 时直接返回 0）。
- CAS 持久化 + `ClaimQuotaForRefund` 防止重复退款。
- 失败/取消不结算、全额退预扣，即使上游 usage 非零。

---



## 18. 测试覆盖

`relay/channel/task/minimaxh3/` 下：

- `adaptor_test.go`：BuildRequestURL / BuildRequestBody / DoResponse / FetchTask / ParseTaskResult。
- `billing_test.go`：`estimateYuan` / `settleQuotaFromTask` 各任务类型 + 边界。
- `callback_test.go`：`DeliverCallback` 幂等/重试/状态过滤。
- `list_test.go`：`ParseListQuery` 各种 filter 组合。
- `query_test.go`：`BuildQueryTask` content 归一化、error 兜底、状态映射。
- `validate_test.go`：三类任务校验全路径。
- 仓库根 `relay/relay_task_h3_test.go`：`ResolveOriginTask` / `peekH3SourceTaskID` 端到端。

`service/error_test.go`、`types/error_test.go`：`TaskErrorFromAPIError` 修复的回归测试。