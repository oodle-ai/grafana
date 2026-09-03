package client

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestForwardedHeadersReachTheOutgoingRequest(t *testing.T) {
	ctx := WithForwardedHeaders(context.Background(), map[string]string{
		"X-Oodle-User-Email": "someone@example.com",
		"X-Dashboard-Uid":    "dash-uid-1",
		"X-Dashboard-Title":  "Service Overview",
		"X-Panel-Id":         "7",
		"X-Panel-Title":      "Request rate",
		"X-Query-Group-Id":   "group-1",
		"X-Datasource-Uid":   "ds-uid-1",
	})

	u, err := url.Parse("http://prometheus:9090/api/v1/query")
	require.NoError(t, err)

	req, err := createRequest(ctx, http.MethodPost, u, http.NoBody)
	require.NoError(t, err)

	require.Equal(t, "someone@example.com", req.Header.Get("X-Oodle-User-Email"))
	require.Equal(t, "dash-uid-1", req.Header.Get("X-Dashboard-Uid"))
	require.Equal(t, "Service Overview", req.Header.Get("X-Dashboard-Title"))
	require.Equal(t, "7", req.Header.Get("X-Panel-Id"))
	require.Equal(t, "Request rate", req.Header.Get("X-Panel-Title"))
	require.Equal(t, "group-1", req.Header.Get("X-Query-Group-Id"))
	require.Equal(t, "ds-uid-1", req.Header.Get("X-Datasource-Uid"))

	// The POST content type is set after the forwarded headers, so it
	// must survive them.
	require.Equal(
		t,
		"application/x-www-form-urlencoded",
		req.Header.Get("Content-Type"),
	)
}

// Only the named headers travel. Anything else Grafana puts on the
// query request stays there.
func TestForwardedHeadersAreAnAllowlist(t *testing.T) {
	ctx := WithForwardedHeaders(context.Background(), map[string]string{
		"X-Oodle-User-Email": "someone@example.com",
		"Authorization":      "Bearer secret",
		"Cookie":             "session=secret",
		"X-Grafana-Org-Id":   "3",
	})

	u, err := url.Parse("http://prometheus:9090/api/v1/query")
	require.NoError(t, err)

	req, err := createRequest(ctx, http.MethodGet, u, http.NoBody)
	require.NoError(t, err)

	require.Equal(t, "someone@example.com", req.Header.Get("X-Oodle-User-Email"))
	require.Empty(t, req.Header.Get("Authorization"))
	require.Empty(t, req.Header.Get("Cookie"))
	require.Empty(t, req.Header.Get("X-Grafana-Org-Id"))
}

// A forwarded copy of the trace context would be a second traceparent,
// which some datasources reject. The HTTP client writes the only one.
func TestTraceContextIsNotForwarded(t *testing.T) {
	ctx := WithForwardedHeaders(context.Background(), map[string]string{
		"traceparent": "00-0102030405060708090a0b0c0d0e0f10-0102030405060708-01",
		"Traceparent": "00-0102030405060708090a0b0c0d0e0f10-0102030405060708-01",
	})

	u, err := url.Parse("http://prometheus:9090/api/v1/query")
	require.NoError(t, err)

	req, err := createRequest(ctx, http.MethodGet, u, http.NoBody)
	require.NoError(t, err)

	require.Empty(t, req.Header.Get("Traceparent"))
}

func TestForwardedHeadersSkipsEmptyValues(t *testing.T) {
	ctx := WithForwardedHeaders(context.Background(), map[string]string{
		"X-Oodle-User-Email": "",
		"X-Dashboard-Uid":    "dash-uid-1",
	})

	u, err := url.Parse("http://prometheus:9090/api/v1/query")
	require.NoError(t, err)

	req, err := createRequest(ctx, http.MethodGet, u, http.NoBody)
	require.NoError(t, err)

	require.NotContains(t, req.Header, "X-Oodle-User-Email")
	require.Equal(t, "dash-uid-1", req.Header.Get("X-Dashboard-Uid"))
}

// A request built without the values on its context must still work.
func TestRequestWithoutForwardedHeaders(t *testing.T) {
	u, err := url.Parse("http://prometheus:9090/api/v1/query")
	require.NoError(t, err)

	req, err := createRequest(context.Background(), http.MethodGet, u, http.NoBody)
	require.NoError(t, err)
	require.NotNil(t, req)
}
