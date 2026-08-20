import { canOptimizeRangeVariableQuery } from './optimizeRangeQuery';

describe('canOptimizeRangeVariableQuery', () => {
  describe('accepts queries where summing the per-step values reproduces the original value', () => {
    it.each([
      'increase(go_gc_duration_seconds[$__range])',
      'sum(increase(go_gc_duration_seconds[$__range]))',
      'sum by (job) (increase(http_requests_total[$__range]))',
      'sum without (instance) (increase(http_requests_total[$__range]))',
      'sum(increase(http_requests_total{job="api", code=~"5.."}[$__range]))',
      'sum_over_time(queue_depth[$__range])',
      'sum(sum_over_time(queue_depth[$__range]))',
      'count_over_time(up[$__range])',
    ])('%s', (expr) => {
      expect(canOptimizeRangeVariableQuery(expr)).toBe(true);
    });
  });

  describe('rejects range functions that do not decompose into a sum', () => {
    it.each([
      // A sum of rates is not the rate over the range.
      'sum(rate(http_requests_total[$__range]))',
      // An average of averages is not the average.
      'avg_over_time(temperature[$__range])',
      // Summing per-window maxima is not the maximum.
      'max_over_time(temperature[$__range])',
      'min_over_time(temperature[$__range])',
      'stddev_over_time(temperature[$__range])',
      'last_over_time(temperature[$__range])',
      'present_over_time(up[$__range])',
      // Loses the changes and resets that straddle a window boundary.
      'changes(config_hash[$__range])',
      'resets(counter_total[$__range])',
      'irate(http_requests_total[$__range])',
      'delta(temperature[$__range])',
    ])('%s', (expr) => {
      expect(canOptimizeRangeVariableQuery(expr)).toBe(false);
    });
  });

  describe('rejects outer operations that do not commute with the sum over data points', () => {
    it.each([
      'max(increase(http_requests_total[$__range]))',
      'min(increase(http_requests_total[$__range]))',
      'avg(increase(http_requests_total[$__range]))',
      'count(increase(http_requests_total[$__range]))',
      'topk(5, increase(http_requests_total[$__range]))',
      // A sum of ratios is not the ratio of the sums.
      'increase(errors_total[$__range]) / increase(requests_total[$__range])',
      // Conservative: linear scaling would survive, but we do not try to prove it.
      'increase(http_requests_total[$__range]) * 2',
      'sum(increase(http_requests_total[$__range])) > 100',
      'histogram_quantile(0.9, sum by (le) (increase(latency_bucket[$__range])))',
    ])('%s', (expr) => {
      expect(canOptimizeRangeVariableQuery(expr)).toBe(false);
    });
  });

  describe('rejects range variables that are not the single range selector width', () => {
    it.each([
      // Used as a number rather than as a window.
      'sum(increase(http_requests_total[$__range])) / $__range_s',
      // Two windows would both be rewritten, and their results are not summed independently.
      'sum(increase(a_total[$__range])) + sum(increase(b_total[$__range]))',
      // Not a range variable query at all.
      'sum(increase(http_requests_total[$__dd_interval]))',
      'sum(rate(http_requests_total[5m]))',
      '',
    ])('%s', (expr) => {
      expect(canOptimizeRangeVariableQuery(expr)).toBe(false);
    });
  });

  it('rejects an expression the query builder cannot parse', () => {
    expect(canOptimizeRangeVariableQuery('sum(increase(http_requests_total[$__range])')).toBe(false);
  });
});
