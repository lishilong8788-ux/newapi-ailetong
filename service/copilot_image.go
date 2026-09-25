package service

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"github.com/google/uuid"
)

// 运营副驾的图片输入：管理员贴进来的报表截图落盘，库里只存相对路径。
//
// 为什么落盘而不是 base64 入库：MySQL 的 `type:text` 上限 64 KB，而压缩后的
// 截图 base64 有 130–270 KB，塞进 CopilotMessage 的列里会截断。全库 25 处
// `type:text`、0 处 longtext，不为图片破这个惯例。
//
// 为什么没有独立的上传端点：图片跟着 chat 请求一起来，在写消息行的同一个请求里
// 落盘。独立端点会产生「传了但没发」的孤儿文件，而这个项目没有任何定期清理任务，
// 孤儿只能靠再写一个兜底回收器解决。跟着 chat 走则落盘与消息行同生同死。
const copilotImageStorageEnv = "COPILOT_IMAGE_PATH"

const defaultCopilotImageStoragePath = "./data/copilot-images"

// 与前端 input-attachment-utils.ts 的 MAX_INPUT_IMAGES / MAX_INPUT_IMAGE_BYTES
// 对齐。两边都要有：前端那份是给人看的即时反馈，这份是不能被绕过的那道。
const (
	MaxCopilotImages     = 6
	MaxCopilotImageBytes = 20 << 20
)

// copilotImageKind 是一种接受的图片格式。扩展名和 magic byte 都要校验：
// 只认 MIME 头等于让客户端自己说自己是什么，而这些字节最终要写进磁盘。
type copilotImageKind struct {
	extension  string
	signatures [][]byte
}

// WebP 是前端压缩后的格式（input-attachment-utils.ts 里 COMPRESSED_IMAGE_MIME），
// PNG/JPEG 是压缩失败时的回退，也允许直接贴原图。
var copilotImageKinds = map[string]copilotImageKind{
	"image/webp": {extension: ".webp", signatures: [][]byte{[]byte("RIFF")}},
	"image/png":  {extension: ".png", signatures: [][]byte{{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}}},
	"image/jpeg": {extension: ".jpg", signatures: [][]byte{{0xFF, 0xD8, 0xFF}}},
}

var errCopilotImageType = errors.New("仅支持 WebP / PNG / JPEG 图片")

func copilotImageStorageRoot() (string, error) {
	configured := strings.TrimSpace(common.GetEnvOrDefaultString(copilotImageStorageEnv, defaultCopilotImageStoragePath))
	if configured == "" {
		configured = defaultCopilotImageStoragePath
	}
	absolute, err := filepath.Abs(configured)
	if err != nil {
		return "", fmt.Errorf("invalid %s: %w", copilotImageStorageEnv, err)
	}
	return absolute, nil
}

// decodeCopilotImageDataURL 把 `data:image/webp;base64,...` 解成字节，并确认
// 声明的类型和真实的头字节一致。
func decodeCopilotImageDataURL(dataURL string) (content []byte, kind copilotImageKind, err error) {
	trimmed := strings.TrimSpace(dataURL)
	if !strings.HasPrefix(trimmed, "data:") {
		return nil, copilotImageKind{}, errors.New("图片必须是 data URL")
	}
	comma := strings.IndexByte(trimmed, ',')
	if comma < 0 {
		return nil, copilotImageKind{}, errors.New("图片 data URL 格式不正确")
	}
	header := trimmed[len("data:"):comma]
	if !strings.Contains(header, ";base64") {
		return nil, copilotImageKind{}, errors.New("图片 data URL 必须是 base64 编码")
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.SplitN(header, ";", 2)[0]))
	kind, accepted := copilotImageKinds[mimeType]
	if !accepted {
		return nil, copilotImageKind{}, errCopilotImageType
	}

	// base64 比原字节大 4/3，先按编码后的长度挡掉超大的那些，避免为一张必然被
	// 拒绝的图先分配几十 MB。
	if int64(len(trimmed)-comma-1) > MaxCopilotImageBytes/3*4+4 {
		return nil, copilotImageKind{}, fmt.Errorf("单张图片不能超过 %d MB", MaxCopilotImageBytes>>20)
	}
	content, err = base64.StdEncoding.DecodeString(trimmed[comma+1:])
	if err != nil {
		return nil, copilotImageKind{}, errors.New("图片 base64 解码失败")
	}
	if len(content) == 0 {
		return nil, copilotImageKind{}, errors.New("图片内容为空")
	}
	if int64(len(content)) > MaxCopilotImageBytes {
		return nil, copilotImageKind{}, fmt.Errorf("单张图片不能超过 %d MB", MaxCopilotImageBytes>>20)
	}

	for _, signature := range kind.signatures {
		if bytes.HasPrefix(content, signature) {
			return content, kind, nil
		}
	}
	return nil, copilotImageKind{}, errCopilotImageType
}

