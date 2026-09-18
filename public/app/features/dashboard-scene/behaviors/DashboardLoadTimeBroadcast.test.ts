import { DataQueryRequest, LoadingState, PanelData, getDefaultTimeRange } from '@grafana/data';
import { SceneQueryRunner, VizPanel } from '@grafana/scenes';

import { DashboardScene } from '../scene/DashboardScene';
import { DefaultGridLayoutManager } from '../scene/layout-default/DefaultGridLayoutManager';

import { collectTraceIds } from './DashboardLoadTimeBroadcast';

function panelWithTraceIds(key: string, traceIds?: string[], durationMs = 0): VizPanel {
  const runner = new SceneQueryRunner({ key: `${key}-runner`, queries: [{ refId: 'A' }] });

  const data: PanelData = {
    state: LoadingState.Done,
    series: [],
    timeRange: getDefaultTimeRange(),
    request: { startTime: 0, endTime: durationMs } as DataQueryRequest,
    ...(traceIds ? { traceIds } : {}),
  };
  runner.setState({ data });

  return new VizPanel({ key, pluginId: 'table', $data: runner });
}

function sceneWith(panels: VizPanel[]): DashboardScene {
  return new DashboardScene({
    uid: 'dash-1',
    title: 'hello',
    body: DefaultGridLayoutManager.fromVizPanels(panels),
  });
}

describe('collectTraceIds', () => {
  it('collects the ids of every panel that queried', () => {
    const scene = sceneWith([panelWithTraceIds('panel-1', ['a']), panelWithTraceIds('panel-2', ['b'])]);

    expect(collectTraceIds(scene).sort()).toEqual(['a', 'b']);
  });

  it('reports an id once when panels share it', () => {
    const scene = sceneWith([panelWithTraceIds('panel-1', ['a']), panelWithTraceIds('panel-2', ['a'])]);

    expect(collectTraceIds(scene)).toEqual(['a']);
  });

  it('is empty when no panel recorded one', () => {
    const scene = sceneWith([panelWithTraceIds('panel-1'), panelWithTraceIds('panel-2')]);

    expect(collectTraceIds(scene)).toEqual([]);
  });

  it('stops at the cap', () => {
    const panels = Array.from({ length: 20 }, (_, i) => panelWithTraceIds(`panel-${i}`, [`trace-${i}`]));

    expect(collectTraceIds(sceneWith(panels))).toHaveLength(8);
  });

  it('keeps the slowest queries when it has to cut', () => {
    // Ascending duration, so the ids that must survive are the last ones.
    const panels = Array.from({ length: 20 }, (_, i) => panelWithTraceIds(`panel-${i}`, [`trace-${i}`], i * 100));

    const slowest = Array.from({ length: 8 }, (_, i) => `trace-${19 - i}`);
    expect(collectTraceIds(sceneWith(panels))).toEqual(slowest);
  });

  it('sorts a query that has not finished last, without dropping it', () => {
    const unfinished = panelWithTraceIds('panel-slow', ['no-end']);
    unfinished.state.$data!.setState({
      data: { ...unfinished.state.$data!.state.data!, request: undefined },
    });

    const scene = sceneWith([unfinished, panelWithTraceIds('panel-fast', ['done'], 500)]);

    expect(collectTraceIds(scene)).toEqual(['done', 'no-end']);
  });
});
