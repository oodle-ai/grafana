import { PromQuery } from './types';

/**
 * Matches the Grafana global range variables ($__range, $__range_s, $__range_ms) in both the
 * `$__range` and the `${__range}` syntax.
 */
const RANGE_VARIABLE_SOURCE = '\\$(?:__range(?:_s|_ms)?\\b|\\{__range(?:_s|_ms)?\\})';

/** The interval variable we migrate `$__range` queries to. */
export const DD_INTERVAL_VARIABLE = '$__dd_interval';

/** Explains why `$__range` is slow and how to rewrite a query that uses it. */
export const RANGE_VARIABLE_DOCS_URL = 'https://docs.oodle.ai/metrics/query-optimization';

/** Matches a range variable used as a range selector, e.g. `[$__range]` or `[$__range:$__interval]`. */
const RANGE_SELECTOR_SOURCE = `\\[\\s*${RANGE_VARIABLE_SOURCE}\\s*(?::[^\\]]*)?\\]`;

/** True when the expression contains one of the global range variables. */
export function usesRangeVariable(expr?: string): boolean {
  return expr ? new RegExp(RANGE_VARIABLE_SOURCE).test(expr) : false;
}

/** Replaces every global range variable in the expression with `replacement`. */
export function replaceRangeVariable(expr: string, replacement: string): string {
  return expr.replace(new RegExp(RANGE_VARIABLE_SOURCE, 'g'), replacement);
}

/** How many global range variables the expression contains. */
export function countRangeVariables(expr?: string): number {
  return expr ? (expr.match(new RegExp(RANGE_VARIABLE_SOURCE, 'g')) ?? []).length : 0;
}

/**
 * True when every global range variable in the expression is used as a range selector, so replacing
 * them with a smaller interval keeps the query valid. `sum_over_time(x[$__range])` qualifies,
 * `sum(x) / $__range_s` does not.
 */
export function rangeVariableIsOnlyInRangeSelectors(expr?: string): boolean {
  if (!expr) {
    return false;
  }

  const total = countRangeVariables(expr);
  const inRangeSelectors = expr.match(new RegExp(RANGE_SELECTOR_SOURCE, 'g'))?.length ?? 0;

  return total > 0 && total === inRangeSelectors;
}

/**
 * A query is run as a range query unless it is explicitly instant only. Queries that set neither
 * flag (old dashboards) are run as range queries by the backend.
 */
export function isRangeQuery(query: Pick<PromQuery, 'range' | 'instant'>): boolean {
  return query.range ?? !query.instant;
}

/**
 * Range variables expand to the whole dashboard time range, which is a problem for both query types:
 * a range query uses it as the lookback window of every single step, so consecutive steps re-read
 * almost the same data, and an instant query re-reads the whole range on every refresh.
 */
export function isSlowRangeVariableQuery(query: Pick<PromQuery, 'expr'>): boolean {
  return usesRangeVariable(query.expr);
}
