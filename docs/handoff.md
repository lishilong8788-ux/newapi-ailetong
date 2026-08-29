# 游乐场：当前进展与继续方式

面向「对话已丢、只有这份文档」的接手人。**先读第零节再动手。**

---

## 从这里开始：还剩什么

前八节大部分是**已完成**的记录（含为什么这么做、别改回去的理由）。真正待办的只有下面这些，按能不能立刻动手排序：

| # | 事项 | 状态 | 节 |
|---|---|---|---|
| 1 | ~~渠道 #1 拉真实模型列表~~ | **已完成**（2026-08-28） | 九 |
| 2 | 图片链路跑通一次 | 模型库已有 5 个图片模型，只差真发一次 | 四 |
| 3 | ~~29 个视频/音频模型被判成 chat~~ | **已完成**（2026-08-28） | 十二 |
| 4 | localStorage 不认账号 | 等用户拍板要不要做 | 六 |
| 5 | 音频链路 | 未开始 | 七 |
| 6 | 视频链路 | 未开始，要多做轮询 | 七 |
| 7 | 一处对不上的响应时间 | 排除三条路径，无结论 | 十 |
| 8 | 7 语言包的孤儿 key | 无害，需单独一轮 | 见另一份文档第零节 |
| 9 | 73 个模型缺 description、10 个缺厂商 | 数据侧，改代码解决不了 | 十一 |

#1 已解，#2 现在可以做了（需要浏览器登录态点一次）。

**最近一轮（2026-08-28）做完的**：渠道 #1 拉真实列表（640→74 个模型）、图片模态识别修复（五个图片模型进库，第十一节）、厂商映射补 5 条规则（无厂商 26→10，第十一节）、视频/ASR 模型不再混进 chat tab（第十二节）。模型库现在是 chat 40 + image 5，另 29 个按模态排除。

**上一轮（2026-08-26）**：未配价模型不进模型库（五点五）、错误文案按错误码分类（五点六）、`routed` 字段与视频音频过滤（五点七）。

---

## 零、这份文档为什么要分「已验证 / 未验证」

写这份文档的那次会话里，我（助手）有两次把**没有执行的改动叙述成已完成**：一次是 `vitest.config.ts` 的 jsdom 配置，一次是整个图片链路的后端改动。用户发现后我回读文件才确认没落地。

所以本文档每一项都标注了**验证方式**。凡标「未验证」的，接手时请先自己跑一遍再信。不要因为文字写得肯定就当它是真的。

已验证的判定标准：命令实际执行过并看到退出码 / 输出。

**第二个坑：这份文档本身会过期。** 2026-08-26 那次会话核对时，第五节「未开始」的存储说明文案其实早已落地并接线，第四节「前端未验证」也已经验证过了。接手人照着做会重复劳动。

所以**动手前先核实一遍**，别信文字。核实一项大概一条命令：文档说某文件不存在就 `ls` 它，说某功能未接线就 `grep` 它的引用。下面每节都给了可核实的落点。

---

## 一、已完成并验证：采样参数面板整体下架

**验证方式**：`bun run typecheck`(0)、`bun run test`(53 文件 311 用例全过)、`bun run build`(0)、`bun run i18n:sync`(missing 全 0)。

**动机**：`temperature`/`top_p`/`max_tokens`/`seed` 四个参数默认全关，所以面板的常态是「打开了但什么都不改」；而真打开反而更危险 —— Claude 4+ 明确拒绝同时携带 `temperature` 与 `top_p`，`max_tokens` 上限逐模型不同。对网关前台来说，不发字段、让上游用自己的默认值是唯一安全的默认。这个页面的用途是「确认模型能不能出话」，上游默认采样正合适。

**删掉的文件**：
- `web/src/features/playground/lib/parameters/playground-parameters.ts`
- `web/src/features/playground/components/input/playground-parameter-panel.tsx`

**删掉的符号**：`ParameterEnabled` 类型、`DEFAULT_PARAMETER_ENABLED`、`STORAGE_KEYS.PARAMETER_ENABLED`、`parameterEnabledSchema`、`loadParameterEnabled`/`saveParameterEnabled`、`getInitialParameterEnabled`；`ChatCompletionRequest` 的四个采样字段；`buildChatCompletionPayload` 里对应的四段分支（现在签名是两参：`(messages, config)`）。

**`PlaygroundConfig` 现在只有** `{ model, group, stream }`。

**芯片**：`CHAT_CAPABILITY.params` 是空数组，`ParamChipBar` 在空数组时返回 `null`。所以 chat 底部只剩 附加 → 价格提示 → 清空/发送。**image/video/audio 的芯片全部保留** —— 它们决定「产出什么」而非「怎么采样」，接链路时要用。

