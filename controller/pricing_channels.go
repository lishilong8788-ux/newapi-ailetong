package controller

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// GetModelChannelPricing serves the per-channel price tiers for one model.
//
// This is the PUBLIC, sell-side counterpart to /api/cost/* — which is admin-only
// and carries purchase prices and margin. Nothing from the cost side may appear
// here: the pricing page is reachable by unauthenticated visitors, so publishing
// a cost would publish our floor. What ships is the discount, the resulting
// ratios, a coarse supplier category, a line label and the channel's last test
// latency.
//
// The channel NAME is admin-only. Operators name channels after suppliers
// ("袁总平台"), and a visitor comparing lines has no need for it; the line code
// from the model_mapping suffix is the label the reference implementations show.
func GetModelChannelPricing(c *gin.Context) {
	modelName := strings.TrimSpace(c.Query("model"))
	if modelName == "" {
		// 400, not a 200 with success:false: an unknown model legitimately
		// answers with an empty list, but a caller that omitted the parameter
		// asked a malformed question and should be told so by status code.
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "model is required",
		})
		return
	}

	// Same group resolution as GetPricing, so a model's channel list can never
	// include a line the caller could not reach by sending a request.
	var group string
	if userId, exists := c.Get("id"); exists {
		if user, err := model.GetUserCache(userId.(int)); err == nil {
			group = user.Group
		}
	}
	usableGroup := service.GetUserUsableGroups(group)

	routes := service.GetModelChannelRoutes(modelName, usableGroup)
	if !isAdminRequest(c) {
		for _, route := range routes {
			route.Name = ""
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"data":       routes,
		"auto_route": service.GetModelAutoRouteInfo(routes),
	})
}

func isAdminRequest(c *gin.Context) bool {
	return c.GetInt("role") >= common.RoleAdminUser
}
