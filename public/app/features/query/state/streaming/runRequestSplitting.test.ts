import { Observable, of } from 'rxjs';

import {
  CoreApp,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  FieldType,
  LoadingState,
  PanelData,
  dateTime,
  toDataFrame,
} from '@grafana/data';
import { setEchoSrv } from '@grafana/runtime';

import { Echo } from '../../../../core/services/echo/Echo';
import { runRequest } from '../runRequest';

jest.mock('app/core/services/backend_srv');

jest.mock('app/features/dashboard/services/DashboardSrv', () => ({
  getDashboardSrv: () => ({ getCurrent: () => undefined }),
}));

const STEP_MS = 60 * 60 * 1000;
const TO_MS = 1700000000000;
const FROM_MS = TO_MS - 8 * 24 * 60 * 60 * 1000;

function makeRequest(): DataQueryRequest {
  return {
    requestId: 'req1',
    interval: '1h',
    intervalMs: STEP_MS,
    maxDataPoints: 200,
    range: { from: dateTime(FROM_MS), to: dateTime(TO_MS), raw: { from: 'now-8d', to: 'now' } },
    scopedVars: {},
    targets: [{ refId: 'A' }],
    timezone: 'browser',
    app: CoreApp.Dashboard,
    panelId: 1,
    panelPluginId: 'timeseries',
    startTime: 0,
  } as DataQueryRequest;
}

/** Returns one point per step in the requested range, like a range query would */
function makeDatasource(): DataSourceApi {
  return {
    type: 'prometheus',
    uid: 'prom',
    name: 'prom',
    query: (request: DataQueryRequest): Observable<DataQueryResponse> => {
      const times: number[] = [];
      const values: number[] = [];

      const start = Math.ceil(request.range.from.valueOf() / STEP_MS) * STEP_MS;
      for (let t = start; t <= request.range.to.valueOf(); t += STEP_MS) {
        times.push(t);
        values.push(t / STEP_MS);
      }

      return of({
        data: [
          toDataFrame({
            refId: 'A',
            fields: [
              { name: 'Time', type: FieldType.time, values: times },
              { name: 'Value', type: FieldType.number, values, labels: { job: 'a' } },
            ],
          }),
        ],
      });
    },
  } as unknown as DataSourceApi;
}

describe('runRequest with query splitting', () => {
  beforeAll(() => {
    setEchoSrv(new Echo());
  });

  function collect(request: DataQueryRequest, datasource: DataSourceApi): Promise<PanelData[]> {
    return new Promise((resolve, reject) => {
      const results: PanelData[] = [];
      runRequest(datasource, request).subscribe({
        next: (data) => results.push(data),
        error: reject,
        complete: () => resolve(results),
      });
    });
  }

  it('emits progressively and ends with the same data an unsplit query returns', async () => {
    const datasource = makeDatasource();

    const split = await collect(makeRequest(), datasource);
    const unsplit = await collect({ ...makeRequest(), panelPluginId: 'table' }, datasource);

    const dataEmissions = split.filter((data) => data.series.length > 0);
    expect(dataEmissions.length).toBe(10);

    // Every emission covers more of the range than the previous one, growing to the left
    const times = dataEmissions.map((data) => data.series[0].fields[0].values);
    for (let i = 1; i < times.length; i++) {
      expect(times[i].length).toBeGreaterThan(times[i - 1].length);
      expect(times[i][times[i].length - 1]).toBe(times[0][times[0].length - 1]);
    }

    // Timestamps stay sorted and are not duplicated on the boundaries between parts
    const finalTimes = times[times.length - 1];
    expect(finalTimes).toEqual([...finalTimes].sort((a, b) => a - b));
    expect(new Set(finalTimes).size).toBe(finalTimes.length);

    const unsplitFinal = unsplit[unsplit.length - 1];
    expect(unsplitFinal.streamProgress).toBeUndefined();
    expect(finalTimes).toEqual(unsplitFinal.series[0].fields[0].values);
    expect(dataEmissions[dataEmissions.length - 1].series[0].fields[1].values).toEqual(
      unsplitFinal.series[0].fields[1].values
    );
  });

  it('reports the loaded part of the range on the panel data', async () => {
    const results = (await collect(makeRequest(), makeDatasource())).filter((data) => data.series.length > 0);

    const first = results[0].streamProgress!;
    expect(first.streaming).toBe(true);
    expect(first.fromMs).toBe(FROM_MS);
    expect(first.toMs).toBe(TO_MS);
    expect(first.loadedFromMs).toBeGreaterThan(FROM_MS);
    expect(first.totalParts).toBe(10);
    expect(results[0].state).toBe(LoadingState.Loading);

    // The range is relative ('now-8d' to 'now'), it must not be re-resolved between parts or the
    // axis would creep while the panel fills in
    results.forEach((result) => {
      expect(result.timeRange.from.valueOf()).toBe(FROM_MS);
      expect(result.timeRange.to.valueOf()).toBe(TO_MS);
    });

    const last = results[results.length - 1];
    expect(last.state).toBe(LoadingState.Done);
    expect(last.streamProgress!.streaming).toBe(false);
    expect(last.streamProgress!.loadedFromMs).toBe(FROM_MS);
    expect(last.timeRange.from.valueOf()).toBe(FROM_MS);
    expect(last.timeRange.to.valueOf()).toBe(TO_MS);
  });
});
