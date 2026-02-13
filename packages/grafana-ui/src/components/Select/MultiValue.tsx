import * as React from 'react';

import { t } from '@grafana/i18n';

import { useTheme2 } from '../../themes/ThemeContext';
import { IconButton, Props as IconButtonProps } from '../IconButton/IconButton';

import { getSelectStyles } from './getSelectStyles';

interface MultiValueContainerProps {
  innerProps: JSX.IntrinsicElements['div'];
}

export const MultiValueContainer = ({ innerProps, children }: React.PropsWithChildren<MultiValueContainerProps>) => {
  const theme = useTheme2();
  const styles = getSelectStyles(theme);

  return (
    <div {...innerProps} className={styles.multiValueContainer}>
      {children}
    </div>
  );
};

interface MultiValueLabelProps {
  innerProps: JSX.IntrinsicElements['div'];
  data?: { label?: string; value?: unknown };
}

/**
 * Renders the multi-value pill label. On right-click, selects the entire label
 * text so the native context menu (Copy, etc.) applies to the full value instead
 * of a single word (e.g. "accounting" in "accounting-cffcfcb68-8mqf9").
 */
export const MultiValueLabel = ({ innerProps, children, data }: React.PropsWithChildren<MultiValueLabelProps>) => {
  const theme = useTheme2();
  const styles = getSelectStyles(theme);
  const labelRef = React.useRef<HTMLDivElement>(null);

  const onContextMenu = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = labelRef.current;
    if (!el) {
      return;
    }
    // Select full label text so Copy applies to entire value; do not preventDefault
    // so the native context menu still appears.
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  return (
    <div
      {...innerProps}
      ref={labelRef}
      className={styles.multiValueLabel}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
};

export type MultiValueRemoveProps = {
  innerProps: IconButtonProps;
};

export const MultiValueRemove = ({ children, innerProps }: React.PropsWithChildren<MultiValueRemoveProps>) => {
  const theme = useTheme2();
  const styles = getSelectStyles(theme);
  return (
    <IconButton
      {...innerProps}
      name="times"
      size="sm"
      className={styles.multiValueRemove}
      tooltip={t('grafana-ui.select.multi-value-remove', 'Remove')}
    />
  );
};
