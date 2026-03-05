import { css } from '@emotion/css';
import { useMemo } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { Trans, t } from '@grafana/i18n';
import { config, getDataSourceSrv } from '@grafana/runtime';
import { SceneComponentProps, SceneObjectBase, SceneObjectRef, SceneObjectState, VizPanel } from '@grafana/scenes';
import { Alert, LoadingPlaceholder, Tab, useStyles2 } from '@grafana/ui';
import { contextSrv } from 'app/core/core';
import { alertRuleApi } from 'app/features/alerting/unified/api/alertRuleApi';
import { GRAFANA_RULER_CONFIG } from 'app/features/alerting/unified/api/featureDiscoveryApi';
import { RulesTable } from 'app/features/alerting/unified/components/rules/RulesTable';
import { combineRulesNamespace } from 'app/features/alerting/unified/hooks/useCombinedRuleNamespaces';
import { getRulesPermissions } from 'app/features/alerting/unified/utils/access-control';
import {
  getOodleRulesSources,
  getPrometheusRulesSources,
  GRAFANA_RULES_SOURCE_NAME,
} from 'app/features/alerting/unified/utils/datasource';
import { CombinedRule } from 'app/types/unified-alerting';

import { getDashboardSceneFor, getPanelIdForVizPanel } from '../../utils/utils';
import { OODLE_PANEL_ID_LABEL } from './constants';

import { ScenesNewRuleFromPanelButton } from './NewAlertRuleButton';
import { PanelDataPaneTab, PanelDataTabHeaderProps, TabId } from './types';

export interface PanelDataAlertingTabState extends SceneObjectState {
  panelRef: SceneObjectRef<VizPanel>;
}

export class PanelDataAlertingTab extends SceneObjectBase<PanelDataAlertingTabState> implements PanelDataPaneTab {
  static Component = PanelDataAlertingTabRendered;
  public tabId = TabId.Alert;

  public renderTab(props: PanelDataTabHeaderProps) {
    return <AlertingTab key={this.getTabLabel()} model={this} {...props} />;
  }

  public getTabLabel() {
    return t('dashboard-scene.panel-data-alerting-tab.tab-label', 'Alert');
  }

  public getDashboardUID() {
    const dashboard = this.getDashboard();
    return dashboard.state.uid!;
  }

  public getDashboard() {
    return getDashboardSceneFor(this);
  }

  public getLegacyPanelId() {
    return getPanelIdForVizPanel(this.state.panelRef.resolve());
  }

  public getCanCreateRules() {
    const rulesPermissions = getRulesPermissions('grafana');
    return (
      config.unifiedAlerting &&
      this.getDashboard().state.meta.canSave &&
      contextSrv.hasPermission(rulesPermissions.create)
    );
  }
}

function getExternalPrometheusSource() {
  const oodleSources = getOodleRulesSources();
  if (oodleSources.length > 0) {
    return oodleSources[0];
  }

  const promSources = getPrometheusRulesSources();
  if (promSources.length === 0) {
    return undefined;
  }

  try {
    const defaultDs = getDataSourceSrv().getInstanceSettings('default');
    return promSources.find((ds) => ds.uid === defaultDs?.uid) ?? promSources[0];
  } catch {
    return promSources[0];
  }
}

