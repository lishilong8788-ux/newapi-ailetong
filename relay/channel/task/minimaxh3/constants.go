package minimaxh3

// ChannelName 与 ModelList 对外暴露的渠道标识。
const ChannelName = "minimax-h3"

// ModelName 是本渠道唯一支持的模型名（大小写敏感的对外展示形式）。
const ModelName = "MiniMax-H3"

var ModelList = []string{ModelName}

// 上游 V2 接口路径。
const (
	PathVideoGeneration   = "/v2/video_generation"
	PathContextIR         = "/v2/h3_context_ir"
	PathVideoRegeneration = "/v2/video_regeneration"
	PathQueryTask         = "/v2/query/video_generation"
)

// 任务类型。与对外契约的 task_type 字段一字对应。
const (
	TaskTypeGeneration   = "generation"
	TaskTypeContextIR    = "h3_context_ir"
	TaskTypeRegeneration = "regeneration"
)

// 产物形态。
const (
	ModalityVideo = "video"
	ModalityText  = "text"
)

// duration 合法区间。H3 自身的上限远小于框架通用的
// relaycommon.MaxTaskDurationSeconds(3600)，计费钳制必须用这里的值。
const (
	MinDuration = 4
	MaxDuration = 15
)

// 价格常量，单位为人民币元。BasePricePerSec 同时是 768P 的基准秒价，
// 管理员配置的 ModelPrice 应与它一致。
const (
	BasePricePerSec        = 0.50  // 768P 元/秒
	Price2KPerSec          = 0.80  // 2K 元/秒
	RegenPricePerSec       = 0.30  // 再生成 元/秒
	ExtraImageYuan         = 0.20  // generation 超额图 元/张
	RegenExtraImageYuan    = 0.15  // 再生成超额图 元/张
	IRInputYuanPerMillion  = 5.80  // IR 输入 元/百万 token
	IROutputYuanPerMillion = 23.00 // IR 输出 元/百万 token
)

// FreeImageCount 免费图片张数，超出部分按 ExtraImageYuan 计价。
const FreeImageCount = 5

// VideoInputPrechargeSeconds 预扣阶段对单段参考视频的保守估算秒数。
// 终态按上游返回的实际 input_seconds 结算，多退少补。
const VideoInputPrechargeSeconds = 15

// QueryWindowSeconds 任务可见窗口，7 天。超窗按 404 处理。
const QueryWindowSeconds = 7 * 24 * 60 * 60

// 列表接口分页边界。
const (
	DefaultPageSize = 20
	MaxPageSize     = 500
	MaxTaskIDs      = 500
)

// 分辨率取值。
const (
	Resolution768P = "768P"
	Resolution2K   = "2K"
)

// RatioAdaptive 纯文生视频不允许使用的自适应比例。
const RatioAdaptive = "adaptive"

// AllowedRatios 画面比例白名单。
var AllowedRatios = map[string]bool{
	RatioAdaptive: true,
	"21:9":        true,
	"16:9":        true,
	"4:3":         true,
	"1:1":         true,
	"3:4":         true,
	"9:16":        true,
}

// content[].role 取值。
const (
	RoleFirstFrame     = "first_frame"
	RoleLastFrame      = "last_frame"
	RoleReferenceImage = "reference_image"
	RoleReferenceVideo = "reference_video"
	RoleBaseVideo      = "base_video"
	RoleReferenceAudio = "reference_audio"
)

// content[].type 取值。
const (
	ContentTypeText     = "text"
	ContentTypeImageURL = "image_url"
	ContentTypeVideoURL = "video_url"
	ContentTypeAudioURL = "audio_url"
)
