import { css, keyframes } from '@emotion/css';
import { useEffect, useLayoutEffect, useRef } from 'react';
import uPlot from 'uplot';

import { GrafanaTheme2, QueryStreamProgress } from '@grafana/data';
import { UPlotConfigBuilder, useStyles2 } from '@grafana/ui';

interface StreamingProgressPluginProps {
  config: UPlotConfigBuilder;
  progress?: QueryStreamProgress;
}

/**
 * Shades the part of the time range that has not been loaded yet while a query that was split
 * into several parts is resolving. Parts are fetched newest first, so the shaded region shrinks
 * from left to right as data arrives. When a part fails, the remaining region is shaded in red.
 */
export const StreamingProgressPlugin = ({ config, progress }: StreamingProgressPluginProps) => {
  const styles = useStyles2(getStyles);

  const plotRef = useRef<uPlot | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<QueryStreamProgress | undefined>(progress);
  const stylesRef = useRef(styles);
  const updateRef = useRef<() => void>(() => {});

  progressRef.current = progress;
  stylesRef.current = styles;

  useLayoutEffect(() => {
    const update = () => {
      const u = plotRef.current;
      const el = elementRef.current;

      if (!u || !el) {
        return;
      }

      const current = progressRef.current;
      const region = getUnloadedRegion(current);

      if (!region) {
        el.style.display = 'none';
        return;
      }

      const left = Math.max(0, u.valToPos(region.from, 'x'));
      const right = Math.min(u.over.clientWidth, u.valToPos(region.to, 'x'));
      const width = right - left;

      if (!(width > 0)) {
        el.style.display = 'none';
        return;
      }

      el.className = current?.hasError ? stylesRef.current.error : stylesRef.current.loading;
      el.style.display = 'block';
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;
    };

    updateRef.current = update;

    config.addHook('init', (u) => {
      plotRef.current = u;

      const el = document.createElement('div');
      el.style.display = 'none';
      u.over.appendChild(el);
      elementRef.current = el;

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
    };
  }, [config]);

  useEffect(() => {
    updateRef.current();
  }, [progress, styles]);

  return null;
};

export function getUnloadedRegion(progress?: QueryStreamProgress): { from: number; to: number } | null {
  if (!progress || (!progress.streaming && !progress.hasError)) {
    return null;
  }

  // Parts are fetched newest first, so the missing range is normally on the left
  if (progress.loadedFromMs > progress.fromMs) {
    return { from: progress.fromMs, to: progress.loadedFromMs };
  }

  if (progress.loadedToMs < progress.toMs) {
    return { from: progress.loadedToMs, to: progress.toMs };
  }

  return null;
}

const pulse = keyframes({
  '0%': { opacity: 0.15 },
  '50%': { opacity: 0.35 },
  '100%': { opacity: 0.15 },
});

const getStyles = (theme: GrafanaTheme2) => {
  const base = {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    pointerEvents: 'none' as const,
  };

  return {
    loading: css({
      ...base,
      backgroundColor: theme.isDark ? theme.colors.border.medium : theme.colors.text.secondary,
      opacity: 0.25,
      [theme.transitions.handleMotion('no-preference')]: {
        animation: `${pulse} 1.5s ease-in-out infinite`,
      },
    }),
    error: css({
      ...base,
      backgroundColor: theme.colors.error.main,
      opacity: 0.15,
    }),
  };
};
