package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// stubAssetFS answers Exists from a fixed set of paths, standing in for the
// embedded frontend build.
type stubAssetFS struct {
	present map[string]bool
}

func (s stubAssetFS) Exists(prefix string, path string) bool { return s.present[path] }

func (s stubAssetFS) Open(name string) (http.File, error) { return nil, http.ErrMissingFile }

func TestCacheOnlyMarksServedAssetsCacheable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	assets := stubAssetFS{present: map[string]bool{
		"/static/js/index.a1b2c3.js": true,
	}}

	cases := []struct {
		name         string
		method       string
		path         string
		wantCacheHdr string
	}{
		{
			name:         "hashed asset gets the long cache",
			method:       http.MethodGet,
			path:         "/static/js/index.a1b2c3.js",
			wantCacheHdr: "max-age=604800",
		},
		{
			name:         "HEAD of an asset gets the long cache",
			method:       http.MethodHead,
			path:         "/static/js/index.a1b2c3.js",
			wantCacheHdr: "max-age=604800",
		},
		{
			// The regression: an /api path with no route must not be cacheable,
			// or the browser keeps serving the 404 after the route ships.
			name:         "unknown api path is uncacheable",
			method:       http.MethodGet,
			path:         "/api/agent/profile",
			wantCacheHdr: "no-store",
		},
		{
			name:         "spa path is uncacheable before the handler decides",
			method:       http.MethodGet,
			path:         "/agent",
			wantCacheHdr: "no-store",
		},
		{
			name:         "post to an asset path is uncacheable",
			method:       http.MethodPost,
			path:         "/static/js/index.a1b2c3.js",
			wantCacheHdr: "no-store",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			engine := gin.New()
			engine.Use(Cache(assets))
			engine.NoRoute(func(c *gin.Context) { c.Status(http.StatusOK) })

			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(testCase.method, testCase.path, nil))

			assert.Equal(t, testCase.wantCacheHdr, recorder.Header().Get("Cache-Control"))
			assert.Equal(t, cacheVersion, recorder.Header().Get("Cache-Version"))
		})
	}
}

func TestCacheWithoutAssetsIsUncacheable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(Cache(nil))
	engine.GET("/anything", func(c *gin.Context) { c.Status(http.StatusOK) })

	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/anything", nil))

	assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
}
