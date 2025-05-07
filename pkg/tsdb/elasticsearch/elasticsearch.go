package elasticsearch

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	jsoniter "github.com/json-iterator/go"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	exp "github.com/grafana/grafana-plugin-sdk-go/experimental/errorsource"
	exphttpclient "github.com/grafana/grafana-plugin-sdk-go/experimental/errorsource/httpclient"

	es "github.com/grafana/grafana/pkg/tsdb/elasticsearch/client"
)

const (
	// headerFromExpression is used by data sources to identify expression queries
	headerFromExpression = "X-Grafana-From-Expr"
	// headerFromAlert is used by data sources to identify alert queries
	headerFromAlert = "FromAlert"
	// this is the default value for the maxConcurrentShardRequests setting - it should be in sync with the default value in the datasource config settings
	defaultMaxConcurrentShardRequests = int64(5)
)

type Service struct {
	im     instancemgmt.InstanceManager
	logger log.Logger
}

func ProvideService(httpClientProvider *httpclient.Provider) *Service {
	return &Service{
		im:     datasource.NewInstanceManager(newInstanceSettings(httpClientProvider)),
		logger: backend.NewLoggerWith("logger", "tsdb.elasticsearch"),
	}
}

func (s *Service) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	dsInfo, err := s.getDSInfo(ctx, req.PluginContext)
	_, fromAlert := req.Headers[headerFromAlert]
	logger := s.logger.FromContext(ctx).With("fromAlert", fromAlert)

	if err != nil {
		logger.Error("Failed to get data source info", "error", err)
		return &backend.QueryDataResponse{}, err
	}

	return queryData(ctx, req, dsInfo, logger)
}

// separate function to allow testing the whole transformation and query flow
func queryData(ctx context.Context, req *backend.QueryDataRequest, dsInfo *es.DatasourceInfo, logger log.Logger) (*backend.QueryDataResponse, error) {
	if len(req.Queries) == 0 {
		return &backend.QueryDataResponse{}, fmt.Errorf("query contains no queries")
	}

	client, err := es.NewClient(ctx, dsInfo, logger)
	if err != nil {
		return &backend.QueryDataResponse{}, err
	}
	query := newElasticsearchDataQuery(ctx, client, req, logger)
	return query.execute()
}

func newInstanceSettings(httpClientProvider *httpclient.Provider) datasource.InstanceFactoryFunc {
	return func(ctx context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
		jsonData := map[string]any{}
		err := json.Unmarshal(settings.JSONData, &jsonData)
		if err != nil {
			return nil, fmt.Errorf("error reading settings: %w", err)
		}
		httpCliOpts, err := settings.HTTPClientOptions(ctx)
		if err != nil {
			return nil, fmt.Errorf("error getting http options: %w", err)
		}

		js, _ := jsoniter.Marshal(httpCliOpts.Header)
		js2, _ := jsoniter.Marshal(httpCliOpts.BasicAuth)
		fmt.Println("ASDASDASD HTTP CLIENT OPTIONS HEADER", string(js))
		fmt.Println("ASDASDASD HTTP CLIENT OPTIONS AUTH", string(js2))

		// Set SigV4 service namespace
		if httpCliOpts.SigV4 != nil {
			httpCliOpts.SigV4.Service = "es"
		}

		// set the default middlewars from the httpClientProvider
		httpCliOpts.Middlewares = httpClientProvider.Opts.Middlewares
		// enable experimental http client to support errors with source
		httpCli, err := exphttpclient.New(httpCliOpts)
		if err != nil {
			return nil, err
		}

		// we used to have a field named `esVersion`, please do not use this name in the future.

		timeField, ok := jsonData["timeField"].(string)
		if !ok {
			return nil, exp.DownstreamError(errors.New("timeField cannot be cast to string"), false)
		}

		if timeField == "" {
			return nil, exp.DownstreamError(errors.New("elasticsearch time field name is required"), false)
		}

		logLevelField, ok := jsonData["logLevelField"].(string)
		if !ok {
			logLevelField = ""
		}

		logMessageField, ok := jsonData["logMessageField"].(string)
		if !ok {
			logMessageField = ""
		}

		interval, ok := jsonData["interval"].(string)
		if !ok {
			interval = ""
		}

		index, ok := jsonData["index"].(string)
		if !ok {
			index = ""
		}
		if index == "" {
			index = settings.Database
		}

		var maxConcurrentShardRequests int64

		switch v := jsonData["maxConcurrentShardRequests"].(type) {
		// unmarshalling from JSON will return float64 for numbers, so we need to handle that and convert to int64
		case float64:
			maxConcurrentShardRequests = int64(v)
		case string:
			maxConcurrentShardRequests, err = strconv.ParseInt(v, 10, 64)
			if err != nil {
				maxConcurrentShardRequests = defaultMaxConcurrentShardRequests
			}
		default:
			maxConcurrentShardRequests = defaultMaxConcurrentShardRequests
		}

		if maxConcurrentShardRequests <= 0 {
			maxConcurrentShardRequests = defaultMaxConcurrentShardRequests
		}

		includeFrozen, ok := jsonData["includeFrozen"].(bool)
		if !ok {
			includeFrozen = false
		}

		configuredFields := es.ConfiguredFields{
			TimeField:       timeField,
			LogLevelField:   logLevelField,
			LogMessageField: logMessageField,
		}

		model := es.DatasourceInfo{
			ID:                         settings.ID,
			URL:                        settings.URL,
			HTTPClient:                 httpCli,
			Database:                   index,
			MaxConcurrentShardRequests: maxConcurrentShardRequests,
			ConfiguredFields:           configuredFields,
			Interval:                   interval,
			IncludeFrozen:              includeFrozen,
		}
		return model, nil
	}
}