**兼容**：旧 `playground_config` 仍带那四个字段，`playgroundConfigSchema` 默认 strip 会丢弃而不是解析失败，老用户的模型与分组照常恢复。`playground_parameter_enabled_v2` 不再读写，留在浏览器无害。

**i18n**：7 个语言包删了 15 个孤儿 key，`src/i18n/static-keys.ts` 的 playground 参数块整段删除。

**理由写在代码注释里**（别再加回来）：`types.ts` 的 `PlaygroundConfig`、`registry.ts` 的 `CHAT_CAPABILITY`。

---

## 二、已完成并验证：会话按模型隔离

**验证方式**：同上，另有 8 个新测试在 `web/src/features/playground/lib/__tests__/storage-images.test.ts`。

**动机**：原先所有模型共用一条历史，这是个真 bug —— 切模型后下一轮会把上个模型的回复当上下文发给新模型，既是错的上下文也是白花的钱。

**存储**：`STORAGE_KEYS.MESSAGES`（单条扁平数组）换成 `STORAGE_KEYS.CONVERSATIONS`（键名 `playground_conversations`）。结构：

```json
{ "version": 1, "data": { "<模型id>": { "messages": [...], "updatedAt": 1756... } } }
```

- LRU 保留最近 `MAX_STORED_CONVERSATIONS`(12) 个，按 `updatedAt` 淘汰。
- 保存三次尝试，逐级降级：原样 → 除最新一条外剥掉图片附件 → 只留最新一条且剥图片。当前在看的那条是最后才放弃的。
- 首次加载 `loadConversations(activeModel)` 把旧单条历史迁进当前模型槽位，然后删掉旧 key（`LEGACY_MESSAGES`）。迁移只发生一次。

**行为**：**切模型是换画布，不是清空** —— 切回去原对话还在。

**切换时的顺序很关键**（`index.tsx` 的 `handleSelectModel`）：先 `stopGeneration()`（和 `stopImage()`）再改 `config.model`。它同步 flush 缓冲、推进 generation 号，所以流到一半的回复落在**切走前**那个模型名下，之后到达的 chunk 因号不匹配被丢弃，不会串台。同时关掉打开的消息编辑器。

**`activeModelRef` 为什么是 ref 而不是依赖项**：`updateMessages` 会传进被 memo 的消息组件，让它随模型变化重建会毁掉 memo（模型库有几百张卡）。

**分组切换不清历史** —— 分组是计费/路由选择，不是换模型。

**清空**只删当前模型槽位，文案改成「其他模型的历史不受影响」，7 语言已补。

---

## 三、已完成并验证：测试环境 localStorage（不属于需求，但它挡着验证）

**验证方式**：修复前 3 套件挂（playground storage、redemption-codes、keys），修复后 53 文件 311 用例全过。

**真实原因**：Node 26 自带实验性 `localStorage` 全局，需 `--localstorage-file` 才启用。没有该 flag 时**属性存在但读出来是 `undefined`**，并覆盖掉 jsdom 装的那个。

**不是 opaque origin**。测试 origin 是正常的 `http://localhost:3000`，从不抛 `SecurityError`。我一开始判断成 opaque origin 并往 `vitest.config.ts` 加了 `environmentOptions.jsdom.url`，**那个改动无效已撤回**（vitest 4 本来就默认这个 origin）。别再往那个方向修。

**做法**：`web/src/test-setup.ts` 里装内存版 Storage，方法挂在 `Storage.prototype` 上 —— 保住 `vi.spyOn(Storage.prototype, 'setItem')` 这种模拟配额拒绝的写法。

---

## 四、图片链路：代码已完整并验证，只差跑通一次

**2026-08-26 更新**：本节原写「前端全部未验证，typecheck 还没跑过」，**已过期**。前后端代码都在，`bun run typecheck`(0)、`bun run test`（playground 20 文件 138 用例全过）、`bun run build`(0) 都跑过了。

核实落点（三条都应有输出）：
```bash
grep -n "pg/images/generations" relay/constant/relay_mode.go   # 第 71 行
grep -n "images/generations" router/relay-router.go            # 第 70 行（/pg 组内相对路径）
grep -rn "message.results" web/src/features/playground/components/message/playground-message-content.tsx
```

注意第二条：路由注册用的是 `/pg` 组内的**相对**路径 `"/images/generations"`，搜绝对路径 `"/pg/images/generations"` 会得到 0 个结果，那是假阴性。

**真正缺的只有一件**：没有真发过一次图片请求。这不是代码缺口，是运行时验证。而且它有前置条件 —— 需要一个上游确实存在的图片模型，否则失败分不清是链路问题还是上游没这个模型。所以它排在第九节那件事之后。

`IMAGE_CAPABILITY.available` 因此仍是 `false`，模型带「即将推出」徽章。**跑通后把它改成 `true`** —— 但别顺手改 `routed`，那是另一件事，见第七节。

