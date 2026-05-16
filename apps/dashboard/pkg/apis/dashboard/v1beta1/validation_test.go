package v1beta1

import (
	"strings"
	"testing"

	common "github.com/grafana/grafana/pkg/apimachinery/apis/common/v0alpha1"
)

func makeDashboard(spec map[string]any) *Dashboard {
	return &Dashboard{
		Spec: DashboardSpec{Object: spec},
	}
}

func panelSpec(overrides map[string]any) map[string]any {
	p := map[string]any{
		"id":      float64(1),
		"type":    "timeseries",
		"title":   "p",
		"gridPos": map[string]any{"h": float64(8), "w": float64(12), "x": float64(0), "y": float64(0)},
	}
	for k, v := range overrides {
		p[k] = v
	}
	return p
}

// TestValidateDashboardSpec_ColorModeEnum is the regression test for
// the original bug: a typo'd FieldColorModeId used to be surfaced as
// fifteen per-arm "conflicting values" errors. With the structural
// consolidation in cuevalidator.FormatErrors, the API now returns a
// single error that names the offending value and lists every
// allowed alternative in sorted order — the exact shape an LLM or
// human caller needs to fix the dashboard JSON in one round-trip.
func TestValidateDashboardSpec_ColorModeEnum(t *testing.T) {
	spec := map[string]any{
		"schemaVersion": float64(42),
		"title":         "Test",
		"panels": []any{
			panelSpec(map[string]any{
				"fieldConfig": map[string]any{
					"defaults": map[string]any{
						"color": map[string]any{
							"mode": "continuous-BlGrOr",
						},
					},
					"overrides": []any{},
				},
			}),
		},
	}

	errs, versionErr := ValidateDashboardSpec(makeDashboard(spec), false)
	if versionErr != nil {
		t.Fatalf("unexpected schema version error: %v", versionErr)
	}

	var colorErrors int
	var colorMsg string
	for _, fe := range errs {
		if strings.HasSuffix(fe.Field, "color.mode") {
			colorErrors++
			colorMsg = fe.Detail
		}
	}

	// Exactly one consolidated error, not one per arm.
	if colorErrors != 1 {
		t.Fatalf("expected 1 consolidated error at color.mode, got %d: %v", colorErrors, errs)
	}

	if !strings.Contains(colorMsg, `"continuous-BlGrOr"`) {
		t.Errorf("error %q should name the offending value", colorMsg)
	}
	if !strings.Contains(colorMsg, "is not one of") {
		t.Errorf("error %q should be the consolidated form", colorMsg)
	}
	for _, allowed := range []string{
		"thresholds", "palette-classic", "palette-classic-by-name",
		"continuous-GrYlRd", "continuous-RdYlGr", "continuous-BlYlRd",
		"continuous-YlRd", "continuous-BlPu", "continuous-YlBl",
		"continuous-blues", "continuous-reds", "continuous-greens",
		"continuous-purples", "fixed", "shades",
	} {
		if !strings.Contains(colorMsg, allowed) {
			t.Errorf("error %q should list allowed value %q", colorMsg, allowed)
		}
	}
	if strings.Contains(colorMsg, "disjunction") {
		t.Errorf("error %q should not leak CUE internals", colorMsg)
	}
	if strings.Contains(colorMsg, "conflicting values") {
		t.Errorf("error %q should not contain raw per-arm errors", colorMsg)
	}
}

// TestValidateDashboardSpec_FieldNotAllowed pins the post-fix
// behaviour for typo'd or unknown fields. Previously these were
// silently dropped, so users could mis-name a property (e.g.
// `transformatons` instead of `transformations`) and only discover
// it at render time. Now closed-struct violations surface as proper
// API errors.
func TestValidateDashboardSpec_FieldNotAllowed(t *testing.T) {
	spec := map[string]any{
		"schemaVersion": float64(42),
		"title":         "Test",
		"panels": []any{
			panelSpec(map[string]any{
				"obviouslyMadeUpProperty": "x",
			}),
		},
	}
	errs, _ := ValidateDashboardSpec(makeDashboard(spec), false)
	if len(errs) == 0 {
		t.Fatal("expected at least one error for unknown field")
	}
	found := false
	for _, fe := range errs {
		if strings.Contains(fe.Detail, "field not allowed") &&
			strings.HasSuffix(fe.Field, "obviouslyMadeUpProperty") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected a 'field not allowed' error for the unknown property; got %v", errs)
	}
}

// TestValidateDashboardSpec_TypeMismatch confirms that errors which
// are not enum-style disjunctions (here, a string where the schema
// requires a list) surface verbatim with the offending path. The
// consolidation logic uses CUE's format-string identifier as its
// discriminator, so it must not collapse type-mismatch errors that
// look superficially similar to enum-arm errors.
func TestValidateDashboardSpec_TypeMismatch(t *testing.T) {
	spec := map[string]any{
		"schemaVersion": float64(42),
		"title":         "x",
		"panels":        "this-should-be-a-list",
	}
	errs, _ := ValidateDashboardSpec(makeDashboard(spec), false)
	if len(errs) == 0 {
		t.Fatal("expected at least one validation error")
	}
	found := false
	for _, fe := range errs {
		if strings.HasSuffix(fe.Field, "panels") &&
			strings.Contains(fe.Detail, "mismatched types") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected a type-mismatch error on panels; got %v", errs)
	}
}

// TestValidateDashboardSpec_HappyPath_ColorMode guards against the
// validator surfacing spurious errors for a perfectly valid dashboard.
func TestValidateDashboardSpec_HappyPath_ColorMode(t *testing.T) {
	spec := map[string]any{
		"schemaVersion": float64(42),
		"title":         "Test",
		"panels": []any{
			panelSpec(map[string]any{
				"fieldConfig": map[string]any{
					"defaults": map[string]any{
						"color": map[string]any{
							"mode": "continuous-GrYlRd",
						},
					},
					"overrides": []any{},
				},
			}),
		},
	}
	errs, _ := ValidateDashboardSpec(makeDashboard(spec), false)
	for _, fe := range errs {
		if strings.HasSuffix(fe.Field, "color.mode") {
			t.Errorf("expected no color.mode error; got %v", fe)
		}
	}
}

// TestValidateDashboardSpec_SchemaVersion pins the schemaVersion
// short-circuit: too-old versions return a single dedicated error
// and skip CUE validation entirely.
func TestValidateDashboardSpec_SchemaVersion(t *testing.T) {
	spec := map[string]any{
		"schemaVersion": float64(1),
		"title":         "Test",
	}
	errs, versionErr := ValidateDashboardSpec(makeDashboard(spec), false)
	if versionErr == nil {
		t.Fatal("expected schemaVersion error")
	}
	if len(errs) != 0 {
		t.Errorf("CUE errors should be skipped when schema version is too old; got %v", errs)
	}
}

var _ = common.Unstructured{}
