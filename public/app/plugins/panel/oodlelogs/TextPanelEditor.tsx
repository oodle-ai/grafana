import { css, cx } from '@emotion/css';
import DangerouslySetHtmlContent from "dangerously-set-html-content";
import AutoSizer from 'react-virtualized-auto-sizer';

import { GrafanaTheme2, StandardEditorProps } from '@grafana/data';
import {
  useStyles2,
} from '@grafana/ui';

import { Options } from './panelcfg.gen';

export const TextPanelEditor = ({ value, onChange, context }: StandardEditorProps<string, {}, Options>) => {
  const styles = useStyles2(getStyles);

  return (
    <div className={cx(styles.editorBox)}>
      <AutoSizer disableHeight>
        {({ width }) => {
          if (width === 0) {
            return null;
          }
          return (
              <DangerouslySetHtmlContent
                allowRerender
                html={`<iframe width="100%" height="100%" src="${value}"/>`}
                className={styles.markdown}
                data-testid="TextPanel-converted-content"
              />
          );
        }}
      </AutoSizer>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  editorBox: css`
    label: editorBox;
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    margin: ${theme.spacing(0.5)} 0;
    width: 100%;
  `,
  markdown: cx(
    'markdown-html',
    css`
      height: 100%;
    `
  ),
});
