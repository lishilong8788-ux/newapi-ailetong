package middleware

import (
	"net/http"

	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
)

// cacheVersion is echoed on every response so an operator can tell which build
// answered without reading the body.
const cacheVersion = "b688f2fb5be447c25e5aa3bd063087a83db32a288bf6a4f35f2d8db310e40b14"

// Cache sets the long-lived cache header for hashed frontend assets, and only
// for those.
//
// The header used to be applied to every path except "/", which meant it also
// landed on responses gin produces when no route matched. A 404 for an /api
// path that did not exist yet - a route added in a later build, a typo, a
// probe - was therefore cacheable for a week, and the browser kept serving it
// from disk after the route started working. No request reached the server, so
// the failure was invisible in the access log.
//
// The predicate here is the same one static.Serve uses to decide whether it
// will serve the request from the embedded build, so the long cache now covers
// exactly the responses that carry a content hash in their filename. Everything
// else - the SPA fallback, the promo redirect, rate-limit rejections, not-found
// errors - is left uncacheable. Handlers that want a different policy (the SPA
// index asks for revalidation rather than no-store) override the header
// downstream.
func Cache(assets static.ServeFileSystem) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Version", cacheVersion)
		if isImmutableAsset(c.Request, assets) {
			c.Header("Cache-Control", "max-age=604800") // one week
		} else {
			c.Header("Cache-Control", "no-store")
		}
		c.Next()
	}
}

// isImmutableAsset reports whether the request will be answered from the
// embedded frontend build. Non-GET/HEAD methods are excluded: a static file
// server never answers them, so a match there could only be a coincidence of
// paths.
func isImmutableAsset(request *http.Request, assets static.ServeFileSystem) bool {
	if assets == nil {
		return false
	}
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		return false
	}
	return assets.Exists("/", request.URL.Path)
}
