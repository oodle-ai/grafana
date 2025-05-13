import { css, cx } from '@emotion/css';
import DangerouslySetHtmlContent from 'dangerously-set-html-content';
import { useState } from 'react';
import { useDebounce } from 'react-use';

import { GrafanaTheme2, PanelProps } from '@grafana/data';
import { CustomScrollbar, useStyles2 } from '@grafana/ui';

import { defaultOptions, Options } from './panelcfg.gen';

export interface Props extends PanelProps<Options> {}

export function TextPanel(props: Props) {
  const styles = useStyles2(getStyles);
  const [processed, setProcessed] = useState<Options>({
    content: (props.options?.content?.length ?? 0) > 0 ? (props.options?.content || '') : defaultOptions.content || '',
  });

  useDebounce(
    () => {
      const content = (props.options?.content?.length ?? 0) > 0 ? (props.options?.content || '') : defaultOptions.content || '';
      if (content !== processed.content) {
        setProcessed({
          content,
        });
      }
    },
    100,
    [props]
  );

  return (
    <CustomScrollbar autoHeightMin="100%" className={styles.containStrict}>
      <DangerouslySetHtmlContent
        allowRerender
        html={`<iframe width="100%" height="100%" src="${processed.content}"/>`}
        className={styles.markdown}
        data-testid="TextPanel-converted-content"
      />
    </CustomScrollbar>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  codeEditorContainer: css`
    .monaco-editor .margin,
    .monaco-editor-background {
      background-color: ${theme.colors.background.primary};
    }
  `,
  markdown: cx(
    'markdown-html',
    css`
      height: 100%;
    `
  ),
  containStrict: css({
    contain: 'strict',
  }),
});