### 4.1 后端（已验证：`go build ./controller/... ./router/... ./relay/constant/...` 退出 0）

Windows 上 `go` 不在 PATH，先 `export PATH="$PATH:/c/Program Files/Go/bin"`。

三处改动：

1. `relay/constant/relay_mode.go:71` —— `Path2RelayMode` 加 `/pg/images/generations`：
   ```go
   } else if strings.HasPrefix(path, "/v1/images/generations") || strings.HasPrefix(path, "/pg/images/generations") {
   ```
   **为什么必须改**：relay mode 是从**请求路径**推的，`/pg` 前缀不匹配 `/v1/...`，不加这行会被判成 chat。`/pg/chat/completions` 早就在第 61 行有同样的特例。

2. `controller/playground.go` —— `Playground(c)` 改成 `Playground(c, relayFormat types.RelayFormat)`，内部两处 `types.RelayFormatOpenAI` 换成 `relayFormat`。**format 不能从路径推**：`GenRelayInfo` 推的是 relay *mode*，而 format 决定请求 DTO 和适配器入口，chat 与 image 不可互换。

3. `router/relay-router.go:67-72` —— 两条路由，各自传 format：
   ```go
   playgroundRouter.POST("/chat/completions", func(c *gin.Context) {
     controller.Playground(c, types.RelayFormatOpenAI)
   })
   playgroundRouter.POST("/images/generations", func(c *gin.Context) {
     controller.Playground(c, types.RelayFormatOpenAIImage)
   })
   ```
   `types` 已在 import 里。`controller.Playground` 全仓库只有这两个调用点。

**契约**（读自 `relaykit/dto/openai_image.go`）：请求 `{model, prompt, n?, size?, quality?}`，`prompt` 是 `binding:"required"`；响应 `{created, data: [{url, b64_json, revised_prompt}]}` —— url 和 b64 二者其一，取决于渠道。

### 4.2 前端（已验证：typecheck / test / build 全过）

改了 8 处：

| 文件 | 改动 |
|---|---|
| `types.ts` | `Message.results?: string[]`（助手生成的图，区别于用户附件 `images`）；新增 `ImageGenerationRequest`/`ImageGenerationResponse` |
| `lib/storage/storage-schema.ts` | `messageSchema` 加 `results` 字段，让结果能持久化 |
| `constants.ts` | `API_ENDPOINTS.IMAGE_GENERATIONS = '/pg/images/generations'` |
| `api.ts` | `sendImageGeneration()`，非流式 |
| `lib/message/message-utils.ts` | `getLastUserMessageText()` —— 倒序找最后一条 user 消息 |
| `hooks/use-image-handler.ts` | **新文件**。非流式版的 `useChatHandler`，同样的 generation 计数器守卫 |
| `hooks/index.ts` | 导出上面这个 |
| `index.tsx` | `sendForModality` 按 `selectedModelOption.modality` 分流；`isBusy` 是两条链路的并集；`onStop` 按模态选 |
| `components/message/playground-message-content.tsx` | 复用现成的 `MessageImages` 渲染 `message.results` |

当时担心的签名不匹配（`use-image-handler.ts` 从 `../lib` 引的三个函数）没有问题，typecheck 干净。

---

## 五、已完成：存储说明文案

**2026-08-26 更新**：本节原写「未开始」，**已过期**。落点也和当时的计划不同。

核实落点：
```bash
ls web/src/features/playground/components/input/storage-note.tsx
grep -rn "StorageNote" web/src/features/playground/components/input/playground-input-controls.tsx
```

实际落在 **`components/input/storage-note.tsx`**，由 `playground-input-controls.tsx:255` 渲染 —— 是底部输入区，不是原计划的 `model-guide-panel.tsx` 空态。下面「选这里的理由」那段因此是**过期的决策记录**，保留是为了说明当初为什么排除底部区；最终选择相反，以代码为准。

原计划的理由（已不适用）：空态只在新模型或第一条消息前出现，不长期占地方，而且正好是浏览器开始记录新对话的时刻。不选底部输入区（已经很挤，再加一行灰字很碎），不选清空确认弹窗（出现得太晚，那时用户已经攒了一堆对话）。

**文案三句，按重要性递减**：
1. 对话只保存在这个浏览器里，服务端不保存。
2. 换浏览器、换设备、清理浏览器数据都会丢。
3. 请求本身照常计费，用量日志里能看到调用记录。

**第三句不能省**。前两句单独看容易被理解成「用了不留痕」，但 relay 链路照常扣额度、照常写消费日志。只说前半段，用户在日志里看到记录会觉得被误导。「不存对话内容 ≠ 不记调用」这个区别必须写出来。

形式：灰字小号 + 数据库带斜线的图标，放在模型说明下面。不用卡片、不用警告色 —— 这是事实交代，不是需要用户做决定的警告。

