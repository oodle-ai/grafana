package legacy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"google.golang.org/grpc/metadata"
	"k8s.io/apimachinery/pkg/runtime/schema"

	authlib "github.com/grafana/authlib/types"

	dashboard "github.com/grafana/grafana/apps/dashboard/pkg/apis/dashboard/v1beta1"
	folders "github.com/grafana/grafana/apps/folder/pkg/apis/folder/v1beta1"
	"github.com/grafana/grafana/pkg/apimachinery/utils"
	"github.com/grafana/grafana/pkg/infra/db"
	"github.com/grafana/grafana/pkg/services/accesscontrol"
	"github.com/grafana/grafana/pkg/services/featuremgmt"
	"github.com/grafana/grafana/pkg/services/librarypanels"
	"github.com/grafana/grafana/pkg/services/provisioning"
	"github.com/grafana/grafana/pkg/services/search/sort"
	"github.com/grafana/grafana/pkg/services/sqlstore"
	"github.com/grafana/grafana/pkg/storage/legacysql"
	"github.com/grafana/grafana/pkg/storage/unified/apistore"
	"github.com/grafana/grafana/pkg/storage/unified/resource"
	"github.com/grafana/grafana/pkg/storage/unified/resourcepb"
)

type MigrateOptions struct {
	Namespace        string
	Store            resourcepb.BulkStoreClient
	LargeObjects     apistore.LargeObjectSupport
	BlobStore        resourcepb.BlobStoreClient
	Resources        []schema.GroupResource
	WithHistory      bool   // only applies to dashboards
	OnlyCount        bool   // just count the values
	AllOrgs          bool   // when true, operate across all organizations instead of a single namespace
	ExcludeNamespace string // when AllOrgs is true, skip this namespace (already being handled separately)
	StackID          string // stack identifier for logging
	Progress         func(count int, msg string)
}

// Read from legacy and write into unified storage
//
//go:generate mockery --name LegacyMigrator --structname MockLegacyMigrator --inpackage --filename legacy_migrator_mock.go --with-expecter
type LegacyMigrator interface {
	Migrate(ctx context.Context, opts MigrateOptions) (*resourcepb.BulkResponse, error)
}

// This can migrate Folders, Dashboards and LibraryPanels
func ProvideLegacyMigrator(
	sql db.DB, // direct access to tables
	provisioning provisioning.ProvisioningService, // only needed for dashboard settings
	libraryPanelSvc librarypanels.Service,
	dashboardPermissionSvc accesscontrol.DashboardPermissionsService,
	accessControl accesscontrol.AccessControl,
	features featuremgmt.FeatureToggles,
) LegacyMigrator {
	dbp := legacysql.NewDatabaseProvider(sql)
	return NewDashboardAccess(dbp, authlib.OrgNamespaceFormatter, nil, provisioning, libraryPanelSvc, sort.ProvideService(), dashboardPermissionSvc, accessControl, features)
}

type BlobStoreInfo struct {
	Count int64
	Size  int64
}

// migrate function -- works for a single kind
type migratorFunc = func(ctx context.Context, orgId int64, opts MigrateOptions, stream resourcepb.BulkStore_BulkProcessClient) (*BlobStoreInfo, error)

func (a *dashboardSqlAccess) Migrate(ctx context.Context, opts MigrateOptions) (*resourcepb.BulkResponse, error) {
	if opts.OnlyCount {
		return a.countValues(ctx, opts)
	}

	if opts.AllOrgs {
		return a.migrateAllOrgs(ctx, opts)
	}

	return a.migrateSingleOrg(ctx, opts)
}

