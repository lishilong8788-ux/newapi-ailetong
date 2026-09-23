package middleware

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

const (
	// HeaderChannelId is the request header a playground caller pins a channel
	// with, and the response header naming the channel that actually served the
	// request. Same name in both directions on purpose: the value means the same
	// thing, and a caller can echo back what it asked for.
	HeaderChannelId = "X-New-Api-Channel-Id"
	// HeaderChannelCode is the short line label of the serving channel. Absent
	// when the channel names no line for the model — see model.ChannelLineCode.
	HeaderChannelCode = "X-New-Api-Channel-Code"
	// HeaderChannelPinned is "1" when the serving channel is the one the caller
	// pinned, "0" when the router chose it.
	HeaderChannelPinned = "X-New-Api-Channel-Pinned"
)

// trafficSourcePlayground is the ContextKeyTrafficSource value the /pg routes
// set. Channel echo headers are scoped to it: the API surface must not start
// advertising internal channel ids to every relay client.
const trafficSourcePlayground = "playground"

// PlaygroundChannelPin lets an admin pin a playground relay to one channel via
// the X-New-Api-Channel-Id request header.
//
// It must run after UserAuth (it reads the authenticated role) and before
// Distribute (which consumes ContextKeyTokenSpecificChannelId). Without the
// header it does nothing at all — automatic routing is the default path and pays
// no cost here.
//
// Admin-only, matching the API-key pin in SetupContextForToken: a pinned channel
// bypasses group selection, the token model limit and retry, so it is an
// operator tool for diagnosing one line, not a user-facing routing knob.
func PlaygroundChannelPin() func(c *gin.Context) {
	return func(c *gin.Context) {
		raw := c.GetHeader(HeaderChannelId)
		if raw == "" {
			c.Next()
			return
		}

		channelId, err := strconv.Atoi(raw)
		if err != nil || channelId <= 0 {
			abortWithOpenAiMessage(c, http.StatusBadRequest, i18n.T(c, i18n.MsgDistributorInvalidChannelId))
			return
		}

		if c.GetInt("role") < common.RoleAdminUser {
			abortWithOpenAiMessage(c, http.StatusForbidden, i18n.T(c, i18n.MsgDistributorPinNotAdmin), types.ErrorCodeAccessDenied)
			return
		}

		channel, err := model.CacheGetChannel(channelId)
		if err != nil || channel == nil {
			abortWithOpenAiMessage(c, http.StatusBadRequest, i18n.T(c, i18n.MsgDistributorInvalidChannelId))
			return
		}

		// Whether the channel can actually serve the requested model, which the
		// API-key pin path never checks: without this the request reaches the
		// upstream and comes back as whatever that provider says about an unknown
		// model. The abilities table is the same source the router selects from, so
		// a model missing here is a model the router would not have routed either.
		//
		// Group-agnostic (any of the channel's own groups): a pin already bypasses
		// group selection, so rejecting on the caller's group would refuse pins the
		// distributor is about to honour. Only checked while the channel is enabled
		// — abilities are disabled along with their channel, and reporting a
		// disabled channel as "does not serve this model" would hide the real
		// reason Distribute is about to give.
		if channel.Status == common.ChannelStatusEnabled {
			if modelRequest, modelErr := getModelFromRequest(c); modelErr == nil && modelRequest.Model != "" {
				if !model.IsChannelEnabledForAnyGroupModel(channel.GetGroups(), modelRequest.Model, channelId) {
					abortWithOpenAiMessage(c, http.StatusBadRequest,
						i18n.T(c, i18n.MsgDistributorPinModelMismatch, map[string]any{"Channel": channelId, "Model": modelRequest.Model}),
						types.ErrorCodeModelNotFound)
					return
				}
			}
		}

		// String, not int: Distribute reads this key with a `.(string)` assertion
		// (shared with the API-key pin path), and any other type panics there.
		// Re-formatted from the parsed int so a padded "007" cannot reach it.
		common.SetContextKey(c, constant.ContextKeyTokenSpecificChannelId, strconv.Itoa(channelId))
		c.Next()
	}
}