做完补 7 个语言包，然后 `bun run i18n:sync` 确认 missing 全 0。

---

## 五点五、已完成：未配价模型不再进模型库（2026-08-26）

**验证方式**：`bun run typecheck`(0)、playground 20 文件 138 用例全过、`bun run build`(0)、`bun run i18n:sync`(7 语种 missing 全 0)。live `/api/pricing` 实测 640 条里 293 条带 `price_unset: true`。

**动机**：模型库列出 640 个模型，其中 293 个没配价。relay 在调用上游之前就拒绝它们（`relay/helper/price.go`），所以它们在这个页面里没有任何可用状态 —— 点进去、打字、报错，纯粹是陷阱。加徽章只会让列表更长而不是更清楚，所以直接不列。

**后端**（`model/pricing.go`）：`/api/pricing` 每条多返回一个 `price_unset bool`。

为什么必须加这个字段：原先前端无法区分「没配价」和「配了 37.5 倍率」—— 自用模式下 37.5 是合法值，靠数字猜会把能用的模型也隐藏掉。判断只能由后端做。

**前端**（`lib/catalog/model-catalog.ts`）：`entry.price_unset` 为真则 `return []`。

这个过滤刻意做得很窄：只有**出现在 `/api/pricing` 里且标了未配价**的才隐藏。目录里查不到的模型保留裸名条目 —— 否则 `/api/pricing` 请求失败会清空整个模型库。测试在 `lib/__tests__/price-unset.test.ts`。

**注意**：`/api/user/models` 仍然返回它们，API 照常按原规则服务。这个改动只决定选择器提供什么。

---

## 五点六、已完成：错误文案按错误码分类（2026-08-26）

**验证方式**：同上，测试在 `lib/__tests__/error-explanations.test.ts`（5 个用例）。

**动机**：所有错误都长成「请求发生错误: <上游英文原文> (request id: ...)」。前半句是废话（用户看红字已经知道出错了），后半句是给开发看的。用户看不出该做什么。

**做法**（`lib/message/message-error-utils.ts`）：`ERROR_EXPLANATIONS` 表，键是 `relaykit/types/error.go` 里的错误码，值是中文标题 + 说明 + 可选的管理员版说明。目前 7 个码：

`model_price_error`、`model_not_found`、`insufficient_user_quota`、`channel:no_available_key`、`channel:invalid_key`、`sensitive_words_detected`、`prompt_blocked`

**三条设计约束，改的时候别破坏**：

1. **没进表的码保持原样**。`explanation` 为 `undefined` 时 `MessageError` 走原来的分支。加错误码不会因为漏配而变成空框。
2. **上游原文降级成小字保留，不删**。缺价那条是整句丢掉的（它只会重复标题已经说过的话），但其余的带模型名和 request id，管理员查日志要用。
3. **管理员与普通用户文案分开**。`adminBody` 缺省时回退到 `body`。让没权限的人去「检查渠道配置」是噪音。

**toast 抑制条件跟着改了**（`hooks/use-chat-handler.ts`）：从「只有缺价不弹」变成 `!hasErrorExplanation(errorCode)` —— 消息里已经有标题、说明和原文，角落里再闪一遍同样的字没有意义。未进表的码保留 toast。

---

## 五点七、已完成：`routed` 字段与视频/音频模型过滤（2026-08-26）

**验证方式**：同上，测试在 `lib/__tests__/price-unset.test.ts` 的 `unrouted modalities` 一组（4 个用例）。

**动机**：视频和音频模型点了必然 404 —— `/pg` 组只注册了 `chat/completions` 和 `images/generations` 两条路由（`router/relay-router.go:62-73`），`registry.ts` 里声明的 `/pg/video/generations`、`/pg/audio/speech` 在后端不存在。

**为什么不能用 `available` 过滤**：image 也是 `available: false`，但它的路由**是真实存在的**，只是浏览器侧没验证过（见第四节）。按 `available` 过滤会把图片模型一起隐藏。两件事必须分开表达，所以加了 `PlaygroundCapability.routed`：

| 字段 | 含义 | 为假时的后果 |
|---|---|---|
| `routed` | 后端有没有这条路由 | 模型不进目录，完全看不到 |
| `available` | 客户端链路验证过没有 | 模型照常显示，带「即将推出」徽章 |

现状：chat `routed: true` `available: true`；image `routed: true` `available: false`；video / audio `routed: false`。

**`MODALITY_TABS`（`lib/model-library/filters.ts`）删掉了视频和音频两个 tab** —— 模型已被过滤，tab 只会显示空列表。接链路时和 `routed` 一起改回来。

~~**这个过滤对当前部署没有实际效果**：347 个已配价模型里 chat 344、image 3，视频音频本来就是 0。~~

