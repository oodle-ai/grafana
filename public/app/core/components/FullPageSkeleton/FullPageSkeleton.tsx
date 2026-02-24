import { css } from '@emotion/css';
import Skeleton from 'react-loading-skeleton';

import { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';
import { useStyles2 } from '@grafana/ui';

export function FullPageSkeleton() {
  const styles = useStyles2(getStyles);

  return (
    <div
      className={styles.container}
      aria-live="polite"
      role="status"
      aria-label={t('full-page-skeleton.label', 'Loading')}
    >
      <Skeleton
        className={styles.skeleton}
        width="100%"
        height="100%"
        borderRadius={0}
      />
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: theme.colors.background.primary,
  }),
  skeleton: css({
    width: '100%',
    height: '100%',
    display: 'block',
    lineHeight: 1,
  }),
});
