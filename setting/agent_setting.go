package setting

// Agent (distributor) programme settings. Defaults keep the feature off so an
// upgrade never starts paying commission without an explicit decision.
var (
	AgentEnabled = false

	// AgentDefaultRate applies to any profile that has no explicit rate.
	AgentDefaultRate = 0.05
	// AgentMaxRate bounds what an operator may configure. Without a server-side
	// ceiling a mistyped rate could make every top-up a net loss.
	AgentMaxRate = 0.30

	// AgentFreezeDays holds new commission before it becomes withdrawable. This
	// is the only barrier against the top-up -> withdraw -> refund arbitrage, so
	// it should cover the payment providers' refund window.
	AgentFreezeDays = 7

	AgentMinWithdrawal     = 100.0
	AgentWithdrawalFeeRate = 0.0

	AgentAutoApprove      = false
	AgentBalanceNeedAudit = false

	// AgentSubscriptionCommission decides whether subscription orders earn
	// commission alongside wallet top-ups.
	AgentSubscriptionCommission = false
)

// EffectiveCommissionRate resolves a profile's rate against the global default
// and clamps the result into the configured range. A nil rate means the profile
// never set one and should follow the default; an explicit zero is honoured.
func EffectiveCommissionRate(profileRate *float64) float64 {
	rate := AgentDefaultRate
	if profileRate != nil {
		rate = *profileRate
	}
	if rate < 0 {
		return 0
	}
	if rate > AgentMaxRate {
		return AgentMaxRate
	}
	return rate
}

// IsCommissionRateValid reports whether a rate is acceptable for storage.
func IsCommissionRateValid(rate float64) bool {
	return rate >= 0 && rate <= AgentMaxRate
}
