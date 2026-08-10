import { QueryStreamProgress } from '@grafana/data';

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
  it('is empty when nothing is streaming', () => {
    expect(getUnloadedRegion(undefined)).toBeNull();
    expect(getUnloadedRegion(progress({ streaming: false }))).toBeNull();
  });

  it('covers the range that has not been loaded yet', () => {
    expect(getUnloadedRegion(progress())).toEqual({ from: 1000, to: 1800 });
  });

  it('is empty once the full range is loaded', () => {
    expect(getUnloadedRegion(progress({ loadedFromMs: 1000 }))).toBeNull();
  });

  it('keeps covering the missing range after an error', () => {
    expect(getUnloadedRegion(progress({ streaming: false, hasError: true }))).toEqual({ from: 1000, to: 1800 });
  });

  it('covers the right side when parts are loaded oldest first', () => {
    expect(getUnloadedRegion(progress({ loadedFromMs: 1000, loadedToMs: 1500 }))).toEqual({ from: 1500, to: 2000 });
  });
});
