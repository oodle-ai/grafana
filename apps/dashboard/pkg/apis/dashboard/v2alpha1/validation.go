package v2alpha1

import (
	_ "embed"
	json "encoding/json"
	"strings"
	"sync"

	"k8s.io/apimachinery/pkg/util/validation/field"

	"cuelang.org/go/cue"
	"cuelang.org/go/cue/cuecontext"

	"github.com/grafana/grafana/apps/dashboard/pkg/apis/dashboard/cuevalidator"
)

func ValidateDashboardSpec(obj *Dashboard) field.ErrorList {
	data, err := json.Marshal(obj.Spec)
	if err != nil {
		return field.ErrorList{
			field.Invalid(field.NewPath("spec"), field.OmitValueType{}, err.Error()),
		}
	}

	// Custom validation for action query params and headers
	validateAndTrimActionArrays(obj)

	if err := getValidator().Validate(data); err != nil {
		formatted := cuevalidator.FormatErrors(err)
		errs := make(field.ErrorList, 0, len(formatted))
		for _, fe := range formatted {
			// Go marshals empty slices as nil, which the CUE validator
			// rejects as a type mismatch. This is a known false positive;
			// drop it so it doesn't leak to API callers.
			if strings.Contains(fe.Message, "mismatched types null and list") {
				continue
			}
			errs = append(errs, field.Invalid(
				field.NewPath(formatErrorPath(fe.Path)),
				field.OmitValueType{},
				fe.Message,
			))
		}
		return errs
	}

	return nil
}

// Validates and trims action query params and headers to exactly 2 elements each
// This is because we couldn't generate with cue a go struct that would have exactly two strings in each sub-array
func validateAndTrimActionArrays(obj *Dashboard) {
	for _, element := range obj.Spec.Elements {
		if element.PanelKind != nil {
			panelElement := element.PanelKind
			if panelElement.Spec.VizConfig.Spec.FieldConfig.Defaults.Actions != nil {
				processActions(panelElement.Spec.VizConfig.Spec.FieldConfig.Defaults.Actions)
			}
		}
	}
}

// Helper function to process action arrays
func processActions(actions []DashboardAction) {
	for _, action := range actions {
		// Process FetchOptions if present
		if action.Fetch != nil {
			if action.Fetch.QueryParams != nil {
				action.Fetch.QueryParams = trimStringArrays(action.Fetch.QueryParams)
			}
			if action.Fetch.Headers != nil {
				action.Fetch.Headers = trimStringArrays(action.Fetch.Headers)
			}
		}

		// Process InfinityOptions if present
		if action.Infinity != nil {
			if action.Infinity.QueryParams != nil {
				action.Infinity.QueryParams = trimStringArrays(action.Infinity.QueryParams)
			}
			if action.Infinity.Headers != nil {
				action.Infinity.Headers = trimStringArrays(action.Infinity.Headers)
			}
		}
	}
}

// Helper function to trim 2D string arrays to exactly 2 elements per sub-array
func trimStringArrays(arrays [][]string) [][]string {
	if arrays == nil {
		return arrays
	}

	result := make([][]string, len(arrays))
	for i, arr := range arrays {
		if len(arr) > 2 {
			result[i] = arr[:2]
		} else {
			result[i] = arr
		}
	}
	return result
}

func formatErrorPath(path []string) string {
	return strings.Join(path, ".")
}

var (
	validator     *cuevalidator.Validator
	getSchemaOnce sync.Once
)

//go:embed dashboard_spec.cue
var schemaSource string

func getValidator() *cuevalidator.Validator {
	getSchemaOnce.Do(func() {
		cueCtx := cuecontext.New()
		compiledSchema := cueCtx.CompileString(schemaSource).LookupPath(
			cue.ParsePath("DashboardSpec"),
		)
		validator = cuevalidator.NewValidator(compiledSchema)
	})

	return validator
}
