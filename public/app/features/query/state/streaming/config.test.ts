import { store } from '@grafana/data';
import { config } from '@grafana/runtime';

import {
  DEFAULT_STREAMING_CONFIG,
  STREAMING_CONFIG_STORAGE_KEY,
  clearQueryStreamingConfigCache,
  getQueryStreamingConfig,
  isQuerySplittingEnabled,
  setQueryStreamingConfig,
  setQuerySplittingEnabled,
} from './config';

describe('getQueryStreamingConfig', () => {
  beforeEach(() => {
    store.delete(STREAMING_CONFIG_STORAGE_KEY);
    delete config.featureToggles.disableQuerySplitting;
    clearQueryStreamingConfigCache();
  });

  it('returns the defaults when nothing is stored', () => {
    expect(getQueryStreamingConfig()).toEqual(DEFAULT_STREAMING_CONFIG);
  });

  it('overrides only the keys that are stored', () => {
    setQueryStreamingConfig({ thresholds: [{ durationMinutes: 60, parts: 4 }] });

    const config = getQueryStreamingConfig();

    expect(config.thresholds).toEqual([{ durationMinutes: 60, parts: 4 }]);
    expect(config.panelTypes).toEqual(DEFAULT_STREAMING_CONFIG.panelTypes);
    expect(config.enabled).toBe(true);
  });

  it('can turn splitting off', () => {
    setQueryStreamingConfig({ enabled: false });
    expect(getQueryStreamingConfig().enabled).toBe(false);
  });

  it('is turned off by the server side feature toggle, whatever is stored', () => {
    config.featureToggles.disableQuerySplitting = true;
    setQueryStreamingConfig({ enabled: true });

    expect(isQuerySplittingEnabled()).toBe(false);
  });

  it('toggles the flag without losing the other stored settings', () => {
    setQueryStreamingConfig({ thresholds: [{ durationMinutes: 60, parts: 4 }] });

    setQuerySplittingEnabled(false);
    expect(isQuerySplittingEnabled()).toBe(false);
    expect(getQueryStreamingConfig().thresholds).toEqual([{ durationMinutes: 60, parts: 4 }]);

    setQuerySplittingEnabled(true);
    expect(isQuerySplittingEnabled()).toBe(true);
    expect(getQueryStreamingConfig().thresholds).toEqual([{ durationMinutes: 60, parts: 4 }]);
  });

  it('splits ranges from 6 hours up by default', () => {
    expect(getQueryStreamingConfig().thresholds).toEqual([
      { durationMinutes: 10080, parts: 10 },
      { durationMinutes: 4320, parts: 8 },
      { durationMinutes: 2880, parts: 6 },
      { durationMinutes: 1440, parts: 4 },
      { durationMinutes: 720, parts: 3 },
      { durationMinutes: 360, parts: 2 },
    ]);
  });

  it('ignores malformed values', () => {
    store.set(STREAMING_CONFIG_STORAGE_KEY, '{"thresholds": "nope", "panelTypes": [1]}');
    clearQueryStreamingConfigCache();

    expect(getQueryStreamingConfig()).toEqual(DEFAULT_STREAMING_CONFIG);
  });

  it('ignores invalid json', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    store.set(STREAMING_CONFIG_STORAGE_KEY, 'not json');
    clearQueryStreamingConfigCache();

    expect(getQueryStreamingConfig()).toEqual(DEFAULT_STREAMING_CONFIG);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
