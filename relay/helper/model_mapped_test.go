package helper

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestResolveMappedModelName 锁住重定向链的解析语义。计费按这个函数的结果去查
// 渠道进价，中继按它决定发给上游的模型名——两边必须是同一个答案，所以自映射、
// 环、空映射这几个边界都得钉住。
func TestResolveMappedModelName(t *testing.T) {
	cases := []struct {
		name         string
		mapping      string
		clientModel  string
		wantUpstream string
		wantMapped   bool
		wantErr      bool
	}{
		{
			name:         "no mapping passes the client name through",
			mapping:      "",
			clientModel:  "gpt-5.5",
			wantUpstream: "gpt-5.5",
		},
		{
			name:         "empty object is not a mapping",
			mapping:      "{}",
			clientModel:  "gpt-5.5",
			wantUpstream: "gpt-5.5",
		},
		{
			name:         "single hop",
			mapping:      `{"gpt-5.5":"gpt-5.5-0929"}`,
			clientModel:  "gpt-5.5",
			wantUpstream: "gpt-5.5-0929",
			wantMapped:   true,
		},
		{
			name:         "chained redirect resolves to the tail",
			mapping:      `{"a":"b","b":"c"}`,
			clientModel:  "a",
			wantUpstream: "c",
			wantMapped:   true,
		},
		{
			name:         "unmapped model is untouched by other entries",
			mapping:      `{"a":"b"}`,
			clientModel:  "z",
			wantUpstream: "z",
		},
		{
			name:         "empty target is not a hop",
			mapping:      `{"a":""}`,
			clientModel:  "a",
			wantUpstream: "a",
		},
		{
			name:         "self mapping at the origin is not a mapping",
			mapping:      `{"a":"a"}`,
			clientModel:  "a",
			wantUpstream: "a",
		},
		{
			name:         "self mapping at the chain tail still counts as mapped",
			mapping:      `{"a":"b","b":"b"}`,
			clientModel:  "a",
			wantUpstream: "b",
			wantMapped:   true,
		},
		{
			name:        "cycle is rejected",
			mapping:     `{"a":"b","b":"a"}`,
			clientModel: "a",
			wantErr:     true,
		},
		{
			name:        "malformed json is rejected",
			mapping:     `{"a":`,
			clientModel: "a",
			wantErr:     true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			upstream, mapped, err := ResolveMappedModelName(tc.mapping, tc.clientModel)
			if tc.wantErr {
				require.Error(t, err)
				// 出错时不能谎报映射成功：调用方会拿这个名字去查进价。
				assert.False(t, mapped)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.wantUpstream, upstream)
			assert.Equal(t, tc.wantMapped, mapped)
		})
	}
}
