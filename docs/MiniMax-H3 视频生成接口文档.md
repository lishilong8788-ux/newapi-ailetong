# MiniMax\-H3 视频生成接口文档

# MiniMax\-H3 视频生成接口文档



- **Base URL**：`https://token.ai-galaxy.com`

- **鉴权**：所有业务接口需在请求头携带 `Authorization: Bearer <你的 Token>`

- **模型名**：`MiniMax-H3`（区分大小写）

- **协议**：路径与请求 / 响应字段与 MiniMax 官方 `/v2` 契约逐字一致，已接入官方 SDK 的下游只需替换 Base URL 即可切流。

> 任务 ID 说明：本网关返回的 `task_id` / `task.id` 是网关侧任务 ID（`task_` 前缀），后续查询、删除一律使用该 ID。网关不会返回上游任务 ID。
> 
> 



---

## 1\. 接口一览

|接口|方法|路径|
|---|---|---|
|创建视频生成任务|POST|`/v2/video_generation`|
|创建上下文理解任务|POST|`/v2/h3_context_ir`|
|视频再生成|POST|`/v2/video_regeneration`|
|查询单个任务|GET|`/v2/query/video_generation/{task_id}`|
|查询任务列表|GET|`/v2/query/video_generation`|
|取消 / 删除任务|DELETE|`/v2/video_generation/{task_id}`|

---

## 2\. 公共枚举

### 2\.1 任务状态 `status`

|取值|含义|是否终态|
|---|---|---|
|`queued`|排队中|否|
|`running`|生成中|否|
|`succeeded`|成功|是|
|`failed`|失败|是|
|`cancelled`|已取消|是|

### 2\.2 任务类型 `task_type`

|取值|对应创建接口|`modality`|
|---|---|---|
|`generation`|`/v2/video_generation`|`video`|
|`h3_context_ir`|`/v2/h3_context_ir`|`text`|
|`regeneration`|`/v2/video_regeneration`|`video`|

### 2\.3 分辨率 `resolution`

`768P`、`2K`。`/v2/video_regeneration` 仅支持 `2K`。

### 2\.4 画面比例 `ratio`

`adaptive`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`。

### 2\.5 `content[].type` 与 `role`

|`type`|说明|可用 `role`|
|---|---|---|
|`text`|提示词，不带 `role`|—|
|`image_url`|图片|`first_frame`、`last_frame`、`reference_image`|
|`video_url`|视频|`reference_video`、`base_video`\(仅再生成\)|
|`audio_url`|音频|`reference_audio`|

媒体对象格式：`{"url": "..."}`，`url` 支持公网地址、`mm_file://{file_id}`、base64 data URI。

---

## 3\. 创建视频生成任务

`POST /v2/video_generation`

### 请求体

|字段|类型|必填|说明|
|---|---|---|---|
|`model`|string|是|固定 `MiniMax-H3`|
|`content`|array|是|至少包含 1 个非空 `text` 项|
|`duration`|int|是|出片时长，**4–15** 秒整数|
|`resolution`|string|是|`768P` / `2K`|
|`ratio`|string|否|见 2\.4；未传由上游取默认值|
|`aigc_watermark`|bool|否|是否添加 AIGC 水印。**显式传 ****`false`**** 会原样下发**，不传则省略|
|`callback_url`|string|否|任务终态回调地址，见第 8 节|

### 示例

```Bash
curl -X POST 'https://token.ai-galaxy.com/v2/video_generation' \
  -H 'Authorization: Bearer <你的 Token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "MiniMax-H3",
    "duration": 6,
    "resolution": "768P",
    "ratio": "16:9",
    "content": [
      {"type": "text", "text": "一只橘猫在窗台上晒太阳，镜头缓慢推近"},
      {"type": "image_url", "role": "first_frame", "image_url": {"url": "https://example.com/first.jpg"}}
    ]
  }'
```

### 响应

```JSON
{ "task_id": "task_abc123def456" }
```

### 参数约束（校验失败返回 400，不产生任何计费）

- `content` 必须含至少 1 个 `text` 且去除空白后非空

- `duration` 必填且在 `[4, 15]` 内

- `resolution` 必填且为 `768P` / `2K`

- **首尾帧与参考项互斥**：`first_frame` / `last_frame` 不能与 `reference_image` / `reference_video` / `reference_audio` 同时出现

---

## 4\. 创建上下文理解任务

`POST /v2/h3_context_ir`

请求体与 `/v2/video_generation` 相同，差异如下：

- `duration` 仍为**必填** `[4, 15]`（用于预扣额度锚定，实际按 Token 结算）

- `resolution` 与 `aigc_watermark` 会在提交上游前被移除，传了不报错但无效果

- 返回结果为文本（`modality: text`），产物在 `task.content` 内

```JSON
{ "task_id": "task_ir789xyz" }
```

---

## 5\. 视频再生成

