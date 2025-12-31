import {
    DataTransformerID,
    standardTransformers,
    TransformerRegistryItem,
    TransformerUIProps,
    TransformerCategory,
    EventDistributionTransformerOptions,
} from '@grafana/data';
import { selectors } from '@grafana/e2e-selectors';
import { Alert } from '@grafana/ui';

import { getTransformationContent } from '../docs/getTransformationContent';
import darkImage from '../images/dark/eventDistribution.svg';
import lightImage from '../images/light/eventDistribution.svg';

export const EventDistributionTransformerEditor = ({
    input,
    options,
    onChange,
}: TransformerUIProps<EventDistributionTransformerOptions>) => {
    return (
        <div data-testid={selectors.components.TransformTab.transformationEditor('Event Distribution')}>
            <Alert
                title="Time Field Configuration"
                severity="info"
            >
                <code>oodle_event_time_epoch_ms</code> label is considered the time field for this transformer.
            </Alert>
        </div>
    );
};

export const eventDistributionTransformerRegistryItem: TransformerRegistryItem<EventDistributionTransformerOptions> = {
    id: DataTransformerID.eventDistribution,
    editor: EventDistributionTransformerEditor,
    transformation: standardTransformers.eventDistributionTransformer,
    name: standardTransformers.eventDistributionTransformer.name,
    description: `Visualize Events - timestamp is extracted from the oodle_event_time_epoch_ms label.`,
    categories: new Set([TransformerCategory.Reformat, TransformerCategory.Combine]),
    help: getTransformationContent(DataTransformerID.eventDistribution).helperDocs,
    imageDark: darkImage,
    imageLight: lightImage,
};
