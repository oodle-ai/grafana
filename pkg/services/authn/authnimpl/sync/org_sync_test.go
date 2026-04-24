package sync

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	claims "github.com/grafana/authlib/types"

	"github.com/grafana/grafana/pkg/apimachinery/identity"
	"github.com/grafana/grafana/pkg/infra/log"
	"github.com/grafana/grafana/pkg/infra/tracing"
	"github.com/grafana/grafana/pkg/services/accesscontrol"
	"github.com/grafana/grafana/pkg/services/accesscontrol/actest"
	"github.com/grafana/grafana/pkg/services/authn"
	"github.com/grafana/grafana/pkg/services/login"
	"github.com/grafana/grafana/pkg/services/org"
	"github.com/grafana/grafana/pkg/services/org/orgtest"
	"github.com/grafana/grafana/pkg/services/user"
	"github.com/grafana/grafana/pkg/services/user/usertest"
	"github.com/grafana/grafana/pkg/setting"
)

func TestOrgSync_SyncOrgRolesHook(t *testing.T) {
	orgService := &orgtest.MockService{}
	orgService.On("GetUserOrgList", mock.Anything, mock.Anything).Return([]*org.UserOrgDTO{
		{
			OrgID: 1,
			Role:  org.RoleEditor,
		},
		{
			OrgID: 3,
			Role:  org.RoleViewer,
		},
	}, nil)
	orgService.On("RemoveOrgUser", mock.Anything, mock.MatchedBy(func(cmd *org.RemoveOrgUserCommand) bool {
		return cmd.OrgID == 3 && cmd.UserID == 1
	})).Return(nil)
	orgService.On("UpdateOrgUser", mock.Anything, mock.MatchedBy(func(cmd *org.UpdateOrgUserCommand) bool {
		return cmd.OrgID == 1 && cmd.UserID == 1 && cmd.Role == org.RoleAdmin
	})).Return(nil)
	orgService.On("AddOrgUser", mock.Anything, mock.MatchedBy(func(cmd *org.AddOrgUserCommand) bool {
		return cmd.OrgID == 2 && cmd.UserID == 1 && cmd.Role == org.RoleEditor
	})).Return(org.ErrOrgNotFound)
	acService := &actest.FakeService{}
	userService := &usertest.FakeUserService{ExpectedUser: &user.User{
		ID:    1,
		Login: "test",
		Name:  "test",
		Email: "test",
	}}

	type fields struct {
		userService   user.Service
		orgService    org.Service
		accessControl accesscontrol.Service
		log           log.Logger
	}
	type args struct {
		ctx context.Context
		id  *authn.Identity
	}
	tests := []struct {
		name    string
		fields  fields
		args    args
		wantErr bool
		wantID  *authn.Identity
	}{
		{
			name: "add user to multiple orgs, should not set the user's default orgID to an org that does not exist",
			fields: fields{
				userService:   userService,
				orgService:    orgService,
				accessControl: acService,
				log:           log.NewNopLogger(),
			},
			args: args{
				ctx: context.Background(),
				id: &authn.Identity{
					ID:             "1",
					Type:           claims.TypeUser,
					Login:          "test",
					Name:           "test",
					Email:          "test",
					OrgRoles:       map[int64]identity.RoleType{1: org.RoleAdmin, 2: org.RoleEditor},
					IsGrafanaAdmin: ptrBool(false),
					ClientParams: authn.ClientParams{
						SyncOrgRoles: true,
						LookUpParams: login.UserLookupParams{
							Email: ptrString("test"),
							Login: nil,
						},
					},
				},
			},
			wantID: &authn.Identity{
				ID:             "1",
				Type:           claims.TypeUser,
				Login:          "test",
				Name:           "test",
				Email:          "test",
				OrgRoles:       map[int64]identity.RoleType{1: org.RoleAdmin, 2: org.RoleEditor},
				OrgID:          1, // set using org
				IsGrafanaAdmin: ptrBool(false),
				ClientParams: authn.ClientParams{
					SyncOrgRoles: true,
					LookUpParams: login.UserLookupParams{
						Email: ptrString("test"),
						Login: nil,
					},
				},
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &OrgSync{
				userService:   tt.fields.userService,
				orgService:    tt.fields.orgService,
				accessControl: tt.fields.accessControl,
				log:           tt.fields.log,
				tracer:        tracing.InitializeTracerForTest(),
			}
			if err := s.SyncOrgRolesHook(tt.args.ctx, tt.args.id, nil); (err != nil) != tt.wantErr {
				t.Errorf("OrgSync.SyncOrgRolesHook() error = %v, wantErr %v", err, tt.wantErr)
			}

			assert.EqualValues(t, tt.wantID, tt.args.id)
		})
	}
}

