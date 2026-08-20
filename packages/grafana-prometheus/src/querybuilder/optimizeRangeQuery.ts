import { countRangeVariables, rangeVariableIsOnlyInRangeSelectors } from '../rangeVariable';

import { buildVisualQueryFromString } from './parsing';
import { PromOperationId } from './types';

/** The only range variable spelling the optimization understands. */
const RANGE_VARIABLE_PARAM = '$__range';

/**
 * Range functions whose value over a window equals the sum of their values over the consecutive
 * sub-windows that tile it. That identity is what the optimization relies on: `f(m[$__range])`
 * evaluated once is replaced by `f(m[$__dd_interval])` evaluated at every step and summed back up.
 *
 * `sum_over_time` and `count_over_time` decompose exactly, because every sample falls into exactly
 * one sub-window. `increase` decomposes up to Prometheus' per-window extrapolation, and splitting it
 * is strictly better around counter resets. Deliberately excluded: `rate` and the other _over_time
 * functions (an average of averages is not an average), and `changes`/`resets`, which lose the
 * events that straddle a window boundary.
 */
const SUM_DECOMPOSABLE_RANGE_FUNCTIONS: string[] = [
  PromOperationId.Increase,
  PromOperationId.SumOverTime,
  PromOperationId.CountOverTime,
];

/**
 * Aggregations that may wrap the range function. Summing over series and summing over data points
 * commute, so `sum(f(m[w]))` summed over the steps equals `sum(f(m[range]))`. No other aggregation
 * commutes: `max` of per-window maxima summed over steps is not the maximum over the range.
 */
const SUM_AGGREGATIONS: string[] = [PromOperationId.Sum, '__sum_by', '__sum_without'];

/**
 * Whether replacing `$__range` with `$__dd_interval`, running the query as a range query stepped by
 * that same interval and summing the data points produces the value the original query produced.
 *
 * This is intentionally strict. Anything it cannot prove equivalent - a second operation, an
 * arithmetic expression, a non-decomposable function, a range variable used anywhere but in the one
 * range selector - is rejected, because a silently wrong number on a stat panel is worse than no
 * suggestion at all.
 */
export function canOptimizeRangeVariableQuery(expr: string): boolean {
  // The range variable has to be the width of a range selector, and there has to be exactly one of
  // them: two selectors would each be rewritten, and the results are not summed independently.
  if (!rangeVariableIsOnlyInRangeSelectors(expr) || countRangeVariables(expr) !== 1) {
    return false;
  }

  const { query, errors } = buildVisualQueryFromString(expr);

  // Anything the query builder cannot model is something we cannot reason about either.
  if (errors.length > 0 || query.binaryQueries?.length) {
    return false;
  }

  const [rangeFunction, aggregation, ...rest] = query.operations;

  if (rest.length > 0 || !rangeFunction) {
    return false;
  }

  if (!SUM_DECOMPOSABLE_RANGE_FUNCTIONS.includes(rangeFunction.id)) {
    return false;
  }

  // The window has to be the range variable itself, not something derived from it.
  if (rangeFunction.params.length !== 1 || rangeFunction.params[0] !== RANGE_VARIABLE_PARAM) {
    return false;
  }

  return !aggregation || SUM_AGGREGATIONS.includes(aggregation.id);
}
