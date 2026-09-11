package authz

// Cost resource permissions. Reuses the shared ActionRead/ActionWrite constants
// declared in resources_channel.go.
const (
	ResourceCost = "cost"
)

var (
	CostRead  = Permission{Resource: ResourceCost, Action: ActionRead}
	CostWrite = Permission{Resource: ResourceCost, Action: ActionWrite}
)

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceCost,
		LabelKey: "Cost & Margin",
		Actions: []ActionDefinition{
			{
				Action:         ActionRead,
				LabelKey:       "View cost & margin reports",
				DescriptionKey: "View channel cost, margin, and inventory reconciliation reports.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionWrite,
				LabelKey:       "Edit cost configuration",
				DescriptionKey: "Edit channel cost prices, batch pricing, purchases, and recalculation.",
				// No DefaultRoles: cost write is root-only by default, mirroring
				// channel sensitive_write.
			},
		},
	})
}
