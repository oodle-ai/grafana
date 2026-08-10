import { CoreApp, store } from '@grafana/data';
import { config } from '@grafana/runtime';

/**
 * How many parts a query should be split into for a given time range duration.
 */
export interface StreamingThreshold {
  durationMinutes: number;
  parts: number;
}

export interface QueryStreamingConfig {
  /** Turns query splitting on/off */
  enabled: boolean;
  /**
   * Thresholds define how many parts to split queries into based on time range duration
   * (in minutes). Queries shorter than the smallest threshold use a single request.
   */
  thresholds: StreamingThreshold[];
  /** Panel plugin ids that render progressive results correctly */
  panelTypes: string[];
  /** Datasource types that support splitting a range query by time */
  datasourceTypes: string[];
  /** Grafana apps (dashboard, panel editor, ...) where splitting is used */
  apps: string[];
}

/**
 * Default: 7+ days (10080 min) -> 10 parts, 3+ days (4320 min) -> 8 parts, 2+ days (2880 min) -> 6 parts,
 * 1+ day (1440 min) -> 4 parts, 12+ hours (720 min) -> 3 parts, 6+ hours (360 min) -> 2 parts.
 * Anything shorter than 6 hours runs as a single request.
 */
export const DEFAULT_STREAMING_THRESHOLDS: StreamingThreshold[] = [
  { durationMinutes: 10080, parts: 10 },
  { durationMinutes: 4320, parts: 8 },
  { durationMinutes: 2880, parts: 6 },
  { durationMinutes: 1440, parts: 4 },
  { durationMinutes: 720, parts: 3 },
  { durationMinutes: 360, parts: 2 },
];

export const DEFAULT_STREAMING_CONFIG: QueryStreamingConfig = {
  enabled: true,
  thresholds: DEFAULT_STREAMING_THRESHOLDS,
  panelTypes: ['timeseries'],
  datasourceTypes: ['prometheus'],
  apps: [CoreApp.Dashboard, CoreApp.PanelEditor, CoreApp.PanelViewer],
};

/**
 * Local storage key holding a JSON override of {@link DEFAULT_STREAMING_CONFIG}, e.g.
 * `{"thresholds":[{"durationMinutes":10080,"parts":10}]}`. Only the provided keys are overridden.
 */
export const STREAMING_CONFIG_STORAGE_KEY = 'grafana.query.streamingConfig';

/**
 * Server side kill switch. Turning this feature toggle on disables query splitting for everyone,
 * whatever the stored config says:
 *
 *   GF_FEATURE_TOGGLES_ENABLE=disableQuerySplitting
 *
 * or in grafana.ini / custom.ini:
 *
 *   [feature_toggles]
 *   disableQuerySplitting = true
 */
export const STREAMING_DISABLED_FEATURE_TOGGLE = 'disableQuerySplitting';

let cached: QueryStreamingConfig | undefined;

export function getQueryStreamingConfig(): QueryStreamingConfig {
  if (!cached) {
    cached = { ...DEFAULT_STREAMING_CONFIG, ...readOverrides() };

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
    if (isThresholdArray(parsed.thresholds)) {
      overrides.thresholds = parsed.thresholds;
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

function isThresholdArray(value: unknown): value is StreamingThreshold[] {
  return (
    Array.isArray(value) &&
    value.every((v) => v && typeof v.durationMinutes === 'number' && typeof v.parts === 'number' && v.parts > 0)
  );
}