`POST /v2/video_regeneration`

### 请求体

|字段|类型|必填|说明|
|---|---|---|---|
|`model`|string|是|固定 `MiniMax-H3`|
|`source_task_id`|string|二选一|已完成任务的 `task_id`，须属于本账号|
|`content`|array|二选一|与 `source_task_id` **恰好提供其一**|
|`resolution`|string|是|仅支持 `2K`|
|`ratio`|string|否|见 2\.4|
|`callback_url`|string|否|见第 8 节|

`duration` 不接收（上游再生成接口无该参数）。

### 示例

```Bash
curl -X POST 'https://token.ai-galaxy.com/v2/video_regeneration' \
  -H 'Authorization: Bearer <你的 Token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "MiniMax-H3",
    "resolution": "2K",
    "source_task_id": "task_abc123def456"
  }'
```

### 参数约束

- `source_task_id` 与 `content` 必须**恰好一个**：都传或都不传均返回 400

- `source_task_id` 必须是本账号名下、7 天内、未删除的任务，否则 404

- `content` 模式下同样要求至少 1 个非空 `text`，且首尾帧与参考项互斥

---

## 6\. 查询单个任务

`GET /v2/query/video_generation/{task_id}`

```Bash
curl 'https://token.ai-galaxy.com/v2/query/video_generation/task_abc123def456' \
  -H 'Authorization: Bearer <你的 Token>'
```

### 响应

```JSON
{
  "task": {
    "id": "task_abc123def456",
    "model": "MiniMax-H3",
    "status": "succeeded",
    "task_type": "generation",
    "modality": "video",
    "created_at": 1771234567,
    "updated_at": 1771234690,
    "resolution": "768P",
    "duration": 6,
    "ratio": "16:9",
    "content": { "url": "https://cdn.example.com/output.mp4?sig=..." },
    "usage": {
      "total_seconds": 6,
      "output_seconds": 6,
      "input_seconds": 0,
      "input_image_count": 1
    }
  }
}
```

### 字段说明

|字段|说明|
|---|---|
|`task.id`|网关任务 ID，恒等于创建时返回的 `task_id`|
|`task.model`|你创建时传入的模型名|
|`task.status`|见 2\.1，恒存在|
|`task.task_type`|见 2\.2|
|`task.modality`|`video` / `text`|
|`task.created_at` / `updated_at`|Unix 秒|
|`task.content`|产物。视频任务为 `{"url": "..."}`；上下文理解任务为文本结构。**上游未返回时该字段不出现**|
|`task.usage`|用量。**只包含上游确实返回的字段**，未返回的键不出现|
|`task.error`|仅 `status=failed` 时出现，且 `code`、`message` 恒非空|

`resolution` / `duration` / `ratio` 按上游返回情况回显，上游未返回则不出现。

### 失败任务示例

```JSON
{
  "task": {
    "id": "task_abc123def456",
    "model": "MiniMax-H3",
    "status": "failed",
    "task_type": "generation",
    "modality": "video",
    "created_at": 1771234567,
    "updated_at": 1771234620,
    "error": { "code": "1026", "message": "content risk detected" }
  }
}
```

上游未给出错误详情时，`code` / `message` 会填占位值 `upstream_error_detail_missing` / `upstream did not return error detail`，保证失败分支总能取到可读内容。

### 建议轮询策略

非终态任务建议 3–5 秒轮询一次；命中 `succeeded` / `failed` / `cancelled` 即停止。已配置 `callback_url` 的场景以回调为主、轮询为兜底。

---

## 7\. 查询任务列表

`GET /v2/query/video_generation`

只返回**本账号最近 7 天内、未删除**的任务。

### 查询参数

|参数|类型|默认|说明|
|---|---|---|---|
|`page_num`|int|1|正整数，非正整数返回 400|
|`page_size`|int|20|正整数；超过 **500** 按 500 截断（不报错）|
|`filter.status`|string|—|见 2\.1，**区分大小写**|
|`filter.task_type`|string|—|见 2\.2|
|`filter.task_ids`|string|—|可重复传多个，最多 500 个|
|`filter.model`|string|—|按创建时传入的模型名精确匹配|

空值参数（如 `?filter.status=`）视为未提供该过滤项。

### 示例

```Bash
curl 'https://token.ai-galaxy.com/v2/query/video_generation?page_num=1&page_size=20&filter.status=succeeded&filter.task_type=generation' \
  -H 'Authorization: Bearer <你的 Token>'
```

### 响应

```JSON
{
  "items": [
    {
      "id": "task_abc123def456",
      "model": "MiniMax-H3",
      "status": "succeeded",
      "task_type": "generation",
      "modality": "video",
      "created_at": 1771234567,
      "updated_at": 1771234690,
      "content": { "url": "https://cdn.example.com/output.mp4?sig=..." },
      "usage": { "total_seconds": 6, "output_seconds": 6 }
    }
  ],
  "total": 1
}
```

