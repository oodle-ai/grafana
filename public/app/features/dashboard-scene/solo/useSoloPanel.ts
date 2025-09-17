import { useState, useEffect } from 'react';

import { VizPanel, UrlSyncManager } from '@grafana/scenes';
import { startGPerformanceMeasure, stopGPerformanceMeasure } from 'app/core/utils/performance';

import { DashboardScene } from '../scene/DashboardScene';
import { DashboardRepeatsProcessedEvent } from '../scene/types';
import { findVizPanelByKey, isPanelClone } from '../utils/utils';

export function useSoloPanel(dashboard: DashboardScene, panelId: string): [VizPanel | undefined, string | undefined] {
  const [panel, setPanel] = useState<VizPanel>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const urlSyncManager = new UrlSyncManager();
    urlSyncManager.initSync(dashboard);

    const cleanUp = dashboard.activate();

    let panel: VizPanel | null = null;
    try {
      startGPerformanceMeasure(`useSoloPanel:findVizPanelByKey:${panelId}`);
      panel = findVizPanelByKey(dashboard, panelId);
      stopGPerformanceMeasure(`useSoloPanel:findVizPanelByKey:${panelId}`);
    } catch (e) {
      // do nothing, just the panel is not found or not a VizPanel
    }

    if (panel) {
      activateParents(panel);
      setPanel(panel);
    } else if (isPanelClone(panelId)) {
      findRepeatClone(dashboard, panelId).then((panel) => {
        if (panel) {
          setPanel(panel);
        } else {
          setError('Panel not found');
        }
      });
    } else {
      setError('Panel not found');
    }

    return cleanUp;
  }, [dashboard, panelId]);

  return [panel, error];
}

function activateParents(panel: VizPanel) {
  let parent = panel.parent;

  while (parent && !parent.isActive) {
    parent.activate();
    parent = parent.parent;
  }
}

function findRepeatClone(dashboard: DashboardScene, panelId: string): Promise<VizPanel | undefined> {
  return new Promise((resolve) => {
    dashboard.subscribeToEvent(DashboardRepeatsProcessedEvent, () => {
      startGPerformanceMeasure(`findRepeatClone:findVizPanelByKey:${panelId}`);
      const panel = findVizPanelByKey(dashboard, panelId);
      stopGPerformanceMeasure(`findRepeatClone:findVizPanelByKey:${panelId}`);
      if (panel) {
        resolve(panel);
      } else {
        // If rows are repeated they could add new panel repeaters that needs to be activated
        dashboard.state.body.activateRepeaters?.();
      }
    });

    dashboard.state.body.activateRepeaters?.();
  });
}
