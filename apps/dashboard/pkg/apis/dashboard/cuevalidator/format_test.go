package cuevalidator_test

import (
	"strings"
	"testing"

	"cuelang.org/go/cue/cuecontext"
	cueerrors "cuelang.org/go/cue/errors"
	cuejson "cuelang.org/go/encoding/json"

	"github.com/grafana/grafana/apps/dashboard/pkg/apis/dashboard/cuevalidator"
)

// validate compiles a CUE schema and validates a JSON literal against
// it. Inline rather than using the production cuevalidator.Validator
// so these tests don't depend on the real dashboard schemas and stay
// fast.
func validate(t *testing.T, schema, jsonValue string) error {
	t.Helper()
	ctx := cuecontext.New()
	compiled := ctx.CompileString(schema)
	if compiled.Err() != nil {
		t.Fatalf("compile schema: %v", compiled.Err())
	}
	return cuejson.Validate([]byte(jsonValue), compiled)
}

func TestFormatErrors_NilError(t *testing.T) {
	if got := cuevalidator.FormatErrors(nil); got != nil {
		t.Fatalf("expected nil, got %v", got)
	}
}

// TestFormatStringsAreStable pins the CUE-internal format string
// identifiers FormatErrors uses to discriminate error kinds. The
// implementation matches on these identifiers (not on the rendered
// message text), so if a future CUE release changes the wording, this
// test fails with a one-line fix: update the constants in format.go.
//
// Without this test, a CUE format-string change would silently turn
// consolidation off again and reintroduce the "fifteen errors per
// typo'd color mode" failure mode.
func TestFormatStringsAreStable(t *testing.T) {
	err := validate(t, `mode: "a" | "b"`, `{"mode": "z"}`)
	if err == nil {
		t.Fatal("expected validation error")
	}

	var sawWrapper, sawArm bool
	for _, e := range cueerrors.Errors(err) {
		format, _ := e.Msg()
		switch format {
		case "%d errors in empty disjunction:":
			sawWrapper = true
		case "conflicting values %s and %s":
			sawArm = true
		}
	}
	if !sawWrapper {
		t.Errorf("expected CUE to still emit a \"%%d errors in empty disjunction:\" wrapper; if you're updating CUE, sync the constant in format.go")
	}
	if !sawArm {
		t.Errorf("expected CUE to still emit \"conflicting values %%s and %%s\" per arm; if you're updating CUE, sync the constant in format.go")
	}
}

// TestFormatErrors_ConsolidatesStringEnumDisjunction is the headline
// behavioural contract: a typo'd string-literal enum value collapses
// from N per-arm errors into one clean `"X" is not one of [...]`
// message naming the offending value and listing every allowed arm
// in sorted order.
func TestFormatErrors_ConsolidatesStringEnumDisjunction(t *testing.T) {
	err := validate(t, `mode: "a" | "b" | "c"`, `{"mode": "z"}`)
	if err == nil {
		t.Fatal("expected validation error")
	}
	out := cuevalidator.FormatErrors(err)
	if len(out) != 1 {
		t.Fatalf("expected 1 consolidated error, got %d: %#v", len(out), out)
	}

	msg := out[0].Message
	if !strings.Contains(msg, `"z" is not one of`) {
		t.Errorf("message %q should name the offending value", msg)
	}
	for _, want := range []string{`"a"`, `"b"`, `"c"`} {
		if !strings.Contains(msg, want) {
			t.Errorf("message %q should list allowed literal %s", msg, want)
		}
	}
	// Sorted order: the allowed set should be deterministic regardless
	// of the order CUE emitted the per-arm errors.
	wantInOrder := `"a", "b", "c"`
	if !strings.Contains(msg, wantInOrder) {
		t.Errorf("message %q should list allowed values in sorted order (%s)", msg, wantInOrder)
	}
	// No leak of CUE internals.
	if strings.Contains(msg, "disjunction") {
		t.Errorf("message %q should not mention CUE internals", msg)
	}
	if strings.Contains(msg, "conflicting values") {
		t.Errorf("message %q should not contain raw per-arm errors", msg)
	}
}

