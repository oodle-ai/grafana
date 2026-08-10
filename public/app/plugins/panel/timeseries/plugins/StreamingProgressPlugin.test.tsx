import { LoadingState, QueryStreamProgress } from '@grafana/data';

import { getUnloadedRegion } from './StreamingProgressPlugin';

const progress = (overrides: Partial<QueryStreamProgress> = {}): QueryStreamProgress => ({
  fromMs: 1000,
  toMs: 2000,
  loadedFromMs: 1800,
  loadedToMs: 2000,
  completedParts: 1,
  totalParts: 5,
  streaming: true,
  ...overrides,
});

describe('getUnloadedRegion', () => {
  it('is empty when no split query ran', () => {
    expect(getUnloadedRegion(undefined, LoadingState.Done)).toBeNull();
  });

  it('covers the range that has not been loaded yet', () => {
    expect(getUnloadedRegion(progress(), LoadingState.Streaming)).toEqual({
      from: 1000,
      to: 1800,
      isStreaming: true,
      hasError: false,
    });
  });

  it('is empty once the full range is loaded', () => {
    const done = progress({ loadedFromMs: 1000, streaming: false, completedParts: 5 });
    expect(getUnloadedRegion(done, LoadingState.Done)).toBeNull();
  });

  it('stops streaming when the query was cancelled, without a final progress update', () => {
    // Cancelling leaves the last progress reporting streaming, the panel state is the truth
    expect(getUnloadedRegion(progress(), LoadingState.Done)).toEqual({
      from: 1000,
      to: 1800,
      isStreaming: false,
      hasError: false,
    });
  });

  it('keeps covering the missing range after an error', () => {
    const failed = progress({ streaming: false, hasError: true });

    expect(getUnloadedRegion(failed, LoadingState.Error)).toEqual({
      from: 1000,
      to: 1800,
      isStreaming: false,
      hasError: true,
    });
  });

  it('ignores the progress of an older request that is still on screen', () => {
    const stale = progress({ requestId: 'SQR1' });

    // The panel keeps rendering the previous results while the new request loads
    expect(getUnloadedRegion(stale, LoadingState.Loading, 'SQR2')).toBeNull();
    expect(getUnloadedRegion(stale, LoadingState.Loading, 'SQR1')).not.toBeNull();
  });

  it('covers the right side when parts are loaded oldest first', () => {
    const ascending = progress({ loadedFromMs: 1000, loadedToMs: 1500 });

    expect(getUnloadedRegion(ascending, LoadingState.Streaming)).toEqual({
      from: 1500,
      to: 2000,
      isStreaming: true,
      hasError: false,
    });
  });
});
