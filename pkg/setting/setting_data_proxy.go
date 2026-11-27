package setting

import (
	"fmt"

	"gopkg.in/ini.v1"

	"github.com/grafana/grafana/pkg/util"
)

const defaultDataProxyRowLimit = int64(1000000)

func readDataProxySettings(iniFile *ini.File, cfg *Cfg) error {
	dataproxy := iniFile.Section("dataproxy")
	cfg.SendUserHeader = dataproxy.Key("send_user_header").MustBool(false)
	cfg.DataProxyLogging = dataproxy.Key("logging").MustBool(false)
	cfg.DataProxyTimeout = dataproxy.Key("timeout").MustInt(30)
	cfg.DataProxyDialTimeout = dataproxy.Key("dialTimeout").MustInt(10)
	cfg.DataProxyKeepAlive = dataproxy.Key("keep_alive_seconds").MustInt(30)
	cfg.DataProxyTLSHandshakeTimeout = dataproxy.Key("tls_handshake_timeout_seconds").MustInt(10)
	cfg.DataProxyExpectContinueTimeout = dataproxy.Key("expect_continue_timeout_seconds").MustInt(1)
	cfg.DataProxyMaxConnsPerHost = dataproxy.Key("max_conns_per_host").MustInt(0)
	cfg.DataProxyMaxIdleConns = dataproxy.Key("max_idle_connections").MustInt()
	cfg.DataProxyIdleConnTimeout = dataproxy.Key("idle_conn_timeout_seconds").MustInt(90)
	cfg.ResponseLimit = dataproxy.Key("response_limit").MustInt64(0)
	cfg.DataProxyRowLimit = dataproxy.Key("row_limit").MustInt64(defaultDataProxyRowLimit)
	cfg.DataProxyUserAgent = dataproxy.Key("user_agent").String()

	cfg.DataProxyBlockInternalAddresses = dataproxy.Key("block_internal_addresses").MustBool(false)
	cfg.DataProxyInternalAddressAllowedUIDs = util.SplitString(
		dataproxy.Key("internal_address_allowed_datasource_uids").String(),
	)
	cfg.DataProxyInternalAddressAllowedHosts = util.SplitString(
		dataproxy.Key("internal_address_allowed_hosts").String(),
	)

	if cfg.DataProxyUserAgent == "" {
		cfg.DataProxyUserAgent = fmt.Sprintf("Grafana/%s", BuildVersion)
	}

	if cfg.DataProxyRowLimit <= 0 {
		cfg.DataProxyRowLimit = defaultDataProxyRowLimit
	}

	return nil
}
