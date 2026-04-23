import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CopyButton } from '../../src/ui/CopyButton.jsx';

describe('<CopyButton>', () => {
    let clipboard;
    beforeEach(() => {
        clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            value: clipboard,
            configurable: true,
        });
    });

    it('renders its label and calls clipboard.writeText on click', async () => {
        render(<CopyButton value="abc123" label="Copy address" />);
        const btn = screen.getByRole('button', { name: 'Copy address' });
        expect(btn).toHaveTextContent('Copy address');
        fireEvent.click(btn);
        await waitFor(() => {
            expect(clipboard.writeText).toHaveBeenCalledWith('abc123');
        });
    });

    it('flips label to "Copied" briefly after a successful write', async () => {
        vi.useFakeTimers();
        try {
            render(<CopyButton value="x" feedbackMs={100} />);
            fireEvent.click(screen.getByRole('button'));
            await waitFor(() => {
                expect(screen.getByRole('button')).toHaveTextContent('Copied');
            });
            act(() => {
                vi.advanceTimersByTime(101);
            });
            expect(screen.getByRole('button')).toHaveTextContent('Copy');
        } finally {
            vi.useRealTimers();
        }
    });

    it('swallows a clipboard rejection without throwing (silent no-op path)', async () => {
        clipboard.writeText = vi.fn().mockRejectedValue(new Error('blocked'));
        render(<CopyButton value="x" />);
        fireEvent.click(screen.getByRole('button'));
        // No error thrown; label never flipped to Copied.
        await waitFor(() => {
            expect(clipboard.writeText).toHaveBeenCalled();
        });
        expect(screen.getByRole('button')).toHaveTextContent('Copy');
    });

    it('uses ariaLabel when provided, otherwise falls back to the visible label', () => {
        const { rerender } = render(<CopyButton value="x" ariaLabel="Copy wallet address" />);
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Copy wallet address');
        rerender(<CopyButton value="x" label="Copy" />);
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Copy');
    });
});
