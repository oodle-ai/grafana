import { LoadingState, PanelData, getDefaultTimeRange } from '@grafana/data';
import { SceneQueryRunner, VizPanel } from '@grafana/scenes';

import { DashboardScene } from '../scene/DashboardScene';
import { DefaultGridLayoutManager } from '../scene/layout-default/DefaultGridLayoutManager';

import { collectTraceIds } from './DashboardLoadTimeBroadcast';

function panelWithTraceIds(key: string, traceIds?: string[]): VizPanel {
  const runner = new SceneQueryRunner({ key: `${key}-runner`, queries: [{ refId: 'A' }] });

  const data: PanelData = {
    state: LoadingState.Done,
    series: [],
    timeRange: getDefaultTimeRange(),
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

  it('stops at the cap, so that the parent never truncates an id', () => {
    const panels = Array.from({ length: 12 }, (_, i) => panelWithTraceIds(`panel-${i}`, [`trace-${i}`]));

    expect(collectTraceIds(sceneWith(panels))).toHaveLength(8);
  });
});
