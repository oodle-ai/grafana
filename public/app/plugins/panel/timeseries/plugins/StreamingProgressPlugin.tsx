import { css, keyframes } from '@emotion/css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import uPlot from 'uplot';

import { GrafanaTheme2, LoadingState, QueryStreamProgress, colorManipulator } from '@grafana/data';
import { t } from '@grafana/i18n';
import { Button, UPlotConfigBuilder, useStyles2 } from '@grafana/ui';

import { canRetryPanelQueries, retryPanelQueries } from './streamingRetry';

interface StreamingProgressPluginProps {
  config: UPlotConfigBuilder;
  progress?: QueryStreamProgress;
  /** Loading state of the panel, a cancelled query stops streaming without a final progress update */
  state?: LoadingState;
  /** Panel id, used to re-run the queries of this panel when the load was interrupted */
  panelId: number;
  /** Request currently rendered by the panel, progress of an older request is stale */
  requestId?: string;
}

interface UnloadedRegion {
  from: number;
  to: number;
  /** Parts are still arriving, as opposed to a load that was cancelled or that failed */
  isStreaming: boolean;
  hasError: boolean;
}

/**
 * Covers the part of the time range that has not been loaded yet while a query that was split into
 * several parts is resolving. Parts are fetched newest first, so the shimmer shrinks from left to
 * right as data arrives. If the load is cancelled or a part fails, the region stops shimmering and
 * offers to run the queries again.
 */
export const StreamingProgressPlugin = ({
  config,
  progress,
  state,
  panelId,
  requestId,
}: StreamingProgressPluginProps) => {
  const styles = useStyles2(getStyles);
  const region = getUnloadedRegion(progress, state, requestId);

  const plotRef = useRef<uPlot | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const regionRef = useRef<UnloadedRegion | null>(region);
  const stylesRef = useRef(styles);
  const updateRef = useRef<() => void>(() => {});
  const [retryContainer, setRetryContainer] = useState<HTMLDivElement | null>(null);

  regionRef.current = region;
  stylesRef.current = styles;

  useLayoutEffect(() => {
    const update = () => {
      const u = plotRef.current;
      const el = elementRef.current;

      if (!u || !el) {
        return;
      }

      const current = regionRef.current;

      if (!current) {
        el.style.display = 'none';
        return;
      }

      const left = Math.max(0, u.valToPos(current.from, 'x'));
      const right = Math.min(u.over.clientWidth, u.valToPos(current.to, 'x'));
      const width = right - left;

      if (!(width > 0)) {
        el.style.display = 'none';
        return;
      }

      el.className = current.hasError
        ? stylesRef.current.error
        : current.isStreaming
          ? stylesRef.current.loading
          : stylesRef.current.stopped;
      el.style.display = 'block';
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;

    };

    updateRef.current = update;

    config.addHook('init', (u) => {
      plotRef.current = u;

      const el = document.createElement('div');
      el.style.display = 'none';
      // The sweep travels inside the region, the region itself clips it
      el.appendChild(document.createElement('div'));
      // The retry button is centered on the region, outside the clipping element
      const retry = document.createElement('div');
      retry.className = stylesRef.current.retry;
      el.appendChild(retry);

      u.over.appendChild(el);
      elementRef.current = el;
      setRetryContainer(retry);

      update();
    });

    // Keep the overlay aligned with the x scale on zoom, resize and redraws
    config.addHook('setScale', update);
    config.addHook('setSize', update);
    config.addHook('draw', update);

    return () => {
      elementRef.current?.remove();
      elementRef.current = null;
      plotRef.current = null;
      setRetryContainer(null);
    };
  }, [config]);

  useEffect(() => {
    updateRef.current();
  }, [region, styles]);

  const showRetry = region !== null && !region.isStreaming && canRetryPanelQueries(panelId);

  if (!retryContainer || !showRetry) {
    return null;
  }

  return createPortal(
    <Button
      size="sm"
      variant="secondary"
      icon="sync"
      onClick={() => retryPanelQueries(panelId)}
      title={t('timeseries.streaming.reload-tooltip', 'Run the queries again, the full range is loaded from scratch')}
    >
      {t('timeseries.streaming.reload', 'Reload')}
    </Button>,
    retryContainer
  );
};

export function getUnloadedRegion(
  progress?: QueryStreamProgress,
  state?: LoadingState,
  requestId?: string
): UnloadedRegion | null {
  if (!progress) {
    return null;
  }

  // While a new request is loading, the panel keeps rendering the results of the previous one.
  // Its progress describes a range that is not being loaded anymore, ignore it.
  if (progress.requestId !== undefined && requestId !== undefined && progress.requestId !== requestId) {
    return null;
  }

  // A cancelled query never reports a final progress, the panel state is the source of truth for
  // whether parts are still on their way
  const isStreaming = progress.streaming && state !== LoadingState.Done && state !== LoadingState.Error;
  const hasError = Boolean(progress.hasError);

  if (!isStreaming && !hasError && progress.completedParts >= progress.totalParts) {
    return null;
  }

  // Parts are fetched newest first, so the missing range is normally on the left
  if (progress.loadedFromMs > progress.fromMs) {
    return { from: progress.fromMs, to: progress.loadedFromMs, isStreaming, hasError };
  }

  if (progress.loadedToMs < progress.toMs) {
    return { from: progress.loadedToMs, to: progress.toMs, isStreaming, hasError };
  }

  return null;
}

// Same shape as the react-loading-skeleton sweep: a highlight crossing the block and starting over
const shimmer = keyframes({
  '0%': { transform: 'translateX(-100%)' },
  '60%, 100%': { transform: 'translateX(350%)' },
});

const getStyles = (theme: GrafanaTheme2) => {
  const base = {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    pointerEvents: 'none' as const,
  };

  // The skeleton palette configured for react-loading-skeleton in ConfigProvider, kept translucent
  // so the grid lines of the empty region still show through
  const baseColor = colorManipulator.alpha(theme.colors.emphasize(theme.colors.background.secondary), 0.75);
  const highlightColor = theme.colors.emphasize(theme.colors.background.secondary, 0.1);

  return {
    loading: css({
      ...base,
      overflow: 'hidden',
      backgroundColor: 'transparent',
    }),
    // Cancelled: no animation, and lighter, the range is not coming on its own anymore
    stopped: css({
      ...base,
      backgroundColor: colorManipulator.alpha(baseColor, 0.5),
    }),
    error: css({
      ...base,
      backgroundColor: colorManipulator.alpha(theme.colors.error.main, 0.15),
    }),
    retry: css({
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      // The region itself is inert, the button inside it is not
      pointerEvents: 'auto',
      whiteSpace: 'nowrap',
    }),
  };
};
