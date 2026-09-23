package helper

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
)

// ResolveMappedModelName 走完 model_mapping 的重定向链，返回真正发给上游的模型名。
//
// 导出是因为计费也要这个答案，而且必须与中继拿到的是同一个：渠道进价按上游模型名
// 索引，两边各算一次就会在链式映射上分叉，成本悄悄挂到另一个模型上。计费侧
// （ModelPriceHelper）跑在选渠道之后、ModelMappedHelper 之前，那时 ChannelMeta
// 还没装配，读不到 info.UpstreamModelName，只能自己用同一个函数从 context 里的
// 映射 JSON 推一遍。
//
// mapped=false 表示链尾就是入参本身（含自映射），调用方不该翻 IsModelMapped。
func ResolveMappedModelName(modelMapping string, clientModel string) (string, bool, error) {
	if modelMapping == "" || modelMapping == "{}" {
		return clientModel, false, nil
	}
	modelMap := make(map[string]string)
	if err := json.Unmarshal([]byte(modelMapping), &modelMap); err != nil {
		return clientModel, false, fmt.Errorf("unmarshal_model_mapping_failed")
	}

	// 支持链式模型重定向，最终使用链尾的模型
	currentModel := clientModel
	visitedModels := map[string]bool{currentModel: true}
	mapped := false
	for {
		mappedModel, exists := modelMap[currentModel]
		if !exists || mappedModel == "" {
			break
		}
		// 模型重定向循环检测，避免无限循环
		if visitedModels[mappedModel] {
			if mappedModel == currentModel {
				// 自映射是链尾，不是环。停在原地的那次不算映射过。
				return currentModel, currentModel != clientModel, nil
			}
			return clientModel, false, errors.New("model_mapping_contains_cycle")
		}
		visitedModels[mappedModel] = true
		currentModel = mappedModel
		mapped = true
	}
	return currentModel, mapped, nil
}

func ModelMappedHelper(c *gin.Context, info *common.RelayInfo, request dto.Request) error {
	if info.ChannelMeta == nil {
		info.ChannelMeta = &common.ChannelMeta{}
	}

	// map model name
	upstreamModel, mapped, err := ResolveMappedModelName(c.GetString("model_mapping"), info.OriginModelName)
	if err != nil {
		return err
	}
	if mapped {
		info.IsModelMapped = true
		info.UpstreamModelName = upstreamModel
	}

	if request != nil {
		request.SetModelName(info.UpstreamModelName)
	}
	return nil
}
