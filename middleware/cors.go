package middleware

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func CORS() gin.HandlerFunc {
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowCredentials = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"*"}
	// Custom response headers a browser client is allowed to read. Same-origin
	// deployments (go:embed dist, and the dev rsbuild proxy) can read them without
	// this, but a cross-origin dashboard cannot, and the failure mode is a silently
	// missing value rather than an error.
	config.ExposeHeaders = []string{
		"X-New-Api-Version",
		"X-New-Api-Other-Ratios",
		HeaderChannelId,
		HeaderChannelCode,
		HeaderChannelPinned,
	}
	return cors.New(config)
}

func Version() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-New-Api-Version", common.Version)
		c.Next()
	}
}
