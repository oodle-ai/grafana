import { Observable, Subscription } from 'rxjs';

import {
  DataQueryError,
  DataQueryRequest,
  DataQueryResponse,
  DataQueryResponseData,
  DataSourceApi,
  LoadingState,
  QueryStreamProgress,
  dateTime,
} from '@grafana/data';
import { config as runtimeConfig, isExpressionReference, toDataQueryError } from '@grafana/runtime';
import { backendSrv } from 'app/core/services/backend_srv';

import { QueryStreamingConfig, getQueryStreamingConfig } from './config';
import { mergeChunkFrames } from './mergeFrames';
import { calculateStreamingParts, minutesToMs, splitTimeRangeDescending } from './timeSplitting';

/** Runs a single (sub) request, provided by the caller to avoid a circular import with runRequest */
export type QueryExecutor = (
  datasource: DataSourceApi,
  request: DataQueryRequest,
  queryFunction?: DataSourceApi['query']
) => Observable<DataQueryResponse>;

/**
 * Decides how many parts a request should be split into, so that no part covers more than the
 * configured split interval. Returns 1 when the request must be run as a single query (splitting
 * disabled, not a supported panel/datasource, query not splittable by time, or time range within
 * the split interval).
 */
export function getRequestSplitParts(
  datasource: DataSourceApi,
  request: DataQueryRequest,
  config: QueryStreamingConfig = getQueryStreamingConfig()
): number {
  if (!config.enabled) {
    return 1;
  }

  if (!config.apps.includes(String(request.app))) {
    return 1;
  }

  if (!request.panelPluginId || !config.panelTypes.includes(request.panelPluginId)) {
    return 1;
  }

  if (!datasource.type || !config.datasourceTypes.includes(datasource.type)) {
    return 1;
  }

  if (request.liveStreaming) {
    return 1;
  }

  // Public dashboards go through their own endpoint, which rebuilds the queries from the saved
  // dashboard and only receives the range and maxDataPoints of the request. There is no way to
  // tell it the range of the unsplit request, so every part would pick its own step
  if (runtimeConfig.publicDashboardAccessToken) {
    return 1;
  }

  // Incremental querying keeps its own cache of the previously queried range and expects
  // requests to cover one contiguous, growing range.
  if (hasIncrementalQuery(datasource)) {
    return 1;
  }

  const targets = request.targets.filter((target) => !target.hide);
  if (targets.length === 0) {
    return 1;
  }

  for (const target of targets) {
    if (isExpressionReference(target.datasource)) {
      return 1;
    }

    // Instant queries return a single point for the end of the range, splitting them is pointless
    if ('instant' in target && target.instant) {
      return 1;
    }

    // $__range is interpolated from the full range (see splitOrigin), so the parts do return the
    // right numbers, but a `[$__range]` window is evaluated once per part and each evaluation
    // still reads the whole range, which multiplies the work done by the datasource
    if ('expr' in target && typeof target.expr === 'string' && hasRangeVariable(target.expr)) {
      return 1;
    }
  }

  const fromMs = request.range.from.valueOf();
  const toMs = request.range.to.valueOf();

  return calculateStreamingParts(toMs - fromMs, minutesToMs(config.splitIntervalMinutes));
}

/** Matches both `$__range`, `$__range_s`, `$__range_ms` and their `${...}` spelling */
function hasRangeVariable(expr: string): boolean {
  return expr.includes('$__range') || expr.includes('${__range');
}

export function scaleMaxDataPoints(
  maxDataPoints: number | undefined,
  partDurationMs: number,
  fullDurationMs: number
): number | undefined {
  if (!maxDataPoints || !(fullDurationMs > 0)) {
    return maxDataPoints;
  }

  return Math.max(1, Math.round((maxDataPoints * partDurationMs) / fullDurationMs));
}

/** Same keying as runRequest: packets with the same key replace each other, others add up */
function getPacketKey(response: DataQueryResponse): string {
  return response.key ?? response.data?.[0]?.refId ?? 'A';
}

function hasIncrementalQuery(datasource: DataSourceApi): boolean {
  return 'hasIncrementalQuery' in datasource && Boolean(datasource.hasIncrementalQuery);
}

/**
 * Splits `request` into several sub requests over consecutive time ranges and runs them one by one,
 * newest range first. Every completed part emits the merged result of all parts fetched so far, so
 * panels fill in from right to left. The last emission contains exactly the data an unsplit query
 * would have returned.
 */
