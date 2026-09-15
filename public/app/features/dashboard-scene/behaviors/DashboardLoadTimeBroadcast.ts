import { sceneGraph, SceneQueryRunner } from '@grafana/scenes';

import { DashboardScene } from '../scene/DashboardScene';

const DEBOUNCE_MS = 500;

/**
 * The parent joins the ids into one string and truncates it at 300
 * characters, which a 32-character id plus its separator reaches at nine.
 * Capping here instead means the last id sent is a whole one.
 *
 * These are the first ids of the load rather than the slowest. A dashboard
 * with more panels than this reports only some of its queries; rank by panel
 * query duration here if that is not good enough.
 */
const MAX_TRACE_IDS = 8;

/**
 * The trace ids of the queries this load ran.
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
  const ids = new Set<string>();

  for (const object of sceneGraph.findAllObjects(dashboard, (o) => o instanceof SceneQueryRunner)) {
    // findAllObjects returns SceneObject, so the check is repeated to narrow it.
    if (!(object instanceof SceneQueryRunner)) {
      continue;
    }

    for (const id of object.state.data?.traceIds ?? []) {
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