`items` 中每一项的结构与单任务查询的 `task` 对象**完全一致**。无匹配结果时 `items` 为 `[]`（不是 `null`），`total` 为 0。`total` 是满足全部过滤条件的总条数，用于翻页。

---

## 8\. 取消 / 删除任务

`DELETE /v2/video_generation/{task_id}`

同一接口按任务当前状态自动分派语义：

|任务状态|行为|`action`|
|---|---|---|
|`queued` / `running`|取消任务，**全额退还已预扣额度**|`cancelled`|
|`succeeded` / `failed` / `cancelled`|删除记录，后续查询返回 404；**不产生额度变动**|`deleted`|

```Bash
curl -X DELETE 'https://token.ai-galaxy.com/v2/video_generation/task_abc123def456' \
  -H 'Authorization: Bearer <你的 Token>'
```

### 响应

```JSON
{
  "task_id": "task_abc123def456",
  "action": "cancelled",
  "status": "cancelled"
}
```

`status` 与 `action` 同值。

> 上游对 `running` 状态的任务不支持删除，此时会透传上游错误。
> 
> 

---

## 9\. 任务终态回调

创建任务时传入 `callback_url`，任务到达终态后网关会向该地址 `POST` 推送。

### 回调请求体

与「查询单个任务」的响应**逐字一致**：

```JSON
{
  "task": {
    "id": "task_abc123def456",
    "model": "MiniMax-H3",
    "status": "succeeded",
    "task_type": "generation",
    "modality": "video",
    "created_at": 1771234567,
    "updated_at": 1771234690,
    "content": { "url": "https://cdn.example.com/output.mp4?sig=..." },
    "usage": { "total_seconds": 6, "output_seconds": 6 }
  }
}
```

### 接收端要求

- 返回 **2xx** 表示接收成功；非 2xx 会触发重试

- 同一终态至多成功推送一次，但**请按幂等处理**（以 `task.id` \+ `status` 去重）

- 回调仅在终态触发（`succeeded` / `failed` / `cancelled`）

- 回调地址需公网可达；不可达时任务状态仍可通过轮询查询接口获取，不影响任务本身与计费

---

## 10\. 错误响应

### 网关本地校验错误

```JSON
{
  "error_code": "invalid_request",
  "status_code": 400,
  "message": "duration must be an integer between 4 and 15, got 30"
}
```

### 上游错误

上游返回的错误体与 HTTP 状态码**原样透传**，形如：

```JSON
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "...", "http_code": "400" },
  "request_id": "..."
}
```

### 状态码对照

|状态码|含义|处理建议|
|---|---|---|
|200|成功|—|
|400|参数错误|按 `message` 修正请求，勿重试|
|401|Token 无效或缺失|检查 `Authorization` 头|
|404|任务不存在、无权访问、已删除或超出 7 天窗口|勿重试|
|429|触发限流或渠道并发已满|退避后重试|
|500|网关内部错误|退避后重试|
|502|上游响应异常|退避后重试|
|503|上游暂不可达|退避后重试|

> 404 对「任务不存在」与「无权访问他人任务」返回完全相同的响应，不泄露任务是否存在。
> 
> 

---

## 11\. 计费说明

采用**加法计费**，非「基础价 × 倍率」：

**视频类**（`generation` / `regeneration`）

```Plain Text
费用 = 出片秒数 × 输出秒单价
     + 输入视频秒数 × 输入视频秒单价
     + max(0, 输入图片数 − 免费张数) × 超额图片单价
```

**上下文理解类**（`h3_context_ir`）

```Plain Text
费用 = 输入 tokens × 输入单价/百万 + 输出 tokens × 输出单价/百万
```

计费流程：

1. **创建时预扣**：按请求参数估算并锁定额度。余额不足直接返回错误，不提交上游

2. **终态结算**：按上游返回的实际 `usage` 重算，多退少补

3. **失败 / 取消全额退款**：`failed` 与 `cancelled` 一律退还全部预扣，即便上游返回了非零 `usage`

两点需注意：

- 输入视频秒数在预扣阶段按单段上限 15 秒**保守估算**，终态按实际时长退还差额

- 音频输入（`reference_audio`）不计费

- 单价以任务**创建时刻**生效的定价为准，后续调价不影响在途任务

---

## 12\. 对接检查清单

* [ ] Base URL 指向 `https://token.ai-galaxy.com`

* [ ] `Authorization: Bearer <Token>` 已配置

* [ ] `model` 固定为 `MiniMax-H3`

* [ ] `duration` 在 4–15 之间（`/v2/video_regeneration` 不传）

* [ ] 未同时使用首尾帧与参考项

* [ ] 轮询在命中三个终态后停止

* [ ] 使用回调时，接收端按 `task.id` \+ `status` 幂等处理并返回 2xx

* [ ] 已处理 429 / 503 的退避重试

