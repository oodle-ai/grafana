import { css, keyframes } from '@emotion/css';

import { GrafanaTheme2, QueryStreamProgress, colorManipulator } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

interface StreamingProgressBarProps {
  progress?: QueryStreamProgress;
}

/**
 * Thin progress bar pinned to the top of the panel while a split query is still loading.
 * The filled portion tracks how much of the time range has arrived, and keeps pulsing until
 * the last part is in.
 */
export const StreamingProgressBar = ({ progress }: StreamingProgressBarProps) => {
  const styles = useStyles2(getStyles);

  if (!progress?.streaming || progress.totalParts < 2) {
    return null;
  }

  const loaded = Math.min(1, Math.max(0, progress.completedParts / progress.totalParts));

  return (
    <div className={styles.track} data-testid="streaming-progress-bar">
      <div className={styles.fill} style={{ width: `${loaded * 100}%` }} />
    </div>
  );
};

// Same pulse as the loading skeletons: fade down and back up, never fully out
const pulse = keyframes({
  '0%': { opacity: 1 },
  '50%': { opacity: 0.5 },
  '100%': { opacity: 1 },
});

const getStyles = (theme: GrafanaTheme2) => ({
  track: css({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    zIndex: 2,
    overflow: 'hidden',
    pointerEvents: 'none',
    backgroundColor: colorManipulator.alpha(theme.colors.primary.main, 0.15),
  }),
  fill: css({
    height: '100%',
    backgroundColor: theme.colors.primary.main,
    [theme.transitions.handleMotion('no-preference')]: {
      animation: `${pulse} 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`,
      transition: theme.transitions.create('width', { duration: theme.transitions.duration.short }),
    },
  }),
});
