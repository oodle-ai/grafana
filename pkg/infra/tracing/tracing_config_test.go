package tracing

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"

	"github.com/grafana/grafana/pkg/setting"
)

// TODO(zserge) Add proper tests for opentelemetry

func TestSplitCustomAttribs(t *testing.T) {
	tests := []struct {
		input    string
		expected []attribute.KeyValue
	}{
		{
			input:    "key1:value:1",
			expected: []attribute.KeyValue{attribute.String("key1", "value:1")},
		},
		{
			input: "key1:value1,key2:value2",
			expected: []attribute.KeyValue{
				attribute.String("key1", "value1"),
				attribute.String("key2", "value2"),
			},
		},
		{
			input:    "",
			expected: []attribute.KeyValue{},
		},
	}

	for _, test := range tests {
		attribs, err := splitCustomAttribs(test.input)
		assert.NoError(t, err)
		assert.EqualValues(t, test.expected, attribs)
	}
}

func TestSplitCustomAttribs_Malformed(t *testing.T) {
	tests := []struct {
		input string
	}{
		{input: "key1=value1"},
		{input: "key1"},
	}

	for _, test := range tests {
		_, err := splitCustomAttribs(test.input)
		assert.Error(t, err)
	}
}

func TestTracingConfig(t *testing.T) {
	for _, test := range []struct {
		Name               string
		Cfg                string
		Env                map[string]string
		ExpectedExporter   string
		ExpectedAddress    string
		ExpectedInsecure   bool
		ExpectedPropagator string
		ExpectedAttrs      []attribute.KeyValue

		ExpectedSampler           string
		ExpectedSamplerParam      float64
		ExpectedSamplingServerURL string
	}{
		{
			Name:             "default config uses noop exporter",
			Cfg:              "",
			ExpectedExporter: noopExporter,
			ExpectedInsecure: true,
			ExpectedAttrs:    []attribute.KeyValue{},
		},
		{
			Name: "custom attributes are parsed",
			Cfg: `
			[tracing.opentelemetry]
			custom_attributes = key1:value1,key2:value2
			`,
			ExpectedExporter: noopExporter,
			ExpectedInsecure: true,
			ExpectedAttrs:    []attribute.KeyValue{attribute.String("key1", "value1"), attribute.String("key2", "value2")},
		},
		{
			Name: "jaeger address is parsed",
			Cfg: `
			[tracing.opentelemetry.jaeger]
			address = jaeger.example.com:6831
			`,
			ExpectedExporter: jaegerExporter,
			ExpectedAddress:  "jaeger.example.com:6831",
			ExpectedAttrs:    []attribute.KeyValue{},
		},
		{
			Name: "OTLP address is parsed",
			Cfg: `
			[tracing.opentelemetry.otlp]
			address = otlp.example.com:4317
			`,
			ExpectedExporter: otlpExporter,
			ExpectedAddress:  "otlp.example.com:4317",
			ExpectedInsecure: true,
			ExpectedAttrs:    []attribute.KeyValue{},
		},
		{
			Name: "OTLP insecure is parsed",
			Cfg: `
			[tracing.opentelemetry.otlp]
			address = otlp.example.com:4317
			insecure = false
			`,
			ExpectedExporter: otlpExporter,
			ExpectedAddress:  "otlp.example.com:4317",
			ExpectedInsecure: false,
			ExpectedAttrs:    []attribute.KeyValue{},
		},
		{
			Name: "legacy config format is supported",
			Cfg: `
			[tracing.jaeger]
			address = jaeger.example.com:6831
			`,
			ExpectedExporter: jaegerExporter,
			ExpectedAddress:  "jaeger.example.com:6831",
			ExpectedAttrs:    []attribute.KeyValue{},
		},
		{
			Name: "legacy env variables are supported",
			Cfg:  `[tracing.jaeger]`,
			Env: map[string]string{
				"JAEGER_AGENT_HOST": "example.com",
				"JAEGER_AGENT_PORT": "12345",
			},
			ExpectedExporter: jaegerExporter,
			ExpectedAddress:  "example.com:12345",
			ExpectedAttrs:    []attribute.KeyValue{},
		},
		{
			Name: "opentelemetry config format is prioritised over legacy jaeger",
			Cfg: `
			[tracing.jaeger]
			address = foo.com:6831
			custom_tags = a:b
			sampler_param = 0
			[tracing.opentelemetry]
			custom_attributes = c:d
			sampler_param = 1
			[tracing.opentelemetry.jaeger]
			address = bar.com:6831
			`,
			ExpectedExporter:     jaegerExporter,
			ExpectedAddress:      "bar.com:6831",
			ExpectedAttrs:        []attribute.KeyValue{attribute.String("c", "d")},
			ExpectedSamplerParam: 1.0,
		},
		{
			Name: "remote sampler config is parsed from otel config",
			Cfg: `
			[tracing.opentelemetry]
			sampler_type = remote
			sampler_param = 0.5
			sampling_server_url = http://example.com:5778/sampling
			[tracing.opentelemetry.otlp]
			address = otlp.example.com:4317
			`,
			ExpectedExporter:          otlpExporter,
			ExpectedAddress:           "otlp.example.com:4317",
			ExpectedInsecure:          true,
			ExpectedAttrs:             []attribute.KeyValue{},
			ExpectedSampler:           "remote",
			ExpectedSamplerParam:      0.5,
			ExpectedSamplingServerURL: "http://example.com:5778/sampling",
		},
	} {
		t.Run(test.Name, func(t *testing.T) {
			// export environment variables
			if test.Env != nil {
				for k, v := range test.Env {
					t.Setenv(k, v)
				}
			}
			// parse config sections
			cfg := setting.NewCfg()
			err := cfg.Raw.Append([]byte(test.Cfg))
			assert.NoError(t, err)
			// create tracingConfig
			tracingConfig, err := ProvideTracingConfig(cfg)
			assert.NoError(t, err)
			// make sure tracker is properly configured
			assert.Equal(t, test.ExpectedExporter, tracingConfig.enabled)
			assert.Equal(t, test.ExpectedAddress, tracingConfig.Address)
			assert.Equal(t, test.ExpectedPropagator, tracingConfig.Propagation)
			assert.Equal(t, test.ExpectedAttrs, tracingConfig.CustomAttribs)
			assert.Equal(t, test.ExpectedInsecure, tracingConfig.Insecure)

			if test.ExpectedSampler != "" {
				assert.Equal(t, test.ExpectedSampler, tracingConfig.Sampler)
				assert.Equal(t, test.ExpectedSamplerParam, tracingConfig.SamplerParam)
				assert.Equal(t, test.ExpectedSamplingServerURL, tracingConfig.SamplerRemoteURL)
			}
		})
	}
}

