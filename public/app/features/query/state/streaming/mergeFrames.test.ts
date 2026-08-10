import { DataFrame, DataQueryResponseData, FieldType, toDataFrame } from '@grafana/data';

import { mergeChunkFrames } from './mergeFrames';

function series(refId: string, labels: Record<string, string>, times: number[], values: number[]): DataFrame {
  return toDataFrame({
    refId,
    name: labels.instance,
    fields: [
      { name: 'Time', type: FieldType.time, values: times },
      { name: 'Value', type: FieldType.number, values, labels },
    ],
  });
}

describe('mergeChunkFrames', () => {
  it('returns the frames untouched when there is a single chunk', () => {
    const frame = series('A', { job: 'a' }, [1, 2], [10, 20]);
    expect(mergeChunkFrames([[frame]])).toEqual([frame]);
  });

  it('concatenates the same series across chunks in time order', () => {
    const older = series('A', { job: 'a' }, [1000, 2000], [1, 2]);
    const newer = series('A', { job: 'a' }, [3000, 4000], [3, 4]);

    const merged = mergeChunkFrames([[older], [newer]]);

    expect(merged.length).toBe(1);
    expect(merged[0].fields[0].values).toEqual([1000, 2000, 3000, 4000]);
    expect(merged[0].fields[1].values).toEqual([1, 2, 3, 4]);
    expect(merged[0].length).toBe(4);
  });

  it('drops the sample duplicated on the boundary between two parts', () => {
    const older = series('A', { job: 'a' }, [1000, 2000, 3000], [1, 2, 3]);
    const newer = series('A', { job: 'a' }, [3000, 4000], [3, 4]);

    const merged = mergeChunkFrames([[older], [newer]]);

    expect(merged[0].fields[0].values).toEqual([1000, 2000, 3000, 4000]);
    expect(merged[0].fields[1].values).toEqual([1, 2, 3, 4]);
  });

  it('keeps series that only exist in some of the parts', () => {
    const older = series('A', { job: 'a' }, [1000], [1]);
    const newerA = series('A', { job: 'a' }, [2000], [2]);
    const newerB = series('A', { job: 'b' }, [2000], [9]);

    const merged = mergeChunkFrames([[older], [newerA, newerB]]);

    expect(merged.length).toBe(2);
    expect(merged[0].fields[0].values).toEqual([1000, 2000]);
    expect(merged[1].fields[0].values).toEqual([2000]);
    expect(merged[1].fields[1].labels).toEqual({ job: 'b' });
  });

  it('keeps the series order stable as older parts arrive', () => {
    // The newest part only knows about job=a, the older part also has job=b
    const newest = series('A', { job: 'a' }, [2000], [2]);
    const older = [series('A', { job: 'b' }, [1000], [9]), series('A', { job: 'a' }, [1000], [1])];

    const firstEmission = mergeChunkFrames([undefined, [newest]]);
    const secondEmission = mergeChunkFrames([older, [newest]]);

    const labelsOf = (frames: DataQueryResponseData[]) => frames.map((frame) => frame.fields[1].labels);

    // job=a must not be pushed down the list, the series index drives the palette color
    expect(labelsOf(firstEmission)).toEqual([{ job: 'a' }]);
    expect(labelsOf(secondEmission)).toEqual([{ job: 'a' }, { job: 'b' }]);
  });

  it('keeps the nanosecond column aligned when only some parts carry one', () => {
    const older = series('A', { job: 'a' }, [1000], [1]);
    const newer = series('A', { job: 'a' }, [2000], [2]);
    newer.fields[0].nanos = [500];

    const merged = mergeChunkFrames([[older], [newer]]);

    expect(merged[0].fields[0].values).toEqual([1000, 2000]);
    expect(merged[0].fields[0].nanos).toEqual([0, 500]);
  });

  it('keeps series apart when they only differ by refId', () => {
    const a = series('A', { job: 'a' }, [1000], [1]);
    const b = series('B', { job: 'a' }, [1000], [5]);

    expect(mergeChunkFrames([[a, b]]).length).toBe(2);
  });

  it('ignores parts that have not returned yet', () => {
    const newer = series('A', { job: 'a' }, [3000], [3]);

    const merged = mergeChunkFrames([undefined, [newer]]);

    expect(merged.length).toBe(1);
    expect(merged[0].fields[0].values).toEqual([3000]);
  });

  it('takes the field config and meta of the most recent part', () => {
    const older = series('A', { job: 'a' }, [1000], [1]);
    older.meta = { executedQueryString: 'old' };
    const newer = series('A', { job: 'a' }, [2000], [2]);
    newer.meta = { executedQueryString: 'new' };

    const merged = mergeChunkFrames([[older], [newer]]);

    expect(merged[0].meta?.executedQueryString).toBe('new');
  });
});
