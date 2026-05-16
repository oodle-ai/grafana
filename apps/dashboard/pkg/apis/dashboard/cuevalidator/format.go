package cuevalidator

import (
	"fmt"
	"sort"
	"strings"

	cueerrors "cuelang.org/go/cue/errors"
)

// FormattedError is a single validation error extracted from CUE's raw
// error tree. Callers translate FormattedError.Path into whatever shape
// their public API expects (for example a Kubernetes field.Path with
// the schema prefix stripped).
type FormattedError struct {
	// Path is the raw CUE path of the offending field.
	Path []string
	// Message is a single-line, caller-friendly description of the
	// failure.
	Message string
}

// Format-string identifiers used by the CUE evaluator. Each kind of
// error CUE emits carries a stable format string (the literal passed
// to its error constructor) which we use as a discriminator. Matching
// on the identifier is robust to changes in the rendered message
// because the constants themselves are what CUE compares against
// internally when building the error.
//
// If CUE ever changes a format string in a new release, the
// TestFormatStringsAreStable test below fails loudly, with a one-line
// fix: update the constant.
const (
	// "N errors in empty disjunction:" — a synthetic wrapper emitted
	// alongside per-arm child errors. Carries no information beyond
	// what its children carry.
	emptyDisjunctionFmt = "%d errors in empty disjunction:"

	// `conflicting values "thresholds" and "continuous-BlGrOr"`
	// — what CUE emits per arm of a string-literal disjunction (also
	// per arm of struct disjunctions, but in that case args[0] is
	// typically a struct value, not a string, so we don't mis-match).
	conflictingValuesFmt = "conflicting values %s and %s"
)

// FormatErrors converts a raw CUE validation error into a list of
// caller-friendly errors. It performs two structural transformations
// and otherwise leaves CUE errors alone:
//
//  1. Drops the synthetic "N errors in empty disjunction:" wrapper.
//     The wrapper carries no information beyond the per-arm child
//     errors, so on its own it is just noise.
//
//  2. Consolidates per-arm "conflicting values" errors. When a string
//     value fails one arm of a string-literal disjunction, CUE emits
//     one error per arm. We bucket these by path, verify they all
//     share the same actual (right-hand) value, and emit a single
//     `"X" is not one of [A, B, …]` message listing the allowed arms
//     in sorted order. This collapses fifteen "conflicting values"
//     lines for a typo'd FieldColorModeId into one.
//
// Errors that don't match either of those patterns — type mismatches,
// "field not allowed", missing required fields, struct-arm disjunction
// failures whose args aren't both strings — pass through unchanged.
//
// Detection is structural: we discriminate on the error's format
// string (a stable identifier inside CUE's error constructors) and
// read the already-typed Msg() args, rather than parsing the rendered
// message text.
func FormatErrors(err error) []FormattedError {
	if err == nil {
		return nil
	}

	// A bucket collects everything CUE reported at a single path so
	// we can consolidate the string-enum subset.
	type bucket struct {
		order   int
		path    []string
		actual  string           // shared RHS across enum-arm errors
		allowed []string         // collected LHS values (one per arm)
		passes  []FormattedError // anything we couldn't consolidate
	}
	buckets := map[string]*bucket{}
	keyOf := func(p []string) string { return strings.Join(p, "\x00") }
	order := 0

	for _, e := range cueerrors.Errors(err) {
		format, args := e.Msg()

		// Drop the synthetic wrapper unconditionally.
		if format == emptyDisjunctionFmt {
			continue
		}

		path := append([]string(nil), e.Path()...)
		key := keyOf(path)
		b, ok := buckets[key]
		if !ok {
			b = &bucket{order: order, path: path}
			buckets[key] = b
			order++
		}

		// Detect a string-enum arm error structurally: same format
		// string, two args, both already typed as plain Go strings.
		// CUE's string-arg formatting includes the surrounding quotes
		// in the value, so the strings look like `"thresholds"` —
		// preserve that exactly in the consolidated output so it
		// matches what the caller would otherwise have seen.
		if format == conflictingValuesFmt && len(args) == 2 {
			lhs, lok := args[0].(string)
			rhs, rok := args[1].(string)
			if lok && rok {
				if b.actual == "" {
					b.actual = rhs
				}
				if b.actual == rhs {
					b.allowed = append(b.allowed, lhs)
					continue
				}
			}
		}

		// Anything else: pass through verbatim, using CUE's own
		// rendering of the format + args.
		b.passes = append(b.passes, FormattedError{
			Path:    path,
			Message: fmt.Sprintf(format, args...),
		})
	}

	ordered := make([]*bucket, 0, len(buckets))
	for _, b := range buckets {
		ordered = append(ordered, b)
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].order < ordered[j].order })

	out := make([]FormattedError, 0)
	for _, b := range ordered {
		if len(b.allowed) > 0 {
			seen := make(map[string]struct{}, len(b.allowed))
			uniq := make([]string, 0, len(b.allowed))
			for _, v := range b.allowed {
				if _, dup := seen[v]; dup {
					continue
				}
				seen[v] = struct{}{}
				uniq = append(uniq, v)
			}
			sort.Strings(uniq)
			out = append(out, FormattedError{
				Path: b.path,
				Message: fmt.Sprintf(
					"%s is not one of [%s]",
					b.actual,
					strings.Join(uniq, ", "),
				),
			})
		}
		out = append(out, b.passes...)
	}
	return out
}
