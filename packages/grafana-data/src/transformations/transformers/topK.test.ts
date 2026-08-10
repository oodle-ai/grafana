import { toDataFrame } from '../../dataframe/processDataFrame';
import { FieldType } from '../../types/dataFrame';
import { DataTransformerConfig } from '../../types/transformations';
import { mockTransformationsRegistry } from '../../utils/tests/mockTransformationsRegistry';
import { transformDataFrame } from '../transformDataFrame';

import { DataTransformerID } from './ids';
import { topKTransformer, TopKTransformerOptions } from './topK';

const seriesFrame = (name: string, values: Array<number | null>) =>
  toDataFrame({
    name,
    fields: [
      { name: 'time', type: FieldType.time, values: [1000, 2000, 3000] },
      { name: 'value', type: FieldType.number, values },
    ],
  });

const apply = (options: TopKTransformerOptions, frames: ReturnType<typeof seriesFrame>[]) => {
  const cfg: DataTransformerConfig<TopKTransformerOptions> = {
    id: DataTransformerID.topK,
    options,
  };
  return transformDataFrame([cfg], frames);
};

describe('Top/Bottom K transformer', () => {
  beforeAll(() => {
    mockTransformationsRegistry([topKTransformer]);
  });

  it('keeps the K series with the highest max over the whole range', async () => {
    const frames = [
      seriesFrame('A', [1, 2, 3]), // max 3, sum 6
      seriesFrame('B', [10, 0, 0]), // max 10, sum 10
      seriesFrame('C', [4, 4, 4]), // max 4, sum 12
    ];

    await expect(apply({ k: 2, calculation: 'max' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['B', 'C']);
    });
  });

  it('keeps the K series with the highest sum over the whole range', async () => {
    const frames = [
      seriesFrame('A', [1, 2, 3]), // sum 6
      seriesFrame('B', [10, 0, 0]), // sum 10
      seriesFrame('C', [4, 4, 4]), // sum 12
    ];

    await expect(apply({ k: 2, calculation: 'sum' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['B', 'C']);
    });
  });

  it('keeps the K series with the highest min over the whole range', async () => {
    const frames = [
      seriesFrame('A', [1, 2, 3]), // min 1
      seriesFrame('B', [10, 0, 0]), // min 0
      seriesFrame('C', [4, 4, 4]), // min 4
    ];

    await expect(apply({ k: 2, calculation: 'min' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['A', 'C']);
    });
  });

  it('keeps the K series with the highest average over the whole range', async () => {
    const frames = [
      seriesFrame('A', [1, 2, 3]), // mean 2
      seriesFrame('B', [10, 0, 0]), // mean 3.33
      seriesFrame('C', [4, 4, 4]), // mean 4
    ];

    await expect(apply({ k: 2, calculation: 'mean' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['B', 'C']);
    });
  });

  it('averages over the values a series actually has, not over the gaps', async () => {
    const frames = [
      seriesFrame('A', [9, null, null]), // mean 9, sum 9
      seriesFrame('B', [4, 4, 4]), // mean 4, sum 12
    ];

    await expect(apply({ k: 1, calculation: 'mean' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['A']);
    });
  });

  it('keeps the K series with the lowest max when ranking from the bottom', async () => {
    const frames = [
      seriesFrame('A', [1, 2, 3]), // max 3
      seriesFrame('B', [10, 0, 0]), // max 10
      seriesFrame('C', [4, 4, 4]), // max 4
    ];

    await expect(apply({ k: 2, calculation: 'max', direction: 'bottom' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['A', 'C']);
    });
  });

  it('keeps the K series with the lowest sum when ranking from the bottom', async () => {
    const frames = [
      seriesFrame('A', [1, 2, 3]), // sum 6
      seriesFrame('B', [10, 0, 0]), // sum 10
      seriesFrame('C', [4, 4, 4]), // sum 12
    ];

    await expect(apply({ k: 2, calculation: 'sum', direction: 'bottom' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['A', 'B']);
    });
  });

  it('drops series without any values first, even when ranking from the bottom', async () => {
    const frames = [seriesFrame('A', [null, null, null]), seriesFrame('B', [5, 5, 5]), seriesFrame('C', [1, 1, 1])];

    await expect(apply({ k: 2, calculation: 'max', direction: 'bottom' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['B', 'C']);
    });
  });

  it('defaults to ranking from the top', async () => {
    const frames = [seriesFrame('A', [1]), seriesFrame('B', [2]), seriesFrame('C', [3])];

    await expect(apply({ k: 2, calculation: 'max' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['B', 'C']);
    });
  });

  it('preserves the input order of the series it keeps', async () => {
    const frames = [seriesFrame('A', [5]), seriesFrame('B', [1]), seriesFrame('C', [9])];

    await expect(apply({ k: 2, calculation: 'max' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['A', 'C']);
    });
  });

  it('ignores gaps and ranks series without any values last', async () => {
    const frames = [seriesFrame('A', [null, null, null]), seriesFrame('B', [null, -5, null])];

    await expect(apply({ k: 1, calculation: 'sum' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['B']);
    });
  });

  it('drops fields, not frames, when a single frame holds many series', async () => {
    const wide = toDataFrame({
      name: 'wide',
      fields: [
        { name: 'time', type: FieldType.time, values: [1000, 2000] },
        { name: 'low', type: FieldType.number, values: [1, 1] },
        { name: 'high', type: FieldType.number, values: [8, 9] },
        { name: 'mid', type: FieldType.number, values: [4, 5] },
      ],
    });

    await expect(apply({ k: 2, calculation: 'max' }, [wide])).toEmitValuesWith((received) => {
      const result = received[0];
      expect(result).toHaveLength(1);
      expect(result[0].fields.map((field) => field.name)).toEqual(['time', 'high', 'mid']);
      expect(result[0].length).toBe(2);
    });
  });

  it('leaves the data untouched when there are no more series than K', async () => {
    const frames = [seriesFrame('A', [1]), seriesFrame('B', [2])];

    await expect(apply({ k: 5, calculation: 'max' }, frames)).toEmitValuesWith((received) => {
      expect(received[0]).toEqual(frames);
    });
  });

  it('leaves frames without numeric fields alone', async () => {
    const table = toDataFrame({
      name: 'logs',
      fields: [{ name: 'message', type: FieldType.string, values: ['a', 'b'] }],
    });
    const frames = [seriesFrame('A', [1]), seriesFrame('B', [2]), table];

    await expect(apply({ k: 1, calculation: 'max' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['B', 'logs']);
    });
  });

  it('falls back to the default K when it is not a number', async () => {
    const frames = [
      seriesFrame('A', [1]),
      seriesFrame('B', [2]),
      seriesFrame('C', [3]),
      seriesFrame('D', [4]),
      seriesFrame('E', [5]),
      seriesFrame('F', [6]),
    ];

    await expect(apply({ k: undefined, calculation: 'max' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['B', 'C', 'D', 'E', 'F']);
    });
  });

  it('accepts K as a string', async () => {
    const frames = [seriesFrame('A', [1]), seriesFrame('B', [2]), seriesFrame('C', [3])];

    await expect(apply({ k: '2', calculation: 'max' }, frames)).toEmitValuesWith((received) => {
      expect(received[0].map((frame) => frame.name)).toEqual(['B', 'C']);
    });
  });
});
