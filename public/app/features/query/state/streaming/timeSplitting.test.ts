import { DEFAULT_STREAMING_THRESHOLDS } from './config';
import { calculateStreamingParts, minutesToMs, splitTimeRangeDescending } from './timeSplitting';

describe('calculateStreamingParts', () => {
  it('does not split ranges shorter than 6 hours', () => {
    expect(calculateStreamingParts(minutesToMs(359), DEFAULT_STREAMING_THRESHOLDS)).toBe(1);
    expect(calculateStreamingParts(minutesToMs(60), DEFAULT_STREAMING_THRESHOLDS)).toBe(1);
    expect(calculateStreamingParts(0, DEFAULT_STREAMING_THRESHOLDS)).toBe(1);
  });

  it('picks the parts of the largest matching threshold', () => {
    expect(calculateStreamingParts(minutesToMs(360), DEFAULT_STREAMING_THRESHOLDS)).toBe(2);
    expect(calculateStreamingParts(minutesToMs(719), DEFAULT_STREAMING_THRESHOLDS)).toBe(2);
    expect(calculateStreamingParts(minutesToMs(720), DEFAULT_STREAMING_THRESHOLDS)).toBe(3);
    expect(calculateStreamingParts(minutesToMs(1440), DEFAULT_STREAMING_THRESHOLDS)).toBe(4);
    expect(calculateStreamingParts(minutesToMs(2879), DEFAULT_STREAMING_THRESHOLDS)).toBe(4);
    expect(calculateStreamingParts(minutesToMs(2880), DEFAULT_STREAMING_THRESHOLDS)).toBe(6);
    expect(calculateStreamingParts(minutesToMs(4319), DEFAULT_STREAMING_THRESHOLDS)).toBe(6);
    expect(calculateStreamingParts(minutesToMs(4320), DEFAULT_STREAMING_THRESHOLDS)).toBe(8);
    expect(calculateStreamingParts(minutesToMs(10080), DEFAULT_STREAMING_THRESHOLDS)).toBe(10);
    expect(calculateStreamingParts(minutesToMs(30 * 24 * 60), DEFAULT_STREAMING_THRESHOLDS)).toBe(10);
  });

  it('does not depend on the order of the thresholds', () => {
    const shuffled = [
      { durationMinutes: 2880, parts: 6 },
      { durationMinutes: 10080, parts: 10 },
      { durationMinutes: 4320, parts: 8 },
    ];
    expect(calculateStreamingParts(minutesToMs(10080), shuffled)).toBe(10);
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
