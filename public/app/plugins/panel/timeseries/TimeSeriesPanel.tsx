import { css } from '@emotion/css';
import { useMemo, useState, useEffect } from 'react';
import { useToggle } from 'react-use';

import {
  PanelProps,
  DataFrameType,
  DashboardCursorSync,
  DataFrame,
  Field,
  alignTimeRangeCompareData,
  shouldAlignTimeCompare,
  useDataLinksContext,
  FieldType,
  GrafanaTheme2,
} from '@grafana/data';
import { t, Trans } from '@grafana/i18n';
import { PanelDataErrorView } from '@grafana/runtime';
import { TooltipDisplayMode, VizOrientation } from '@grafana/schema';
import { EventBusPlugin, KeyboardPlugin, TooltipPlugin2, usePanelContext, useStyles2, Icon, Button, Tooltip } from '@grafana/ui';
import { TimeRange2, TooltipHoverMode } from '@grafana/ui/internal';
import { TimeSeries } from 'app/core/components/TimeSeries/TimeSeries';
import { config } from 'app/core/config';
import { useShowAllTimeSeries } from 'app/features/dashboard-scene/scene/ShowAllTimeSeriesContext';
import { DataExplorerLink, getIndexPatternName } from 'app/features/logs/components/DataExplorerLink';
import { useDatasourcesFromTargets } from 'app/features/logs/components/useDatasourcesFromTargets';

import { TimeSeriesTooltip } from './TimeSeriesTooltip';
import { Options } from './panelcfg.gen';
import { AnnotationsPlugin2 } from './plugins/AnnotationsPlugin2';
import { ExemplarsPlugin, getVisibleLabels } from './plugins/ExemplarsPlugin';
import { OutsideRangePlugin } from './plugins/OutsideRangePlugin';
import { StreamingProgressPlugin } from './plugins/StreamingProgressPlugin';
import { ThresholdControlsPlugin } from './plugins/ThresholdControlsPlugin';
import { getPrepareTimeseriesSuggestion } from './suggestions';
import { getTimezones, prepareGraphableFields } from './utils';

const MAX_NUMBER_OF_TIME_SERIES = 20;

interface CustomAnnotation {
  timestamp: number;
  text: string;
  color?: string;
}

interface TimeSeriesPanelProps extends PanelProps<Options> { }

