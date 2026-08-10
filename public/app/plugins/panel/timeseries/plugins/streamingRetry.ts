import { findVizPanelByKey, getQueryRunnerFor } from 'app/features/dashboard-scene/utils/utils';

/**
 * Re-runs the queries of a single panel, which restarts a split query that was cancelled or that
 * stopped on an error. Returns false when the panel cannot be reached, e.g. outside a dashboard.
 */
export function retryPanelQueries(panelId: number): boolean {
  const scene = window.__grafanaSceneContext;

  if (!scene) {
    return false;
  }

  const panel = findVizPanelByKey(scene, String(panelId));
  const queryRunner = getQueryRunnerFor(panel ?? undefined);

  if (!queryRunner) {
    return false;
  }

  queryRunner.runQueries();
  return true;
}

export function canRetryPanelQueries(panelId: number): boolean {
  const scene = window.__grafanaSceneContext;
  return Boolean(scene && getQueryRunnerFor(findVizPanelByKey(scene, String(panelId)) ?? undefined));
}
