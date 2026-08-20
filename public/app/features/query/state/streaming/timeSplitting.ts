export interface StreamingTimeRange {
  /** Start of the part (epoch ms) */
  fromMs: number;
  /** End of the part (epoch ms) */
  toMs: number;
  /** Fetch order, 0 is fetched first */
  index: number;
  isFirst: boolean;
  isLast: boolean;
}

export function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}

/**
 * Number of parts a time range should be split into, so that no part covers more than
 * `splitIntervalMs`. Ranges up to the split interval are not split (1 part).
 */
export function calculateStreamingParts(durationMs: number, splitIntervalMs: number): number {
  if (!(durationMs > 0) || !(splitIntervalMs > 0) || durationMs <= splitIntervalMs) {
    return 1;
  }

  return Math.ceil(durationMs / splitIntervalMs);
}

export function roundDownToStep(timestampMs: number, stepMs: number): number {
  return Math.floor(timestampMs / stepMs) * stepMs;
}

export function roundUpToStep(timestampMs: number, stepMs: number): number {
  return Math.ceil(timestampMs / stepMs) * stepMs;
}

/**
 * Splits a time range into parts, ordered newest first so the chart fills in from right to left.
 *
 * Boundaries are aligned to `stepMs` so that every part samples the same absolute grid of
 * timestamps and the merged result is identical to a single unsplit query.
 */
export function splitTimeRangeDescending(
  fromMs: number,
  toMs: number,
  numParts: number,
  stepMs: number
): StreamingTimeRange[] {
  if (numParts <= 1 || !(toMs > fromMs)) {
    return [{ fromMs, toMs, index: 0, isFirst: true, isLast: true }];
  }

  const step = stepMs > 0 ? stepMs : 1;
  const totalDuration = toMs - fromMs;
  // Round the part duration up to a whole number of steps so parts stay on the sample grid
  const partDuration = Math.max(step, roundUpToStep(totalDuration / numParts, step));

  const ranges: StreamingTimeRange[] = [];
  let currentEnd = toMs;

  for (let i = 0; i < numParts; i++) {
    let partStart = i === numParts - 1 ? fromMs : roundDownToStep(currentEnd - partDuration, step);

    if (partStart < fromMs) {
      partStart = fromMs;
    }

    const isLast = partStart <= fromMs;

    ranges.push({
      fromMs: partStart,
      toMs: currentEnd,
      index: i,
      isFirst: i === 0,
      isLast,
    });

    currentEnd = partStart;

    if (isLast) {
      break;
    }
  }

  return ranges;
}
