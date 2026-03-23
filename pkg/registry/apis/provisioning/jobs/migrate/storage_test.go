package migrate

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/grafana/grafana/pkg/registry/apis/provisioning/resources"
	"github.com/grafana/grafana/pkg/storage/legacysql/dualwrite"
	"github.com/grafana/grafana/pkg/storage/unified/resource"
	"github.com/grafana/grafana/pkg/storage/unified/resourcepb"

	"google.golang.org/grpc/metadata"
)

func TestStorageSwapper_StopReadingUnifiedStorage(t *testing.T) {
	tests := []struct {
		name          string
		setupMocks    func(*MockBulkStoreClient, *dualwrite.MockService)
		expectedError string
	}{
		{
			name: "should update status for all resources",
			setupMocks: func(bulk *MockBulkStoreClient, dual *dualwrite.MockService) {
				for _, gr := range resources.SupportedProvisioningResources {
					status := dualwrite.StorageStatus{
						ReadUnified: true,
						Migrated:    123,
						Migrating:   456,
					}
					dual.On("Status", mock.Anything, gr.GroupResource()).Return(status, nil)
					dual.On("Update", mock.Anything, mock.MatchedBy(func(status dualwrite.StorageStatus) bool {
						return !status.ReadUnified && status.Migrated == 0 && status.Migrating == 0
					})).Return(dualwrite.StorageStatus{}, nil)
				}
			},
		},
		{
			name: "should fail if status update fails",
			setupMocks: func(bulk *MockBulkStoreClient, dual *dualwrite.MockService) {
				gr := resources.SupportedProvisioningResources[0]
				dual.On("Status", mock.Anything, gr.GroupResource()).Return(dualwrite.StorageStatus{}, nil)
				dual.On("Update", mock.Anything, mock.Anything).Return(dualwrite.StorageStatus{}, errors.New("update failed"))
			},
			expectedError: "update failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bulk := NewMockBulkStoreClient(t)
			dual := dualwrite.NewMockService(t)

			if tt.setupMocks != nil {
				tt.setupMocks(bulk, dual)
			}

			swapper := NewStorageSwapper(bulk, dual, nil)
			err := swapper.StopReadingUnifiedStorage(context.Background())

			if tt.expectedError != "" {
				require.Error(t, err)
				require.Contains(t, err.Error(), tt.expectedError)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestStorageSwapper_WipeUnifiedAndSetMigratedFlag(t *testing.T) {
	tests := []struct {
		name          string
		setupMocks    func(*MockBulkStoreClient, *dualwrite.MockService)
		expectedError string
	}{
		{
			name: "should fail if already using unified storage",
			setupMocks: func(bulk *MockBulkStoreClient, dual *dualwrite.MockService) {
				gr := resources.SupportedProvisioningResources[0]
				status := dualwrite.StorageStatus{
					ReadUnified: true,
				}
				dual.On("Status", mock.Anything, gr.GroupResource()).Return(status, nil)
			},
			expectedError: "unexpected state - already using unified storage",
		},
		{
			name: "should fail if migration is in progress",
			setupMocks: func(bulk *MockBulkStoreClient, dual *dualwrite.MockService) {
				gr := resources.SupportedProvisioningResources[0]
				status := dualwrite.StorageStatus{
					ReadUnified: false,
					Migrating:   time.Now().UnixMilli(),
				}
				dual.On("Status", mock.Anything, gr.GroupResource()).Return(status, nil)
			},
			expectedError: "another migration job is running",
		},
		{
			name: "should fail if bulk process fails",
			setupMocks: func(bulk *MockBulkStoreClient, dual *dualwrite.MockService) {
				gr := resources.SupportedProvisioningResources[0]
				dual.On("Status", mock.Anything, gr.GroupResource()).Return(dualwrite.StorageStatus{}, nil)
				bulk.On("BulkProcess", mock.Anything, mock.Anything).Return(nil, errors.New("bulk process failed"))
			},
			expectedError: "error clearing unified",
		},
		{
			name: "should fail if status update fails after bulk process",
			setupMocks: func(bulk *MockBulkStoreClient, dual *dualwrite.MockService) {
				// First loop: wipe unified storage for all resources
				for _, gr := range resources.SupportedProvisioningResources {
					dual.On("Status", mock.Anything, gr.GroupResource()).Return(dualwrite.StorageStatus{}, nil)

					mockStream := NewBulkStore_BulkProcessClient(t)
					mockStream.On("CloseAndRecv").Return(&resourcepb.BulkResponse{}, nil)
					bulk.On("BulkProcess", mock.Anything, mock.Anything).Return(mockStream, nil).Once()
				}

				// Second loop: Update fails on the first resource
				dual.On("Update", mock.Anything, mock.MatchedBy(func(status dualwrite.StorageStatus) bool {
					return status.ReadUnified && !status.WriteLegacy && status.Migrated > 0
				})).Return(dualwrite.StorageStatus{}, errors.New("update failed"))
			},
			expectedError: "update failed",
		},
		{
			name: "should fail if bulk process stream close fails",
			setupMocks: func(bulk *MockBulkStoreClient, dual *dualwrite.MockService) {
				gr := resources.SupportedProvisioningResources[0]
				dual.On("Status", mock.Anything, gr.GroupResource()).Return(dualwrite.StorageStatus{}, nil)

				mockStream := NewBulkStore_BulkProcessClient(t)
				mockStream.On("CloseAndRecv").Return(nil, errors.New("stream close failed"))
				bulk.On("BulkProcess", mock.Anything, mock.Anything).Return(mockStream, nil)
			},
			expectedError: "error clearing unified",
		},
		{
			name: "should succeed with complete workflow",
			setupMocks: func(bulk *MockBulkStoreClient, dual *dualwrite.MockService) {
				for _, gr := range resources.SupportedProvisioningResources {
					dual.On("Status", mock.Anything, gr.GroupResource()).Return(dualwrite.StorageStatus{}, nil)

					mockStream := NewBulkStore_BulkProcessClient(t)
					mockStream.On("CloseAndRecv").Return(&resourcepb.BulkResponse{}, nil)
					bulk.On("BulkProcess", mock.MatchedBy(func(ctx context.Context) bool {
						md, ok := metadata.FromOutgoingContext(ctx)
						if !ok {
							return false
						}

						//nolint:errcheck // hits the err != nil gotcha
						settings, _ := resource.NewBulkSettings(md)
						if !settings.RebuildCollection {
							return false
						}
						if len(settings.Collection) != 1 {
							return false
						}
						if settings.Collection[0].Namespace != "test-namespace" {
							return false
						}
						if settings.Collection[0].Group != gr.Group {
							return false
						}
						if settings.Collection[0].Resource != gr.Resource {
							return false
						}

						return true
					}), mock.Anything).Return(mockStream, nil)

					dual.On("Update", mock.Anything, mock.MatchedBy(func(status dualwrite.StorageStatus) bool {
						return status.ReadUnified && !status.WriteLegacy && status.Migrated > 0
					})).Return(dualwrite.StorageStatus{}, nil).Once()
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bulk := NewMockBulkStoreClient(t)
			dual := dualwrite.NewMockService(t)

			if tt.setupMocks != nil {
				tt.setupMocks(bulk, dual)
			}

			migrator := NewMockLegacyResourceMigrator(t)
			migrator.On("CountLegacyResources", mock.Anything, mock.Anything).Maybe().Return(int64(0), nil)
			migrator.On("MigrateAllToUnified", mock.Anything, mock.Anything, mock.Anything).Maybe().Return(nil)

			swapper := NewStorageSwapper(bulk, dual, migrator)
			err := swapper.WipeUnifiedAndSetMigratedFlag(context.Background(), "test-namespace")

			if tt.expectedError != "" {
				require.Error(t, err)
				require.Contains(t, err.Error(), tt.expectedError)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestStorageSwapper_WipeUnifiedAndSetMigratedFlag_LegacyResourcesExist(t *testing.T) {
	t.Run("should skip auto-migration when no other orgs have legacy resources", func(t *testing.T) {
		bulk := NewMockBulkStoreClient(t)
		dual := dualwrite.NewMockService(t)

		for _, gr := range resources.SupportedProvisioningResources {
			dual.On("Status", mock.Anything, gr.GroupResource()).Return(dualwrite.StorageStatus{}, nil)

			mockStream := NewBulkStore_BulkProcessClient(t)
			mockStream.On("CloseAndRecv").Return(&resourcepb.BulkResponse{}, nil)
			bulk.On("BulkProcess", mock.Anything, mock.Anything).Return(mockStream, nil).Once()

			dual.On("Update", mock.Anything, mock.MatchedBy(func(status dualwrite.StorageStatus) bool {
				return status.ReadUnified && !status.WriteLegacy && status.Migrated > 0
			})).Return(dualwrite.StorageStatus{}, nil).Once()
		}

		migrator := NewMockLegacyResourceMigrator(t)
		migrator.On("CountLegacyResources", mock.Anything, "test-namespace").Return(int64(0), nil)

		swapper := NewStorageSwapper(bulk, dual, migrator)
		err := swapper.WipeUnifiedAndSetMigratedFlag(context.Background(), "test-namespace")

		require.NoError(t, err)
		migrator.AssertNotCalled(t, "MigrateAllToUnified", mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("should auto-migrate when other orgs have legacy resources", func(t *testing.T) {
		bulk := NewMockBulkStoreClient(t)
		dual := dualwrite.NewMockService(t)

		for _, gr := range resources.SupportedProvisioningResources {
			dual.On("Status", mock.Anything, gr.GroupResource()).Return(dualwrite.StorageStatus{}, nil)

			mockStream := NewBulkStore_BulkProcessClient(t)
			mockStream.On("CloseAndRecv").Return(&resourcepb.BulkResponse{}, nil)
			bulk.On("BulkProcess", mock.Anything, mock.Anything).Return(mockStream, nil).Once()

			dual.On("Update", mock.Anything, mock.MatchedBy(func(status dualwrite.StorageStatus) bool {
				return status.ReadUnified && !status.WriteLegacy && status.Migrated > 0
			})).Return(dualwrite.StorageStatus{}, nil).Once()
		}

		migrator := NewMockLegacyResourceMigrator(t)
		migrator.On("CountLegacyResources", mock.Anything, "test-namespace").Return(int64(42), nil)
		migrator.On("MigrateAllToUnified", mock.Anything, bulk, "test-namespace").Return(nil)

		swapper := NewStorageSwapper(bulk, dual, migrator)
		err := swapper.WipeUnifiedAndSetMigratedFlag(context.Background(), "test-namespace")

		require.NoError(t, err)
		migrator.AssertCalled(t, "MigrateAllToUnified", mock.Anything, bulk, "test-namespace")
	})

	t.Run("should fail if auto-migration fails", func(t *testing.T) {
		bulk := NewMockBulkStoreClient(t)
		dual := dualwrite.NewMockService(t)

		for _, gr := range resources.SupportedProvisioningResources {
			dual.On("Status", mock.Anything, gr.GroupResource()).Return(dualwrite.StorageStatus{}, nil)

			mockStream := NewBulkStore_BulkProcessClient(t)
			mockStream.On("CloseAndRecv").Return(&resourcepb.BulkResponse{}, nil)
			bulk.On("BulkProcess", mock.Anything, mock.Anything).Return(mockStream, nil).Once()
		}

		migrator := NewMockLegacyResourceMigrator(t)
		migrator.On("CountLegacyResources", mock.Anything, "test-namespace").Return(int64(10), nil)
		migrator.On("MigrateAllToUnified", mock.Anything, bulk, "test-namespace").Return(errors.New("migration failed"))

		swapper := NewStorageSwapper(bulk, dual, migrator)
		err := swapper.WipeUnifiedAndSetMigratedFlag(context.Background(), "test-namespace")

		require.Error(t, err)
		require.Contains(t, err.Error(), "auto-migrate legacy resources")
	})
}