// migrateAllOrgs migrates legacy resources for every organization into unified storage.
// This is used when one org enables Git Sync and other orgs' data needs to be
// migrated to unified storage so the global storage flag can be safely switched.
func (a *dashboardSqlAccess) migrateAllOrgs(ctx context.Context, opts MigrateOptions) (*resourcepb.BulkResponse, error) {
	if opts.Progress == nil {
		opts.Progress = func(count int, msg string) {}
	}

	orgIDs, err := a.getAllOrgIDs(ctx)
	if err != nil {
		return nil, fmt.Errorf("enumerate organizations: %w", err)
	}

	combined := &resourcepb.BulkResponse{}
	for _, orgID := range orgIDs {
		ns := a.namespacer(orgID)
		if ns == opts.ExcludeNamespace {
			a.log.Info("skipping excluded namespace during multi-org migration", "namespace", ns, "orgId", orgID)
			continue
		}

		orgOpts := opts
		orgOpts.Namespace = ns
		orgOpts.AllOrgs = false
		orgOpts.ExcludeNamespace = ""

		rsp, err := a.migrateSingleOrg(ctx, orgOpts)
		if err != nil {
			return nil, fmt.Errorf("migrate org %d (namespace %s): %w", orgID, ns, err)
		}
		if rsp != nil {
			combined.Summary = append(combined.Summary, rsp.Summary...)
		}
	}
	return combined, nil
}

// getAllOrgIDs returns all distinct organization IDs that have dashboards or folders.
func (a *dashboardSqlAccess) getAllOrgIDs(ctx context.Context) ([]int64, error) {
	sql, err := a.sql(ctx)
	if err != nil {
		return nil, err
	}

	var orgIDs []int64
	err = sql.DB.WithDbSession(ctx, func(sess *sqlstore.DBSession) error {
		return sess.SQL("SELECT DISTINCT org_id FROM " + sql.Table("dashboard")).Find(&orgIDs)
	})
	if err != nil {
		return nil, err
	}
	return orgIDs, nil
}

func (a *dashboardSqlAccess) migrateSingleOrg(ctx context.Context, opts MigrateOptions) (*resourcepb.BulkResponse, error) {
	info, err := authlib.ParseNamespace(opts.Namespace)
	if err != nil {
		return nil, err
	}
	if opts.Progress == nil {
		opts.Progress = func(count int, msg string) {} // noop
	}

	if len(opts.Resources) < 1 {
		return nil, fmt.Errorf("missing resource selector")
	}

	migratorFuncs := []migratorFunc{}
	settings := resource.BulkSettings{
		RebuildCollection: true,
		SkipValidation:    true,
	}

	for _, res := range opts.Resources {
		switch fmt.Sprintf("%s/%s", res.Group, res.Resource) {
		case "folder.grafana.app/folders":
			migratorFuncs = append(migratorFuncs, a.migrateFolders)
			settings.Collection = append(settings.Collection, &resourcepb.ResourceKey{
				Namespace: opts.Namespace,
				Group:     folders.GROUP,
				Resource:  folders.RESOURCE,
			})

		case "dashboard.grafana.app/librarypanels":
			migratorFuncs = append(migratorFuncs, a.migratePanels)
			settings.Collection = append(settings.Collection, &resourcepb.ResourceKey{
				Namespace: opts.Namespace,
				Group:     dashboard.GROUP,
				Resource:  dashboard.LIBRARY_PANEL_RESOURCE,
			})

		case "dashboard.grafana.app/dashboards":
			migratorFuncs = append(migratorFuncs, a.migrateDashboards)
			settings.Collection = append(settings.Collection, &resourcepb.ResourceKey{
				Namespace: opts.Namespace,
				Group:     dashboard.GROUP,
				Resource:  dashboard.DASHBOARD_RESOURCE,
			})
		default:
			return nil, fmt.Errorf("unsupported resource: %s", res)
		}
	}

	ctx = metadata.NewOutgoingContext(ctx, settings.ToMD())
	if md, ok := metadata.FromOutgoingContext(ctx); ok {
		a.log.Debug("bulk grpc request metadata",
			"metadata", md,
			"collection", settings.Collection,
		)
	} else {
		a.log.Debug("bulk grpc request, no metadata found",
			"collection", settings.Collection,
		)
	}

	stream, err := opts.Store.BulkProcess(ctx)
	if err != nil {
		return nil, err
	}

	blobStore := BlobStoreInfo{}
	opts.StackID = fmt.Sprintf("%d", info.StackID)
	a.log.Info("start migrating legacy resources", "namespace", opts.Namespace, "orgId", info.OrgID, "stackId", info.StackID)
	for _, m := range migratorFuncs {
		blobs, err := m(ctx, info.OrgID, opts, stream)
		if err != nil {
			a.log.Error("error migrating legacy resources", "error", err, "namespace", opts.Namespace)
			return nil, err
		}
		if blobs != nil {
			blobStore.Count += blobs.Count
			blobStore.Size += blobs.Size
		}
	}
	a.log.Info("finished migrating legacy resources", "blobStore", blobStore)
	return stream.CloseAndRecv()
}

