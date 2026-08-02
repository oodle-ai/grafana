import { PluginLoadingStrategy } from '@grafana/data';
import { config } from '@grafana/runtime';

import { clearPluginSettingsCache } from '../pluginSettings';

import { CACHE_INITIALISED_AT, DECOUPLED_PLUGIN_REGEX, PLUGIN_PATH_REGEX } from './constants';

const cache: Record<string, PluginInfo> = {};

type RegisterPluginInfo = {
  path: string;
  version: string;
  loadingStrategy: PluginLoadingStrategy;
};

type PluginInfo = Omit<RegisterPluginInfo, 'path'>;

export function registerPluginInfoInCache({ path, version, loadingStrategy }: RegisterPluginInfo): void {
  const key = extractCacheKeyFromPath(path);

  if (key && !cache[key]) {
    cache[key] = {
      version: encodeURI(version),
      loadingStrategy,
    };
  }
}

export function clearPluginInfoInCache(pluginId: string): void {
  const path = pluginId;
  if (cache[path]) {
    delete cache[path];
  }
  clearPluginSettingsCache(pluginId);
}

export function resolvePluginUrlWithCache(url: string, defaultBust = CACHE_INITIALISED_AT): string {
  const path = getCacheKey(url);
  if (!path) {
    return `${url}?_cache=${defaultBust}`;
  }
  const info = cache[path];
  const version = info?.version;
  const bust = getCorePluginCacheBust(version) || version || defaultBust;
  return `${url}?_cache=${bust}`;
}

// Core plugins report the Grafana version as their plugin version,
// so it is identical across every build of the same release. Their
// module.js also has a stable filename, so busting on the version
// leaves browsers serving a stale module for the asset max-age.
// The build commit changes on every build, so use that instead.
function getCorePluginCacheBust(
  version: string | undefined,
): string | undefined {
  const grafanaVersion = config.buildInfo?.version;
  if (!version || !grafanaVersion) {
    return undefined;
  }
  if (version !== encodeURI(grafanaVersion)) {
    return undefined;
  }
  const commit = config.buildInfo?.commit;
  return commit ? encodeURIComponent(commit) : undefined;
}

export function getPluginInfoFromCache(path: string): PluginInfo | undefined {
  const key = getCacheKey(path);
  if (!key) {
    return;
  }
  return cache[key];
}

export function extractCacheKeyFromPath(path: string): string | null {
  const match = path.match(PLUGIN_PATH_REGEX);

  if (match) {
    return match[1];
  }

  // Decoupled core plugins can be loaded by alternative paths
  const decoupledPluginMatch = path.match(DECOUPLED_PLUGIN_REGEX);

  if (decoupledPluginMatch) {
    return decoupledPluginMatch[1];
  }

  return null;
}

function getCacheKey(path: string): string | undefined {
  const key = Object.keys(cache).find((key) => path.includes(key));
  if (!key) {
    return;
  }
  return key;
}
