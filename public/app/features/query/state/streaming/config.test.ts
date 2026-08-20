import { store } from '@grafana/data';
import { config } from '@grafana/runtime';

import {
  DEFAULT_SPLIT_INTERVAL_MINUTES,
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
    setQueryStreamingConfig({ splitIntervalMinutes: 60 });

    const config = getQueryStreamingConfig();

    expect(config.splitIntervalMinutes).toBe(60);
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
    setQueryStreamingConfig({ splitIntervalMinutes: 60 });

    setQuerySplittingEnabled(false);
    expect(isQuerySplittingEnabled()).toBe(false);
    expect(getQueryStreamingConfig().splitIntervalMinutes).toBe(60);

    setQuerySplittingEnabled(true);
    expect(isQuerySplittingEnabled()).toBe(true);
    expect(getQueryStreamingConfig().splitIntervalMinutes).toBe(60);
  });

  it('splits ranges longer than 30 days by default', () => {
    expect(getQueryStreamingConfig().splitIntervalMinutes).toBe(DEFAULT_SPLIT_INTERVAL_MINUTES);
    expect(DEFAULT_SPLIT_INTERVAL_MINUTES).toBe(30 * 24 * 60);
  });

  it('ignores malformed values', () => {
    store.set(STREAMING_CONFIG_STORAGE_KEY, '{"splitIntervalMinutes": "nope", "panelTypes": [1]}');
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
