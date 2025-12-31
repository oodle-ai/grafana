import { css, cx } from '@emotion/css';

import { GrafanaTheme2, intervalToAbbreviatedDurationString } from '@grafana/data';
import { Trans, t } from '@grafana/i18n';
import { Icon, Stack, useStyles2, useTheme2 } from '@grafana/ui';
import alertDef from 'app/features/alerting/state/alertDef';
import { Spacer } from 'app/features/alerting/unified/components/Spacer';
import {
  alertStateToReadable,
  alertStateToState,
  getFirstActiveAt,
  prometheusRuleType,
} from 'app/features/alerting/unified/utils/rules';
import { PromAlertingRuleState } from 'app/types/unified-alerting-dto';

import { GRAFANA_RULES_SOURCE_NAME } from '../../../../features/alerting/unified/utils/datasource';
import { AlertInstanceTotalState, CombinedRuleWithLocation } from '../../../../types/unified-alerting';
import { AlertInstances } from '../AlertInstances';
import { getStyles } from '../UnifiedAlertList';
import { UnifiedAlertListOptions } from '../types';

type Props = {
  rules: CombinedRuleWithLocation[];
  options: UnifiedAlertListOptions;
  handleInstancesLimit?: (limit: boolean) => void;
  limitInstances: boolean;
  hideViewRuleLinkText?: boolean;
};

function getGrafanaInstancesTotal(totals: Partial<Record<AlertInstanceTotalState, number>>) {
  return Object.values(totals)
    .filter((total) => total !== undefined)
    .reduce((total, currentTotal) => total + currentTotal, 0);
}

const UngroupedModeView = ({ rules, options, handleInstancesLimit, limitInstances, hideViewRuleLinkText }: Props) => {
  const styles = useStyles2(getStyles);
  const stateStyle = useStyles2(getStateTagStyles);
  const theme = useTheme2();

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'critical':
        return theme.colors.error.main;
      case 'warn':
        return theme.colors.warning.main;
      case 'no_data':
        return theme.colors.text.secondary;
      default:
        return theme.colors.text.primary;
    }
  };

  const rulesToDisplay = rules.length <= options.maxItems ? rules : rules.slice(0, options.maxItems);

  return (
    <>
      <ol className={styles.alertRuleList}>
        {rulesToDisplay.map((ruleWithLocation, index) => {
          const { namespaceName, groupName } = ruleWithLocation;
          const alertingRule = prometheusRuleType.alertingRule(ruleWithLocation.promRule)
            ? ruleWithLocation.promRule
            : undefined;
          const firstActiveAt = getFirstActiveAt(alertingRule);

          const grafanaInstancesTotal =
            ruleWithLocation.dataSourceName === GRAFANA_RULES_SOURCE_NAME
              ? getGrafanaInstancesTotal(ruleWithLocation.instanceTotals)
              : undefined;
          const grafanaFilteredInstancesTotal =
            ruleWithLocation.dataSourceName === GRAFANA_RULES_SOURCE_NAME
              ? getGrafanaInstancesTotal(ruleWithLocation.filteredInstanceTotals)
              : undefined;

          const monitorID = ruleWithLocation?.labels?.['_oodle_monitor_id'];
          const severity = ruleWithLocation?.labels?.['severity'];
          const href = monitorID ? '/alerts?view=' + monitorID : undefined;
          if (alertingRule) {
            return (
              <li
                className={styles.alertRuleItem}
                key={`alert-${namespaceName}-${groupName}-${ruleWithLocation.name}-${index}`}
              >
                <div className={stateStyle.icon}>
                  <Icon
                    name={alertDef.getStateDisplayModel(alertingRule.state).iconClass}
                    className={stateStyle[alertStateToState(alertingRule.state)]}
                    size={'lg'}
                    style={
                      severity &&
                      (alertingRule.state === PromAlertingRuleState.Firing ||
                        alertingRule.state === PromAlertingRuleState.Pending)
                        ? { color: getSeverityColor(severity) }
                        : undefined
                    }
                  />
                </div>
                <div className={styles.alertNameWrapper}>
                  <div className={styles.instanceDetails}>
                    <Stack direction="row" gap={1}>
                      <div className={styles.alertName} title={ruleWithLocation.name}>
                        {ruleWithLocation.name}
                      </div>
                      <Spacer />
                      {href && (
                        <a
                          href={href}
                          target="__blank"
                          className={styles.link}
                          rel="noopener"
                          aria-label={t('alertlist.ungrouped-mode-view.aria-label-view-alert-rule', 'View alert rule')}
                        >
                          <span className={cx({ [styles.hidden]: hideViewRuleLinkText })}>View alert</span>
                          <Icon name={'external-link-alt'} size="sm" />
                        </a>
                      )}
                    </Stack>
                    <div className={styles.alertDuration}>
                      <span
                        className={stateStyle[alertStateToState(alertingRule.state)]}
                        style={
                          severity &&
                          (alertingRule.state === PromAlertingRuleState.Firing ||
                            alertingRule.state === PromAlertingRuleState.Pending)
                            ? { color: getSeverityColor(severity) }
                            : undefined
                        }
                      >
                        {severity &&
                        (alertingRule.state === PromAlertingRuleState.Firing ||
                          alertingRule.state === PromAlertingRuleState.Pending)
                          ? (severity.charAt(0).toUpperCase() + severity.slice(1).toLowerCase()).replace('_', ' ')
                          : alertStateToReadable(alertingRule.state)}
                      </span>{' '}
                      {firstActiveAt && alertingRule.state !== PromAlertingRuleState.Inactive && (
                        <Trans
                          i18nKey="alertlist.ungrouped-mode-view.active-for"
                          values={{
                            duration: intervalToAbbreviatedDurationString({ start: firstActiveAt, end: Date.now() }),
                          }}
                        >
                          for <span>{'{{duration}}'}</span>
                        </Trans>
                      )}
                    </div>
                  </div>
                  <AlertInstances
                    rule={ruleWithLocation}
                    alerts={alertingRule.alerts ?? []}
                    options={options}
                    grafanaTotalInstances={grafanaInstancesTotal}
                    grafanaFilteredInstancesTotal={grafanaFilteredInstancesTotal}
                    handleInstancesLimit={handleInstancesLimit}
                    limitInstances={limitInstances}
                  />
                </div>
              </li>
            );
          } else {
            return null;
          }
        })}
      </ol>
    </>
  );
};

const getStateTagStyles = (theme: GrafanaTheme2) => ({
  icon: css({
    marginTop: theme.spacing(2.5),
    alignSelf: 'flex-start',
  }),
  good: css({
    color: theme.colors.success.main,
  }),
  bad: css({
    color: theme.colors.error.main,
  }),
  warning: css({
    color: theme.colors.warning.main,
  }),
  neutral: css({
    color: theme.colors.secondary.main,
  }),
  info: css({
    color: theme.colors.primary.main,
  }),
});

export default UngroupedModeView;
