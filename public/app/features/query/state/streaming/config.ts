import { CoreApp, store } from '@grafana/data';
import { config } from '@grafana/runtime';

export interface QueryStreamingConfig {
  /** Turns query splitting on/off */
  enabled: boolean;
  /**
   * Longest range (in minutes) a single request may cover. Queries over this duration are split
   * into as many parts as needed, shorter ones run as a single request.
   */
  splitIntervalMinutes: number;
  /** Panel plugin ids that render progressive results correctly */
  panelTypes: string[];
  /** Datasource types that support splitting a range query by time */
  datasourceTypes: string[];
  /** Grafana apps (dashboard, panel editor, ...) where splitting is used */
  apps: string[];
}

/** 30 days: ranges up to this run as a single request, longer ones are split into 30 day parts */
export const DEFAULT_SPLIT_INTERVAL_MINUTES = 30 * 24 * 60;

export const DEFAULT_STREAMING_CONFIG: QueryStreamingConfig = {
  enabled: true,
  splitIntervalMinutes: DEFAULT_SPLIT_INTERVAL_MINUTES,
  panelTypes: ['timeseries'],
  datasourceTypes: ['prometheus'],
  apps: [CoreApp.Dashboard, CoreApp.PanelEditor, CoreApp.PanelViewer],
};

/**
 * Local storage key holding a JSON override of {@link DEFAULT_STREAMING_CONFIG}, e.g.
 * `{"splitIntervalMinutes":10080}`. Only the provided keys are overridden.
 */
export const STREAMING_CONFIG_STORAGE_KEY = 'grafana.query.streamingConfig';

let cached: QueryStreamingConfig | undefined;

export function getQueryStreamingConfig(): QueryStreamingConfig {
  if (!cached) {
    cached = { ...DEFAULT_STREAMING_CONFIG, ...readOverrides() };

    // Server side kill switch, set with GF_FEATURE_TOGGLES_ENABLE=disableQuerySplitting or
    // `disableQuerySplitting = true` under [feature_toggles]. It wins over the stored config.
    if (config.featureToggles.disableQuerySplitting) {
      cached.enabled = false;
    }
  }

  return cached;
}

export function setQueryStreamingConfig(overrides: Partial<QueryStreamingConfig> | null) {
  cached = undefined;

  if (overrides === null) {
    store.delete(STREAMING_CONFIG_STORAGE_KEY);
  } else {
    store.set(STREAMING_CONFIG_STORAGE_KEY, JSON.stringify(overrides));
  }
}

/** Turns query splitting on/off for this browser, persisted across sessions */
export function setQuerySplittingEnabled(enabled: boolean) {
  const stored = { ...readOverrides(), enabled };
  setQueryStreamingConfig(stored);
}

export function isQuerySplittingEnabled(): boolean {
  return getQueryStreamingConfig().enabled;
}

/** Only used by tests */
export function clearQueryStreamingConfigCache() {
  cached = undefined;
}

function readOverrides(): Partial<QueryStreamingConfig> {
  const raw = store.get(STREAMING_CONFIG_STORAGE_KEY);

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const overrides: Partial<QueryStreamingConfig> = {};
    if (typeof parsed.enabled === 'boolean') {
      overrides.enabled = parsed.enabled;
    }
    if (typeof parsed.splitIntervalMinutes === 'number' && parsed.splitIntervalMinutes > 0) {
      overrides.splitIntervalMinutes = parsed.splitIntervalMinutes;
    }
    if (isStringArray(parsed.panelTypes)) {
      overrides.panelTypes = parsed.panelTypes;
    }
    if (isStringArray(parsed.datasourceTypes)) {
      overrides.datasourceTypes = parsed.datasourceTypes;
    }
    if (isStringArray(parsed.apps)) {
      overrides.apps = parsed.apps;
    }
    return overrides;
  } catch (err) {
    console.error('Failed to parse query streaming config', err);
    return {};
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}
