package httpclientprovider

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"slices"
	"strings"
	"syscall"

	sdkhttpclient "github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"

	"github.com/grafana/grafana/pkg/setting"
)

// ErrInternalAddress is the error for a datasource connection that the guard
// refuses.
var ErrInternalAddress = errors.New("datasource address is in a private or internal network")

// The guard refuses datasource connections to private and internal
// addresses. It checks the IP address that the socket connects to, after DNS
// resolution. A check of the saved URL is not sufficient: a public name can
// resolve to a private address, a DNS answer can change after the check, and a
// redirect can point anywhere. A redirect that the client follows dials
// through the same transport, so the guard checks it too.

// specialPrefixes are ranges that netip does not count as private but that
// must not be reached: carrier-grade NAT, which cloud networks and Kubernetes
// overlays use; "this network"; the IETF, test and benchmark ranges; the
// reserved IPv4 range; and the IPv6 ::/8 block, which holds the
// IPv4-compatible and NAT64 forms that reach an IPv4 host.
var specialPrefixes = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("::/8"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001:db8::/32"),
}

// isBlockedAddr reports whether a connection to addr must be refused.
func isBlockedAddr(addr netip.Addr) bool {
	// An IPv4 address written as IPv6 (::ffff:10.0.0.1) reaches the IPv4
	// host, so check it as IPv4.
	addr = addr.Unmap()
	return !addr.IsValid() ||
		addr.IsLoopback() ||
		addr.IsPrivate() ||
		addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() ||
		addr.IsInterfaceLocalMulticast() ||
		addr.IsMulticast() ||
		addr.IsUnspecified() ||
		slices.ContainsFunc(specialPrefixes, func(p netip.Prefix) bool {
			return p.Contains(addr)
		})
}

// internalAddressControl is a net.Dialer Control function. The dialer calls
// it after DNS resolution and before connect, once for each address it tries.
func internalAddressControl(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("%w: cannot parse %q", ErrInternalAddress, address)
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return fmt.Errorf("%w: cannot parse %q", ErrInternalAddress, address)
	}
	if isBlockedAddr(addr) {
		return fmt.Errorf("%w: refused %s", ErrInternalAddress, addr)
	}
	return nil
}

// internalAddressGuard sets a guarded dialer on the transport of each
// datasource that is not exempt.
type internalAddressGuard struct {
	exemptUIDs  map[string]struct{}
	exemptHosts map[string]struct{}
}

// newInternalAddressGuard returns nil when the guard is off.
func newInternalAddressGuard(cfg *setting.Cfg) *internalAddressGuard {
	if !cfg.DataProxyBlockInternalAddresses {
		return nil
	}
	g := &internalAddressGuard{
		exemptUIDs:  map[string]struct{}{},
		exemptHosts: map[string]struct{}{},
	}
	for _, uid := range cfg.DataProxyInternalAddressAllowedUIDs {
		g.exemptUIDs[uid] = struct{}{}
	}
	for _, host := range cfg.DataProxyInternalAddressAllowedHosts {
		g.exemptHosts[strings.ToLower(host)] = struct{}{}
	}
	return g
}

// configure changes the transport of a datasource client. A client without a
// datasource UID is not a datasource client, for example a plugin install or
// a usage report, so it keeps its transport.
func (g *internalAddressGuard) configure(opts sdkhttpclient.Options, transport *http.Transport) {
	if g == nil {
		return
	}
	uid, ok := opts.Labels["datasource_uid"]
	if !ok {
		return
	}

	// The guard checks the address that the socket connects to. With a
	// proxy from the environment, that is the proxy and not the datasource,
	// so a guarded datasource does not use one.
	transport.Proxy = nil

	timeouts := sdkhttpclient.DefaultTimeoutOptions
	if opts.Timeouts != nil {
		timeouts = *opts.Timeouts
	}
	guarded := &net.Dialer{
		Timeout:   timeouts.DialTimeout,
		KeepAlive: timeouts.KeepAlive,
		Control:   internalAddressControl,
	}

	_, uidExempt := g.exemptUIDs[uid]
	if !uidExempt {
		transport.DialContext = guarded.DialContext
		return
	}

	// An operator can run datasources inside the private network. A
	// datasource on the UID allow list reaches an internal address only
	// through a host name on the host allow list, because a UID alone does
	// not show who made the datasource. Every other host name is guarded.
	open := &net.Dialer{
		Timeout:   timeouts.DialTimeout,
		KeepAlive: timeouts.KeepAlive,
	}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, _, err := net.SplitHostPort(address)
		if err == nil {
			if _, ok := g.exemptHosts[strings.ToLower(host)]; ok {
				return open.DialContext(ctx, network, address)
			}
		}
		return guarded.DialContext(ctx, network, address)
	}
}
