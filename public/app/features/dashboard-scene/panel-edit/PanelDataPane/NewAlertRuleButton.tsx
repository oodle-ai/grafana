import { useMemo } from 'react';
import { useLocation } from 'react-router-dom-v5-compat';

import { urlUtil } from '@grafana/data';
import { Trans } from '@grafana/i18n';
import { getDataSourceSrv, locationService, logInfo } from '@grafana/runtime';
import { VizPanel } from '@grafana/scenes';
import { Button, Stack } from '@grafana/ui';
import { LogMessages } from 'app/features/alerting/unified/Analytics';
import { scenesPanelToRuleFormValues } from 'app/features/alerting/unified/utils/rule-form';

import { getDashboardSceneFor, getPanelIdForVizPanel, getQueryRunnerFor } from '../../utils/utils';
import { OODLE_PANEL_ID_LABEL } from './constants';

interface ScenesNewRuleFromPanelButtonProps {
  panel: VizPanel;
  className?: string;
}

export const ScenesNewRuleFromPanelButton = ({ panel, className }: ScenesNewRuleFromPanelButtonProps) => {
  const location = useLocation();
  const promqlQueries = useMemo(() => getPromQLQueries(panel), [panel]);

  const dashboardUid = getDashboardSceneFor(panel).state.uid ?? '';
  const panelId = getPanelIdForVizPanel(panel);
  const panelIdLabel = `${dashboardUid}-${panelId}`;

  const navigateToAlertCreation = async (expr?: string) => {
    logInfo(LogMessages.alertRuleFromPanel);

    const formValues = await scenesPanelToRuleFormValues(panel);
    const params: Record<string, string> = {
      defaults: JSON.stringify(formValues),
      returnTo: location.pathname + location.search,
      labels: JSON.stringify({ [OODLE_PANEL_ID_LABEL]: panelIdLabel }),
    };
    if (expr) {
      params.query = expr;
    }
    locationService.push(urlUtil.renderUrl('/alerting/new', params));
  };

  if (promqlQueries.length > 1) {
    return (
      <Stack direction="row" gap={1} wrap="wrap">
        {promqlQueries.map((q) => {
          const expr = getQueryExpr(q);
          return (
            <Button
              key={q.refId}
              icon="bell"
              onClick={() => navigateToAlertCreation(expr)}
              className={className}
              data-testid="create-alert-rule-button"
            >
              <Trans i18nKey="dashboard-scene.scenes-new-rule-from-panel-button.new-alert-rule">
                New alert rule
              </Trans>{' '}
              ({q.refId})
            </Button>
          );
        })}
      </Stack>
    );
  }

  const expr = promqlQueries.length === 1 ? getQueryExpr(promqlQueries[0]) : undefined;

  return (
    <Button
      icon="bell"
      onClick={() => navigateToAlertCreation(expr)}
      className={className}
      data-testid="create-alert-rule-button"
    >
      <Trans i18nKey="dashboard-scene.scenes-new-rule-from-panel-button.new-alert-rule">New alert rule</Trans>
    </Button>
  );
};

function getPromQLQueries(panel: VizPanel) {
  const queryRunner = getQueryRunnerFor(panel);
  if (!queryRunner) {
    return [];
  }

  return queryRunner.state.queries.filter((q) => {
    if (q.hide) {
      return false;
    }
    const dsType = resolveQueryDatasourceType(q.datasource, queryRunner.state.datasource);
    return dsType === 'prometheus';
  });
}

function resolveQueryDatasourceType(
  queryDs: unknown,
  runnerDs: { type?: string; uid?: string } | null | undefined
): string | undefined {
  const dsRef = getDatasourceRef(queryDs) ?? runnerDs;
  if (dsRef?.type) {
    return dsRef.type;
  }
  if (dsRef?.uid) {
    try {
      return getDataSourceSrv().getInstanceSettings({ uid: dsRef.uid })?.type;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function getDatasourceRef(ds: unknown): { type?: string; uid?: string } | undefined {
  if (ds != null && typeof ds === 'object') {
    const ref: { type?: string; uid?: string } = {};
    if ('type' in ds && typeof ds.type === 'string') {
      ref.type = ds.type;
    }
    if ('uid' in ds && typeof ds.uid === 'string') {
      ref.uid = ds.uid;
    }
    return ref.type || ref.uid ? ref : undefined;
  }
  return undefined;
}

function getQueryExpr(query: object): string | undefined {
  if ('expr' in query && typeof query.expr === 'string') {
    return query.expr;
  }
  return undefined;
}
