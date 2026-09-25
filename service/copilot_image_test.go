package service

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 各格式的最短合法头字节。内容不是真图片，校验只看头：真图片的其余字节对这几条
// 测试没有信息量，而内嵌一张真 PNG 会让测试文件变成一坨 base64。
var (
	webpBytes = []byte("RIFF\x00\x00\x00\x00WEBPVP8 ")
	pngBytes  = []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00}
	jpegBytes = []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00}
)

func dataURL(mimeType string, content []byte) string {
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(content)
}

// useTempImageRoot 把存储根指到临时目录，避免测试往部署目录里写东西。
func useTempImageRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Setenv(copilotImageStorageEnv, root)
	absolute, err := filepath.Abs(root)
	require.NoError(t, err)
	return absolute
}

func TestSaveCopilotImages_WritesUnderSessionDir(t *testing.T) {
	root := useTempImageRoot(t)

	paths, err := SaveCopilotImages(42, []string{
		dataURL("image/webp", webpBytes),
		dataURL("image/png", pngBytes),
	})
	require.NoError(t, err)
	require.Len(t, paths, 2)

	assert.True(t, strings.HasPrefix(paths[0], "42/"), "图片要按会话分目录，实际 %q", paths[0])
	assert.True(t, strings.HasSuffix(paths[0], ".webp"))
	assert.True(t, strings.HasSuffix(paths[1], ".png"))

	for _, relative := range paths {
		_, statErr := os.Stat(filepath.Join(root, filepath.FromSlash(relative)))
		assert.NoError(t, statErr, "%s 应该真的落盘了", relative)
	}
}

// 声明 PNG 实际是别的东西要被拒。只认 MIME 头等于让客户端自己说自己是什么，
// 而这些字节最终要写进磁盘、再被当成图片发给上游。
func TestSaveCopilotImages_RejectsSignatureMismatch(t *testing.T) {
	useTempImageRoot(t)

	_, err := SaveCopilotImages(1, []string{dataURL("image/png", []byte("<html>not a png"))})
	require.Error(t, err)
	assert.ErrorIs(t, err, errCopilotImageType)
}

func TestSaveCopilotImages_RejectsUnsupportedMime(t *testing.T) {
	useTempImageRoot(t)

	_, err := SaveCopilotImages(1, []string{dataURL("image/svg+xml", []byte("<svg/>"))})
	require.Error(t, err)
	assert.ErrorIs(t, err, errCopilotImageType)
}

// 一张坏的要让整批失败，并且不留下已经写成功的那几张：半数图片进对话会让模型
// 看到一个残缺的问题，而管理员以为它看全了。
func TestSaveCopilotImages_PartialFailureLeavesNothingBehind(t *testing.T) {
	root := useTempImageRoot(t)

	_, err := SaveCopilotImages(7, []string{
		dataURL("image/webp", webpBytes),
		dataURL("image/png", []byte("bogus")),
	})
	require.Error(t, err)

	entries, readErr := os.ReadDir(filepath.Join(root, "7"))
	if readErr == nil {
		assert.Empty(t, entries, "整批失败后不该留下任何文件")
	}
}

func TestSaveCopilotImages_RejectsTooMany(t *testing.T) {
	useTempImageRoot(t)

	many := make([]string, MaxCopilotImages+1)
	for i := range many {
		many[i] = dataURL("image/webp", webpBytes)
	}
	_, err := SaveCopilotImages(1, many)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "最多")
}

func TestSaveCopilotImages_RejectsNonDataURL(t *testing.T) {
	useTempImageRoot(t)

	_, err := SaveCopilotImages(1, []string{"https://example.com/screenshot.png"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "data URL")
}

// 路径来自 URL 参数和库里的一列，按不可信处理：没有这道校验，`../../` 能把这个
// 端点变成任意文件读取。
func TestResolveCopilotImagePath_RejectsEscape(t *testing.T) {
	useTempImageRoot(t)

	for _, escape := range []string{
		"../secrets.env",
		"1/../../../etc/passwd",
		"..",
	} {
		_, err := ResolveCopilotImagePath(escape)
		assert.Error(t, err, "%q 必须被拒", escape)
	}
}

func TestResolveCopilotImagePath_AllowsNormalPath(t *testing.T) {
	root := useTempImageRoot(t)

	absolute, err := ResolveCopilotImagePath("42/abc.webp")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(root, "42", "abc.webp"), absolute)
}

// 落盘再读回要能还原成 data URL：这是喂给上游模型的那一步，MIME 丢了图就废了。
func TestReadCopilotImageDataURL_RoundTrip(t *testing.T) {
	useTempImageRoot(t)

	paths, err := SaveCopilotImages(3, []string{dataURL("image/jpeg", jpegBytes)})
	require.NoError(t, err)
	require.Len(t, paths, 1)

	got, err := ReadCopilotImageDataURL(paths[0])
	require.NoError(t, err)
	assert.Equal(t, dataURL("image/jpeg", jpegBytes), got)
}

func TestReadCopilotImageDataURL_MissingFileErrors(t *testing.T) {
	useTempImageRoot(t)

	_, err := ReadCopilotImageDataURL("9/not-there.webp")
	assert.Error(t, err, "读不到的图要报错，让调用方决定怎么降级")
}

func TestRemoveCopilotSessionImageDir_DropsWholeSession(t *testing.T) {
	root := useTempImageRoot(t)

	_, err := SaveCopilotImages(11, []string{dataURL("image/webp", webpBytes)})
	require.NoError(t, err)

	RemoveCopilotSessionImageDir(11)

	_, statErr := os.Stat(filepath.Join(root, "11"))
	assert.True(t, os.IsNotExist(statErr), "删会话要把它的图片目录一并删掉")
}

func TestCopilotImageMimeType(t *testing.T) {
	assert.Equal(t, "image/webp", CopilotImageMimeType("1/a.webp"))
	assert.Equal(t, "image/png", CopilotImageMimeType("1/a.png"))
	assert.Equal(t, "image/jpeg", CopilotImageMimeType("1/a.jpg"))
	assert.Equal(t, "image/jpeg", CopilotImageMimeType("1/a.jpeg"))
	assert.Empty(t, CopilotImageMimeType("1/a.svg"))
}