**2026-08-28 订正：现在它过滤掉 25 个模型。** 换了渠道后上游有了真实的视频模型，
`routed: false` 从防御性变成实际生效。但注意它**只在模态推导正确时才有用** ——
这批模型起初全被判成 chat，过滤器完全没碰到它们。修法见第十二节。

**`MODALITY_LABELS` 里的 video/audio 保留**，那是 `Record<PlaygroundModality, string>`，类型要求全模态齐全，且卡片徽章仍会用到。`src/i18n/static-keys.ts` 里的 `'Video'` 也保留 —— 那是定价页筛选器在用，不是游乐场的 tab。

---

## 六、待办：一个不该靠文案糊过去的缺陷

`localStorage` 按域名存、**不认账号**。同一台浏览器 A 退出、B 登录，B 会看到 A 留下的对话。

游乐场是自己试模型的草稿纸，多数情况无所谓；但公用机器上不合适。**建议改代码而不是写进说明** —— 把实现缺陷写成用户的注意义务是转嫁责任。两个方向：键名带用户 id，或登出时清掉。用户尚未拍板要不要做。

核实仍未做（2026-08-26 查过，`storage.ts` 里没有任何 userId 相关代码）：
```bash
grep -rn "userId\|user_id" web/src/features/playground/lib/storage/storage.ts   # 应为空
```

---

## 七、剩余模态

顺序不变：**图片 → 音频 → 视频**。视频放最后，因为它走异步任务链路（`RelayTask` + 轮询 task_id），要多做一层轮询；在对话框里表现为一条「生成中…」的助手消息，出结果后原地换成播放器，和现在流式转圈是同一套状态机。

音频、视频在 `lib/capability/registry.ts` 里现在是 `routed: false` + `available: false`，模型已被过滤出模型库，`MODALITY_TABS` 里也没有对应 tab（见第五点七节）。

**接链路时要改三处，缺一处就是白做**：
1. `router/relay-router.go` 的 `/pg` 组加路由
2. `registry.ts` 里该模态改 `routed: true`，验证后再改 `available: true`
3. `lib/model-library/filters.ts` 的 `MODALITY_TABS` 加回 tab

只改 1 和 2 的话模型能用但 tab 里找不到；只改 3 的话 tab 是空的。

**结果都在对话框里收**，不做单独画廊/列表。理由：这个页面要判断「模型能不能出东西」，而判断需要提示词和结果挨在一起。`canvas` 字段（`gallery`/`video-list`/`audio-list`）目前**没有任何组件读它**，留着做以后的接口，别当成待做的四个画布。

---

## 九、已完成（2026-08-28）：渠道 #1 的模型列表是假的

> **已解决。** 管理员在渠道页拉了真实列表，渠道 `models` 从 640 条缩到 74 条，
> `abilities` enabled 的 distinct 模型同为 74（222 行 = 74 × 3 个分组）。
> 下面点名的五个必失败模型全部不在渠道 `models` 里了。
>
> **连带后果**：`/api/pricing` 现在返回 74 条且 `price_unset` 全为 0 ——
> 原先 293 个未配价模型一起消失，五点五节那个过滤器现在没有可过滤的东西
> （它仍然正确，只是当前数据下不起作用，别因此以为它坏了或没必要）。
>
> **核对时注意 1 分钟缓存**：`GetPricing()`（`model/pricing.go:79`）缓存 60 秒。
> 拉完列表立刻打 `/api/pricing` 会看到旧的 640/293，等一轮再打才是真值。
> 2026-08-28 那次会话我就是先看到 640 才误判成「没生效」。

以下为原始记录，保留是为了说明当初怎么定位到上游的。

**这件事挡着第四节和第七节，而且改代码解决不了。**

现象：模型库里点某些模型（BLOOMZ-7B、chatglm_std、ERNIE-Lite-8K-0922、SparkDesk-v2.1、claude-3-haiku-20240307 等）发消息，报「没有渠道可以提供该模型」。

**本地数据是干净的**，别去查 —— 2026-08-26 逐项验证过：640 个模型全都有 enabled 的 ability 行、priority 对得上 `MAX(priority)` 子查询、都在渠道 `models` 字段里、渠道 `status=1`。SQL 层面「必然失败的模型数」是 **0**。

**错误来自上游，不是本地**。渠道 #1 是 `type=60`（`ChannelTypeNewAPI`），`base_url = https://tokease.cn` —— 上游本身也是一个 new-api 实例。日志里那行 `channel error (channel #1, status code: 503)` 说明渠道选到了并且请求发出去了，「No available channel」是**上游返回的响应体**。对比 request id 能确认：日志前缀的 id 和错误文字里的 id 不是同一个，后者来自上游。

**修法是数据层的**：渠道页 → 编辑渠道 #1 → 获取模型列表，从上游拉真实列表覆盖那 640 个。拉完游乐场和 API 就一致了。

