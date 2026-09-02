package tracing

import (
	"fmt"
	"os"
	"strings"

	"go.opentelemetry.io/otel/attribute"

	"github.com/grafana/grafana/pkg/setting"
)

type TracingConfig struct {
	enabled       string
	Address       string
	Propagation   string
	CustomAttribs []attribute.KeyValue

	// URLPath and Headers apply to the OTLP-over-HTTP exporter only.
	// A collector that identifies the caller from a request header needs
	// an exporter that can send one.
	URLPath string
	Headers map[string]string

	Sampler          string
	SamplerParam     float64
	SamplerRemoteURL string

	ServiceName    string
	ServiceVersion string

	ProfilingIntegration bool
	Insecure             bool
}

func ProvideTracingConfig(cfg *setting.Cfg) (*TracingConfig, error) {
	return ParseTracingConfig(cfg)
}

func NewEmptyTracingConfig() *TracingConfig {
	return &TracingConfig{
		CustomAttribs: []attribute.KeyValue{},
	}
}

func NewJaegerTracingConfig(address string, propagation string) (*TracingConfig, error) {
	if address == "" {
		return nil, fmt.Errorf("address cannot be empty")
	}

	cfg := NewEmptyTracingConfig()
	cfg.enabled = jaegerExporter
	cfg.Address = address
	cfg.Propagation = propagation
	return cfg, nil
}

func NewOTLPTracingConfig(address string, propagation string, insecure bool) (*TracingConfig, error) {
	if address == "" {
		return nil, fmt.Errorf("address cannot be empty")
	}

	cfg := NewEmptyTracingConfig()
	cfg.enabled = otlpExporter
	cfg.Address = address
	cfg.Propagation = propagation
	cfg.Insecure = insecure
	return cfg, nil
}

func ParseTracingConfig(cfg *setting.Cfg) (*TracingConfig, error) {
	if cfg == nil {
		return nil, fmt.Errorf("cfg cannot be nil")
	}
	tc := NewEmptyTracingConfig()
	tc.ServiceName = "grafana"
	tc.ServiceVersion = cfg.BuildVersion

	legacyAddress, legacyTags := "", ""
	if section, err := cfg.Raw.GetSection("tracing.jaeger"); err == nil {
		legacyAddress = section.Key("address").MustString("")
		if legacyAddress == "" {
			host, port := os.Getenv(envJaegerAgentHost), os.Getenv(envJaegerAgentPort)
			if host != "" || port != "" {
				legacyAddress = fmt.Sprintf("%s:%s", host, port)
			}
		}
		legacyTags = section.Key("always_included_tag").MustString("")
		tc.Sampler = section.Key("sampler_type").MustString("")
		tc.SamplerParam = section.Key("sampler_param").MustFloat64(1)
		tc.SamplerRemoteURL = section.Key("sampling_server_url").MustString("")
	}
	section := cfg.Raw.Section("tracing.opentelemetry")
	var err error
	// we default to legacy tag set (attributes) if the new config format is absent
	tc.CustomAttribs, err = splitCustomAttribs(section.Key("custom_attributes").MustString(legacyTags))
	if err != nil {
		return nil, err
	}

	// Allow overriding service name via configuration
	serviceName := section.Key("service_name").MustString("")
	if serviceName != "" {
		tc.ServiceName = serviceName
	}

	// if sampler_type is set in tracing.opentelemetry, we ignore the config in tracing.jaeger
	sampler := section.Key("sampler_type").MustString("")
	if sampler != "" {
		tc.Sampler = sampler
	}

	samplerParam := section.Key("sampler_param").MustFloat64(0)
	if samplerParam != 0 {
		tc.SamplerParam = samplerParam
	}

	samplerRemoteURL := section.Key("sampling_server_url").MustString("")
	if samplerRemoteURL != "" {
		tc.SamplerRemoteURL = samplerRemoteURL
	}

	section = cfg.Raw.Section("tracing.opentelemetry.jaeger")
	tc.enabled = noopExporter

	// we default to legacy Jaeger agent address if the new config value is empty
	tc.Address = section.Key("address").MustString(legacyAddress)
	tc.Propagation = section.Key("propagation").MustString("")
	if tc.Address != "" {
		tc.enabled = jaegerExporter
		return tc, nil
	}

	section = cfg.Raw.Section("tracing.opentelemetry.otlp")
	tc.Address = section.Key("address").MustString("")
	if tc.Address != "" {
		tc.enabled = otlpExporter
	}
	tc.Propagation = section.Key("propagation").MustString("")
	tc.Insecure = section.Key("insecure").MustBool(true)
	if tc.enabled == otlpExporter {
		return tc, nil
	}

	// OTLP over HTTP. Used where the collector serves no gRPC port, or
	// where the export needs a request header the gRPC exporter cannot
	// send.
	section = cfg.Raw.Section("tracing.opentelemetry.otlphttp")
	address := section.Key("address").MustString("")
	if address == "" {
		return tc, nil
	}

	tc.enabled = otlpHTTPExporter
	tc.Address = address
	// Left empty the exporter posts to the path the OpenTelemetry
	// specification names, which the receiver also serves.
	tc.URLPath = section.Key("url_path").MustString("")
	tc.Headers, err = splitHeaders(section.Key("headers").MustString(""))
	if err != nil {
		return nil, err
	}
	if propagation := section.Key("propagation").MustString(""); propagation != "" {
		tc.Propagation = propagation
	}
	tc.Insecure = section.Key("insecure").MustBool(true)

	return tc, nil
}

// splitHeaders reads a comma-separated list of key=value pairs into the
// headers the OTLP-over-HTTP exporter sends on every export.
func splitHeaders(s string) (map[string]string, error) {
	headers := map[string]string{}
	if s == "" {
		return headers, nil
	}

	for _, pair := range strings.Split(s, ",") {
		if pair == "" {
			continue
		}

		parts := strings.SplitN(pair, "=", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("tracing header malformed - must be in 'key=value' form: %q", pair)
		}

		headers[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
	}

	return headers, nil
}

// OTelExporterEnabled reports whether external plugins should be given
// this tracing configuration. It stays false for the OTLP-over-HTTP
// exporter: plugins build an OTLP gRPC client from the address, and the
// HTTP endpoint is not one. Core datasources are unaffected, since they
// run in process and use the global tracer.
func (tc TracingConfig) OTelExporterEnabled() bool {
	return tc.enabled == otlpExporter
}

func splitCustomAttribs(s string) ([]attribute.KeyValue, error) {
	res := []attribute.KeyValue{}

	attribs := strings.Split(s, ",")
	for _, v := range attribs {
		parts := strings.SplitN(v, ":", 2)
		if len(parts) > 1 {
			res = append(res, attribute.String(parts[0], parts[1]))
		} else if v != "" {
			return nil, fmt.Errorf("custom attribute malformed - must be in 'key:value' form: %q", v)
		}
	}

	return res, nil
}
