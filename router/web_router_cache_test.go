package router

import (
	"embed"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// emptyBuildFS stands in for an embedded frontend build with no files in it, so
// every request falls through to the SPA/not-found handling.
//
//go:embed web_router_cache_test.go
var emptyBuildFS embed.FS

// TestWebRouterDoesNotCacheNotFound pins the contract that broke the agent
// workbench: an /api path with no registered route answered 404 with a
// week-long max-age, so browsers kept replaying the 404 from disk after the
// route shipped and no request reached the server to reveal it.
func TestWebRouterDoesNotCacheNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetWebRouter(engine, WebAssets{
		BuildFS:   emptyBuildFS,
		IndexPage: []byte("<!doctype html><title>index</title>"),
	})

	cases := []struct {
		name         string
		path         string
		wantStatus   int
		wantCacheHdr string
	}{
		{
			name:         "unregistered api route",
			path:         "/api/agent/profile",
			wantStatus:   http.StatusNotFound,
			wantCacheHdr: "no-store",
		},
		{
			name:         "unregistered relay route",
			path:         "/v1/nope",
			wantStatus:   http.StatusNotFound,
			wantCacheHdr: "no-store",
		},
		{
			name:         "missing hashed asset",
			path:         "/assets/index.deadbeef.js",
			wantStatus:   http.StatusNotFound,
			wantCacheHdr: "no-store",
		},
		{
			// The SPA shell stays revalidatable rather than no-store: it is the
			// document every deep link resolves to, and it must pick up a new
			// build without waiting out a cache entry.
			name:         "spa deep link",
			path:         "/agent",
			wantStatus:   http.StatusOK,
			wantCacheHdr: "no-cache",
		},
		{
			name:         "root",
			path:         "/",
			wantStatus:   http.StatusOK,
			wantCacheHdr: "no-cache",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, testCase.path, nil))

			assert.Equal(t, testCase.wantStatus, recorder.Code)
			assert.Equal(t, testCase.wantCacheHdr, recorder.Header().Get("Cache-Control"))
		})
	}
}
