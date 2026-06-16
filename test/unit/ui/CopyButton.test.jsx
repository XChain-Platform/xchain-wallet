// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CopyButton } from '../../../packages/core/src/ui/CopyButton.jsx';

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
        // `shouldAdvanceTime` lets fake setTimeout still tick along, which
        // is what waitFor needs to poll the assertion. Without it the
        // fake clock freezes both the component's feedbackMs timer AND
        // waitFor's own polling loop, and the test deadlocks.
        vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 5 });
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
