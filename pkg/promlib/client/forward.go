package client

import (
	"context"
	"net/http"
)

// forwardedHeaders are the request headers Grafana copies onto the
// query it sends to the datasource.
//
// They name the person and the panel a query belongs to. Grafana knows
// both, and the query backends know neither: a query reaches them as
// PromQL and a tenant, several hops after the proxy that authenticated
// the caller. Without these the backend traces can report how long a
// query took but not who waited on it or which dashboard it was on.
//
// Trace context is deliberately absent. The tracing middleware in
// Grafana's HTTP client already writes exactly one traceparent onto the
// outgoing request, and a forwarded copy would make two, which some
// datasources reject.
var forwardedHeaders = []string{
	"X-Oodle-User-Email",
	"X-Dashboard-Uid",
	"X-Dashboard-Title",
	"X-Panel-Id",
	"X-Panel-Title",
	"X-Query-Group-Id",
	"X-Datasource-Uid",
}

// forwardedHeadersCtxKey types the context value below. It is
// unexported so that only WithForwardedHeaders can set it.
type forwardedHeadersCtxKey struct{}

// WithForwardedHeaders carries the headers to forward down to the code
// that builds the outgoing request.
//
// The headers arrive on the query request, but the request is built
// several calls deeper, and those calls are handed only a context.
func WithForwardedHeaders(
	ctx context.Context,
	headers map[string]string,
) context.Context {
	if len(headers) == 0 {
		return ctx
	}

	forward := make(map[string]string, len(forwardedHeaders))
	for _, name := range forwardedHeaders {
		// Header names arrive in the canonical form Grafana wrote them
		// in, but a map lookup is exact, so read both.
		if value, ok := headers[name]; ok && value != "" {
			forward[name] = value
			continue
		}
		if value, ok := headers[http.CanonicalHeaderKey(name)]; ok && value != "" {
			forward[name] = value
		}
	}

	if len(forward) == 0 {
		return ctx
	}

	return context.WithValue(ctx, forwardedHeadersCtxKey{}, forward)
}

// applyForwardedHeaders writes the headers WithForwardedHeaders put on
// ctx onto the outgoing request.
func applyForwardedHeaders(ctx context.Context, request *http.Request) {
	headers, ok := ctx.Value(forwardedHeadersCtxKey{}).(map[string]string)
	if !ok {
		return
	}

	for name, value := range headers {
		request.Header.Set(name, value)
	}
}
