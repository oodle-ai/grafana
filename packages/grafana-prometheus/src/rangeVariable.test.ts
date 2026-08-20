import {
  countRangeVariables,
  isRangeQuery,
  isSlowRangeVariableQuery,
  rangeVariableIsOnlyInRangeSelectors,
  replaceRangeVariable,
  usesRangeVariable,
} from './rangeVariable';

describe('usesRangeVariable', () => {
  it.each([
    'sum_over_time(metric[$__range])',
    'sum_over_time(metric[${__range}])',
    'increase(metric[$__range]) / $__range_s',
    'metric / $__range_ms',
  ])('detects the range variable in %s', (expr) => {
    expect(usesRangeVariable(expr)).toBe(true);
  });

  it.each([
    '',
    undefined,
    'rate(metric[$__rate_interval])',
    'sum_over_time(metric[$__dd_interval])',
    'my_range_metric',
  ])('does not detect a range variable in %s', (expr) => {
    expect(usesRangeVariable(expr)).toBe(false);
  });
});

describe('replaceRangeVariable', () => {
  it('replaces every occurrence', () => {
    expect(replaceRangeVariable('sum_over_time(a[$__range]) + sum_over_time(b[${__range}])', '$__dd_interval')).toBe(
      'sum_over_time(a[$__dd_interval]) + sum_over_time(b[$__dd_interval])'
    );
  });
});

describe('countRangeVariables', () => {
  it('counts every occurrence', () => {
    expect(countRangeVariables('sum_over_time(a[$__range]) + sum_over_time(b[${__range}])')).toBe(2);
    expect(countRangeVariables('increase(a[$__range]) / $__range_s')).toBe(2);
    expect(countRangeVariables('rate(a[$__rate_interval])')).toBe(0);
    expect(countRangeVariables(undefined)).toBe(0);
  });
});

describe('rangeVariableIsOnlyInRangeSelectors', () => {
  it.each([
    'sum_over_time(metric[$__range])',
    'sum_over_time(metric[ $__range ])',
    'max_over_time((sum(metric))[$__range:$__interval])',
    'sum_over_time(a[$__range]) + sum_over_time(b[${__range}])',
  ])('is true for %s', (expr) => {
    expect(rangeVariableIsOnlyInRangeSelectors(expr)).toBe(true);
  });

  it.each(['sum(metric) / $__range_s', 'increase(metric[$__range]) / $__range_s', 'metric', ''])(
    'is false for %s',
    (expr) => {
      expect(rangeVariableIsOnlyInRangeSelectors(expr)).toBe(false);
    }
  );
});

describe('isRangeQuery', () => {
  it('defaults to a range query when neither flag is set', () => {
    expect(isRangeQuery({})).toBe(true);
  });

  it('is false for instant only queries', () => {
    expect(isRangeQuery({ instant: true })).toBe(false);
    expect(isRangeQuery({ instant: true, range: false })).toBe(false);
  });

  it('is true when both are selected', () => {
    expect(isRangeQuery({ instant: true, range: true })).toBe(true);
  });
});

describe('isSlowRangeVariableQuery', () => {
  it('is true for a range query using $__range', () => {
    expect(isSlowRangeVariableQuery({ expr: 'sum_over_time(metric[$__range])' })).toBe(true);
  });

  it('is true for an instant query using $__range, which reads the whole range on every refresh', () => {
    expect(isSlowRangeVariableQuery({ expr: 'sum(increase(metric[$__range]))' })).toBe(true);
  });

  it('is false without $__range', () => {
    expect(isSlowRangeVariableQuery({ expr: 'rate(metric[$__rate_interval])' })).toBe(false);
  });
});
