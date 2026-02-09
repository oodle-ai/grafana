import { css } from '@emotion/css';
import { MouseEvent, useCallback, useRef, useState, useEffect } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { selectors } from '@grafana/e2e-selectors';
import { t } from '@grafana/i18n';
import { Icon, InlineToast, useStyles2 } from '@grafana/ui';
import { LoadingIndicator } from '@grafana/ui/internal';

import { getStyles as getTagBadgeStyles } from '../../../../core/components/TagFilter/TagBadge';
import { ALL_VARIABLE_TEXT } from '../../constants';

const SHOW_COPIED_DURATION = 2 * 1000;

async function copyToClipboard(text: string, fallbackRef: React.RefObject<HTMLButtonElement | null>) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement('textarea');
  fallbackRef.current?.appendChild(textarea);
  textarea.value = text;
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

interface Props {
  onClick: () => void;
  text: string;
  loading: boolean;
  onCancel: () => void;
  disabled?: boolean;
  /**
   *  htmlFor, needed for the label
   */
  id: string;
}

export const VariableLink = ({ loading, disabled, onClick: propsOnClick, text, onCancel, id }: Props) => {
  const styles = useStyles2(getStyles);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const [showCopied, setShowCopied] = useState(false);

  useEffect(() => {
    if (!showCopied) {
      return;
    }
    const timeoutId = setTimeout(() => setShowCopied(false), SHOW_COPIED_DURATION);
    return () => clearTimeout(timeoutId);
  }, [showCopied]);

  const onContainerClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      event.preventDefault();
      propsOnClick();
    },
    [propsOnClick]
  );

  const onContainerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        propsOnClick();
      }
    },
    [propsOnClick]
  );

  const onCopyClick = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      try {
        await copyToClipboard(text, copyButtonRef);
        setShowCopied(true);
      } catch {
        // Clipboard API can throw; ignore for now
      }
    },
    [text]
  );

  if (loading) {
    return (
      <div
        className={styles.container}
        data-testid={selectors.pages.Dashboard.SubMenu.submenuItemValueDropDownValueLinkTexts(`${text}`)}
        title={text}
        id={id}
      >
        <VariableLinkText text={text} />
        <LoadingIndicator loading onCancel={onCancel} />
      </div>
    );
  }

  return (
    <div
      className={styles.container}
      data-variable-link-container
      data-disabled={disabled || undefined}
      id={id}
    >
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={false}
        aria-controls={`options-${id}`}
        aria-disabled={disabled}
        title={text}
        className={styles.mainClickable}
        data-testid={selectors.pages.Dashboard.SubMenu.submenuItemValueDropDownValueLinkTexts(`${text}`)}
        onClick={disabled ? undefined : onContainerClick}
        onKeyDown={disabled ? undefined : onContainerKeyDown}
      >
        <VariableLinkText text={text} />
        <button
          ref={copyButtonRef}
          type="button"
          className={styles.copyButton}
          onClick={onCopyClick}
          disabled={disabled}
          aria-label={t('variable.picker.copy-value', 'Copy value')}
          title={t('variable.picker.copy-value', 'Copy value')}
        >
          <Icon name={showCopied ? 'check' : 'copy'} size="sm" aria-hidden />
        </button>
        <Icon aria-hidden name="angle-down" size="sm" className={styles.chevron} />
      </div>
      {showCopied && (
        <InlineToast
          placement="top"
          referenceElement={copyButtonRef.current}
        >
          {t('clipboard-button.inline-toast.success', 'Copied')}
        </InlineToast>
      )}
    </div>
  );
};

interface VariableLinkTextProps {
  text: string;
}

const VariableLinkText = ({ text }: VariableLinkTextProps) => {
  const styles = useStyles2(getStyles);

  return (
    <span className={styles.textAndTags}>
      {text === ALL_VARIABLE_TEXT ? t('variable.picker.link-all', 'All') : text}
    </span>
  );
};

const getStyles = (theme: GrafanaTheme2) => {
  const tagBadgeStyles = getTagBadgeStyles(theme);

  return {
    container: css({
      maxWidth: '500px',
      paddingRight: '10px',
      padding: theme.spacing(0, 1),
      backgroundColor: theme.components.input.background,
      border: `1px solid ${theme.components.input.borderColor}`,
      borderRadius: theme.shape.radius.default,
      display: 'inline-flex',
      alignItems: 'center',
      color: theme.colors.text.primary,
      height: theme.spacing(theme.components.height.md),
      position: 'relative',

      [`.${tagBadgeStyles.badge}`]: {
        margin: '0 5px',
      },

      '&[data-disabled]': {
        backgroundColor: theme.colors.action.disabledBackground,
        color: theme.colors.action.disabledText,
        border: `1px solid ${theme.colors.action.disabledBackground}`,
      },
    }),
    mainClickable: css({
      display: 'flex',
      alignItems: 'center',
      flex: 1,
      minWidth: 0,
      cursor: 'pointer',
      border: 'none',
      background: 'none',
      padding: 0,
      margin: 0,
      color: 'inherit',
      font: 'inherit',

      '&:focus': {
        outline: 'none',
      },

      '[data-disabled] &': {
        cursor: 'not-allowed',
      },
    }),
    copyButton: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      marginLeft: theme.spacing(0.25),
      marginRight: theme.spacing(0.25),
      padding: theme.spacing(0.25),
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      borderRadius: theme.shape.radius.sm,
      opacity: 0,

      '[data-variable-link-container]:hover &, &:focus, &:focus-visible': {
        opacity: 1,
      },

      '&:hover': {
        backgroundColor: theme.colors.action.hover,
      },

      '&:disabled': {
        cursor: 'not-allowed',
        opacity: 0,
      },

      '&:focus': {
        outline: 'none',
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: '2px',
      },
    }),
    chevron: css({
      flexShrink: 0,
      marginLeft: theme.spacing(0.25),
    }),
    textAndTags: css({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      marginRight: theme.spacing(0.25),
    }),
  };
};
