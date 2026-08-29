package controller

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

// Playground relays a playground request under a temporary in-memory token.
//
// `relayFormat` is what the route is for: `/pg/chat/completions` passes
// `RelayFormatOpenAI`, `/pg/images/generations` passes
// `RelayFormatOpenAIImage`. It cannot be inferred here — `GenRelayInfo` derives
// the relay *mode* from the request path (`Path2RelayMode`, which special-cases
// each `/pg` path) but the *format* selects the request DTO and adaptor entry
// point, and those are not interchangeable between chat and images.
func Playground(c *gin.Context, relayFormat types.RelayFormat) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(),
			})
		}
	}()

	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		newAPIError = types.NewError(errors.New("暂不支持使用 access token"), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, relayFormat, nil, nil)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")

	// Write user context to ensure acceptUnsetRatio is available
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	Relay(c, relayFormat)
}

// PlaygroundTask relays a playground *task* submission under a temporary
// in-memory token.
//
// Separate from Playground because tasks are a different relay shape, not a
// different format: RelayTask resolves an origin task, retries per channel and
// persists a model.Task row, and it derives its own RelayInfo with
// RelayFormatTask. Passing that format to Playground would still reach Relay,
// which has no task pipeline.
//
// The submission only returns a task id. The result arrives by polling
// PlaygroundTaskFetch, so nothing here waits for the video.
func PlaygroundTask(c *gin.Context) {
	if err := setupPlaygroundToken(c, types.RelayFormatTask); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"message": err.Error(), "type": "new_api_error"},
		})
		return
	}

	RelayTask(c)
}

// PlaygroundTaskFetch reads back one of the caller's own tasks.
//
// No channel is selected and no token is needed: the fetch is answered from the
// task row, and ownership is enforced by the user id that UserAuth already put
// on the context (`model.GetByTaskId(userId, taskId)`).
func PlaygroundTaskFetch(c *gin.Context) {
	RelayTaskFetch(c)
}

// setupPlaygroundToken mints the temporary token the relay pipeline bills
// against, mirroring Playground's own setup.
func setupPlaygroundToken(c *gin.Context, relayFormat types.RelayFormat) error {
	if c.GetBool("use_access_token") {
		return errors.New("暂不支持使用 access token")
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, relayFormat, nil, nil)
	if err != nil {
		return err
	}

	userId := c.GetInt("id")
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		return err
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	return nil
}
