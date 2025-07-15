import { css, cx } from '@emotion/css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as React from 'react';

import {
    CoreApp,
    DataHoverClearEvent,
    DataHoverEvent,
    DataQueryResponse,
    Field,
    GrafanaTheme2,
    hasLogsContextSupport,
    hasLogsContextUiSupport,
    Labels,
    LogRowContextOptions,
    LogRowModel,
    LogsSortOrder,
    PanelProps,
    TimeRange,
    toUtc,
    urlUtil,
    DataFrame,
    FieldType,
    guessFieldTypeForField,
    sortDataFrame,
    applyFieldOverrides,
    ValueLinkConfig,
    DataTransformerConfig,
    CustomTransformOperator,
    transformDataFrame,
    lastValueFrom,
} from '@grafana/data';
import { config } from '@grafana/runtime';
import { AdHocFilterItem, CustomScrollbar, Table, usePanelContext, useStyles2 } from '@grafana/ui';
import { FILTER_FOR_OPERATOR, FILTER_OUT_OPERATOR } from '@grafana/ui/src/components/Table/types';
import { getFieldLinksForExplore } from 'app/features/explore/utils/links';
import { LogRowContextModal } from 'app/features/logs/components/log-context/LogRowContextModal';
import { PanelDataErrorView } from 'app/features/panel/components/PanelDataErrorView';
import { parseLogsFrame } from 'app/features/logs/logsFrame';

import { createAndCopyShortLink } from '../../../core/utils/shortLinks';
import { LogLabels } from '../../../features/logs/components/LogLabels';
import { COMMON_LABELS, dataFrameToLogsModel, dedupLogRows } from '../../../features/logs/logsModel';

import {
    isIsFilterLabelActive,
    isOnClickFilterLabel,
    isOnClickFilterOutLabel,
    isOnClickFilterOutString,
    isOnClickFilterString,
    isOnClickHideField,
    isOnClickShowField,
    Options,
} from './types';
import { useDatasourcesFromTargets } from './useDatasourcesFromTargets';

interface EventsPanelProps extends PanelProps<Options> {
    /**
     * Adds a key => value filter to the query referenced by the provided DataFrame refId. Used by Log details and Logs table.
     * onClickFilterLabel?: (key: string, value: string, frame?: DataFrame) => void;
     *
     * Adds a negative key => value filter to the query referenced by the provided DataFrame refId. Used by Log details and Logs table.
     * onClickFilterOutLabel?: (key: string, value: string, frame?: DataFrame) => void;
     *
     * Adds a string filter to the query referenced by the provided DataFrame refId. Used by the Logs popover menu.
     * onClickFilterOutString?: (value: string, refId?: string) => void;
     *
     * Removes a string filter to the query referenced by the provided DataFrame refId. Used by the Logs popover menu.
     * onClickFilterString?: (value: string, refId?: string) => void;
     *
     * Determines if a given key => value filter is active in a given query. Used by Log details.
     * isFilterLabelActive?: (key: string, value: string, refId?: string) => Promise<boolean>;
     *
     * Array of field names to display instead of the log line. Pass a list of fields or an empty array to enable hide/show fields in Log Details.
     * displayedFields?: string[]
     *
     * Called from the "eye" icon in Log Details to request showing the displayed field. If ommited, a default implementation is used.
     * onClickShowField?: (key: string) => void;
     *
     * Called from the "eye" icon in Log Details to request hiding the displayed field. If ommited, a default implementation is used.
     * onClickHideField?: (key: string) => void;
     */
}
interface LogsPermalinkUrlState {
    logs?: {
        id?: string;
    };
}

const noCommonLabels: Labels = {};