**为什么必须是人来做**：它会改写渠道配置，且需要用渠道的 key 去请求上游。（写这份文档的那次会话里，助手试图把渠道 key 读到临时文件用于诊断，被权限层正确拦截。别再走这条路 —— 拉列表功能在 UI 里，不需要导出 key。）

做完这一步再回到第四节验证图片链路，那时才能找到一个上游确实存在的图片模型。

---

## 十、悬而未决：一处对不上的响应时间

某条早先失败的消息，页面刷新后「响应时间」显示 7174.39 秒，而它出错时显示的是 306 毫秒。7174 秒 ≈ 1 小时 59 分，正好是消息时间戳到刷新那一刻的间隔，所以像是 `completedAt` 被重算成了 `Date.now()` 而 `startedAt` 还是旧的。

**排除了三条路径**（都不是原因，别重复查）：
- 重试走 `createRegeneratedMessages` → `createLoadingAssistantMessage()`，`startedAt` 是新的
- 存储恢复路径 `storage.ts:292` 把 `completedAt` 兜到 `startedAt`，只会得出 0，且只作用于 LOADING/STREAMING 状态
- `MessageMetadata` 直接读存好的 `durationMs`，不重算

**没有复现，没有结论。** 如果你能稳定重现（刷新后看某条旧错误消息的响应时间），从 `completeAssistantTiming` 的调用点入手。它定义在 `lib/message/message-timing-utils.ts:22`，非测试调用点 6 处：

```bash
grep -rn "completeAssistantTiming(" web/src/features/playground/ --include=*.ts | grep -v __tests__
```

- `message-streaming-utils.ts` 152 / 191 / 237 / 242 —— 流式收尾，**这四处上面没查过**
- `message-update-utils.ts:39` —— 错误收尾，已排除
- `storage.ts:299` —— 恢复收尾，已排除

优先看 `message-streaming-utils.ts` 那四处。

---

## 十一、图片模态识别与厂商映射（2026-08-28）

**验证方式**：`go build ./...`(0)、`go vet ./common/ ./model/`(净)、`go test ./common/ ./model/`(全过)、
`bun run typecheck`(0)、playground 20 文件 138 用例全过、重启后 `/api/pricing` 实测 5 个
`image-generation`、模型库 image tab 5 个 / chat tab 69 个。

### 根因：聚合渠道对所有模型广播同一组端点

渠道 #1 是 `type=60`（`ChannelTypeNewAPI`），`common/endpoint_type.go:33` 对该类型返回
一组固定的 chat 端点，**不含 `image-generation`，也与具体模型无关**。补图片端点只靠
第 55 行的 `IsImageGenerationModel`，而它的匹配表原先只有 6 项，新列表一个都不匹配。
结果 74 个模型全部被判成 chat，图片 tab 是空的，第四节的链路代码没有模型能走到。

**这就是原文档记的 `gpt-image-2` 那条数据缺口**，换了渠道后从 1 个模型放大到全部。

### 改法：`common/model.go` 的 `ImageGenerationModels` 加 3 项

`qwen-image`、`z-image`、`wan2.7-image`。

**模式是从上游权威数据挑的，不是猜的**：`https://tokease.cn/api/pricing` 是公开接口
（上游本身也是 new-api），它的 `supported_endpoint_types` 明确标了哪些模型是
`image-generation`——只有 5 个。在上游全部 114 个模型上验证：5/5 命中、0 漏、0 误伤。

**试过并排除的两个更宽写法**（别改成这样）：

- 单个 `-image` 会误伤 `Kling-3.0-image`，那是 `tencentcloud-vod-image`，任务式接口，
  不是 `/v1/images/generations`
- `prefix:wan` 当前干净，但阿里 Wan 家族有视频型号，将来出 `wan2.8-t2v` 就误判

所以钉精确名。将来上新版本就再加一行，和表里 `dall-e-2`/`dall-e-3` 分两行是同一做法。

测试在 `common/model_test.go`：边界表测（含 `Kling-3.0-image`、`wan2.7-t2v` 必须为 false），
以及聚合渠道下 `image-generation` 必须排在端点列表**首位**（第一个端点是 relay 优先目标）。

### 厂商映射：`model/pricing_default.go` 的 `defaultVendorRules` 加 5 条

`qwq`、`z-image`、`wan2`、`seedance`、`fun-asr`。无厂商模型从 26 个降到 10 个。

`qwq` 单独一条是因为 `qwen` 匹配不到 `QwQ-32B`。`z-image-turbo` 是通义实验室的开源
图像模型（用户确认），官方元数据库查不到它。

**这张表有个不写出来就会踩的约束**：`initDefaultVendorMapping` 首个匹配即 break，
而它 range 的是 map —— **一个模型名同时命中两条规则，结果取决于 Go 的随机 map 遍历顺序**，
同一部署重启后厂商会变。`model/pricing_default_test.go` 的
`TestDefaultVendorRulesAreUnambiguous` 用模式对模式的包含检查守住这点（覆盖所有
可能的模型名，不只是样例）。加规则前先跑它。

