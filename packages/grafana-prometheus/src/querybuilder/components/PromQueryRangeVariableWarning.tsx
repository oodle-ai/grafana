import { css } from '@emotion/css';

import { AddPanelTransformationsEvent, DataTransformerID, GrafanaTheme2, PanelData, ReducerID } from '@grafana/data';
import { t, Trans } from '@grafana/i18n';
import { getAppEvents } from '@grafana/runtime';
import { Alert, Button, TextLink, useStyles2 } from '@grafana/ui';

import {
  DD_INTERVAL_VARIABLE,
  isRangeQuery,
  isSlowRangeVariableQuery,
  RANGE_VARIABLE_DOCS_URL,
  replaceRangeVariable,
} from '../../rangeVariable';
import { PromQuery } from '../../types';
import { canOptimizeRangeVariableQuery } from '../optimizeRangeQuery';
import { QueryEditorMode } from '../shared/types';

const STAT_PANEL_PLUGIN_ID = 'stat';

export interface Props {
  query: PromQuery;
  data?: PanelData;
  editorMode: QueryEditorMode;
  onChange: (update: PromQuery) => void;
  onRunQuery: () => void;
}

/**
 * Warns about queries that use $__range. A range query has to read the whole dashboard time range at
 * every single step, and an instant query re-reads it on every refresh. Explaining that in an alert
 * takes more words than anyone reads in one, so the alert only names the problem and links to the
 * docs, which have room for the step and lookback window it depends on.
 */
export function PromQueryRangeVariableWarning({ query, data, editorMode, onChange, onRunQuery }: Props) {
  const styles = useStyles2(getStyles);

  if (!isSlowRangeVariableQuery(query)) {
    return null;
  }

  // The code editor gets the louder, red version of the warning.
  const isCodeEditor = editorMode === QueryEditorMode.Code;
  const isRange = isRangeQuery(query);
  // The optimization turns one instant read of the whole range into a range query that is summed back
  // up, so it only applies to an instant query on a panel that shows a single number - a range query
  // already produces a series and needs a different fix. canOptimizeRangeVariableQuery then checks that
  // the rewrite provably preserves the value.
  const canOptimize =
    !isRange && data?.request?.panelPluginId === STAT_PANEL_PLUGIN_ID && canOptimizeRangeVariableQuery(query.expr);

  const onOptimize = () => {
    getAppEvents().publish(
      new AddPanelTransformationsEvent({
        panelId: data?.request?.panelId,
        transformations: [{ id: DataTransformerID.reduce, options: { reducers: [ReducerID.sum] } }],
      })
    );

    onChange({
      ...query,
      expr: replaceRangeVariable(query.expr, DD_INTERVAL_VARIABLE),
      // The step has to match the range selector, otherwise the summed data points overlap or leave gaps.
      interval: DD_INTERVAL_VARIABLE,
      // Reduce sums the data points of a series, so the instant query has to become a range query.
      range: true,
      instant: false,
    });
    onRunQuery();
  };

  return (
    <Alert
      severity={isCodeEditor ? 'error' : 'warning'}
      topSpacing={0}
      bottomSpacing={1}
      title={
        isCodeEditor
          ? t(
              'grafana-prometheus.querybuilder.prom-query-range-variable-warning.title-code',
              'Do not use $__range in this query'
            )
          : t(
              'grafana-prometheus.querybuilder.prom-query-range-variable-warning.title-builder',
              '$__range makes this a slow query'
            )
      }
    >
      <Trans i18nKey="grafana-prometheus.querybuilder.prom-query-range-variable-warning.docs">
        Read the{' '}
        <TextLink href={RANGE_VARIABLE_DOCS_URL} external>
          docs
        </TextLink>{' '}
        to learn more about this issue and how to optimize this query.
      </Trans>
      {canOptimize && (
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" icon="bolt" onClick={onOptimize}>
            <Trans i18nKey="grafana-prometheus.querybuilder.prom-query-range-variable-warning.optimize-query">
              Optimize query
            </Trans>
          </Button>
        </div>
      )}
    </Alert>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  actions: css({
    marginTop: theme.spacing(1),
  }),
});