export const EventsPanel = ({
    data,
    timeZone,
    fieldConfig,
    options: {
        showLabels,
        showTime,
        wrapLogMessage,
        showCommonLabels,
        prettifyLogMessage,
        sortOrder,
        dedupStrategy,
        enableLogDetails,
        showLogContextToggle,
        onClickFilterLabel,
        onClickFilterOutLabel,
        onClickFilterOutString,
        onClickFilterString,
        isFilterLabelActive,
        frameIndex,
        showHeader,
        showTypeIcons,
        footer,
        cellHeight,
        sortBy,
        ...options
    },
    id,
}: EventsPanelProps) => {
    const isAscending = sortOrder === LogsSortOrder.Ascending;
    const style = useStyles2(getStyles);
    const [scrollTop, setScrollTop] = useState(0);
    const logsContainerRef = useRef<HTMLDivElement>(null);
    const [contextRow, setContextRow] = useState<LogRowModel | null>(null);
    const timeRange = data.timeRange;
    const dataSourcesMap = useDatasourcesFromTargets(data.request?.targets);
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    const [displayedFields, setDisplayedFields] = useState<string[]>(options.displayedFields ?? []);
    let closeCallback = useRef<() => void>();

    const { eventBus, onAddAdHocFilter } = usePanelContext();

    const onLogRowHover = useCallback(
        (row?: LogRowModel) => {
            if (row) {
                eventBus.publish(
                    new DataHoverEvent({
                        point: {
                            time: row.timeEpochMs,
                        },
                    })
                );
            }
        },
        [eventBus]
    );

    const onLogContainerMouseLeave = useCallback(() => {
        eventBus.publish(new DataHoverClearEvent());
    }, [eventBus]);

    const onCloseContext = useCallback(() => {
        setContextRow(null);
        if (closeCallback.current) {
            closeCallback.current();
        }
    }, [closeCallback]);

    const onOpenContext = useCallback(
        (row: LogRowModel, onClose: () => void) => {
            setContextRow(row);
            closeCallback.current = onClose;
        },
        [closeCallback]
    );

    const onPermalinkClick = useCallback(
        async (row: LogRowModel) => {
            return await copyDashboardUrl(row, timeRange);
        },
        [timeRange]
    );

    const showContextToggle = useCallback(
        (row: LogRowModel): boolean => {
            if (
                !row.dataFrame.refId ||
                !dataSourcesMap ||
                (!showLogContextToggle &&
                    data.request?.app !== CoreApp.Dashboard &&
                    data.request?.app !== CoreApp.PanelEditor &&
                    data.request?.app !== CoreApp.PanelViewer)
            ) {
                return false;
            }

            const dataSource = dataSourcesMap.get(row.dataFrame.refId);
            return hasLogsContextSupport(dataSource);
        },
        [dataSourcesMap, showLogContextToggle, data.request?.app]
    );

    const showPermaLink = useCallback(() => {
        return !(
            data.request?.app !== CoreApp.Dashboard &&
            data.request?.app !== CoreApp.PanelEditor &&
            data.request?.app !== CoreApp.PanelViewer
        );
    }, [data.request?.app]);

    const getLogRowContext = useCallback(
        async (row: LogRowModel, origRow: LogRowModel, options: LogRowContextOptions): Promise<DataQueryResponse> => {
            if (!origRow.dataFrame.refId || !dataSourcesMap) {
                return Promise.resolve({ data: [] });
            }

            const query = data.request?.targets[0];
            if (!query) {
                return Promise.resolve({ data: [] });
            }

            const dataSource = dataSourcesMap.get(origRow.dataFrame.refId);
            if (!hasLogsContextSupport(dataSource)) {
                return Promise.resolve({ data: [] });
            }

            return dataSource.getLogRowContext(row, options, query);
        },
        [data.request?.targets, dataSourcesMap]
    );

    const getLogRowContextUi = useCallback(
        (origRow: LogRowModel, runContextQuery?: () => void): React.ReactNode => {
            if (!origRow.dataFrame.refId || !dataSourcesMap) {
                return <></>;
            }

            const query = data.request?.targets[0];
            if (!query) {
                return <></>;
            }

            const dataSource = dataSourcesMap.get(origRow.dataFrame.refId);
            if (!hasLogsContextUiSupport(dataSource)) {
                return <></>;
            }

            if (!dataSource.getLogRowContextUi) {
                return <></>;
            }

            return dataSource.getLogRowContextUi(origRow, runContextQuery, query);
        },
        [data.request?.targets, dataSourcesMap]
    );

    // Important to memoize stuff here, as panel rerenders a lot for example when resizing.
    const [logRows, deduplicatedRows, commonLabels] = useMemo(() => {
        const logs = data
            ? dataFrameToLogsModel(data.series, data.request?.intervalMs, undefined, data.request?.targets)
            : null;
        const logRows = logs?.rows || [];
        const commonLabels = logs?.meta?.find((m) => m.label === COMMON_LABELS);
        const deduplicatedRows = dedupLogRows(logRows, dedupStrategy);
        return [logRows, deduplicatedRows, commonLabels];
    }, [data, dedupStrategy]);

    useLayoutEffect(() => {
        if (isAscending && logsContainerRef.current) {
            setScrollTop(logsContainerRef.current.offsetHeight);
        } else {
            setScrollTop(0);
        }
    }, [isAscending, logRows]);

    const getFieldLinks = useCallback(
        (field: Field, rowIndex: number) => {
            return getFieldLinksForExplore({ field, rowIndex, range: data.timeRange });
        },
        [data]
    );

    /**
     * Scrolls the given row into view.
     */
    const scrollIntoView = useCallback(
        (row: HTMLElement) => {
            scrollElement?.scrollTo({
                top: row.offsetTop,
                behavior: 'smooth',
            });
        },
        [scrollElement]
    );

    const handleOnClickFilterLabel = useCallback(
        (key: string, value: string) => {
            onAddAdHocFilter?.({
                key,
                value,
                operator: '=',
            });
        },
        [onAddAdHocFilter]
    );

    const handleOnClickFilterOutLabel = useCallback(
        (key: string, value: string) => {
            onAddAdHocFilter?.({
                key,
                value,
                operator: '!=',
            });
        },
        [onAddAdHocFilter]
    );

    const showField = useCallback(
        (key: string) => {
            const index = displayedFields?.indexOf(key);
            if (index === -1) {
                setDisplayedFields(displayedFields?.concat(key));
            }
        },
        [displayedFields]
    );

    const hideField = useCallback(
        (key: string) => {
            const index = displayedFields?.indexOf(key);
            if (index !== undefined && index > -1) {
                setDisplayedFields(displayedFields?.filter((k) => key !== k));
            }
        },
        [displayedFields]
    );

    useEffect(() => {
        if (options.displayedFields) {
            setDisplayedFields(options.displayedFields);
        }
    }, [options.displayedFields]);

    // Convert log rows to DataFrame for table display
    const tableDataFrame = useMemo(() => {
        if (!logRows || logRows.length === 0) {
            return null;
        }

        // Create fields for the table
        const fields: Field[] = [];

        // Add time field if enabled
        if (showTime) {
            fields.push({
                name: 'Time',
                type: FieldType.time,
                values: logRows.map(row => row.timeEpochMs),
                config: {
                    custom: {
                        width: 150,
                    },
                },
            });
        }

        // Add labels field if enabled
        if (showLabels) {
            fields.push({
                name: 'Labels',
                type: FieldType.string,
                values: logRows.map(row => {
                    const labels = row.uniqueLabels || {};
                    return Object.entries(labels)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(', ');
                }),
                config: {
                    custom: {
                        width: 200,
                    },
                },
            });
        }

        // Add log level field
        fields.push({
            name: 'Level',
            type: FieldType.string,
            values: logRows.map(row => row.logLevel),
            config: {
                custom: {
                    width: 80,
                },
            },
        });

        // Add log message field
        fields.push({
            name: 'Message',
            type: FieldType.string,
            values: logRows.map(row => row.entry),
            config: {
                custom: {
                    width: 400,
                },
            },
        });

        // Add displayed fields if any
        if (displayedFields && displayedFields.length > 0) {
            displayedFields.forEach(fieldName => {
                fields.push({
                    name: fieldName,
                    type: FieldType.string,
                    values: logRows.map(row => {
                        const field = row.dataFrame.fields.find(f => f.name === fieldName);
                        return field ? field.values.get(row.rowIndex) : '';
                    }),
                    config: {
                        custom: {
                            width: 150,
                        },
                    },
                });
            });
        }

        const frame: DataFrame = {
            name: 'Logs Table',
            fields,
            length: logRows.length,
            refId: 'events',
        };

        // Sort the frame by time if time field exists
        if (showTime && fields.length > 0) {
            const timeFieldIndex = fields.findIndex(f => f.name === 'Time');
            if (timeFieldIndex >= 0) {
                return sortDataFrame(frame, timeFieldIndex, !isAscending);
            }
        }

        return frame;
    }, [logRows, showTime, showLabels, displayedFields, isAscending]);

    // Prepare table frame with field overrides
    const preparedTableFrame = useMemo(() => {
        if (!tableDataFrame) {
            return null;
        }

        const [frameWithOverrides] = applyFieldOverrides({
            data: [tableDataFrame],
            timeZone,
            theme: config.theme2,
            replaceVariables: (v: string) => v,
            fieldConfig: {
                defaults: {
                    custom: {},
                },
                overrides: [],
            },
        });

        // Add field links and configuration
        for (const field of frameWithOverrides.fields) {
            field.getLinks = (config: ValueLinkConfig) => {
                return getFieldLinksForExplore({
                    field,
                    rowIndex: config.valueRowIndex!,
                    range: data.timeRange,
                });
            };

            field.config = {
                ...field.config,
                custom: {
                    inspect: true,
                    filterable: true,
                    width: getInitialFieldWidth(field),
                    ...field.config.custom,
                },
                filterable: true,
            };

            // Try to guess better type for numeric support
            field.type = field.type === FieldType.string ? (guessFieldTypeForField(field) ?? FieldType.string) : field.type;
        }

        return frameWithOverrides;
    }, [tableDataFrame, timeZone, data.timeRange]);

    if (!data || logRows.length === 0) {
        return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsStringField />;
    }

    const renderCommonLabels = () => (
        <div className={cx(style.labelContainer, isAscending && style.labelContainerAscending)}>
            <span className={style.label}>Common labels:</span>
            <LogLabels
                labels={typeof commonLabels?.value === 'object' ? commonLabels?.value : noCommonLabels}
                emptyMessage="(no common labels)"
            />
        </div>
    );

    // Passing callbacks control the display of the filtering buttons. We want to pass it only if onAddAdHocFilter is defined.
    const defaultOnClickFilterLabel = onAddAdHocFilter ? handleOnClickFilterLabel : undefined;
    const defaultOnClickFilterOutLabel = onAddAdHocFilter ? handleOnClickFilterOutLabel : undefined;

    const onClickShowField = isOnClickShowField(options.onClickShowField) ? options.onClickShowField : showField;
    const onClickHideField = isOnClickHideField(options.onClickHideField) ? options.onClickHideField : hideField;

    const onCellFilterAdded = (filter: AdHocFilterItem) => {
        const { value, key, operator } = filter;
        if (!defaultOnClickFilterLabel || !defaultOnClickFilterOutLabel) {
            return;
        }
        if (operator === FILTER_FOR_OPERATOR) {
            defaultOnClickFilterLabel(key, value);
        }
        if (operator === FILTER_OUT_OPERATOR) {
            defaultOnClickFilterOutLabel(key, value);
        }
    };

    return (
        <>
            {contextRow && (
                <LogRowContextModal
                    open={contextRow !== null}
                    row={contextRow}
                    onClose={onCloseContext}
                    getRowContext={(row, options) => getLogRowContext(row, contextRow, options)}
                    logsSortOrder={sortOrder}
                    timeZone={timeZone}
                    getLogRowContextUi={getLogRowContextUi}
                />
            )}
            <CustomScrollbar
                autoHide
                scrollTop={scrollTop}
                scrollRefCallback={(scrollElement) => setScrollElement(scrollElement)}
            >
                <div onMouseLeave={onLogContainerMouseLeave} className={style.container} ref={logsContainerRef}>
                    {showCommonLabels && !isAscending && renderCommonLabels()}
                    {preparedTableFrame && (
                        <Table
                            data={preparedTableFrame}
                            width={data.width}
                            height={data.height}
                            noHeader={!showHeader}
                            showTypeIcons={showTypeIcons}
                            resizable={true}
                            initialSortBy={sortBy}
                            onCellFilterAdded={onCellFilterAdded}
                            footerOptions={footer}
                            enablePagination={footer?.enablePagination}
                            cellHeight={cellHeight}
                            timeRange={timeRange}
                            fieldConfig={fieldConfig}
                        />
                    )}
                    {showCommonLabels && isAscending && renderCommonLabels()}
                </div>
            </CustomScrollbar>
        </>
    );
};

