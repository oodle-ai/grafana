import { DEFAULT_SPLIT_INTERVAL_MINUTES } from './config';
import { calculateStreamingParts, minutesToMs, splitTimeRangeDescending } from './timeSplitting';

const THIRTY_DAYS = minutesToMs(DEFAULT_SPLIT_INTERVAL_MINUTES);
const DAY = minutesToMs(24 * 60);

describe('calculateStreamingParts', () => {
  it('does not split ranges up to the split interval', () => {
    expect(calculateStreamingParts(minutesToMs(60), THIRTY_DAYS)).toBe(1);
    expect(calculateStreamingParts(7 * DAY, THIRTY_DAYS)).toBe(1);
    expect(calculateStreamingParts(THIRTY_DAYS - 1, THIRTY_DAYS)).toBe(1);
    expect(calculateStreamingParts(THIRTY_DAYS, THIRTY_DAYS)).toBe(1);
    expect(calculateStreamingParts(0, THIRTY_DAYS)).toBe(1);
  });

  it('splits longer ranges into parts of at most the split interval', () => {
    expect(calculateStreamingParts(THIRTY_DAYS + 1, THIRTY_DAYS)).toBe(2);
    expect(calculateStreamingParts(45 * DAY, THIRTY_DAYS)).toBe(2);
    expect(calculateStreamingParts(60 * DAY, THIRTY_DAYS)).toBe(2);
    expect(calculateStreamingParts(90 * DAY, THIRTY_DAYS)).toBe(3);
    expect(calculateStreamingParts(365 * DAY, THIRTY_DAYS)).toBe(13);
  });

  it('does not split when the interval is not usable', () => {
    expect(calculateStreamingParts(90 * DAY, 0)).toBe(1);
    expect(calculateStreamingParts(90 * DAY, -1)).toBe(1);
  });
});

describe('splitTimeRangeDescending', () => {
  const step = 60000;

  it('returns a single range when there is nothing to split', () => {
    const ranges = splitTimeRangeDescending(0, 1000, 1, step);
    expect(ranges).toEqual([{ fromMs: 0, toMs: 1000, index: 0, isFirst: true, isLast: true }]);
  });

  it('returns ranges ordered newest first and covering the full range without gaps', () => {
    const from = 1700000040000;
    const to = from + 10 * 24 * 60 * 60 * 1000;
    const ranges = splitTimeRangeDescending(from, to, 10, step);

    expect(ranges.length).toBe(10);
    expect(ranges[0].toMs).toBe(to);
    expect(ranges[0].isFirst).toBe(true);
    expect(ranges[ranges.length - 1].fromMs).toBe(from);
    expect(ranges[ranges.length - 1].isLast).toBe(true);

    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].toMs).toBe(ranges[i - 1].fromMs);
      expect(ranges[i].fromMs).toBeLessThan(ranges[i].toMs);
    }
  });

  it('aligns the boundaries to the step so every part samples the same grid', () => {
    const from = 1700000037000;
    const to = from + 7 * 24 * 60 * 60 * 1000;
    const ranges = splitTimeRangeDescending(from, to, 8, step);

    // All boundaries except the outer ones sit on a step multiple
    for (let i = 0; i < ranges.length - 1; i++) {
      expect(ranges[i].fromMs % step).toBe(0);
    }
    expect(ranges[0].toMs).toBe(to);
    expect(ranges[ranges.length - 1].fromMs).toBe(from);
  });

  it('stops early when the parts already cover the range', () => {
    const from = 0;
    const to = 3 * step;
    const ranges = splitTimeRangeDescending(from, to, 10, step);

    expect(ranges[ranges.length - 1].fromMs).toBe(from);
    expect(ranges.length).toBeLessThanOrEqual(10);
    expect(ranges.filter((r) => r.isLast).length).toBe(1);
  });
});
