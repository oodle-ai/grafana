import { Scope } from '@grafana/data';
import { sceneGraph, SceneObject } from '@grafana/scenes';
import { startGPerformanceMeasure, stopGPerformanceMeasure } from 'app/core/utils/performance';

import { ScopesFacade } from './ScopesFacadeScene';
import { scopesDashboardsScene, scopesSelectorScene } from './instance';
import { getScopesFromSelectedScopes } from './internal/utils';

export function getSelectedScopes(): Scope[] {
  return getScopesFromSelectedScopes(scopesSelectorScene?.state.scopes ?? []);
}

export function getSelectedScopesNames(): string[] {
  return getSelectedScopes().map((scope) => scope.metadata.name);
}

export function enableScopes() {
  scopesSelectorScene?.enable();
  scopesDashboardsScene?.enable();
}

export function disableScopes() {
  scopesSelectorScene?.disable();
  scopesDashboardsScene?.disable();
}

export function exitScopesReadOnly() {
  scopesSelectorScene?.exitReadOnly();
  scopesDashboardsScene?.enable();
}

export function enterScopesReadOnly() {
  scopesSelectorScene?.enterReadOnly();
  scopesDashboardsScene?.disable();
}

export function getClosestScopesFacade(scene: SceneObject): ScopesFacade | null {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  startGPerformanceMeasure('getClosestScopesFacade');
  const result = sceneGraph.findObject(scene, (obj) => obj instanceof ScopesFacade) as ScopesFacade | null;
  stopGPerformanceMeasure('getClosestScopesFacade');
  return result;
}