const getStyles = (theme: GrafanaTheme2) => ({
    container: css({
        marginBottom: theme.spacing(1.5),
    }),
    labelContainer: css({
        margin: theme.spacing(0, 0, 0.5, 0.5),
        display: 'flex',
        alignItems: 'center',
    }),
    labelContainerAscending: css({
        margin: theme.spacing(0.5, 0, 0.5, 0),
    }),
    label: css({
        marginRight: theme.spacing(0.5),
        fontSize: theme.typography.bodySmall.fontSize,
        fontWeight: theme.typography.fontWeightMedium,
    }),
});

function getInitialFieldWidth(field: Field): number {
    switch (field.name) {
        case 'Time':
            return 150;
        case 'Level':
            return 80;
        case 'Labels':
            return 200;
        case 'Message':
            return 400;
        default:
            return 150;
    }
}

function getLogsPanelState(): LogsPermalinkUrlState | undefined {
    const urlParams = urlUtil.getUrlSearchParams();
    const panelStateEncoded = urlParams?.panelState;
    if (
        panelStateEncoded &&
        Array.isArray(panelStateEncoded) &&
        panelStateEncoded?.length > 0 &&
        typeof panelStateEncoded[0] === 'string'
    ) {
        try {
            return JSON.parse(panelStateEncoded[0]);
        } catch (e) {
            console.error('error parsing logsPanelState', e);
        }
    }

    return undefined;
}

async function copyDashboardUrl(row: LogRowModel, timeRange: TimeRange) {
    // this is an extra check, to be sure that we are not
    // creating permalinks for logs without an id-field.
    // normally it should never happen, because we do not
    // display the permalink button in such cases.
    if (row.rowId === undefined || !row.dataFrame.refId) {
        return;
    }

    // get panel state, add log-row-id
    const panelState = {
        logs: { id: row.uid },
    };

    // Grab the current dashboard URL
    const currentURL = new URL(window.location.href);

    // Add panel state containing the rowId, and absolute time range from the current query, but leave everything else the same, if the user is in edit mode when grabbing the link, that's what will be linked to, etc.
    currentURL.searchParams.set('panelState', JSON.stringify(panelState));
    currentURL.searchParams.set('from', toUtc(timeRange.from).valueOf().toString(10));
    currentURL.searchParams.set('to', toUtc(timeRange.to).valueOf().toString(10));

    await createAndCopyShortLink(currentURL.toString());

    return Promise.resolve();
} 