export function runSplitRequest(
  datasource: DataSourceApi,
  request: DataQueryRequest,
  queryFunction: DataSourceApi['query'] | undefined,
  parts: number,
  executor: QueryExecutor
): Observable<DataQueryResponse> {
  const fromMs = request.range.from.valueOf();
  const toMs = request.range.to.valueOf();
  const stepMs = Math.max(1, request.intervalMs || 1);
  const ranges = splitTimeRangeDescending(fromMs, toMs, parts, stepMs);
  const responseKey = `${request.requestId}_split`;

  return new Observable<DataQueryResponse>((subscriber) => {
    // Indexed by part (parts are fetched newest first). A part can answer with several packets,
    // one per query for instance, which are keyed and replaced the same way runRequest does it.
    const chunkPackets: Array<Map<string, DataQueryResponseData[]> | undefined> = new Array(ranges.length);
    const traceIds = new Set<string>();

    let subscription: Subscription | null = null;
    let currentRequestId: string | undefined;
    let stopped = false;
    let completedParts = 0;

    const buildResponse = (
      state: LoadingState,
      loadedFromMs: number,
      error?: DataQueryError,
      errors?: DataQueryError[]
    ): DataQueryResponse => {
      // Parts are stored newest first, merge them oldest first
      const ordered = chunkPackets
        .map((packets) => (packets ? Array.from(packets.values()).flat() : undefined))
        .reverse();

      const progress: QueryStreamProgress = {
        requestId: request.requestId,
        fromMs,
        toMs,
        loadedFromMs,
        loadedToMs: toMs,
        completedParts,
        totalParts: ranges.length,
        streaming: state === LoadingState.Loading,
        hasError: state === LoadingState.Error ? true : undefined,
      };

      return {
        data: mergeChunkFrames(ordered),
        key: responseKey,
        state,
        error,
        errors,
        traceIds: traceIds.size > 0 ? Array.from(traceIds) : undefined,
        streamProgress: progress,
      };
    };

    const runPart = (index: number) => {
      if (stopped) {
        return;
      }

      const range = ranges[index];
      const subRequest: DataQueryRequest = {
        ...request,
        // A unique id per part, requests sharing an id cancel each other
        requestId: `${request.requestId}_split_${index}`,
        startTime: Date.now(),
        // Datasources derive the step from range/maxDataPoints, keep the ratio of the full
        // request so every part is sampled at the same resolution
        maxDataPoints: scaleMaxDataPoints(request.maxDataPoints, range.toMs - range.fromMs, toMs - fromMs),
        // The step and the interval variables ($__interval, $__rate_interval, $__dd_interval,
        // $__large_interval, $__range) must not be derived from the range of the part
        splitOrigin: {
          fromMs,
          toMs,
          maxDataPoints: request.maxDataPoints,
        },
        range: {
          from: dateTime(range.fromMs),
          to: dateTime(range.toMs),
          // Keep the original raw range so datasources that look at it (e.g. for timezone
          // handling) treat every part the same way as the unsplit request
          raw: request.range.raw,
        },
      };
      currentRequestId = subRequest.requestId;

      subscription?.unsubscribe();
      subscription = executor(datasource, subRequest, queryFunction).subscribe({
        next: (response) => {
          if (stopped) {
            return;
          }

          let packets = chunkPackets[index];
          if (!packets) {
            packets = new Map();
            chunkPackets[index] = packets;
          }
          packets.set(getPacketKey(response), response.data ?? []);

          response.traceIds?.forEach((traceId) => traceIds.add(traceId));

          if (response.error || response.errors?.length) {
            stopped = true;
            completedParts = index;
            subscriber.next(buildResponse(LoadingState.Error, range.toMs, response.error, response.errors));
            subscriber.complete();
          }
        },
        error: (err) => {
          if (stopped) {
            return;
          }
          stopped = true;
          completedParts = index;
          // Keep whatever has been loaded so far instead of failing the whole request
          subscriber.next(buildResponse(LoadingState.Error, range.toMs, toDataQueryError(err)));
          subscriber.complete();
        },
        complete: () => {
          if (stopped) {
            return;
          }

          completedParts = index + 1;
          const isLast = range.isLast || index === ranges.length - 1;

          // Partial results stay Loading: scenes marks a query as completed on the first
          // non-Loading state, which would drop the panel out of the running query set and take
          // the Cancel button and the loading bar with it
          subscriber.next(buildResponse(isLast ? LoadingState.Done : LoadingState.Loading, range.fromMs));

          if (isLast) {
            subscriber.complete();
            return;
          }

          runPart(index + 1);
        },
      });
    };

    runPart(0);

    return () => {
      stopped = true;
      subscription?.unsubscribe();
      if (currentRequestId) {
        backendSrv.resolveCancelerIfExists(currentRequestId);
      }
    };
  });
}
