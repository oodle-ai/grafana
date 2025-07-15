import { LogsDedupStrategy, LogsSortOrder } from '@grafana/data';

export class EventsPanelSuggestionsSupplier {
    getSuggestionsForData(data: any) {
        if (!data || !data.series || data.series.length === 0) {
            return [];
        }

        const suggestions = [];

        // Check if the data contains log-like fields
        const hasLogFields = data.series.some((series: any) => {
            return series.fields.some((field: any) => {
                return field.name === 'message' || field.name === 'log' || field.name === 'text';
            });
        });

        if (hasLogFields) {
            suggestions.push({
                type: 'events',
                title: 'Events',
                description: 'Display events in a table format',
                options: {
                    showTime: true,
                    showLabels: true,
                    showCommonLabels: false,
                    wrapLogMessage: false,
                    prettifyLogMessage: false,
                    enableLogDetails: true,
                    showLogContextToggle: false,
                    dedupStrategy: LogsDedupStrategy.none,
                    sortOrder: LogsSortOrder.Descending,
                    showHeader: true,
                    showTypeIcons: false,
                    cellHeight: 'sm',
                    footer: {
                        show: true,
                        enablePagination: false,
                        countRows: true,
                        reducer: ['count'],
                    },
                },
            });
        }

        return suggestions;
    }
} 