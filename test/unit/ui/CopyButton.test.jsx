// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const haptic = vi.hoisted(() => ({
    tap: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/hooks/useHaptic.js', () => ({
    useHapticFeedback: () => haptic,
}));

import { CopyButton } from '../../../packages/core/src/ui/CopyButton.jsx';

describe('<CopyButton>', () => {
    let clipboard;
    beforeEach(() => {
        vi.clearAllMocks();
        clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            value: clipboard,
            configurable: true,
        });
    });

    afterEach(() => {
        delete globalThis.Capacitor;
    });

    it('stays filled by default and takes the outlined look only when asked', () => {
        const { rerender } = render(<CopyButton value="abc" label="Copy" />);
        expect(screen.getByRole('button', { name: 'Copy' }).className).not.toMatch(/outlined/);
        rerender(<CopyButton value="abc" label="Copy" appearance="outlined" />);
        expect(screen.getByRole('button', { name: 'Copy' }).className).toMatch(/outlined/);
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

    it.each([
        ['address', 'bc1qexactaddress', 'Copy address'],
        ['transaction ID', 'aabbcc001122', 'Copy transaction ID'],
        ['amount', '1234567.8900', 'Copy amount'],
    ])('copies an exact %s value and names it in the confirmation', async (_kind, value, label) => {
        render(<CopyButton value={value} label={label} />);
        fireEvent.click(screen.getByRole('button', { name: label }));

        await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(value));
        expect(screen.getByRole('button', { name: `Copied: ${label.slice(5)}` }))
            .toHaveTextContent(`Copied: ${label.slice(5)}`);
        expect(screen.getByRole('status')).toHaveTextContent(`Copied: ${label.slice(5)}`);
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
                expect(screen.getByRole('button')).toHaveTextContent('Copied: value');
            });
            expect(haptic.tap).toHaveBeenCalledOnce();
            expect(haptic.error).not.toHaveBeenCalled();
            const announcement = screen.getByRole('status');
            expect(announcement).toHaveTextContent('Copied: value');
            expect(announcement).toHaveAttribute('aria-live', 'polite');
            expect(announcement).toHaveAttribute('aria-atomic', 'true');
            expect(screen.getByRole('button')).not.toHaveAttribute('aria-live');
            act(() => {
                vi.advanceTimersByTime(101);
            });
            expect(screen.getByRole('button')).toHaveTextContent('Copy value');
        } finally {
            vi.useRealTimers();
        }
    });

    it('lets an enclosing result region own the copy announcement', async () => {
        render(
            <div role="status" aria-live="polite">
                <CopyButton value="x" />
            </div>,
        );
        fireEvent.click(screen.getByRole('button'));
        await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied: value'));
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status')).toHaveTextContent('Copied: value');
    });

    it('names clipboard unavailability when every copy path is refused', async () => {
        clipboard.writeText = vi.fn().mockRejectedValue(new Error('blocked'));
        render(<CopyButton value="x" />);
        fireEvent.click(screen.getByRole('button'));
        await waitFor(() => {
            expect(screen.getByRole('button')).toHaveTextContent('Copy failed: the clipboard is unavailable.');
        });
        expect(clipboard.writeText).toHaveBeenCalled();
        expect(haptic.error).toHaveBeenCalledOnce();
        expect(haptic.tap).not.toHaveBeenCalled();
        const alert = screen.getByRole('alert');
        expect(alert).toHaveAttribute('aria-live', 'assertive');
        expect(alert).toHaveAttribute('aria-atomic', 'true');
        expect(alert).toHaveTextContent('Copy failed: the clipboard is unavailable.');
    });

    it('announces each copy once while ordinary rerenders leave the announcement intact', async () => {
        const view = render(<CopyButton value="x" />);
        const button = screen.getByRole('button');
        button.focus();
        fireEvent.click(button);
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));
        const first = screen.getByRole('status');
        expect(first).toHaveTextContent('Copied');
        expect(button).toHaveFocus();

        view.rerender(<CopyButton value="x" />);
        expect(screen.getByRole('status')).toBe(first);

        fireEvent.click(button);
        await waitFor(() => expect(screen.getByRole('status')).not.toBe(first));
        expect(screen.getAllByText('Copied: value')).toHaveLength(2);
        expect(button).toHaveFocus();
    });

    it('uses the shared legacy fallback when clipboard.writeText rejects', async () => {
        clipboard.writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
        const execCommand = vi.fn().mockReturnValue(true);
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: execCommand,
        });

        try {
            render(<CopyButton value="txid-abc" label="Copy transaction ID" />);
            fireEvent.click(screen.getByRole('button', { name: 'Copy transaction ID' }));

            await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied'));
            expect(clipboard.writeText).toHaveBeenCalledWith('txid-abc');
            expect(execCommand).toHaveBeenCalledWith('copy');
            expect(haptic.tap).toHaveBeenCalledOnce();
            expect(haptic.error).not.toHaveBeenCalled();
        } finally {
            delete document.execCommand;
        }
    });

    it('uses the shared legacy fallback when the Clipboard API is missing', async () => {
        delete globalThis.navigator.clipboard;
        const execCommand = vi.fn().mockReturnValue(true);
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: execCommand,
        });

        try {
            render(<CopyButton value="bc1qaddress" label="Copy address" />);
            fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));

            await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied'));
            expect(execCommand).toHaveBeenCalledWith('copy');
            expect(haptic.tap).toHaveBeenCalledOnce();
            expect(haptic.error).not.toHaveBeenCalled();
        } finally {
            delete document.execCommand;
        }
    });

    it('reports failure without rejecting when clipboard access itself throws', async () => {
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            configurable: true,
            get() { throw new Error('clipboard unavailable'); },
        });
        render(<CopyButton value="bc1qaddress" label="Copy address" />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));

        await waitFor(() => {
            expect(screen.getByRole('button')).toHaveTextContent('Copy failed: the clipboard is unavailable.');
        });
        expect(haptic.error).toHaveBeenCalledOnce();
    });

    it('uses ariaLabel when provided, otherwise falls back to the visible label', () => {
        const { rerender } = render(<CopyButton value="x" ariaLabel="Copy wallet address" />);
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Copy wallet address');
        rerender(<CopyButton value="x" />);
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Copy value');
    });

    it('routes sensitive values through the native secure clipboard', async () => {
        const write = vi.fn().mockResolvedValue({ marked: true });
        globalThis.Capacitor = {
            isNativePlatform: () => true,
            Plugins: { XChainClipboard: { write } },
        };
        render(<CopyButton value="secret" label="Copy secret" sensitive />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy secret' }));

        await waitFor(() => {
            expect(write).toHaveBeenCalledWith({
                value: 'secret',
                sensitive: true,
                ttlSeconds: 60,
            });
        });
        expect(clipboard.writeText).not.toHaveBeenCalled();
    });
    // A reset timer left pending past unmount fired after jsdom was torn down
    // and failed the develop coverage run with "window is not defined"
    // (CopyButton.jsx setState inside the timeout, from AddressList.actions).
    it('clears its pending reset when it unmounts', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 5 });
        try {
            const view = render(<CopyButton value="x" feedbackMs={60_000} />);
            fireEvent.click(screen.getByRole('button'));
            await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied: value'));
            expect(vi.getTimerCount()).toBe(1);
            view.unmount();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('restarts the confirmation window on a second click', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 5 });
        try {
            render(<CopyButton value="x" feedbackMs={1000} />);
            const button = screen.getByRole('button');
            fireEvent.click(button);
            await waitFor(() => expect(button).toHaveTextContent('Copied: value'));
            act(() => { vi.advanceTimersByTime(600); });
            fireEvent.click(button);
            await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(2));
            expect(vi.getTimerCount()).toBe(1);
            // The first click's timer would have reset the label here.
            act(() => { vi.advanceTimersByTime(500); });
            expect(button).toHaveTextContent('Copied: value');
            act(() => { vi.advanceTimersByTime(600); });
            expect(button).toHaveTextContent('Copy value');
        } finally {
            vi.useRealTimers();
        }
    });
});
