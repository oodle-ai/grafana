import { PanelData, RawTimeRange } from '@grafana/data';
import { locationService, LocationService } from '@grafana/runtime';
import { getDashboardSrv } from 'app/features/dashboard/services/DashboardSrv';
import { getTimeSrv } from 'app/features/dashboard/services/TimeSrv';

import { DashboardModel } from '../dashboard/state/DashboardModel';

declare global {
  interface Window {
    locationService?: LocationService;
    grafanaRuntime?: {
      getDashboardSaveModel: () => DashboardModel | undefined;
      getDashboardTimeRange: () => { from: number; to: number; raw: RawTimeRange };
      getPanelData: () => Record<number, PanelData | undefined> | undefined;
    };
  }
}

/**
 * This will setup features that are accessible through the root window location
 *
 * This is useful for manipulating the application from external drivers like puppetter/cypress
 *
 * @internal and subject to change
 */
export function initWindowRuntime() {
  window.grafanaRuntime = {
    /** Get info for the current dashboard.  This will include the migrated dashboard JSON */
    getDashboardSaveModel: () => {
      const d = getDashboardSrv().getCurrent();
      if (!d) {
        return undefined;
      }
      return d.getSaveModelCloneOld();
    },

    /** The selected time range */
    getDashboardTimeRange: () => {
      const tr = getTimeSrv().timeRange();
      return {
        from: tr.from.valueOf(),
        to: tr.to.valueOf(),
        raw: tr.raw,
      };
    },

    /** Get the query results for the last loaded data */
    getPanelData: () => {
      const d = getDashboardSrv().getCurrent();
      if (!d) {
        return undefined;
      }
      return d.panels.reduce<Record<number, PanelData | undefined>>((acc, panel) => {
        acc[panel.id] = panel.getQueryRunner().getLastResult();
        return acc;
      }, {});
    },
  };

  if (window.locationService) {
    console.warn(
      'window.locationService already exists. Grafana will not overwrite it.'
    );
    return;
  }

  window.locationService = {
    partial: (query, replace) => locationService.partial(query, replace),
    push: (location) => locationService.push(location),
    replace: (location) => locationService.replace(location),
    reload: () => locationService.reload(),
    getLocation: () => locationService.getLocation(),
    getHistory: () => locationService.getHistory(),
    getSearch: () => locationService.getSearch(),
    getSearchObject: () => locationService.getSearchObject(),
    getLocationObservable: () => locationService.getLocationObservable(),
    update: (update) => locationService.update(update),
  };
}
