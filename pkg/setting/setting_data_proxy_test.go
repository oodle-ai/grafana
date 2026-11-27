package setting

import (
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/ini.v1"
)

func TestInternalAddressGuardSettings(t *testing.T) {
	t.Run("the guard is off and the allow lists are empty by default", func(t *testing.T) {
		cfg := NewCfg()
		require.NoError(t, readDataProxySettings(ini.Empty(), cfg))
		require.False(t, cfg.DataProxyBlockInternalAddresses)
		require.Empty(t, cfg.DataProxyInternalAddressAllowedUIDs)
		require.Empty(t, cfg.DataProxyInternalAddressAllowedHosts)
	})

	t.Run("the settings can be changed", func(t *testing.T) {
		f := ini.Empty()
		sec, err := f.NewSection("dataproxy")
		require.NoError(t, err)
		_, err = sec.NewKey("block_internal_addresses", "true")
		require.NoError(t, err)
		_, err = sec.NewKey("internal_address_allowed_datasource_uids", "uid-a, uid-b")
		require.NoError(t, err)
		_, err = sec.NewKey("internal_address_allowed_hosts", "allowed.internal")
		require.NoError(t, err)

		cfg := NewCfg()
		require.NoError(t, readDataProxySettings(f, cfg))
		require.True(t, cfg.DataProxyBlockInternalAddresses)
		require.Equal(t, []string{"uid-a", "uid-b"}, cfg.DataProxyInternalAddressAllowedUIDs)
		require.Equal(t, []string{"allowed.internal"}, cfg.DataProxyInternalAddressAllowedHosts)
	})
}