func (a *dashboardSqlAccess) countValues(ctx context.Context, opts MigrateOptions) (*resourcepb.BulkResponse, error) {
	sql, err := a.sql(ctx)
	if err != nil {
		return nil, err
	}

	var orgId int64
	if !opts.AllOrgs {
		ns, err := authlib.ParseNamespace(opts.Namespace)
		if err != nil {
			return nil, err
		}
		orgId = ns.OrgID
	}

	orgFilter := " AND org_id=?"
	orgArgs := func() []interface{} { return []interface{}{orgId} }
	if opts.AllOrgs {
		if opts.ExcludeNamespace != "" {
			excludeNs, err := authlib.ParseNamespace(opts.ExcludeNamespace)
			if err != nil {
				return nil, err
			}
			orgFilter = " AND org_id!=?"
			orgArgs = func() []interface{} { return []interface{}{excludeNs.OrgID} }
		} else {
			orgFilter = ""
			orgArgs = func() []interface{} { return nil }
		}
	}

	rsp := &resourcepb.BulkResponse{}
	err = sql.DB.WithDbSession(ctx, func(sess *sqlstore.DBSession) error {
		for _, res := range opts.Resources {
			switch fmt.Sprintf("%s/%s", res.Group, res.Resource) {
			case "folder.grafana.app/folders":
				summary := &resourcepb.BulkResponse_Summary{}
				summary.Group = folders.GROUP
				summary.Resource = folders.RESOURCE
				_, err = sess.SQL("SELECT COUNT(*) FROM "+sql.Table("dashboard")+
					" WHERE is_folder=TRUE"+orgFilter, orgArgs()...).Get(&summary.Count)
				rsp.Summary = append(rsp.Summary, summary)

			case "dashboard.grafana.app/librarypanels":
				summary := &resourcepb.BulkResponse_Summary{}
				summary.Group = dashboard.GROUP
				summary.Resource = dashboard.LIBRARY_PANEL_RESOURCE
				_, err = sess.SQL("SELECT COUNT(*) FROM "+sql.Table("library_element")+
					" WHERE 1=1"+orgFilter, orgArgs()...).Get(&summary.Count)
				rsp.Summary = append(rsp.Summary, summary)

			case "dashboard.grafana.app/dashboards":
				summary := &resourcepb.BulkResponse_Summary{}
				summary.Group = dashboard.GROUP
				summary.Resource = dashboard.DASHBOARD_RESOURCE
				rsp.Summary = append(rsp.Summary, summary)

				_, err = sess.SQL("SELECT COUNT(*) FROM "+sql.Table("dashboard")+
					" WHERE is_folder=FALSE"+orgFilter, orgArgs()...).Get(&summary.Count)
				if err != nil {
					return err
				}

				historyQuery := `SELECT COUNT(*)
						FROM ` + sql.Table("dashboard_version") + ` as dv
						JOIN ` + sql.Table("dashboard") + `         as dd
						ON dd.id = dv.dashboard_id
						WHERE 1=1` + orgFilter
				_, err = sess.SQL(historyQuery, orgArgs()...).Get(&summary.History)
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	return rsp, nil
}

func (a *dashboardSqlAccess) migrateDashboards(ctx context.Context, orgId int64, opts MigrateOptions, stream resourcepb.BulkStore_BulkProcessClient) (*BlobStoreInfo, error) {
	query := &DashboardQuery{
		OrgID:         orgId,
		Limit:         100000000,
		GetHistory:    opts.WithHistory, // include history
		AllowFallback: true,             // allow fallback to dashboard table during migration
		Order:         "ASC",            // oldest first
	}

	blobs := &BlobStoreInfo{}
	sql, err := a.sql(ctx)
	if err != nil {
		return blobs, err
	}

	opts.Progress(-1, "migrating dashboards...")
	rows, err := a.getRows(ctx, sql, query)
	if rows != nil {
		defer func() {
			_ = rows.Close()
		}()
	}
	if err != nil {
		return blobs, err
	}

	large := opts.LargeObjects

	// Now send each dashboard
	for i := 1; rows.Next(); i++ {
		dash := rows.row.Dash
		if dash.APIVersion == "" {
			dash.APIVersion = fmt.Sprintf("%s/v0alpha1", dashboard.GROUP)
		}
		dash.SetNamespace(opts.Namespace)
		dash.SetResourceVersion("") // it will be filled in by the backend

		body, err := json.Marshal(dash)
		if err != nil {
			err = fmt.Errorf("error reading json from: %s // %w", rows.row.Dash.Name, err)
			return blobs, err
		}

		req := &resourcepb.BulkRequest{
			Key: &resourcepb.ResourceKey{
				Namespace: opts.Namespace,
				Group:     dashboard.GROUP,
				Resource:  dashboard.DASHBOARD_RESOURCE,
				Name:      rows.Name(),
			},
			Value:  body,
			Folder: rows.row.FolderUID,
			Action: resourcepb.BulkRequest_ADDED,
		}
		if dash.Generation > 1 {
			req.Action = resourcepb.BulkRequest_MODIFIED
		} else if dash.Generation < 0 {
			req.Action = resourcepb.BulkRequest_DELETED
		}

		// With large object support
		if large != nil && len(body) > large.Threshold() {
			obj, err := utils.MetaAccessor(dash)
			if err != nil {
				return blobs, err
			}

			opts.Progress(i, fmt.Sprintf("[v:%d] %s Large object (%d)", dash.Generation, dash.Name, len(body)))
			err = large.Deconstruct(ctx, req.Key, opts.BlobStore, obj, req.Value)
			if err != nil {
				return blobs, err
			}

			// The smaller version (most of spec removed)
			req.Value, err = json.Marshal(dash)
			if err != nil {
				return blobs, err
			}
			blobs.Count++
			blobs.Size += int64(len(body))
		}

		opts.Progress(i, fmt.Sprintf("[v:%2d] %s (size:%d / %d|%d)", dash.Generation, dash.Name, len(req.Value), i, rows.count))

		err = stream.Send(req)
		if err != nil {
			if errors.Is(err, io.EOF) {
				opts.Progress(i, fmt.Sprintf("stream EOF/cancelled. index=%d", i))
				err = nil
			}
			return blobs, err
		}
	}

	if len(rows.rejected) > 0 {
		for _, row := range rows.rejected {
			id := row.Dash.Labels[utils.LabelKeyDeprecatedInternalID]
			a.log.Warn("rejected dashboard",
				"namespace", opts.Namespace,
				"dashboard", row.Dash.Name,
				"uid", row.Dash.UID,
				"id", id,
				"version", row.Dash.Generation,
				"stackId", opts.StackID,
			)
			opts.Progress(-2, fmt.Sprintf("rejected: id:%s, uid:%s", id, row.Dash.Name))
		}
	}

	if rows.Error() != nil {
		return blobs, rows.Error()
	}

	opts.Progress(-2, fmt.Sprintf("finished dashboards... (%d)", rows.count))
	return blobs, err
}

func (a *dashboardSqlAccess) migrateFolders(ctx context.Context, orgId int64, opts MigrateOptions, stream resourcepb.BulkStore_BulkProcessClient) (*BlobStoreInfo, error) {
	query := &DashboardQuery{
		OrgID:      orgId,
		Limit:      100000000,
		GetFolders: true,
		Order:      "ASC",
	}

	sql, err := a.sql(ctx)
	if err != nil {
		return nil, err
	}

	opts.Progress(-1, "migrating folders...")
	rows, err := a.getRows(ctx, sql, query)
	if rows != nil {
		defer func() {
			_ = rows.Close()
		}()
	}
	if err != nil {
		return nil, err
	}

	// Now send each dashboard
	for i := 1; rows.Next(); i++ {
		dash := rows.row.Dash
		dash.APIVersion = "folder.grafana.app/v1beta1"
		dash.Kind = "Folder"
		dash.SetNamespace(opts.Namespace)
		dash.SetResourceVersion("") // it will be filled in by the backend

		spec := map[string]any{
			"title": dash.Spec.Object["title"],
		}
		description := dash.Spec.Object["description"]
		if description != nil {
			spec["description"] = description
		}
		dash.Spec.Object = spec

		body, err := json.Marshal(dash)
		if err != nil {
			return nil, err
		}

		req := &resourcepb.BulkRequest{
			Key: &resourcepb.ResourceKey{
				Namespace: opts.Namespace,
				Group:     "folder.grafana.app",
				Resource:  "folders",
				Name:      rows.Name(),
			},
			Value:  body,
			Folder: rows.row.FolderUID,
			Action: resourcepb.BulkRequest_ADDED,
		}
		if dash.Generation > 1 {
			req.Action = resourcepb.BulkRequest_MODIFIED
		} else if dash.Generation < 0 {
			req.Action = resourcepb.BulkRequest_DELETED
		}

		opts.Progress(i, fmt.Sprintf("[v:%d] %s (%d)", dash.Generation, dash.Name, len(req.Value)))

		err = stream.Send(req)
		if err != nil {
			if errors.Is(err, io.EOF) {
				err = nil
			}
			return nil, err
		}
	}

	if rows.Error() != nil {
		return nil, rows.Error()
	}

	opts.Progress(-2, fmt.Sprintf("finished folders... (%d)", rows.count))
	return nil, err
}

func (a *dashboardSqlAccess) migratePanels(ctx context.Context, orgId int64, opts MigrateOptions, stream resourcepb.BulkStore_BulkProcessClient) (*BlobStoreInfo, error) {
	opts.Progress(-1, "migrating library panels...")
	panels, err := a.GetLibraryPanels(ctx, LibraryPanelQuery{
		OrgID: orgId,
		Limit: 1000000,
	})
	if err != nil {
		return nil, err
	}
	for i, panel := range panels.Items {
		meta, err := utils.MetaAccessor(&panel)
		if err != nil {
			return nil, err
		}
		body, err := json.Marshal(panel)
		if err != nil {
			return nil, err
		}

		req := &resourcepb.BulkRequest{
			Key: &resourcepb.ResourceKey{
				Namespace: opts.Namespace,
				Group:     dashboard.GROUP,
				Resource:  dashboard.LIBRARY_PANEL_RESOURCE,
				Name:      panel.Name,
			},
			Value:  body,
			Folder: meta.GetFolder(),
			Action: resourcepb.BulkRequest_ADDED,
		}
		if panel.Generation > 1 {
			req.Action = resourcepb.BulkRequest_MODIFIED
		}

		opts.Progress(i, fmt.Sprintf("[v:%d] %s (%d)", i, meta.GetName(), len(req.Value)))

		err = stream.Send(req)
		if err != nil {
			if errors.Is(err, io.EOF) {
				err = nil
			}
			return nil, err
		}
	}
	opts.Progress(-2, fmt.Sprintf("finished panels... (%d)", len(panels.Items)))
	return nil, nil
}
