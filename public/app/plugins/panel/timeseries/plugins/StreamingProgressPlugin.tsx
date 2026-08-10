import { css, keyframes } from '@emotion/css';
import { useEffect, useLayoutEffect, useRef } from 'react';
import uPlot from 'uplot';

import { GrafanaTheme2, QueryStreamProgress, colorManipulator } from '@grafana/data';
import { UPlotConfigBuilder, useStyles2 } from '@grafana/ui';

interface StreamingProgressPluginProps {
  config: UPlotConfigBuilder;
  progress?: QueryStreamProgress;
}

/**
 * Covers the part of the time range that has not been loaded yet, with the same shimmer used by
 * the loading skeletons, while a query that was split into several parts is resolving. Parts are
 * fetched newest first, so the shimmer shrinks from left to right as data arrives. When a part
 * fails, the remaining region turns into a static red shade instead.
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

      const hasError = Boolean(current?.hasError);
      el.className = hasError ? stylesRef.current.error : stylesRef.current.loading;
      el.style.display = 'block';
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;

      const sweep = el.firstElementChild;
      if (sweep instanceof HTMLElement) {
        sweep.className = hasError ? '' : stylesRef.current.sweep;
      }
    };

    updateRef.current = update;

    config.addHook('init', (u) => {
      plotRef.current = u;

      const el = document.createElement('div');
      el.style.display = 'none';
      // The sweep travels inside the region, the region itself clips it
      el.appendChild(document.createElement('div'));
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

// The highlight travels across the skeleton and off its right edge, then starts over
const shimmer = keyframes({
  '0%': { transform: 'translateX(-100%)' },
  '50%': { transform: 'translateX(350%)' },
  '100%': { transform: 'translateX(-100%)' },
});

// Fallback for reduced motion: the block fades instead of sweeping
const pulse = keyframes({
  '0%': { opacity: 1 },
  '50%': { opacity: 0.5 },
  '100%': { opacity: 1 },
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
      overflow: 'hidden',
      backgroundColor: colorManipulator.alpha(theme.colors.text.secondary, theme.isDark ? 0.12 : 0.1),
      // Without the sweep, fade the block instead so it still reads as loading
      [theme.transitions.handleMotion('reduce')]: {
        animation: `${pulse} 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`,
      },
    }),
    sweep: css({
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      width: '35%',
      backgroundImage: `linear-gradient(90deg, transparent, ${colorManipulator.alpha(
        theme.colors.text.primary,
        theme.isDark ? 0.12 : 0.08
      )}, transparent)`,
      [theme.transitions.handleMotion('reduce')]: {
        display: 'none',
      },
      [theme.transitions.handleMotion('no-preference')]: {
        animation: `${shimmer} 1.5s ease-in-out infinite`,
      },
    }),
    error: css({
      ...base,
      backgroundColor: theme.colors.error.main,
      opacity: 0.15,
    }),
  };
};