export const TimeSeriesPanel = ({
  data,
  timeRange,
  timeZone,
  width,
  height,
  options,
  fieldConfig,
  onChangeTimeRange,
  replaceVariables,
  id,
}: TimeSeriesPanelProps) => {
  const {
    sync,
    eventsScope,
    canAddAnnotations,
    onThresholdsChange,
    canEditThresholds,
    showThresholds,
    eventBus,
    canExecuteActions,
  } = usePanelContext();
  const showAllTimeSeriesFromDashboard = useShowAllTimeSeries();
  const [showAllSeriesLocal, toggleShowAllSeriesLocal] = useToggle(false);
  const showAllSeries = showAllTimeSeriesFromDashboard || showAllSeriesLocal;
  const toggleShowAllSeries = toggleShowAllSeriesLocal;
  const styles = useStyles2(getStyles);
  const [customAnnotations, setCustomAnnotations] = useState<DataFrame[]>([]);
  const dataSourcesMap = useDatasourcesFromTargets(data.request?.targets);

  // Check if any datasource has an index pattern (logs datasource) for the Data Explorer link
  const hasIndexPatternTargets = useMemo(() => {
    const targets = data.request?.targets;
    if (!targets || dataSourcesMap.size === 0) {
      return false;
    }
    return targets.some((target) => {
      const ds = dataSourcesMap.get(target.refId);
      return ds && getIndexPatternName(ds) !== null;
    });
  }, [data.request?.targets, dataSourcesMap]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const annotationsParam = searchParams.get('customAnnotations');
    if (annotationsParam) {
      try {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const parsedAnnotations = JSON.parse(annotationsParam) as CustomAnnotation[];
        // Convert custom annotations to DataFrame format
        const annotationFrames = parsedAnnotations.map(annotation => {
          const timeField: Field = {
            name: 'time',
            type: FieldType.time,
            values: [annotation.timestamp],
            config: {},
          };

          const textField: Field = {
            name: 'text',
            type: FieldType.string,
            values: [annotation.text],
            config: {},
          };

          const fields = [timeField, textField];
          if (annotation.color) {
            const colorField: Field = {
              name: 'color',
              type: FieldType.string,
              values: [annotation.color ?? ''],
              config: {},
            };

            fields.push(colorField);
          }

          return {
            fields: fields,
            length: 1,
            meta: {
              type: DataFrameType.TimeSeriesMulti,
            },
          };
        });

        setCustomAnnotations(annotationFrames);
      } catch (e) {
        console.error('Failed to parse annotations from URL:', e);
      }
    }
  }, []);

  const { dataLinkPostProcessor } = useDataLinksContext();

  const userCanExecuteActions = useMemo(() => canExecuteActions?.() ?? false, [canExecuteActions]);
  // Vertical orientation is not available for users through config.
  // It is simplified version of horizontal time series panel and it does not support all plugins.
  const isVerticallyOriented = options.orientation === VizOrientation.Vertical;
  const { frames, compareDiffMs } = useMemo(() => {
    const dataToUse = showAllSeries ? data.series : data.series.slice(0, MAX_NUMBER_OF_TIME_SERIES);
    let frames = prepareGraphableFields(dataToUse, config.theme2, timeRange);
    if (frames != null) {
      let compareDiffMs: number[] = [0];

      frames.forEach((frame: DataFrame) => {
        const diffMs = frame.meta?.timeCompare?.diffMs ?? 0;

        frame.fields.forEach((field) => {
          if (field.type !== FieldType.time) {
            compareDiffMs.push(diffMs);
          }
        });

        if (diffMs !== 0) {
          // Check if the compared frame needs time alignment
          // Apply alignment when time ranges match (no shift applied yet)
          const needsAlignment = shouldAlignTimeCompare(frame, frames, timeRange);

          if (needsAlignment) {
            alignTimeRangeCompareData(frame, diffMs, config.theme2);
          }
        }
      });

      return { frames, compareDiffMs };
    }

    return { frames };
  }, [data.series, showAllSeries, timeRange]);

  const timezones = useMemo(() => getTimezones(options.timezone, timeZone), [options.timezone, timeZone]);
  const suggestions = useMemo(() => {
    if (frames?.length && frames.every((df) => df.meta?.type === DataFrameType.TimeSeriesLong)) {
      const s = getPrepareTimeseriesSuggestion(id);
      return {
        message: 'Long data must be converted to wide',
        suggestions: s ? [s] : undefined,
      };
    }
    return undefined;
  }, [frames, id]);

  const enableAnnotationCreation = Boolean(canAddAnnotations && canAddAnnotations());
  const [newAnnotationRange, setNewAnnotationRange] = useState<TimeRange2 | null>(null);
  const cursorSync = sync?.() ?? DashboardCursorSync.Off;

  if (!frames || suggestions) {
    return (
      <PanelDataErrorView
        panelId={id}
        message={suggestions?.message}
        fieldConfig={fieldConfig}
        data={data}
        needsTimeField={true}
        needsNumberField={true}
        suggestions={suggestions?.suggestions}
      />
    );
  }

  // Combine dashboard annotations with custom annotations from URL
  const allAnnotations = [...(data.annotations ?? []), ...customAnnotations];

  const shouldShowSeriesWarning = !showAllSeries && MAX_NUMBER_OF_TIME_SERIES < data.series.length;

  return (
    <div className={styles.panelWrapper}>
      {hasIndexPatternTargets && (
        <div className={styles.panelHeader}>
          <DataExplorerLink
            targets={data.request?.targets}
            dataSourcesMap={dataSourcesMap}
            timeRange={timeRange}
          />
        </div>
      )}
      {shouldShowSeriesWarning && (
        <div className={styles.timeSeriesDisclaimer}>
          <span className={styles.warningMessage}>
            <Icon name="exclamation-triangle" aria-hidden="true" />
            <Trans i18nKey={'timeseries.panel.show-only-series'}>
              Showing only {{ MAX_NUMBER_OF_TIME_SERIES }} series
            </Trans>
          </span>
          <Tooltip
            content={t(
              'timeseries.panel.content',
              'Rendering too many series in a single panel may impact performance and make data harder to read. Consider refining your queries.'
            )}
          >
            <Button variant="secondary" size="sm" onClick={toggleShowAllSeries}>
              <Trans i18nKey={'timeseries.panel.show-all-series'}>Show all {{ length: data.series.length }}</Trans>
            </Button>
          </Tooltip>
        </div>
      )}
    <TimeSeries
      key={`timeseries-${showAllSeries}-${frames?.length}`}
      frames={frames}
      structureRev={data.structureRev}
      timeRange={timeRange}
      timeZone={timezones}
      width={width}
      height={shouldShowSeriesWarning ? height - 24 : height}
      legend={options.legend}
      options={options}
      replaceVariables={replaceVariables}
      dataLinkPostProcessor={dataLinkPostProcessor}
      cursorSync={cursorSync}
    >
      {(uplotConfig, alignedFrame) => {
        return (
          <>
            <KeyboardPlugin config={uplotConfig} />
            <StreamingProgressPlugin config={uplotConfig} progress={data.streamProgress} />
            {cursorSync !== DashboardCursorSync.Off && (
              <EventBusPlugin config={uplotConfig} eventBus={eventBus} frame={alignedFrame} />
            )}
            {options.tooltip.mode !== TooltipDisplayMode.None && (
              <TooltipPlugin2
                config={uplotConfig}
                hoverMode={
                  options.tooltip.mode === TooltipDisplayMode.Single ? TooltipHoverMode.xOne : TooltipHoverMode.xAll
                }
                queryZoom={onChangeTimeRange}
                clientZoom={true}
                syncMode={cursorSync}
                syncScope={eventsScope}
                getDataLinks={(seriesIdx, dataIdx) =>
                  alignedFrame.fields[seriesIdx].getLinks?.({ valueRowIndex: dataIdx }) ?? []
                }
                render={(u, dataIdxs, seriesIdx, isPinned = false, dismiss, timeRange2, viaSync, dataLinks) => {
                  if (enableAnnotationCreation && timeRange2 != null) {
                    setNewAnnotationRange(timeRange2);
                    dismiss();
                    return;
                  }

                  const annotate = () => {
                    let xVal = u.posToVal(u.cursor.left!, 'x');

                    setNewAnnotationRange({ from: xVal, to: xVal });
                    dismiss();
                  };

                  return (
                    // not sure it header time here works for annotations, since it's taken from nearest datapoint index
                    <TimeSeriesTooltip
                      series={alignedFrame}
                      dataIdxs={dataIdxs}
                      seriesIdx={seriesIdx}
                      mode={viaSync ? TooltipDisplayMode.Multi : options.tooltip.mode}
                      sortOrder={options.tooltip.sort}
                      hideZeros={options.tooltip.hideZeros}
                      isPinned={isPinned}
                      annotate={enableAnnotationCreation ? annotate : undefined}
                      maxHeight={options.tooltip.maxHeight}
                      replaceVariables={replaceVariables}
                      dataLinks={dataLinks}
                      canExecuteActions={userCanExecuteActions}
                      compareDiffMs={compareDiffMs}
                    />
                  );
                }}
                maxWidth={options.tooltip.maxWidth}
              />
            )}
            {!isVerticallyOriented && (
              <>
                <AnnotationsPlugin2
                  replaceVariables={replaceVariables}
                  annotations={allAnnotations}
                  config={uplotConfig}
                  timeZone={timeZone}
                  newRange={newAnnotationRange}
                  setNewRange={setNewAnnotationRange}
                />
                <OutsideRangePlugin config={uplotConfig} onChangeTimeRange={onChangeTimeRange} />
                {allAnnotations.length > 0 && (
                  <ExemplarsPlugin
                    visibleSeries={getVisibleLabels(uplotConfig, frames)}
                    config={uplotConfig}
                    exemplars={allAnnotations}
                    timeZone={timeZone}
                    maxHeight={options.tooltip.maxHeight}
                    maxWidth={options.tooltip.maxWidth}
                  />
                )}
                {((canEditThresholds && onThresholdsChange) || showThresholds) && (
                  <ThresholdControlsPlugin
                    config={uplotConfig}
                    fieldConfig={fieldConfig}
                    onThresholdsChange={canEditThresholds ? onThresholdsChange : undefined}
                  />
                )}
              </>
            )}
          </>
        );
      }}
    </TimeSeries>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  panelWrapper: css({
    position: 'relative',
    height: '100%',
    width: '100%',
  }),
  panelHeader: css({
    position: 'absolute',
    top: theme.spacing(-4),
    right: theme.spacing(4),
    zIndex: 1,
  }),
  timeSeriesDisclaimer: css({
    label: 'time-series-disclaimer',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    position: 'relative',
    top: theme.spacing(-1),
  }),
  warningMessage: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.colors.warning.main,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
