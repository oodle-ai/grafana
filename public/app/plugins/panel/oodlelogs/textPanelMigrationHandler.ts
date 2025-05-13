import { PanelModel } from '@grafana/data';

import { Options } from './panelcfg.gen';

export const textPanelMigrationHandler = (panel: PanelModel<Options>): Partial<Options> => {
  return panel.options;
};
