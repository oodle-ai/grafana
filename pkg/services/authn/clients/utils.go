package clients

import (
	"github.com/grafana/grafana/pkg/services/org"
	"github.com/grafana/grafana/pkg/setting"
)

// roleExtractor should return the org role, optional isGrafanaAdmin or an error
type roleExtractor func() (org.RoleType, *bool, error)

// getRoles only handles one org role for now, could be subject to change
func getRoles(cfg *setting.Cfg, extract roleExtractor) (map[int64]org.RoleType, *bool, error) {
	role, isGrafanaAdmin, err := extract()
	orgRoles := make(map[int64]org.RoleType, 0)
	if err != nil {
		return orgRoles, nil, err
	}

	if role == "" || !role.IsValid() {
		return orgRoles, nil, nil
	}

	orgRoles[cfg.DefaultOrgID()] = role

	return orgRoles, isGrafanaAdmin, nil
}

// getRolesForOrg maps the extracted role to requestOrgID if > 0,
// otherwise falls back to cfg.DefaultOrgID().
func getRolesForOrg(cfg *setting.Cfg, requestOrgID int64, extract roleExtractor) (map[int64]org.RoleType, *bool, error) {
	role, isGrafanaAdmin, err := extract()
	orgRoles := make(map[int64]org.RoleType, 0)
	if err != nil {
		return orgRoles, nil, err
	}

	if role == "" || !role.IsValid() {
		return orgRoles, nil, nil
	}

	targetOrgID := requestOrgID
	if targetOrgID <= 0 {
		targetOrgID = cfg.DefaultOrgID()
	}
	orgRoles[targetOrgID] = role

	return orgRoles, isGrafanaAdmin, nil
}