func TestSplitHeaders(t *testing.T) {
	tests := []struct {
		input    string
		expected map[string]string
	}{
		{
			input:    "",
			expected: map[string]string{},
		},
		{
			input:    "X-Tenant-Id=team-a",
			expected: map[string]string{"X-Tenant-Id": "team-a"},
		},
		{
			input: "X-Tenant-Id=team-a,X-Resource-Attrs=k8s.cluster.name=prod",
			expected: map[string]string{
				"X-Tenant-Id": "team-a",
				// Only the first "=" separates the pair, so a value
				// that is itself a key=value list survives intact.
				"X-Resource-Attrs": "k8s.cluster.name=prod",
			},
		},
		{
			input:    " X-Tenant-Id = team-a ",
			expected: map[string]string{"X-Tenant-Id": "team-a"},
		},
	}

	for _, test := range tests {
		headers, err := splitHeaders(test.input)
		assert.NoError(t, err)
		assert.EqualValues(t, test.expected, headers)
	}
}

func TestSplitHeaders_Malformed(t *testing.T) {
	_, err := splitHeaders("no-equals-sign")
	assert.Error(t, err)
}

func TestTracingConfig_OTLPHTTP(t *testing.T) {
	cfg := setting.NewCfg()
	err := cfg.Raw.Append([]byte(`
	[tracing.opentelemetry.otlphttp]
	address = collector:4318
	url_path = /v1/otlp/traces
	propagation = w3c
	headers = X-Tenant-Id=team-a
	`))
	assert.NoError(t, err)

	tracingCfg, err := ParseTracingConfig(cfg)
	assert.NoError(t, err)

	assert.Equal(t, otlpHTTPExporter, tracingCfg.enabled)
	assert.Equal(t, "collector:4318", tracingCfg.Address)
	assert.Equal(t, "/v1/otlp/traces", tracingCfg.URLPath)
	assert.Equal(t, "w3c", tracingCfg.Propagation)
	assert.Equal(
		t,
		map[string]string{"X-Tenant-Id": "team-a"},
		tracingCfg.Headers,
	)

	// External plugins build an OTLP gRPC client from the address, and
	// this address serves HTTP, so they must not be handed it.
	assert.False(t, tracingCfg.OTelExporterEnabled())
}

// The gRPC exporter keeps precedence, so an existing deployment that
// sets both is not silently moved onto the HTTP one.
func TestTracingConfig_OTLPTakesPrecedenceOverOTLPHTTP(t *testing.T) {
	cfg := setting.NewCfg()
	err := cfg.Raw.Append([]byte(`
	[tracing.opentelemetry.otlp]
	address = otel-collector:4317

	[tracing.opentelemetry.otlphttp]
	address = collector:4318
	`))
	assert.NoError(t, err)

	tracingCfg, err := ParseTracingConfig(cfg)
	assert.NoError(t, err)

	assert.Equal(t, otlpExporter, tracingCfg.enabled)
	assert.Equal(t, "otel-collector:4317", tracingCfg.Address)
}

// Configuration reaches this deployment as GF_* environment variables,
// not as an ini file. Grafana applies an override only to a key that
// already exists in the loaded ini, so a section absent from
// defaults.ini is silently ignored and the exporter stays disabled.
// Appending ini text in a test bypasses that mechanism entirely, so
// this case loads the real defaults instead.
func TestTracingConfig_OTLPHTTPFromEnvironment(t *testing.T) {
	t.Setenv("GF_TRACING_OPENTELEMETRY_OTLPHTTP_ADDRESS", "collector:4318")
	t.Setenv("GF_TRACING_OPENTELEMETRY_OTLPHTTP_URL_PATH", "/v1/otlp/traces")
	t.Setenv("GF_TRACING_OPENTELEMETRY_OTLPHTTP_HEADERS", "X-Tenant-Id=team-a")
	t.Setenv("GF_TRACING_OPENTELEMETRY_OTLPHTTP_PROPAGATION", "w3c")

	cfg := setting.NewCfg()
	require.NoError(t, cfg.Load(setting.CommandLineArgs{HomePath: "../../../"}))

	tracingCfg, err := ParseTracingConfig(cfg)
	require.NoError(t, err)

	assert.Equal(t, otlpHTTPExporter, tracingCfg.enabled)
	assert.Equal(t, "collector:4318", tracingCfg.Address)
	assert.Equal(t, "/v1/otlp/traces", tracingCfg.URLPath)
	assert.Equal(t, "w3c", tracingCfg.Propagation)
	assert.Equal(
		t,
		map[string]string{"X-Tenant-Id": "team-a"},
		tracingCfg.Headers,
	)
}
