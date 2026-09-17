import { PanelData } from '@grafana/data';
import { sceneGraph, SceneQueryRunner } from '@grafana/scenes';

import { DashboardScene } from '../scene/DashboardScene';

const DEBOUNCE_MS = 500;

/**
 * A load reports one id per panel that queried, and the slowest panels are
 * the ones worth opening, so the ids are ranked before they are cut.
 *
 * Eight keeps the joined ids inside the length the receiver accepts, so
 * that the last id sent is always a whole one.
 */
const MAX_TRACE_IDS = 8;

/**
 * How long the query behind a panel's data took. A request that has not
 * finished has no end, and sorts last rather than being dropped: its id is
 * still worth sending if there is room.
 */
function queryDurationMs(data: PanelData): number {
  const { startTime, endTime } = data.request ?? {};

  return startTime !== undefined && endTime !== undefined ? endTime - startTime : 0;
}

/**
 * The trace ids of the queries this load ran, slowest first.
 *
 * Grafana already records one per query: the backend returns its trace id
 * on the `grafana-trace-id` response header, and `runRequest` keeps them on
 * `PanelData.traceIds`. Those ids name the whole trace rather than a
 * Grafana-only one, because the proxy in front of Grafana starts the trace
 * and forwards its context on the request.
 *
 * A dashboard load issues one query request per panel, and each is its own
 * trace, so a load has as many ids as it has panels that queried.
 */
export function collectTraceIds(dashboard: DashboardScene): string[] {
  const queried: Array<{ durationMs: number; traceIds: string[] }> = [];

  for (const object of sceneGraph.findAllObjects(dashboard, (o) => o instanceof SceneQueryRunner)) {
    // findAllObjects returns SceneObject, so the check is repeated to narrow it.
    if (!(object instanceof SceneQueryRunner)) {
      continue;
    }

    const data = object.state.data;
    if (!data?.traceIds?.length) {
      continue;
    }

    queried.push({ durationMs: queryDurationMs(data), traceIds: data.traceIds });
  }

  queried.sort((a, b) => b.durationMs - a.durationMs);

  const ids = new Set<string>();
  for (const { traceIds } of queried) {
    for (const id of traceIds) {
      ids.add(id);

      if (ids.size >= MAX_TRACE_IDS) {
        return Array.from(ids);
      }
    }
  }

  return Array.from(ids);
}

export function dashboardLoadTimeBroadcast(dashboard: DashboardScene) {
  const queryController = sceneGraph.getQueryController(dashboard);
  if (!queryController) {
    return;
  }

  let loadStartTime: number | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const sub = queryController.subscribeToState((newState, prevState) => {
    if (newState.isRunning === prevState.isRunning) {
      return;
    }

    if (newState.isRunning) {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      if (loadStartTime === null) {
        loadStartTime = performance.now();
      }
    } else {
      debounceTimer = setTimeout(() => {
        if (loadStartTime !== null) {
          const durationMs = performance.now() - loadStartTime;
          const traceIds = collectTraceIds(dashboard);
          sendToParent('dashboardLoadComplete', {
            dashboardUid: dashboard.state.uid,
            dashboardTitle: dashboard.state.title,
            durationMs: Math.round(durationMs),
            // Omitted rather than sent empty, so that a load with no traced
            // query is told apart from one whose ids went missing.
            ...(traceIds.length > 0 ? { traceIds } : {}),
          });
          loadStartTime = null;
        }
        debounceTimer = null;
      }, DEBOUNCE_MS);
    }
  });

  return () => {
    sub.unsubscribe();
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
  };
}

function sendToParent(eventType: string, value: Record<string, unknown>) {
  window.parent.postMessage(
    {
      type: 'message',
      payload: {
        source: 'oodle-grafana',
        eventType,
        value,
      },
    },
    '*'
  );
}
