package migrate

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"github.com/grafana/grafana-app-sdk/logging"

	"github.com/grafana/grafana/pkg/registry/apis/provisioning/resources"
	"github.com/grafana/grafana/pkg/storage/legacysql/dualwrite"
	"github.com/grafana/grafana/pkg/storage/unified/resource"
	"github.com/grafana/grafana/pkg/storage/unified/resourcepb"
)

//go:generate mockery --name BulkStoreClient --structname MockBulkStoreClient --inpackage --filename mock_bulk_store_client.go --with-expecter
//go:generate mockery --name=BulkStore_BulkProcessClient --srcpkg=github.com/grafana/grafana/pkg/storage/unified/resource --output=. --outpkg=migrate --filename=mock_bulk_process_client.go --with-expecter
type BulkStoreClient interface {
	BulkProcess(ctx context.Context, opts ...grpc.CallOption) (resourcepb.BulkStore_BulkProcessClient, error)
}

// LegacyResourceMigrator handles migration of legacy resources across all organizations.
// Used by StorageSwapper to ensure all orgs' data is in unified storage before
// switching the global storage mode flag.
//
//go:generate mockery --name LegacyResourceMigrator --structname MockLegacyResourceMigrator --inpackage --filename mock_legacy_resource_migrator.go --with-expecter
type LegacyResourceMigrator interface {
	// CountLegacyResources returns the total count of legacy resources (dashboards + folders)
	// across all organizations except excludeNamespace.
	CountLegacyResources(ctx context.Context, excludeNamespace string) (int64, error)

	// MigrateAllToUnified copies legacy resources from all organizations into unified storage.
	// excludeNamespace is skipped (already being handled by the caller's own migration).
	MigrateAllToUnified(ctx context.Context, store BulkStoreClient, excludeNamespace string) error
}

//go:generate mockery --name StorageSwapper --structname MockStorageSwapper --inpackage --filename mock_storage_swapper.go --with-expecter
type StorageSwapper interface {
	StopReadingUnifiedStorage(ctx context.Context) error
	WipeUnifiedAndSetMigratedFlag(ctx context.Context, namespace string) error
}

type storageSwapper struct {
	bulk            BulkStoreClient
	dual            dualwrite.Service
	legacyMigrator  LegacyResourceMigrator
}

func NewStorageSwapper(bulk BulkStoreClient, dual dualwrite.Service, legacyMigrator LegacyResourceMigrator) StorageSwapper {
	return &storageSwapper{
		bulk:           bulk,
		dual:           dual,
		legacyMigrator: legacyMigrator,
	}
}

func (s *storageSwapper) StopReadingUnifiedStorage(ctx context.Context) error {
	for _, gr := range resources.SupportedProvisioningResources {
		status, _ := s.dual.Status(ctx, gr.GroupResource())
		status.ReadUnified = false
		status.Migrated = 0
		status.Migrating = 0
		_, err := s.dual.Update(ctx, status)
		if err != nil {
			return err
		}
	}

	return nil
}

func (s *storageSwapper) WipeUnifiedAndSetMigratedFlag(ctx context.Context, namespace string) error {
	logger := logging.FromContext(ctx)

	for _, gr := range resources.SupportedProvisioningResources {
		status, _ := s.dual.Status(ctx, gr.GroupResource())
		if status.ReadUnified {
			return fmt.Errorf("unexpected state - already using unified storage for: %s", gr)
		}
		if status.Migrating > 0 {
			if time.Since(time.UnixMilli(status.Migrating)) < time.Second*30 {
				return fmt.Errorf("another migration job is running for: %s", gr)
			}
		}
		settings := resource.BulkSettings{
			RebuildCollection: true, // wipes everything in the collection
			Collection: []*resourcepb.ResourceKey{{
				Namespace: namespace,
				Group:     gr.Group,
				Resource:  gr.Resource,
			}},
		}
		ctx = metadata.NewOutgoingContext(ctx, settings.ToMD())
		stream, err := s.bulk.BulkProcess(ctx)
		if err != nil {
			return fmt.Errorf("error clearing unified %s / %w", gr, err)
		}
		stats, err := stream.CloseAndRecv()
		if err != nil {
			return fmt.Errorf("error clearing unified %s / %w", gr, err)
		}
		if stats != nil && stats.Error != nil {
			return fmt.Errorf("error clearing unified %s: %s (code %d)", gr, stats.Error.Message, stats.Error.Code)
		}
		logger.Info("cleared unified storage", "stats", stats)
	}

	// The dual-writer flags are global (not per-namespace), so before flipping them
	// we must ensure all organizations' legacy data is in unified storage.
	// Auto-migrate other orgs' resources so they remain visible after the switch.
	if s.legacyMigrator != nil {
		remaining, err := s.legacyMigrator.CountLegacyResources(ctx, namespace)
		if err != nil {
			return fmt.Errorf("check remaining legacy resources: %w", err)
		}
		if remaining > 0 {
			logger.Info("auto-migrating legacy resources from other organizations to unified storage",
				"remaining", remaining, "excludeNamespace", namespace)
			if err := s.legacyMigrator.MigrateAllToUnified(ctx, s.bulk, namespace); err != nil {
				return fmt.Errorf("auto-migrate legacy resources to unified storage: %w", err)
			}
		}
	}

	for _, gr := range resources.SupportedProvisioningResources {
		status, _ := s.dual.Status(ctx, gr.GroupResource())
		status.Migrated = time.Now().UnixMilli()
		status.ReadUnified = true
		status.WriteLegacy = false
		_, err := s.dual.Update(ctx, status)
		if err != nil {
			return err
		}
	}

	return nil
}