func TestOrgSync_SyncOrgRolesHook_Additive(t *testing.T) {
	t.Run("additive mode: existing memberships preserved when syncing new org", func(t *testing.T) {
		orgService := &orgtest.MockService{}
		orgService.On("GetUserOrgList", mock.Anything, mock.Anything).Return([]*org.UserOrgDTO{
			{OrgID: 1, Role: org.RoleAdmin},
			{OrgID: 3, Role: org.RoleViewer},
		}, nil)
		// Expect add for org 2, no remove calls
		orgService.On("AddOrgUser", mock.Anything, mock.MatchedBy(func(cmd *org.AddOrgUserCommand) bool {
			return cmd.OrgID == 2 && cmd.UserID == 1 && cmd.Role == org.RoleEditor
		})).Return(nil)

		s := &OrgSync{
			userService:   &usertest.FakeUserService{ExpectedUser: &user.User{ID: 1}},
			orgService:    orgService,
			accessControl: &actest.FakeService{},
			log:           log.NewNopLogger(),
			tracer:        tracing.InitializeTracerForTest(),
		}

		id := &authn.Identity{
			ID:       "1",
			Type:     claims.TypeUser,
			OrgRoles: map[int64]identity.RoleType{2: org.RoleEditor},
			ClientParams: authn.ClientParams{
				SyncOrgRoles:         true,
				AdditiveSyncOrgRoles: true,
			},
		}

		err := s.SyncOrgRolesHook(context.Background(), id, nil)
		assert.NoError(t, err)

		// Must NOT have called RemoveOrgUser
		orgService.AssertNotCalled(t, "RemoveOrgUser", mock.Anything, mock.Anything)
		// Must have called AddOrgUser for org 2
		orgService.AssertCalled(t, "AddOrgUser", mock.Anything, mock.MatchedBy(func(cmd *org.AddOrgUserCommand) bool {
			return cmd.OrgID == 2
		}))
	})

	t.Run("additive mode: role update in request org, others untouched", func(t *testing.T) {
		orgService := &orgtest.MockService{}
		orgService.On("GetUserOrgList", mock.Anything, mock.Anything).Return([]*org.UserOrgDTO{
			{OrgID: 1, Role: org.RoleAdmin},
			{OrgID: 2, Role: org.RoleViewer},
		}, nil)
		orgService.On("UpdateOrgUser", mock.Anything, mock.MatchedBy(func(cmd *org.UpdateOrgUserCommand) bool {
			return cmd.OrgID == 2 && cmd.UserID == 1 && cmd.Role == org.RoleEditor
		})).Return(nil)

		s := &OrgSync{
			userService:   &usertest.FakeUserService{ExpectedUser: &user.User{ID: 1}},
			orgService:    orgService,
			accessControl: &actest.FakeService{},
			log:           log.NewNopLogger(),
			tracer:        tracing.InitializeTracerForTest(),
		}

		id := &authn.Identity{
			ID:       "1",
			Type:     claims.TypeUser,
			OrgRoles: map[int64]identity.RoleType{2: org.RoleEditor},
			ClientParams: authn.ClientParams{
				SyncOrgRoles:         true,
				AdditiveSyncOrgRoles: true,
			},
		}

		err := s.SyncOrgRolesHook(context.Background(), id, nil)
		assert.NoError(t, err)

		orgService.AssertNotCalled(t, "RemoveOrgUser", mock.Anything, mock.Anything)
		orgService.AssertCalled(t, "UpdateOrgUser", mock.Anything, mock.MatchedBy(func(cmd *org.UpdateOrgUserCommand) bool {
			return cmd.OrgID == 2 && cmd.Role == org.RoleEditor
		}))
	})

	t.Run("non-additive mode: memberships removed as before", func(t *testing.T) {
		orgService := &orgtest.MockService{}
		orgService.On("GetUserOrgList", mock.Anything, mock.Anything).Return([]*org.UserOrgDTO{
			{OrgID: 1, Role: org.RoleAdmin},
			{OrgID: 2, Role: org.RoleViewer},
		}, nil)
		orgService.On("UpdateOrgUser", mock.Anything, mock.MatchedBy(func(cmd *org.UpdateOrgUserCommand) bool {
			return cmd.OrgID == 2 && cmd.UserID == 1 && cmd.Role == org.RoleEditor
		})).Return(nil)
		orgService.On("RemoveOrgUser", mock.Anything, mock.MatchedBy(func(cmd *org.RemoveOrgUserCommand) bool {
			return cmd.OrgID == 1 && cmd.UserID == 1
		})).Return(nil)

		acService := &actest.FakeService{}

		s := &OrgSync{
			userService:   &usertest.FakeUserService{ExpectedUser: &user.User{ID: 1}},
			orgService:    orgService,
			accessControl: acService,
			log:           log.NewNopLogger(),
			tracer:        tracing.InitializeTracerForTest(),
		}

		id := &authn.Identity{
			ID:       "1",
			Type:     claims.TypeUser,
			OrgRoles: map[int64]identity.RoleType{2: org.RoleEditor},
			ClientParams: authn.ClientParams{
				SyncOrgRoles:         true,
				AdditiveSyncOrgRoles: false,
			},
		}

		err := s.SyncOrgRolesHook(context.Background(), id, nil)
		assert.NoError(t, err)

		// org1 membership should be removed
		orgService.AssertCalled(t, "RemoveOrgUser", mock.Anything, mock.MatchedBy(func(cmd *org.RemoveOrgUserCommand) bool {
			return cmd.OrgID == 1
		}))
	})
}

