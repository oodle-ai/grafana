import { PanelPlugin, LogsSortOrder, LogsDedupStrategy, LogsDedupDescription } from '@grafana/data';

import { EventsPanel } from './EventsPanel';
import { EventsPanelSuggestionsSupplier } from './suggestions';
import { Options } from './types';

export const plugin = new PanelPlugin<Options>(EventsPanel)
    .setPanelOptions((builder) => {
        builder
            .addBooleanSwitch({
                path: 'showTime',
                name: 'Time',
                description: 'Show time column in table',
                defaultValue: false,
            })
            .addBooleanSwitch({
                path: 'showLabels',
                name: 'Unique labels',
                description: 'Show labels column in table',
                defaultValue: false,
            })
            .addBooleanSwitch({
                path: 'showCommonLabels',
                name: 'Common labels',
                description: 'Show common labels section',
                defaultValue: false,
            })
            .addBooleanSwitch({
                path: 'wrapLogMessage',
                name: 'Wrap lines',
                description: 'Wrap log messages in table cells',
                defaultValue: false,
            })
            .addBooleanSwitch({
                path: 'prettifyLogMessage',
                name: 'Prettify JSON',
                description: 'Prettify JSON in log messages',
                defaultValue: false,
            })
            .addBooleanSwitch({
                path: 'enableLogDetails',
                name: 'Enable event details',
                description: 'Enable event details panel',
                defaultValue: true,
            })
            .addBooleanSwitch({
                path: 'showHeader',
                name: 'Show header',
                description: 'Show table header',
                defaultValue: true,
            })
            .addBooleanSwitch({
                path: 'showTypeIcons',
                name: 'Show type icons',
                description: 'Show field type icons in table',
                defaultValue: false,
            })
            .addRadio({
                path: 'dedupStrategy',
                name: 'Deduplication',
                description: '',
                settings: {
                    options: [
                        { value: LogsDedupStrategy.none, label: 'None', description: LogsDedupDescription[LogsDedupStrategy.none] },
                        {
                            value: LogsDedupStrategy.exact,
                            label: 'Exact',
                            description: LogsDedupDescription[LogsDedupStrategy.exact],
                        },
                        {
                            value: LogsDedupStrategy.numbers,
                            label: 'Numbers',
                            description: LogsDedupDescription[LogsDedupStrategy.numbers],
                        },
                        {
                            value: LogsDedupStrategy.signature,
                            label: 'Signature',
                            description: LogsDedupDescription[LogsDedupStrategy.signature],
                        },
                    ],
                },
                defaultValue: LogsDedupStrategy.none,
            })
            .addRadio({
                path: 'sortOrder',
                name: 'Order',
                description: '',
                settings: {
                    options: [
                        { value: LogsSortOrder.Descending, label: 'Newest first' },
                        { value: LogsSortOrder.Ascending, label: 'Oldest first' },
                    ],
                },
                defaultValue: LogsSortOrder.Descending,
            })
            .addSelect({
                path: 'cellHeight',
                name: 'Cell height',
                description: 'Height of table cells',
                settings: {
                    options: [
                        { value: 'sm', label: 'Small' },
                        { value: 'md', label: 'Medium' },
                        { value: 'lg', label: 'Large' },
                    ],
                },
                defaultValue: 'sm',
            })
            .addBooleanSwitch({
                path: 'footer.show',
                name: 'Show footer',
                description: 'Show table footer with statistics',
                defaultValue: true,
            })
            .addBooleanSwitch({
                path: 'footer.enablePagination',
                name: 'Enable pagination',
                description: 'Enable pagination in table',
                defaultValue: false,
            })
            .addBooleanSwitch({
                path: 'footer.countRows',
                name: 'Count rows',
                description: 'Show row count in footer',
                defaultValue: true,
            });
    })
    .setSuggestionsSupplier(new EventsPanelSuggestionsSupplier()); 