// TestFormatErrors_PreservesFieldNotAllowed pins the post-fix
// behaviour for typo'd or unknown fields. Earlier versions of this
// helper silently dropped these (so typo'd properties like
// `transformatons` were invisible to callers); they must now reach
// the API verbatim.
func TestFormatErrors_PreservesFieldNotAllowed(t *testing.T) {
	err := validate(t, `close({ allowed: string })`, `{"allowed": "ok", "unexpected": "x"}`)
	if err == nil {
		t.Fatal("expected validation error")
	}
	out := cuevalidator.FormatErrors(err)

	found := false
	for _, fe := range out {
		if strings.Contains(fe.Message, "field not allowed") {
			found = true
			if len(fe.Path) == 0 || fe.Path[len(fe.Path)-1] != "unexpected" {
				t.Errorf("expected path to end in 'unexpected', got %v", fe.Path)
			}
		}
	}
	if !found {
		t.Errorf("field-not-allowed error should pass through; got %v", out)
	}
}

// TestFormatErrors_PreservesTypeMismatch guards against the
// consolidation logic accidentally collapsing type-mismatch errors,
// which use a different CUE format string from enum-arm errors but
// could easily be mis-matched by a careless implementation.
func TestFormatErrors_PreservesTypeMismatch(t *testing.T) {
	err := validate(t, `value: [...string]`, `{"value": "not-a-list"}`)
	if err == nil {
		t.Fatal("expected validation error")
	}
	out := cuevalidator.FormatErrors(err)
	if len(out) == 0 {
		t.Fatal("expected at least one error")
	}
	found := false
	for _, fe := range out {
		if strings.Contains(fe.Message, "mismatched types") {
			found = true
		}
	}
	if !found {
		t.Errorf("type mismatch should pass through verbatim; got %v", out)
	}
}

// TestFormatErrors_DropsSyntheticDisjunctionWrapper confirms the
// "%d errors in empty disjunction:" wrapper never reaches callers.
// (Its child errors carry the actual information; the wrapper is
// pure noise.)
func TestFormatErrors_DropsSyntheticDisjunctionWrapper(t *testing.T) {
	err := validate(t, `mode: "a" | "b"`, `{"mode": "z"}`)
	if err == nil {
		t.Fatal("expected validation error")
	}
	out := cuevalidator.FormatErrors(err)
	for _, fe := range out {
		if strings.Contains(fe.Message, "empty disjunction") {
			t.Errorf("wrapper should be dropped, but got: %q", fe.Message)
		}
	}
}

// TestFormatErrors_PreservesPath confirms the helper doesn't rewrite
// or truncate the CUE path — callers depend on the full path for
// their own prefix stripping.
func TestFormatErrors_PreservesPath(t *testing.T) {
	err := validate(t,
		`outer: { inner: { mode: "a" | "b" } }`,
		`{"outer": {"inner": {"mode": "z"}}}`,
	)
	if err == nil {
		t.Fatal("expected validation error")
	}
	out := cuevalidator.FormatErrors(err)
	if len(out) != 1 {
		t.Fatalf("expected 1 consolidated error, got %d: %#v", len(out), out)
	}
	wantSuffix := []string{"outer", "inner", "mode"}
	got := out[0].Path
	if len(got) < len(wantSuffix) {
		t.Fatalf("path %v shorter than expected suffix %v", got, wantSuffix)
	}
	tail := got[len(got)-len(wantSuffix):]
	for i := range wantSuffix {
		if tail[i] != wantSuffix[i] {
			t.Errorf("path tail %v != %v", tail, wantSuffix)
			break
		}
	}
}

// TestFormatErrors_DeduplicatesAllowedSet ensures the allowed-arm
// list is unique even when CUE reports the same arm via multiple
// unification branches.
func TestFormatErrors_DeduplicatesAllowedSet(t *testing.T) {
	err := validate(t,
		`mode: ("a" | "b") & ("a" | "c")`,
		`{"mode": "z"}`,
	)
	if err == nil {
		t.Fatal("expected validation error")
	}
	out := cuevalidator.FormatErrors(err)
	if len(out) == 0 {
		t.Fatal("expected at least one error")
	}
	msg := out[0].Message
	for _, lit := range []string{`"a"`, `"b"`, `"c"`} {
		if n := strings.Count(msg, lit); n > 1 {
			t.Errorf("literal %s appears %d times in %q; want at most 1", lit, n, msg)
		}
	}
}
