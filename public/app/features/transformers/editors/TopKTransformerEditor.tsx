import { ChangeEvent, useCallback } from 'react';

import {
  DataTransformerID,
  SelectableValue,
  standardTransformers,
  TopKCalculation,
  TopKDirection,
  TopKTransformerOptions,
  TransformerCategory,
  TransformerRegistryItem,
  TransformerUIProps,
} from '@grafana/data';
import { selectors } from '@grafana/e2e-selectors';
import { t } from '@grafana/i18n';
import { InlineField, Input, RadioButtonGroup, Select } from '@grafana/ui';

import { getTransformationContent } from '../docs/getTransformationContent';
import darkImage from '../images/dark/topK.svg';
import lightImage from '../images/light/topK.svg';

const DEFAULT_CALCULATION: TopKCalculation = 'max';
const DEFAULT_DIRECTION: TopKDirection = 'top';

export const TopKTransformerEditor = ({ options, onChange }: TransformerUIProps<TopKTransformerOptions>) => {
  const directionOptions: Array<SelectableValue<TopKDirection>> = [
    {
      label: t('transformers.top-k-transformer-editor.direction.top', 'Top'),
      value: 'top',
      description: t(
        'transformers.top-k-transformer-editor.direction-description.top',
        'Keep the highest scoring series'
      ),
    },
    {
      label: t('transformers.top-k-transformer-editor.direction.bottom', 'Bottom'),
      value: 'bottom',
      description: t(
        'transformers.top-k-transformer-editor.direction-description.bottom',
        'Keep the lowest scoring series'
      ),
    },
  ];

  const calculationOptions: Array<SelectableValue<TopKCalculation>> = [
    {
      label: t('transformers.top-k-transformer-editor.calculation.max', 'Max'),
      value: 'max',
      description: t(
        'transformers.top-k-transformer-editor.calculation-description.max',
        'Rank by the highest value of each series over the whole time range'
      ),
    },
    {
      label: t('transformers.top-k-transformer-editor.calculation.min', 'Min'),
      value: 'min',
      description: t(
        'transformers.top-k-transformer-editor.calculation-description.min',
        'Rank by the lowest value of each series over the whole time range'
      ),
    },
    {
      label: t('transformers.top-k-transformer-editor.calculation.mean', 'Avg'),
      value: 'mean',
      description: t(
        'transformers.top-k-transformer-editor.calculation-description.mean',
        'Rank by the average value of each series over the whole time range'
      ),
    },
    {
      label: t('transformers.top-k-transformer-editor.calculation.sum', 'Sum'),
      value: 'sum',
      description: t(
        'transformers.top-k-transformer-editor.calculation-description.sum',
        'Rank by the sum of all values of each series over the whole time range'
      ),
    },
  ];

  const onChangeDirection = useCallback(
    (selected: SelectableValue<TopKDirection>) => {
      onChange({
        ...options,
        direction: selected.value ?? DEFAULT_DIRECTION,
      });
    },
    [onChange, options]
  );

  const onChangeK = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const k = event.currentTarget.valueAsNumber;
      onChange({
        ...options,
        k: Number.isFinite(k) ? k : undefined,
      });
    },
    [onChange, options]
  );

  const onChangeCalculation = useCallback(
    (calculation: TopKCalculation) => {
      onChange({
        ...options,
        calculation,
      });
    },
    [onChange, options]
  );

  return (
    <div data-testid={selectors.components.TransformTab.transformationEditor('Top/Bottom K')}>
      <InlineField
        label={t('transformers.top-k-transformer-editor.label-direction', 'Direction')}
        labelWidth={16}
        tooltip={t(
          'transformers.top-k-transformer-editor.tooltip-direction',
          'Keep the highest or the lowest ranked series.'
        )}
      >
        <Select
          options={directionOptions}
          value={options.direction ?? DEFAULT_DIRECTION}
          onChange={onChangeDirection}
          width={16}
        />
      </InlineField>
      <InlineField
        label={t('transformers.top-k-transformer-editor.label-series-count', 'Series count')}
        labelWidth={16}
        tooltip={t(
          'transformers.top-k-transformer-editor.tooltip-series-count',
          'Number of series to keep. The remaining series are dropped.'
        )}
      >
        <Input type="number" min={1} step={1} value={options.k ?? ''} onChange={onChangeK} width={12} />
      </InlineField>
      <InlineField label={t('transformers.top-k-transformer-editor.label-rank-by', 'Rank by')} labelWidth={16} grow>
        <RadioButtonGroup
          options={calculationOptions}
          value={options.calculation ?? DEFAULT_CALCULATION}
          onChange={onChangeCalculation}
        />
      </InlineField>
    </div>
  );
};

export const getTopKTransformRegistryItem: () => TransformerRegistryItem<TopKTransformerOptions> = () => ({
  id: DataTransformerID.topK,
  editor: TopKTransformerEditor,
  transformation: standardTransformers.topKTransformer,
  name: t('transformers.top-k-transformer-editor.name.top-k', 'Top/Bottom K'),
  description: t(
    'transformers.top-k-transformer-editor.description.top-k',
    'Keep only the top or bottom K series, ranked by their max, min, average or sum over the whole time range.'
  ),
  categories: new Set([TransformerCategory.Filter]),
  help: getTransformationContent(DataTransformerID.topK).helperDocs,
  imageDark: darkImage,
  imageLight: lightImage,
});
