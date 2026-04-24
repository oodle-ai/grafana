package clients

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/grafana/grafana/pkg/services/org"
	"github.com/grafana/grafana/pkg/setting"
)

func TestGetRolesForOrg(t *testing.T) {
	cfg := setting.NewCfg()
	// default org id is 1

	t.Run("valid role with request org > 0 maps to request org", func(t *testing.T) {
		orgRoles, _, err := getRolesForOrg(cfg, 42, func() (org.RoleType, *bool, error) {
			return org.RoleEditor, nil, nil
		})
		assert.NoError(t, err)
		assert.Equal(t, map[int64]org.RoleType{42: org.RoleEditor}, orgRoles)
	})

	t.Run("valid role with request org <= 0 falls back to default org", func(t *testing.T) {
		orgRoles, _, err := getRolesForOrg(cfg, 0, func() (org.RoleType, *bool, error) {
			return org.RoleViewer, nil, nil
		})
		assert.NoError(t, err)
		assert.Equal(t, map[int64]org.RoleType{1: org.RoleViewer}, orgRoles)
	})

	t.Run("invalid role returns empty map", func(t *testing.T) {
		orgRoles, _, err := getRolesForOrg(cfg, 42, func() (org.RoleType, *bool, error) {
			return org.RoleType("invalid"), nil, nil
		})
		assert.NoError(t, err)
		assert.Empty(t, orgRoles)
	})

	t.Run("empty role returns empty map", func(t *testing.T) {
		orgRoles, _, err := getRolesForOrg(cfg, 42, func() (org.RoleType, *bool, error) {
			return "", nil, nil
		})
		assert.NoError(t, err)
		assert.Empty(t, orgRoles)
	})
}
