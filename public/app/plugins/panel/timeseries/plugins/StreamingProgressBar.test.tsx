import { render, screen } from '@testing-library/react';

import { QueryStreamProgress } from '@grafana/data';

import { StreamingProgressBar } from './StreamingProgressBar';

const progress = (overrides: Partial<QueryStreamProgress> = {}): QueryStreamProgress => ({
  fromMs: 1000,
  toMs: 2000,
  loadedFromMs: 1800,
  loadedToMs: 2000,
  completedParts: 1,
  totalParts: 4,
  streaming: true,
  ...overrides,
});

describe('StreamingProgressBar', () => {
  it('is not rendered when there is no split query running', () => {
    render(<StreamingProgressBar progress={undefined} />);
    expect(screen.queryByTestId('streaming-progress-bar')).not.toBeInTheDocument();
  });

  it('is not rendered once loading is done', () => {
    render(<StreamingProgressBar progress={progress({ streaming: false })} />);
    expect(screen.queryByTestId('streaming-progress-bar')).not.toBeInTheDocument();
  });

  it('fills in proportionally to the parts that have loaded', () => {
    render(<StreamingProgressBar progress={progress({ completedParts: 3, totalParts: 4 })} />);

    const bar = screen.getByTestId('streaming-progress-bar');
    expect(bar.firstElementChild).toHaveStyle({ width: '75%' });
  });

  it('never overflows the track', () => {
    render(<StreamingProgressBar progress={progress({ completedParts: 9, totalParts: 4 })} />);

    expect(screen.getByTestId('streaming-progress-bar').firstElementChild).toHaveStyle({ width: '100%' });
  });
});
