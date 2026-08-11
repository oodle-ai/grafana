import { Observable, from, of, throwError } from 'rxjs';

import {
  CoreApp,
  DataQuery,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  FieldType,
  LoadingState,
  dateTime,
  toDataFrame,
} from '@grafana/data';

import { DEFAULT_STREAMING_CONFIG, QueryStreamingConfig } from './config';
import { QueryExecutor, getRequestSplitParts, runSplitRequest } from './splitQuery';

const config: QueryStreamingConfig = DEFAULT_STREAMING_CONFIG;

const datasource = { type: 'prometheus', uid: 'prom' } as DataSourceApi;

const target = (t: { refId: string; expr?: string; instant?: boolean; hide?: boolean }): DataQuery => t as DataQuery;

function makeRequest(overrides: Partial<DataQueryRequest> = {}): DataQueryRequest {
  const to = dateTime(1700000000000);
  const from = dateTime(to.valueOf() - 8 * 24 * 60 * 60 * 1000);

  return {
    requestId: 'req1',
    interval: '1m',
    intervalMs: 60000,
    range: { from, to, raw: { from: 'now-8d', to: 'now' } },
    scopedVars: {},
    targets: [target({ refId: 'A', expr: 'up' })],
    timezone: 'browser',
    app: CoreApp.Dashboard,
    panelPluginId: 'timeseries',
    startTime: 0,
    ...overrides,
  } as DataQueryRequest;
}

describe('getRequestSplitParts', () => {
  it('splits a long range on a supported panel and datasource', () => {
    expect(getRequestSplitParts(datasource, makeRequest(), config)).toBe(10);
  });

  it('does not split when disabled', () => {
    expect(getRequestSplitParts(datasource, makeRequest(), { ...config, enabled: false })).toBe(1);
  });

  it.each([
    [60, 1],
    [5 * 60, 1],
    [6 * 60, 2],
    [12 * 60, 3],
    [24 * 60, 4],
  ])('splits a range of %i minutes into %i parts', (minutes, parts) => {
    const to = dateTime(1700000000000);
    const from = dateTime(to.valueOf() - minutes * 60 * 1000);

    expect(getRequestSplitParts(datasource, makeRequest({ range: { from, to, raw: { from, to } } }), config)).toBe(
      parts
    );
  });

  it('does not split unsupported panel types', () => {
    expect(getRequestSplitParts(datasource, makeRequest({ panelPluginId: 'table' }), config)).toBe(1);
  });

  it('does not split unsupported datasources', () => {
    expect(getRequestSplitParts({ type: 'loki' } as DataSourceApi, makeRequest(), config)).toBe(1);
  });

  it('does not split outside of dashboards', () => {
    expect(getRequestSplitParts(datasource, makeRequest({ app: CoreApp.Explore }), config)).toBe(1);
  });

  it('does not split instant queries', () => {
    const request = makeRequest({ targets: [target({ refId: 'A', expr: 'up', instant: true })] });
    expect(getRequestSplitParts(datasource, request, config)).toBe(1);
  });

  it.each(['sum_over_time(up[$__range])', 'sum_over_time(up[${__range}])', 'up + ${__range_s}'])(
    'does not split queries that use the range variable in %s',
    (expr) => {
      const request = makeRequest({ targets: [target({ refId: 'A', expr })] });
      expect(getRequestSplitParts(datasource, request, config)).toBe(1);
    }
  );

  it('does not split when incremental querying is on', () => {
    const ds = { type: 'prometheus', hasIncrementalQuery: true } as unknown as DataSourceApi;
    expect(getRequestSplitParts(ds, makeRequest(), config)).toBe(1);
  });

  it('ignores hidden queries when checking the targets', () => {
    const request = makeRequest({
      targets: [target({ refId: 'A', expr: 'up' }), target({ refId: 'B', expr: 'up', instant: true, hide: true })],
    });
    expect(getRequestSplitParts(datasource, request, config)).toBe(10);
  });
});

