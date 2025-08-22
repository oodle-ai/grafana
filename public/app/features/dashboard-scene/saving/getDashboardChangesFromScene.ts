import { Panel } from '@grafana/schema';
import { DashboardScene } from '../scene/DashboardScene';
import { transformSceneToSaveModel } from '../serialization/transformSceneToSaveModel';

import { getDashboardChanges as getDashboardSaveModelChanges } from './getDashboardChanges';
import { sortedDeepCloneWithoutNulls } from 'app/core/utils/object';

export function getSortedPanels(panels: Panel[]): Panel[] {
  const rowIdxs = panels.reduce((acc, panel, idx) => {
    if (panel.type === 'row') {
      return [...acc, idx];
    } else {
      return acc;
    }
  }, [0]).concat(panels.length-1);

  let sortedPanels: Panel[] = [];
  let tempPanels: Panel[] = [];

  for(let i = 0; i < panels.length; i++) {
    if(rowIdxs.includes(i)) {
      sortedPanels.push(...tempPanels.sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0)));
      tempPanels = [];
    } else {
      tempPanels.push(panels[i]);
    }
  }

  sortedPanels.push(...tempPanels.sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0)));
  
  return sortedPanels;
}

/**
 * Get changes between the initial save model and the current scene.
 * It also checks if the folder has changed.
 * @param scene DashboardScene object
 * @param saveTimeRange if true, compare the time range
 * @param saveVariables if true, compare the variables
 * @param saveRefresh if true, compare the refresh interval
 * @returns
 */
export function getDashboardChangesFromScene(
  scene: DashboardScene,
  saveTimeRange?: boolean,
  saveVariables?: boolean,
  saveRefresh?: boolean
) {
  const initialSaveModel = scene.getInitialSaveModel()!;
  const currentSceneModel = transformSceneToSaveModel(scene);
  const changeInfo = getDashboardSaveModelChanges(
    sortedDeepCloneWithoutNulls({...initialSaveModel, panels: getSortedPanels(initialSaveModel.panels ?? [])}),
    sortedDeepCloneWithoutNulls({...currentSceneModel, panels: getSortedPanels(currentSceneModel.panels ?? [])}),
    saveTimeRange,
    saveVariables,
    saveRefresh
  );
  const hasFolderChanges = scene.getInitialState()?.meta.folderUid !== scene.state.meta.folderUid;

  return {
    ...changeInfo,
    hasFolderChanges,
    hasChanges: changeInfo.hasChanges || hasFolderChanges,
  };
}
