import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { VariableLink } from './VariableLink';

const defaultProps = {
  id: 'var-pod',
  text: 'accounting-cffcfcb68-8mqf9',
  loading: false,
  disabled: false,
  onClick: jest.fn(),
  onCancel: jest.fn(),
};

describe('VariableLink', () => {
  let writeTextSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window, 'isSecureContext', { value: true, writable: true });
    if (!navigator.clipboard) {
      Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });
    }
    writeTextSpy = jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  });

  afterEach(() => {
    writeTextSpy.mockRestore();
  });

  it('renders the variable value text', () => {
    render(<VariableLink {...defaultProps} />);
    expect(screen.getByText('accounting-cffcfcb68-8mqf9')).toBeInTheDocument();
  });

  it('calls onClick when the main clickable area is clicked', async () => {
    render(<VariableLink {...defaultProps} />);
    const mainButton = screen.getByRole('button', { name: /accounting-cffcfcb68-8mqf9/i });
    await userEvent.click(mainButton);
    expect(defaultProps.onClick).toHaveBeenCalledTimes(1);
  });

  it('copies value to clipboard when copy button is clicked and does not open dropdown', async () => {
    render(<VariableLink {...defaultProps} />);
    const copyButton = screen.getByRole('button', { name: /copy value/i });
    await userEvent.click(copyButton);
    expect(writeTextSpy).toHaveBeenCalledWith('accounting-cffcfcb68-8mqf9');
    expect(defaultProps.onClick).not.toHaveBeenCalled();
  });

  it('shows Copied feedback after copy button is clicked', async () => {
    render(<VariableLink {...defaultProps} />);
    const copyButton = screen.getByRole('button', { name: /copy value/i });
    await userEvent.click(copyButton);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('renders loading state when loading is true', () => {
    render(<VariableLink {...defaultProps} loading={true} />);
    expect(screen.getByText('accounting-cffcfcb68-8mqf9')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy value/i })).not.toBeInTheDocument();
  });

  it('does not call onClick when disabled and main area is clicked', async () => {
    render(<VariableLink {...defaultProps} disabled={true} />);
    const mainButton = screen.getByRole('button', { expanded: false });
    await userEvent.click(mainButton);
    expect(defaultProps.onClick).not.toHaveBeenCalled();
  });
});
