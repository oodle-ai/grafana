import { PanelPlugin } from '@grafana/data';

import { TextPanel } from './TextPanel';
import { TextPanelEditor } from './TextPanelEditor';
import { defaultOptions, Options } from './panelcfg.gen';
import { textPanelMigrationHandler } from './textPanelMigrationHandler';

export const plugin = new PanelPlugin<Options>(TextPanel)
  .setPanelOptions((builder) => {
    builder
      .addCustomEditor({
        id: 'content',
        path: 'content',
        name: 'Content',
        editor: TextPanelEditor,
        defaultValue: defaultOptions.content,
      });
  })
  .setMigrationHandler(textPanelMigrationHandler);