function deduplicateRules(rules: CombinedRule[]): CombinedRule[] {
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const labels = rule.promRule?.labels ?? rule.labels ?? {};
    const sortedLabels = Object.keys(labels)
      .sort()
      .map((k) => `${k}=${labels[k]}`)
      .join(',');
    const key = `${rule.name}|${sortedLabels}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function useAllAlertRules(panelIdLabel?: string) {
  const externalSource = useMemo(() => getExternalPrometheusSource(), []);

  const { currentData: grafanaPromRules, isLoading: grafanaPromLoading } =
    alertRuleApi.endpoints.prometheusRuleNamespaces.useQuery({
      ruleSourceName: GRAFANA_RULES_SOURCE_NAME,
    });

  const { currentData: rulerRules, isLoading: rulerLoading } = alertRuleApi.endpoints.rulerRules.useQuery({
    rulerConfig: GRAFANA_RULER_CONFIG,
  });

  const { currentData: externalPromRules, isLoading: externalLoading } =
    alertRuleApi.endpoints.prometheusRuleNamespaces.useQuery(
      { ruleSourceName: externalSource?.name ?? '' },
      { skip: !externalSource }
    );

  const rules = useMemo(() => {
    const grafanaCombined = combineRulesNamespace(
      GRAFANA_RULES_SOURCE_NAME,
      grafanaPromRules ?? [],
      rulerRules ?? undefined
    );
    const allNamespaces = [...grafanaCombined];

    if (externalSource && externalPromRules && externalPromRules.length > 0) {
      allNamespaces.push(...combineRulesNamespace(externalSource, externalPromRules));
    }

    const allRules = allNamespaces.flatMap((ns) => ns.groups).flatMap((group) => group.rules);
    const deduplicated = deduplicateRules(allRules);

    if (!panelIdLabel) {
      return deduplicated;
    }
    return deduplicated.filter(
      (rule) =>
        rule.promRule?.labels?.[OODLE_PANEL_ID_LABEL] === panelIdLabel ||
        rule.labels?.[OODLE_PANEL_ID_LABEL] === panelIdLabel
    );
  }, [grafanaPromRules, rulerRules, externalPromRules, externalSource, panelIdLabel]);

  return { rules, loading: grafanaPromLoading || rulerLoading || externalLoading };
}

function getPanelIdLabel(model: PanelDataAlertingTab): string | undefined {
  try {
    return `${model.getDashboardUID()}-${model.getLegacyPanelId()}`;
  } catch {
    return undefined;
  }
}

export function PanelDataAlertingTabRendered({ model }: SceneComponentProps<PanelDataAlertingTab>) {
  const styles = useStyles2(getStyles);
  const panelIdLabel = getPanelIdLabel(model);
  const { rules, loading } = useAllAlertRules(panelIdLabel);

  if (loading && !rules.length) {
    return (
      <LoadingPlaceholder
        text={t('dashboard-scene.panel-data-alerting-tab-rendered.text-loading-rules', 'Loading rules...')}
      />
    );
  }

  const panel = model.state.panelRef.resolve();
  const canCreateRules = model.getCanCreateRules();

  if (rules.length) {
    return (
      <>
        {canCreateRules && (
          <div className={styles.buttonRow}>
            <ScenesNewRuleFromPanelButton panel={panel} />
          </div>
        )}
        <RulesTable rules={rules} />
      </>
    );
  }

  const isNew = !Boolean(model.getDashboardUID());
  const dashboard = model.getDashboard();

  return (
    <div className={styles.noRulesWrapper}>
      {!isNew && (
        <>
          <p>
            <Trans i18nKey="dashboard.panel-edit.alerting-tab.no-rules">
              There are no alert rules linked to this panel.
            </Trans>
          </p>
          {canCreateRules && <ScenesNewRuleFromPanelButton panel={panel} />}
        </>
      )}
      {isNew && !!dashboard.state.meta.canSave && (
        <Alert
          severity="info"
          title={t(
            'dashboard-scene.panel-data-alerting-tab-rendered.title-dashboard-not-saved',
            'Dashboard not saved'
          )}
        >
          <Trans i18nKey="dashboard.panel-edit.alerting-tab.dashboard-not-saved">
            Dashboard must be saved before alerts can be added.
          </Trans>
        </Alert>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  buttonRow: css({
    display: 'flex',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
  }),
  noRulesWrapper: css({
    margin: theme.spacing(2),
    backgroundColor: theme.colors.background.secondary,
    padding: theme.spacing(3),
  }),
});

interface PanelDataAlertingTabHeaderProps extends PanelDataTabHeaderProps {
  model: PanelDataAlertingTab;
}

function AlertingTab(props: PanelDataAlertingTabHeaderProps) {
  const { model } = props;
  const panelIdLabel = getPanelIdLabel(model);
  const { rules } = useAllAlertRules(panelIdLabel);

  return (
    <Tab
      label={model.getTabLabel()}
      icon="bell"
      counter={rules.length}
      active={props.active}
      onChangeTab={props.onChangeTab}
    />
  );
}