describe('runSplitRequest', () => {
  const frameFor = (times: number[], values: number[], refId = 'A') =>
    toDataFrame({
      refId,
      fields: [
        { name: 'Time', type: FieldType.time, values: times },
        { name: 'Value', type: FieldType.number, values, labels: { job: 'a' } },
      ],
    });

  it('runs the parts newest first and emits a merged result per part', async () => {
    const request = makeRequest();
    const requestedRanges: Array<[number, number]> = [];

    const executor: QueryExecutor = (_ds, req) => {
      requestedRanges.push([req.range.from.valueOf(), req.range.to.valueOf()]);
      const t = req.range.from.valueOf();
      return of<DataQueryResponse>({ data: [frameFor([t], [t])] });
    };

    const emissions = await collect(runSplitRequest(datasource, request, undefined, 3, executor));

    expect(requestedRanges.length).toBe(3);
    // Newest range first, and every part continues where the previous one started
    expect(requestedRanges[0][1]).toBe(request.range.to.valueOf());
    expect(requestedRanges[1][1]).toBe(requestedRanges[0][0]);
    expect(requestedRanges[2][1]).toBe(requestedRanges[1][0]);
    expect(requestedRanges[2][0]).toBe(request.range.from.valueOf());

    expect(emissions.map((e) => e.state)).toEqual([LoadingState.Loading, LoadingState.Loading, LoadingState.Done]);

    // Data grows from the right, the merged frame stays sorted by time
    expect(emissions[0].data[0].fields[0].values).toEqual([requestedRanges[0][0]]);
    expect(emissions[2].data[0].fields[0].values).toEqual([
      requestedRanges[2][0],
      requestedRanges[1][0],
      requestedRanges[0][0],
    ]);
  });

  it('scales maxDataPoints with the part duration so every part uses the same step', async () => {
    const request = makeRequest({ maxDataPoints: 1000 });
    const requests: DataQueryRequest[] = [];

    const executor: QueryExecutor = (_ds, req) => {
      requests.push(req);
      return of<DataQueryResponse>({ data: [] });
    };

    await collect(runSplitRequest(datasource, request, undefined, 4, executor));

    const fullDuration = request.range.to.valueOf() - request.range.from.valueOf();
    requests.forEach((req) => {
      const duration = req.range.to.valueOf() - req.range.from.valueOf();
      expect(req.maxDataPoints).toBe(Math.max(1, Math.round((1000 * duration) / fullDuration)));
      // The step of the panel is untouched
      expect(req.intervalMs).toBe(request.intervalMs);
      expect(req.range.raw).toEqual(request.range.raw);
    });
  });

  it('passes the range of the unsplit request to every part', async () => {
    const request = makeRequest({ maxDataPoints: 1000 });
    const requests: DataQueryRequest[] = [];

    const executor: QueryExecutor = (_ds, req) => {
      requests.push(req);
      return of<DataQueryResponse>({ data: [] });
    };

    await collect(runSplitRequest(datasource, request, undefined, 4, executor));

    expect(requests.length).toBe(4);
    requests.forEach((req) => {
      expect(req.splitOrigin).toEqual({
        fromMs: request.range.from.valueOf(),
        toMs: request.range.to.valueOf(),
        maxDataPoints: 1000,
      });
    });
  });

  it('keeps every packet when a part answers with one response per query', async () => {
    const request = makeRequest();

    const executor: QueryExecutor = (_ds, req) => {
      const t = req.range.to.valueOf();
      const packets: DataQueryResponse[] = [
        { data: [frameFor([t], [1], 'A')], key: 'A' },
        { data: [frameFor([t], [2], 'B')], key: 'B' },
      ];
      return from(packets);
    };

    const emissions = await collect(runSplitRequest(datasource, request, undefined, 2, executor));

    // Two series per part, not just the packet that happened to arrive last
    expect(emissions[emissions.length - 1].data.length).toBe(2);
  });

  it('reports the loaded portion of the range as it progresses', async () => {
    const request = makeRequest();
    const executor: QueryExecutor = (_ds, req) =>
      of<DataQueryResponse>({ data: [frameFor([req.range.to.valueOf()], [1])] });

    const emissions = await collect(runSplitRequest(datasource, request, undefined, 4, executor));

    const fullFrom = request.range.from.valueOf();
    const fullTo = request.range.to.valueOf();

    emissions.forEach((emission, i) => {
      const progress = emission.streamProgress!;
      expect(progress.fromMs).toBe(fullFrom);
      expect(progress.toMs).toBe(fullTo);
      expect(progress.loadedToMs).toBe(fullTo);
      expect(progress.completedParts).toBe(i + 1);
      expect(progress.totalParts).toBe(4);
    });

    expect(emissions[0].streamProgress!.loadedFromMs).toBeGreaterThan(fullFrom);
    expect(emissions[0].streamProgress!.streaming).toBe(true);

    const last = emissions[emissions.length - 1].streamProgress!;
    expect(last.loadedFromMs).toBe(fullFrom);
    expect(last.streaming).toBe(false);
  });

  it('keeps the data loaded so far when a part fails', async () => {
    const request = makeRequest();
    let calls = 0;

    const executor: QueryExecutor = (_ds, req) => {
      calls++;
      if (calls === 2) {
        return throwError(() => new Error('boom'));
      }
      return of<DataQueryResponse>({ data: [frameFor([req.range.to.valueOf()], [1])] });
    };

    const emissions = await collect(runSplitRequest(datasource, request, undefined, 4, executor));

    expect(calls).toBe(2);
    expect(emissions[emissions.length - 1].state).toBe(LoadingState.Error);
    expect(emissions[emissions.length - 1].data.length).toBe(1);
    expect(emissions[emissions.length - 1].streamProgress!.hasError).toBe(true);
    expect(emissions[emissions.length - 1].streamProgress!.streaming).toBe(false);
  });

  it('stops running the remaining parts when unsubscribed', () => {
    const request = makeRequest();
    let calls = 0;
    const executor: QueryExecutor = () => {
      calls++;
      return new Observable<DataQueryResponse>(() => {});
    };

    const subscription = runSplitRequest(datasource, request, undefined, 4, executor).subscribe();
    subscription.unsubscribe();

    expect(calls).toBe(1);
  });
});

function collect(observable: Observable<DataQueryResponse>): Promise<DataQueryResponse[]> {
  return new Promise((resolve, reject) => {
    const emissions: DataQueryResponse[] = [];
    observable.subscribe({
      next: (value) => emissions.push(value),
      error: reject,
      complete: () => resolve(emissions),
    });
  });
}
