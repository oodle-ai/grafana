package httpclientprovider

import (
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"

	sdkhttpclient "github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/stretchr/testify/require"

	"github.com/grafana/grafana/pkg/infra/tracing"
	"github.com/grafana/grafana/pkg/services/validations"
	"github.com/grafana/grafana/pkg/setting"
)

const (
	exemptUID = "allowed-uid"
	// The test servers listen on 127.0.0.1. "localhost" stands in for an
	// allowed internal host name, and the IP address for every other host
	// name.
	exemptHost = "localhost"
)

func guardedProvider(t *testing.T, enabled bool) *sdkhttpclient.Provider {
	t.Helper()
	cfg := &setting.Cfg{
		DataProxyBlockInternalAddresses:      enabled,
		DataProxyInternalAddressAllowedUIDs:  []string{exemptUID},
		DataProxyInternalAddressAllowedHosts: []string{exemptHost},
	}
	return New(cfg, &validations.OSSDataSourceRequestURLValidator{}, tracing.InitializeTracerForTest())
}

func datasourceClient(t *testing.T, p *sdkhttpclient.Provider, labels map[string]string) *http.Client {
	t.Helper()
	client, err := p.New(sdkhttpclient.Options{Labels: labels})
	require.NoError(t, err)
	return client
}

func okServer(t *testing.T) (*httptest.Server, *bool) {
	t.Helper()
	reached := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv, &reached
}

func localhostURL(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	_, port, err := net.SplitHostPort(srv.Listener.Addr().String())
	require.NoError(t, err)
	return "http://" + exemptHost + ":" + port
}

func get(client *http.Client, url string) error {
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	return resp.Body.Close()
}

func TestInternalAddressGuard(t *testing.T) {
	t.Run("a datasource cannot reach an internal address", func(t *testing.T) {
		srv, reached := okServer(t)
		client := datasourceClient(t, guardedProvider(t, true), map[string]string{
			"datasource_uid":  "other-uid",
			"datasource_name": "other",
		})

		err := get(client, srv.URL)
		require.Error(t, err)
		require.True(t, errors.Is(err, ErrInternalAddress), err)
		require.False(t, *reached)
	})

	t.Run("an exempt datasource reaches an internal address through an allowed host", func(t *testing.T) {
		srv, reached := okServer(t)
		client := datasourceClient(t, guardedProvider(t, true), map[string]string{
			"datasource_uid":  exemptUID,
			"datasource_name": "allowed",
		})

		require.NoError(t, get(client, localhostURL(t, srv)))
		require.True(t, *reached)
	})

	t.Run("an exempt datasource cannot reach an internal address through another host", func(t *testing.T) {
		srv, reached := okServer(t)
		client := datasourceClient(t, guardedProvider(t, true), map[string]string{
			"datasource_uid": exemptUID,
		})

		err := get(client, srv.URL)
		require.True(t, errors.Is(err, ErrInternalAddress), err)
		require.False(t, *reached)
	})

	t.Run("a redirect to an internal address is refused", func(t *testing.T) {
		target, reached := okServer(t)
		redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, target.URL, http.StatusFound)
		}))
		t.Cleanup(redirector.Close)

		// The first hop goes through the allowed host, so only the guard on
		// the redirect can stop the second hop.
		client := datasourceClient(t, guardedProvider(t, true), map[string]string{
			"datasource_uid": exemptUID,
		})

		err := get(client, localhostURL(t, redirector))
		require.True(t, errors.Is(err, ErrInternalAddress), err)
		require.False(t, *reached)
	})

	t.Run("a client that is not for a datasource keeps its transport", func(t *testing.T) {
		srv, reached := okServer(t)
		client := datasourceClient(t, guardedProvider(t, true), nil)

		require.NoError(t, get(client, srv.URL))
		require.True(t, *reached)
	})

	t.Run("the guard can be turned off", func(t *testing.T) {
		srv, reached := okServer(t)
		client := datasourceClient(t, guardedProvider(t, false), map[string]string{
			"datasource_uid": "other-uid",
		})

		require.NoError(t, get(client, srv.URL))
		require.True(t, *reached)
	})

	t.Run("the transport from GetTransport is guarded too", func(t *testing.T) {
		srv, reached := okServer(t)
		rt, err := guardedProvider(t, true).GetTransport(sdkhttpclient.Options{
			Labels: map[string]string{"datasource_uid": "other-uid"},
		})
		require.NoError(t, err)

		err = get(&http.Client{Transport: rt}, srv.URL)
		require.True(t, errors.Is(err, ErrInternalAddress), err)
		require.False(t, *reached)
	})
}

func TestIsBlockedAddr(t *testing.T) {
	cases := map[string]bool{
		"127.0.0.1":        true,
		"10.1.2.3":         true,
		"172.16.0.1":       true,
		"192.168.1.1":      true,
		"169.254.169.254":  true,
		"100.64.0.10":      true,
		"0.0.0.0":          true,
		"::1":              true,
		"fd00::1":          true,
		"fe80::1":          true,
		"::ffff:10.0.0.1":  true,
		"::ffff:127.0.0.1": true,
		"64:ff9b:1::a00:1": true,
		"8.8.8.8":          false,
		"1.1.1.1":          false,
		"2606:4700::1111":  false,
	}
	for ip, blocked := range cases {
		require.Equal(t, blocked, isBlockedAddr(netip.MustParseAddr(ip)), ip)
	}
}