func TestOrgSync_SetDefaultOrgHook(t *testing.T) {
	testCases := []struct {
		name              string
		defaultOrgSetting int64
		identity          *authn.Identity
		setupMock         func(*usertest.MockService, *orgtest.FakeOrgService)
		inputErr          error
	}{
		{
			name:              "should set default org",
			defaultOrgSetting: 2,
			identity:          &authn.Identity{ID: "1", Type: claims.TypeUser},
			setupMock: func(userService *usertest.MockService, orgService *orgtest.FakeOrgService) {
				userService.On("Update", mock.Anything, mock.MatchedBy(func(cmd *user.UpdateUserCommand) bool {
					return cmd.UserID == 1 && *cmd.OrgID == 2
				})).Return(nil)
			},
		},
		{
			name:              "should skip setting the default org when default org is not set",
			defaultOrgSetting: -1,
			identity:          &authn.Identity{ID: "1", Type: claims.TypeUser},
		},
		{
			name:              "should skip setting the default org when identity is nil",
			defaultOrgSetting: -1,
			identity:          nil,
		},
		{
			name:              "should skip setting the default org when input err is not nil",
			defaultOrgSetting: 2,
			identity:          &authn.Identity{ID: "1", Type: claims.TypeUser},
			inputErr:          fmt.Errorf("error"),
		},
		{
			name:              "should skip setting the default org when identity is not a user",
			defaultOrgSetting: 2,
			identity:          &authn.Identity{ID: "1", Type: claims.TypeServiceAccount},
		},
		{
			name:              "should skip setting the default org when user id is not valid",
			defaultOrgSetting: 2,
			identity:          &authn.Identity{ID: "invalid", Type: claims.TypeUser},
		},
		{
			name:              "should skip setting the default org when user is not allowed to use the configured default org",
			defaultOrgSetting: 3,
			identity:          &authn.Identity{ID: "1", Type: claims.TypeUser},
		},
		{
			name:              "should skip setting the default org when validateUsingOrg returns error",
			defaultOrgSetting: 2,
			identity:          &authn.Identity{ID: "1", Type: claims.TypeUser},
			setupMock: func(userService *usertest.MockService, orgService *orgtest.FakeOrgService) {
				orgService.ExpectedError = fmt.Errorf("error")
			},
		},
		{
			name:              "should skip the hook when the user org update was unsuccessful",
			defaultOrgSetting: 2,
			identity:          &authn.Identity{ID: "1", Type: claims.TypeUser},
			setupMock: func(userService *usertest.MockService, orgService *orgtest.FakeOrgService) {
				userService.On("Update", mock.Anything, mock.Anything).Return(fmt.Errorf("error"))
			},
		},
	}
	for _, tt := range testCases {
		t.Run(tt.name, func(t *testing.T) {
			cfg := setting.NewCfg()
			cfg.LoginDefaultOrgId = tt.defaultOrgSetting

			userService := &usertest.MockService{}
			defer userService.AssertExpectations(t)

			orgService := &orgtest.FakeOrgService{
				ExpectedUserOrgDTO: []*org.UserOrgDTO{{OrgID: 2}},
			}

			if tt.setupMock != nil {
				tt.setupMock(userService, orgService)
			}

			s := &OrgSync{
				userService:   userService,
				orgService:    orgService,
				accessControl: actest.FakeService{},
				log:           log.NewNopLogger(),
				cfg:           cfg,
				tracer:        tracing.InitializeTracerForTest(),
			}

			s.SetDefaultOrgHook(context.Background(), tt.identity, nil, tt.inputErr)
		})
	}
}
