import { css } from '@emotion/css';
import { ReactNode, useCallback, useEffect, useState } from 'react';

import {
  DataFrame,
  EventBus,
  AbsoluteTimeRange,
  TimeZone,
  SplitOpen,
  LoadingState,
  ThresholdsConfig,
  TimeRange,
  ThresholdsMode, RawTimeRange,
} from '@grafana/data';
import { t } from '@grafana/i18n';
import { GraphThresholdsStyleConfig, PanelChrome, PanelChromeProps, useStyles2, GraphThresholdsStyleMode,
} from '@grafana/ui';
import { ExploreGraphStyle, ExploreTimeRangeOptions } from 'app/types/explore';

import { storeGraphStyle } from '../state/utils';

import { ExploreGraph } from './ExploreGraph';
import { ExploreGraphLabel } from './ExploreGraphLabel';
import { ExploreGraphTimeSelector } from "./ExploreTimeSelector";
import { loadGraphStyle } from './utils';
import {GrafanaTheme2} from "@grafana/data/";

const MAX_NUMBER_OF_TIME_SERIES = 20;

interface Props extends Pick<PanelChromeProps, 'statusMessage'> {
  width: number;
  height: number;
  data: DataFrame[];
  annotations?: DataFrame[];
  eventBus: EventBus;
  timeRange: TimeRange;
  timeZone: TimeZone;
  updateTimeRange?: (rawRange: RawTimeRange) => void;
  onChangeTime: (absoluteRange: AbsoluteTimeRange) => void;
  splitOpenFn: SplitOpen;
  loadingState: LoadingState;
  thresholdsConfig?: ThresholdsConfig;
  thresholdsStyle?: GraphThresholdsStyleConfig;
  warnThreshold?: number;
  criticalThreshold?: number;
  queryBuilderOnly?: boolean;
  hideQueryEditor?: boolean;
  hideMiniOptions?: boolean;
  title?: string;
  graphStyleOverride?: ExploreGraphStyle;
}

export const GraphContainer = ({
  title,
  data,
  eventBus,
  height,
  width,
  timeRange,
  timeZone,
  annotations,
  updateTimeRange,
  onChangeTime,
  splitOpenFn,
  thresholdsConfig,
  thresholdsStyle,
  loadingState,
  statusMessage,
  warnThreshold,
  criticalThreshold,
  queryBuilderOnly,
  hideQueryEditor,
  hideMiniOptions,
  graphStyleOverride,
}: Props) => {
  const [graphStyle, setGraphStyle] = useState<ExploreGraphStyle>(() => graphStyleOverride ?? loadGraphStyle());
  const [timeRangeOption, setTimeRangeOption] = useState<ExploreTimeRangeOptions>('24h');
  const styles = useStyles2(getStyles);

  useEffect(() => {
    if (graphStyleOverride) {
      setGraphStyle(graphStyleOverride);
    }
  }, [graphStyleOverride]);

  const onGraphStyleChange = useCallback((graphStyle: ExploreGraphStyle) => {
    storeGraphStyle(graphStyle);
    setGraphStyle(graphStyle);
  }, []);

  if (criticalThreshold || warnThreshold) {
    thresholdsStyle = {
      mode: GraphThresholdsStyleMode.Dashed,
    }

    let steps = [
      { value: 0, color: 'green', state: 'ok' },
    ];
    if (warnThreshold) {
      steps.push({ value: warnThreshold, color: 'yellow', state: 'warning' });
    }
    if (criticalThreshold) {
      steps.push({ value: criticalThreshold, color: 'red', state: 'critical' });
    }
    thresholdsConfig = {
      steps: steps,
      mode: ThresholdsMode.Absolute,
    };
  }

  const onTimeRangeChange = useCallback((timeRange: ExploreTimeRangeOptions) => {
    if (!updateTimeRange) {
      return;
    }

    updateTimeRange({ from: 'now-' + timeRange, to: 'now' });
    setTimeRangeOption(timeRange);
  }, [updateTimeRange]);

  let actions: ReactNode = null;
  if (!hideMiniOptions) {
    if (queryBuilderOnly && hideQueryEditor) {
      actions = <ExploreGraphTimeSelector timeRange={timeRangeOption} onChangeTimeRange={onTimeRangeChange} />
    } else {
      actions = <ExploreGraphLabel graphStyle={graphStyle} onChangeGraphStyle={onGraphStyleChange} />
    }
  }

  return (
    <PanelChrome
      title={title ? title : queryBuilderOnly ? '' : t('graph.container.title', 'Graph')}
      hideHeader={!title && queryBuilderOnly && hideQueryEditor && hideMiniOptions}
      titleItems={[
        (queryBuilderOnly && MAX_NUMBER_OF_TIME_SERIES >= data.length) && data.length > 0 && (
          <div key="series-count" className={styles.seriesCount}>
            {t('graph.container.series-count', '{{count}} series', { count: data.length })}
          </div>
        ),
      ].filter(Boolean)}
      width={width}
      height={height}
      loadingState={loadingState}
      statusMessage={statusMessage}
      actions={actions}
    >
      {(innerWidth, innerHeight) => (
        <ExploreGraph
          graphStyle={queryBuilderOnly ? 'lines' : graphStyle}
          data={data}
          height={innerHeight}
          width={innerWidth}
          timeRange={timeRange}
          onChangeTime={onChangeTime}
          timeZone={timeZone}
          annotations={annotations}
          splitOpenFn={splitOpenFn}
          loadingState={loadingState}
          thresholdsConfig={thresholdsConfig}
          thresholdsStyle={thresholdsStyle}
          eventBus={eventBus}
        />
      )}
    </PanelChrome>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  timeSeriesDisclaimer: css({
    label: 'time-series-disclaimer',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  warningMessage: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.colors.warning.main,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  seriesCount: css({
    label: 'series-count',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    display: 'flex',
    alignItems: 'center',
  }),
});
