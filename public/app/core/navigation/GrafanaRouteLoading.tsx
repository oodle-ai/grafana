import { css } from '@emotion/css';

import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

import { FullPageSkeleton } from '../components/FullPageSkeleton/FullPageSkeleton';

export function GrafanaRouteLoading() {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.loadingPage}>
      <FullPageSkeleton />
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  loadingPage: css({
    backgroundColor: theme.colors.background.primary,
    flex: 1,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  }),
});
