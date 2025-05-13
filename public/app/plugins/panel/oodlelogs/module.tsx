import { PanelPlugin } from '@grafana/data';

import { TextPanel } from './TextPanel';
import { TextPanelEditor } from './TextPanelEditor';
import { CodeLanguage, defaultCodeOptions, defaultOptions, Options, TextMode } from './panelcfg.gen';
import { textPanelMigrationHandler } from './textPanelMigrationHandler';

export const plugin = new PanelPlugin<Options>(TextPanel)
  .setPanelOptions((builder) => {
    // builder
    //   .addTextInput({
    //     id: 'content',
    //     path: 'content',
    //     name: 'Content',
    //     editor: TextPanelEditor,
    //     defaultValue: defaultOptions.content,
    //   });
  })
  .setMigrationHandler(textPanelMigrationHandler);
