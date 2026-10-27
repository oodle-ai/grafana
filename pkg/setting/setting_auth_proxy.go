package setting

import (
	"strings"

	"github.com/grafana/grafana/pkg/util"
)

type AuthProxySettings struct {
	// Auth Proxy
	Enabled          bool
	HeaderName       string
	HeaderProperty   string
	AutoSignUp       bool
	EnableLoginToken bool
	Whitelist        string
	Headers          map[string]string
	HeadersEncoded   bool
	SyncTTL          int

	// SecretHeader and Secrets let the auth proxy prove that a request came
	// through it. The accept list checks only the client address, which is
	// not enough when other clients on the same network can reach Grafana.
	// Two secrets allow a rotation without downtime. When RequireSecret is
	// false, a request without a valid secret is counted but still accepted,
	// so the proxy can start to send the secret before Grafana requires it.
	SecretHeader  string
	Secrets       []string
	RequireSecret bool
}

func (cfg *Cfg) readAuthProxySettings() {
	authProxySettings := AuthProxySettings{}
	authProxy := cfg.Raw.Section("auth.proxy")
	authProxySettings.Enabled = authProxy.Key("enabled").MustBool(false)
	authProxySettings.HeaderName = valueAsString(authProxy, "header_name", "")
	authProxySettings.HeaderProperty = valueAsString(authProxy, "header_property", "")
	authProxySettings.AutoSignUp = authProxy.Key("auto_sign_up").MustBool(true)
	authProxySettings.EnableLoginToken = authProxy.Key("enable_login_token").MustBool(false)
	authProxySettings.SyncTTL = authProxy.Key("sync_ttl").MustInt(15)
	authProxySettings.Whitelist = valueAsString(authProxy, "whitelist", "")
	authProxySettings.Headers = make(map[string]string)
	headers := valueAsString(authProxy, "headers", "")

	for _, propertyAndHeader := range util.SplitString(headers) {
		split := strings.SplitN(propertyAndHeader, ":", 2)
		if len(split) == 2 {
			authProxySettings.Headers[split[0]] = split[1]
		}
	}

	authProxySettings.HeadersEncoded = authProxy.Key("headers_encoded").MustBool(false)

	authProxySettings.SecretHeader = valueAsString(authProxy, "secret_header", "X-Grafana-Auth-Proxy-Secret")
	for _, key := range []string{"secret", "secret_alt"} {
		if secret := strings.TrimSpace(valueAsString(authProxy, key, "")); secret != "" {
			authProxySettings.Secrets = append(authProxySettings.Secrets, secret)
		}
	}
	authProxySettings.RequireSecret = authProxy.Key("require_secret").MustBool(false)

	cfg.AuthProxy = authProxySettings
}
