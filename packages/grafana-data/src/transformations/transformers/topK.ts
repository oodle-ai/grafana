import { map } from 'rxjs/operators';

import { DataFrame, FieldType } from '../../types/dataFrame';
import { DataTransformerInfo } from '../../types/transformations';

import { DataTransformerID } from './ids';

/** How each series is scored over the whole time range */
export type TopKCalculation = 'max' | 'min' | 'mean' | 'sum';

/** Which end of the ranking to keep */
export type TopKDirection = 'top' | 'bottom';

export interface TopKTransformerOptions {
  /** Number of series to keep */
  k?: number | string;
  /** Reducer used to rank the series */
  calculation?: TopKCalculation;
  /** Keep the highest or the lowest scoring series */
  direction?: TopKDirection;
}

const DEFAULT_K = 5;
const DEFAULT_CALCULATION: TopKCalculation = 'max';
const DEFAULT_DIRECTION: TopKDirection = 'top';

interface Candidate {
  frameIndex: number;
  fieldIndex: number;
  /** null when the series has no numeric values at all */
  score: number | null;
}

/** Reduce a series to a single number over the whole range, ignoring gaps */
function scoreSeries(values: unknown[], calculation: TopKCalculation): number | null {
  let sum = 0;
  let max = Number.NEGATIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  let count = 0;

  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
      continue;
    }
    count++;
    sum += num;
    if (num > max) {
      max = num;
    }
    if (num < min) {
      min = num;
    }
  }

  if (count === 0) {
    return null;
  }

  switch (calculation) {
    case 'sum':
      return sum;
    case 'mean':
      return sum / count;
    case 'min':
      return min;
    default:
      return max;
  }
}

/**
 * Best score first for the chosen direction, input order preserved on ties. Series without
 * any values always sort last, so they are dropped first whether ranking top or bottom.
 */
function byScore(direction: TopKDirection) {
  return (a: Candidate, b: Candidate): number => {
    if (a.score === b.score) {
      return 0;
    }
    if (a.score === null) {
      return 1;
    }
    if (b.score === null) {
      return -1;
    }
    return direction === 'bottom' ? a.score - b.score : b.score - a.score;
  };
}

export function topKSeries(data: DataFrame[], options: TopKTransformerOptions): DataFrame[] {
  if (!Array.isArray(data) || data.length === 0) {
    return data;
  }

  const calculation = options.calculation ?? DEFAULT_CALCULATION;
  const direction = options.direction ?? DEFAULT_DIRECTION;

  let k = typeof options.k === 'string' ? parseInt(options.k, 10) : options.k;
  if (k === undefined || !Number.isFinite(k)) {
    k = DEFAULT_K;
  }
  k = Math.max(0, Math.floor(k));

  // Every numeric field is a series, so this handles both one frame per series
  // and a single wide frame holding many series.
  const candidates: Candidate[] = [];
  data.forEach((frame, frameIndex) => {
    frame.fields.forEach((field, fieldIndex) => {
      if (field.type === FieldType.number) {
        candidates.push({ frameIndex, fieldIndex, score: scoreSeries(field.values, calculation) });
      }
    });
  });

  if (candidates.length <= k) {
    return data;
  }

  const keep = new Set<string>();
  for (const candidate of [...candidates].sort(byScore(direction)).slice(0, k)) {
    keep.add(`${candidate.frameIndex}/${candidate.fieldIndex}`);
  }

  const result: DataFrame[] = [];
  data.forEach((frame, frameIndex) => {
    const fields = frame.fields.filter(
      (field, fieldIndex) => field.type !== FieldType.number || keep.has(`${frameIndex}/${fieldIndex}`)
    );

    if (fields.length === frame.fields.length) {
      // Nothing was dropped, including frames that hold no series at all
      result.push(frame);
      return;
    }

    // Drop frames whose series were all filtered out, rather than leaving an empty frame behind
    if (!fields.some((field) => field.type === FieldType.number)) {
      return;
    }

    result.push({ ...frame, fields });
  });

  return result;
}

export const topKTransformer: DataTransformerInfo<TopKTransformerOptions> = {
  id: DataTransformerID.topK,
  name: 'Top/Bottom K',
  description:
    'Keep only the top or bottom K series, ranked by their max, min, average or sum over the whole time range',
  defaultOptions: {
    k: DEFAULT_K,
    calculation: DEFAULT_CALCULATION,
    direction: DEFAULT_DIRECTION,
  },

  operator: (options) => (source) => source.pipe(map((data) => topKSeries(data, options))),
};
