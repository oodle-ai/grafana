import { sceneGraph } from '@grafana/scenes';

import { DashboardScene } from '../scene/DashboardScene';

const DEBOUNCE_MS = 500;

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
        sendToParent('dashboardLoadStart', {
          dashboardUid: dashboard.state.uid,
          dashboardTitle: dashboard.state.title,
        });
      }
    } else {
      debounceTimer = setTimeout(() => {
        if (loadStartTime !== null) {
          const durationMs = performance.now() - loadStartTime;
          sendToParent('dashboardLoadComplete', {
            dashboardUid: dashboard.state.uid,
            dashboardTitle: dashboard.state.title,
            durationMs: Math.round(durationMs),
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