### 陷阱：往 `models` 表插行会关掉厂商自动兜底

`initDefaultVendorMapping`（`model/pricing_default.go:75`）**遇到已有元数据就 `continue`**。
所以补元数据时不显式写 `vendor_id`，会把模型现有的厂商图标弄丢。当前 74 个里
48 个的 vendor 是靠这个兜底来的，不是表里存的。

### 为什么没走 `models` 表补 `endpoints` 这条路

原计划是纯数据改动、不动代码。实际查下来这条路更差：

官方元数据库（`https://basellm.github.io/llm-metadata`，即 `POST /api/models/sync_upstream`
的数据源，`controller/model_sync.go:40`）只覆盖 74 个里的 33 个，而且**它的 `endpoints`
字段全是 `null`** —— 补不了模态，只能补描述和图标。也就是说数据侧方案照样要手写 5 行，
还解决不了同一个根因。`ImageGenerationModels` 这张表存在的目的正是这件事。

（另外直接写 live 库被权限层拦了，拦得对。要补元数据请走管理端「模型管理」页，
`endpoints` 字段在 `model-mutate-drawer.tsx:956` 可编辑，走 API 还会顺带
`RefreshPricing()`。）

### 剩下的数据缺口（改代码解决不了）

1. **73 / 74 个模型 `description` 为空** —— 左栏卡片塌成两行。要补 `models` 表
2. **10 个模型仍无厂商** —— 图标回退成首字母。这几个我查不到出处，没猜：
   `happyhorse-1.0/1.1-*`（7 个，端点 `ali-video`）、`mimo-v2.5`/`mimo-v2.5-pro`（疑似小米，
   但 `vendors` 表里没有该厂商）、`hy3`（疑似腾讯混元 3，但 `hy` 太短，加规则有碰撞风险）

---

## 十二、已完成（2026-08-28）：29 个视频/音频模型不再被判成 chat

**验证方式**：`go build ./...`(0)、`cd relaykit && GOWORK=off go build ./...`(0)、
`go vet ./common/ ./constant/ ./model/`(净)、`go test ./common/ ./model/`(全过)、
`bun run typecheck`(0)、playground 20 文件 139 用例全过。重启后 `/api/pricing` 实测端点分布：
40 chat / 25 `openai-video` / 5 `image-generation` / 4 `audio-transcription`，
模型库进库 45（chat 40 + image 5）、排除 29（video 25 + ASR 4），合计 74。

### 改法：非 chat 模型**替换**而非追加端点

`common/endpoint_type.go` 的 `GetEndpointTypesByChannelType` 开头加两个早返回：
命中 `TaskVideoModels` 返回 `[openai-video]`，命中 `AudioTranscriptionModels`
返回 `[audio-transcription]`，都**不落到按渠道类型分支**。

**为什么是替换，而图片那次是追加**（这是两处的关键差别，别改成一致）：
图片模型追加 `image-generation` 后仍带着 chat 端点，无害，因为 `deriveModality`
先查 image；但视频/ASR 模型如果保留 chat 端点，前端第 4 步 CHAT 命中就返回
`'chat'`，`NON_INTERACTIVE` 在第 5 步永远轮不到 —— 追加解决不了问题。
更根本的是：声称一个视频模型能应答 `/v1/chat/completions` 本身就是假的。

### 三份名单（`common/model.go`）

- `TaskVideoModels` — `seedance`、`happyhorse`、`kling-3.0`、`kling-o1`、
  `minimax-h3`、`vidu-q`、`qwen-0925`
- `AudioTranscriptionModels` — `fun-asr`、`-asr-`、`prefix:asr-`
- `ImageGenerationModels` — 见第十一节

`Kling-3.0-image`、`Qwen-0925`、`Vidu-q2` 上游是 `tencentcloud-vod-image`，
归在 `TaskVideoModels` 里**不是笔误**：本仓库没有任务式**图片**路由，
`router/video-router.go` 只有视频那套，它们实际经视频任务链路到上游。

三个分类器的匹配顺序（video → ASR → image）意味着同时命中两个就会按顺序静默取第一个。
`TestModalityClassifiersAreMutuallyExclusive` 用这批部署真实的 45 个模型名守住互斥。

### 新增端点类型 `audio-transcription`

`relaykit/types/endpoint_type.go` 加 `EndpointTypeAudioTranscription`，
`constant/endpoint_type.go` 加别名，前端 `derive.ts` 的
`NON_INTERACTIVE_ENDPOINTS` 加它。

