package v1beta1

import (
	_ "embed"
	json "encoding/json"
	fmt "fmt"
	"strings"
	"sync"

	"k8s.io/apimachinery/pkg/util/validation/field"

	"cuelang.org/go/cue"
	"cuelang.org/go/cue/cuecontext"

	"github.com/grafana/grafana/apps/dashboard/pkg/apis/dashboard/cuevalidator"
	"github.com/grafana/grafana/apps/dashboard/pkg/migration/schemaversion"
)

func ValidateDashboardSpec(obj *Dashboard, forceValidation bool) (field.ErrorList, field.ErrorList) {
	var schemaVersionError field.ErrorList
	schemaVersion := schemaversion.GetSchemaVersion(obj.Spec.Object)
	if schemaVersion != schemaversion.LATEST_VERSION {
		schemaVersionError = field.ErrorList{field.Invalid(field.NewPath("spec", "schemaVersion"), field.OmitValueType{}, fmt.Sprintf("Schema version %d is not supported - please upgrade to %d", schemaVersion, schemaversion.LATEST_VERSION))}
		if !forceValidation {
			return nil, schemaVersionError
		}
	}

	data, err := json.Marshal(obj.Spec.Object)
	if err != nil {
		return field.ErrorList{
			field.Invalid(field.NewPath("spec"), field.OmitValueType{}, err.Error()),
		}, schemaVersionError
	}

	if err := getValidator().Validate(data); err != nil {
		formatted := cuevalidator.FormatErrors(err)
		errs := make(field.ErrorList, 0, len(formatted))
		for _, fe := range formatted {
			errs = append(errs, field.Invalid(
				field.NewPath(formatErrorPath(fe.Path)),
				field.OmitValueType{},
				fe.Message,
			))
		}
		return errs, schemaVersionError
	}

	return nil, schemaVersionError
}

func formatErrorPath(path []string) string {
	// omitting the "lineage.schemas[0].schema.spec" prefix here.
	return strings.Join(path[4:], ".")
}

var (
	validator     *cuevalidator.Validator
	getSchemaOnce sync.Once
)

//go:embed dashboard_kind.cue
var schemaSource string

func getValidator() *cuevalidator.Validator {
	getSchemaOnce.Do(func() {
		cueCtx := cuecontext.New()
		compiledSchema := cueCtx.CompileString(schemaSource).LookupPath(
			cue.ParsePath("lineage.schemas[0].schema.spec"),
		)
		validator = cuevalidator.NewValidator(compiledSchema)
	})

	return validator
}