func (s *Service) getDSInfo(ctx context.Context, pluginCtx backend.PluginContext) (*es.DatasourceInfo, error) {
	i, err := s.im.Get(ctx, pluginCtx)
	if err != nil {
		return nil, err
	}

	instance := i.(es.DatasourceInfo)

	return &instance, nil
}

func (s *Service) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	logger := s.logger.FromContext(ctx)
	// allowed paths for resource calls:
	// - empty string for fetching db version
	// - /_mapping for fetching index mapping, e.g. requests going to `index/_mapping`
	// - _msearch for executing getTerms queries
	// - _mapping for fetching "root" index mappings
	if req.Path != "" && !strings.HasSuffix(req.Path, "/_mapping") && req.Path != "_msearch" && req.Path != "_mapping" {
		logger.Error("Invalid resource path", "path", req.Path)
		return fmt.Errorf("invalid resource URL: %s", req.Path)
	}

	ds, err := s.getDSInfo(ctx, req.PluginContext)
	if err != nil {
		logger.Error("Failed to get data source info", "error", err)
		return err
	}

	esUrl, err := createElasticsearchURL(req, ds)
	if err != nil {
		logger.Error("Failed to create request url", "error", err, "url", ds.URL, "path", req.Path)
	}

	// Add detailed logging of the constructed URL
	logger.Debug("Constructed Elasticsearch URL",
		"url", esUrl,
		"originalUrl", ds.URL,
		"path", req.Path,
		"method", req.Method)

	request, err := http.NewRequestWithContext(ctx, req.Method, esUrl, bytes.NewBuffer(req.Body))

	//var request *http.Request
	//if req.Method == http.MethodGet {
	//	request, err = http.NewRequestWithContext(ctx, req.Method, esUrl, nil)
	//} else {
	//	request, err = http.NewRequestWithContext(ctx, req.Method, esUrl, bytes.NewBuffer(req.Body))
	//}
	if err != nil {
		logger.Error("Failed to create request", "error", err, "url", esUrl)
		return err
	}

	// Log request details
	logger.Debug("Request details",
		"method", request.Method,
		"url", request.URL.String(),
		"headers", request.Header,
		"contentLength", request.ContentLength)

	pluginCtx, _ := jsoniter.Marshal(req.PluginContext)
	fmt.Println("ASDASDASD PLUGIN CONTEXT", string(pluginCtx))

	logger.Debug("Sending request to Elasticsearch", "resourcePath", req.Path)
	oheaders, _ := jsoniter.Marshal(req.Headers)
	headers, _ := jsoniter.Marshal(request.Header)
	fmt.Println(
		"ASDASDASD Received request for ElasticSearch",
		"resourcePath", req.Path,
		"body", req.Body,
		"url", req.URL,
		"method", req.Method,
		"headers", string(oheaders),
	)

	fmt.Println(
		"ASDASDASD Sending request to Elasticsearch",
		ds.HTTPClient,
		request.URL.String(),
		"method", request.Method,
		"contentLength", request.ContentLength,
		"requestUri", request.RequestURI,
		"remoteAddr", request.RemoteAddr,
		"proto", request.Proto,
		"protoMajor", request.ProtoMajor,
		"protoMinor", request.ProtoMinor,
		"trailer", request.Trailer,
		"host", request.Host,
		"referer", request.Referer(),
		"headers", string(headers),
	)
	start := time.Now()
	response, err := ds.HTTPClient.Do(request)
	if err != nil {
		status := "error"
		if errors.Is(err, context.Canceled) {
			status = "cancelled"
		}
		lp := []any{"error", err, "status", status, "duration", time.Since(start), "stage", es.StageDatabaseRequest, "resourcePath", req.Path}
		sourceErr := exp.Error{}
		if errors.As(err, &sourceErr) {
			lp = append(lp, "statusSource", sourceErr.Source())
		}
		if response != nil {
			lp = append(lp, "statusCode", response.StatusCode)
		}
		logger.Error("Error received from Elasticsearch", lp...)
		return err
	}

	// Add retry logic for 400 Bad Request
	if response.StatusCode == http.StatusBadRequest {
		// Read the response body to get more details about the error
		body, err := io.ReadAll(response.Body)
		if err != nil {
			logger.Error("Failed to read error response body", "error", err)
		} else {
			logger.Error("Bad Request response from Elasticsearch",
				"statusCode", response.StatusCode,
				"body", string(body),
				"url", request.URL.String())
		}
		response.Body.Close()

		// Retry the request once after a short delay
		time.Sleep(100 * time.Millisecond)
		response, err = ds.HTTPClient.Do(request)
		if err != nil {
			logger.Error("Error on retry request", "error", err)
			return err
		}
		if response.StatusCode == http.StatusBadRequest {
			logger.Error("Bad Request persisted after retry",
				"statusCode", response.StatusCode,
				"url", request.URL.String())
		}
	}

	logger.Info("Response received from Elasticsearch", "statusCode", response.StatusCode, "status", "ok", "duration", time.Since(start), "stage", es.StageDatabaseRequest, "contentLength", response.Header.Get("Content-Length"), "resourcePath", req.Path)

	defer func() {
		if err := response.Body.Close(); err != nil {
			logger.Warn("Failed to close response body", "error", err)
		}
	}()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		logger.Error("Error reading response body bytes", "error", err)
		return err
	}

	responseHeaders := map[string][]string{
		"content-type": {"application/json"},
	}

	if response.Header.Get("Content-Encoding") != "" {
		responseHeaders["content-encoding"] = []string{response.Header.Get("Content-Encoding")}
	}

	return sender.Send(&backend.CallResourceResponse{
		Status:  response.StatusCode,
		Headers: responseHeaders,
		Body:    body,
	})
}

func createElasticsearchURL(req *backend.CallResourceRequest, ds *es.DatasourceInfo) (string, error) {
	esUrl, err := url.Parse(ds.URL)
	if err != nil {
		return "", fmt.Errorf("failed to parse data source URL: %s, error: %w", ds.URL, err)
	}

	esUrl.Path = path.Join(esUrl.Path, req.Path)
	esUrlString := esUrl.String()
	// If the request path is empty and the URL does not end with a slash, add a slash to the URL.
	// This ensures that for version checks executed to the root URL, the URL ends with a slash.
	// This is helpful, for example, for load balancers that expect URLs to match the pattern /.*.
	if req.Path == "" && esUrlString[len(esUrlString)-1:] != "/" {
		return esUrl.String() + "/", nil
	}
	return esUrlString, nil
}