// SaveCopilotImages 把一组 data URL 落盘，返回相对路径（正斜杠，可直接入库）。
//
// 任意一张失败就整批失败并清掉已写的：半数图片进了对话会让模型看到一个残缺的
// 问题，而管理员以为它看全了。
func SaveCopilotImages(sessionId int, dataURLs []string) ([]string, error) {
	if len(dataURLs) == 0 {
		return nil, nil
	}
	if len(dataURLs) > MaxCopilotImages {
		return nil, fmt.Errorf("一条消息最多 %d 张图片", MaxCopilotImages)
	}

	root, err := copilotImageStorageRoot()
	if err != nil {
		return nil, err
	}
	relativeDir := strconv.Itoa(sessionId)
	if err := os.MkdirAll(filepath.Join(root, relativeDir), 0o750); err != nil {
		common.SysError("failed to create copilot image directory: " + err.Error())
		return nil, errors.New("副驾图片存储目录不可写，请检查部署配置")
	}

	saved := make([]string, 0, len(dataURLs))
	for _, dataURL := range dataURLs {
		content, kind, decodeErr := decodeCopilotImageDataURL(dataURL)
		if decodeErr != nil {
			RemoveCopilotImageFiles(saved)
			return nil, decodeErr
		}
		relativePath := filepath.ToSlash(filepath.Join(relativeDir, uuid.NewString()+kind.extension))
		absolutePath := filepath.Join(root, filepath.FromSlash(relativePath))
		if err := os.WriteFile(absolutePath, content, 0o640); err != nil {
			common.SysError("failed to write copilot image: " + err.Error())
			RemoveCopilotImageFiles(saved)
			return nil, errors.New("保存图片失败")
		}
		saved = append(saved, relativePath)
	}
	return saved, nil
}

// ResolveCopilotImagePath 把入库的相对路径还原成绝对路径，并确认它没有走出
// 存储根。库里的值是自己写的，但它经手过 JSON 解析和一次落库，按不可信处理。
func ResolveCopilotImagePath(relativePath string) (string, error) {
	root, err := copilotImageStorageRoot()
	if err != nil {
		return "", err
	}
	absolute := filepath.Join(root, filepath.FromSlash(relativePath))
	if absolute != root && !strings.HasPrefix(absolute, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("copilot image path escapes storage root: %s", relativePath)
	}
	return absolute, nil
}

// ReadCopilotImageDataURL 把落盘的图片读回 data URL，喂给上游模型。
//
// 每轮都读盘是有意的取舍：图片留在上下文里（追问「第三行那个为什么亏」时模型还
// 得看见图），而缓存住这些字节等于按会话数量在进程里堆几 MB 的图。读盘的代价
// 远小于同一张图重发给上游的 vision token。
func ReadCopilotImageDataURL(relativePath string) (string, error) {
	absolute, err := ResolveCopilotImagePath(relativePath)
	if err != nil {
		return "", err
	}
	content, err := os.ReadFile(absolute)
	if err != nil {
		return "", err
	}
	mimeType := copilotImageMimeByExtension(filepath.Ext(absolute))
	if mimeType == "" {
		return "", errCopilotImageType
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(content), nil
}

// CopilotImageMimeType 给下发图片的端点用（ServeFile 只在没有 Content-Type 时
// 才自己嗅探，显式设置更可靠）。
func CopilotImageMimeType(relativePath string) string {
	return copilotImageMimeByExtension(filepath.Ext(relativePath))
}

func copilotImageMimeByExtension(extension string) string {
	lowered := strings.ToLower(extension)
	for mimeType, kind := range copilotImageKinds {
		if kind.extension == lowered {
			return mimeType
		}
	}
	// .jpeg 与 .jpg 同类，白名单里只登记了后者。
	if lowered == ".jpeg" {
		return "image/jpeg"
	}
	return ""
}

// RemoveCopilotImageFiles 删除文件。错误只记日志：调用它的地方（落库失败回滚、
// 删会话）都已经把库里的引用处理完了，一个删不掉的文件不该让那些操作失败。
func RemoveCopilotImageFiles(relativePaths []string) {
	for _, relativePath := range relativePaths {
		absolute, err := ResolveCopilotImagePath(relativePath)
		if err != nil {
			common.SysError("failed to resolve copilot image for removal: " + err.Error())
			continue
		}
		if err := os.Remove(absolute); err != nil && !os.IsNotExist(err) {
			common.SysError("failed to remove copilot image file: " + err.Error())
		}
	}
}

// RemoveCopilotSessionImageDir 删掉整个会话的图片目录，删会话时调用。
func RemoveCopilotSessionImageDir(sessionId int) {
	absolute, err := ResolveCopilotImagePath(strconv.Itoa(sessionId))
	if err != nil {
		common.SysError("failed to resolve copilot image dir for removal: " + err.Error())
		return
	}
	if err := os.RemoveAll(absolute); err != nil {
		common.SysError("failed to remove copilot image dir: " + err.Error())
	}
}