**ASR 不等于游乐场的 audio 模态**：`AUDIO_CAPABILITY` 是语音**合成**
（`/pg/audio/speech`、音色选择、语速情感），ASR 是**识别**（音频→文字），
方向相反、没有共同界面。所以它归 `null`（完全不进库）而不是 `'audio'`。
`derive.ts` 里那条「后端没有音频端点类型」的注释已订正 —— 合成仍然没有，识别有了。

**没往 `common/endpoint_defaults.go` 加条目**：那张表按设计只收单一
Path/Method 能描述的端点，任务式（video/mj/suno）故意不在其中；
`GetDefaultEndpointInfo` 的调用点都有 `ok` 保护，`openai-video` 一直缺条目也没出问题。

### 原始分析（保留）

**2026-08-28 发现。** 修完图片模态后剩下的同类问题，但修法不同，所以单列。

74 个模型里 **29 个**上游端点既不是 chat 也不是 image，却全部落在 chat tab：

| 上游端点 | 数量 | 模型 |
|---|---|---|
| `seedance-video` | 8 | `Seedance 2.0`、`seedance2.0/2.5-*` |
| `ali-video` | 7 | `happyhorse-1.0/1.1-*` |
| `tencentcloud-vod-video` | 3 | `Kling-3.0`、`Kling-3.0-Omni`、`Kling-O1` |
| `videogenerator` | 3 | `seedance2.0-*-kuanshen` |
| `tencentcloud-vod-image` | 3 | `Kling-3.0-image`、`Qwen-0925`、`Vidu-q2` |
| `ali-asr-sync` / `ali-asr-async` | 4 | `fun-asr*`、`qwen-audio-3.0-asr-flash*` |
| `minimax-h3-video` | 1 | `MiniMax-H3` |

**为什么第五点七节的 `routed: false` 过滤没拦住**：那个过滤按**模态**工作，而这些模型
压根没被判成 video/audio —— 它们被判成了 chat。过滤器只在模态推导正确时才有用。

**这些是真陷阱**：点进去、打字、报错，正是五点五节隐藏未配价模型时要消除的那种体验。
（我没法自己点验证，需要登录态；上述判断依据是上游端点类型与
`relay/constant/relay_mode.go` 里 `/pg` 只有两条路由这两个事实。）

**修法与图片那次不同，别照抄**：图片能靠 `ImageGenerationModels` 补端点是因为
`/pg/images/generations` 真实存在。视频/音频路由**不存在**，所以补端点只会把它们从
「chat tab 里的陷阱」变成「video tab 里的陷阱」。这批模型应该**直接不进模型库**，
和未配价模型一样。

两个方向，都要先拍板：

1. **后端加识别 + 前端过滤**：仿 `ImageGenerationModels` 加视频/音频名单，让
   `deriveModality` 能判对，再靠既有的 `routed: false` 自动过滤掉。改动小，但要维护
   第二张名单
2. **接链路**（第七节）：真做视频/音频，那时它们该显示。工作量大得多

选 1 是止血，选 2 是根治，两者不冲突（1 做完 2 照样能做）。

---

## 十三、验证命令

```bash
cd web
bun run typecheck   # 期望 0
bun run test        # 全仓库；playground 部分期望 20 文件 138 用例
bun run build       # 期望 0
bun run lint        # 见下面的基线说明
bun run i18n:sync   # 看 _reports/_sync-report.json，missing 应全 0
bun run format      # 改完代码跑一次，之后要重跑 typecheck + test
```

只跑 playground 一部分（快得多，全套 setup 很慢）：
```bash
bunx vitest run --config vitest.config.ts src/features/playground/
```

**测试配置有三个，用错会「没有找到测试文件」**：`vitest.config.ts` 覆盖 `src/**`（要它）、`vitest.node.config.ts` 只覆盖 `lib/capability/**`、`vitest.verify.config.ts`。文档里出现过的 `vitest.pricing.config.ts` **不存在**。

**lint 基线是 359 个 error，全是既有的。** 别试图清零，也别把它当成自己改坏了。判断方式是 `git stash` 前后各跑一次比数字：
```bash
bun run lint 2>&1 | grep -c "error"
```
或者只看自己动过的文件有没有出现在输出里。

后端：`export PATH="$PATH:/c/Program Files/Go/bin"` 然后 `go build ./...`。改了 Go 代码**必须重编并重启**才生效 —— 2026-08-26 那次会话里，后端 `price_unset` 字段加完但跑的还是三天前编的二进制，于是前端过滤看着像没生效，白查了一轮。判断方式：
```bash
find . -name '*.go' -newer bin/new-api.exe -not -path './web/*' | head
```
有输出就说明该重编。完整流程见 `docs/dev-startup.md`。

本机环境注意：无 Docker、无 sqlite3；有常驻 node 进程（openclaw / cc-connect），别误杀；GitHub 走 7897 代理。启动流程见 `docs/dev-startup.md`。
