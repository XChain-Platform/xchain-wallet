// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RawPsbtViewer } from '../../../packages/core/src/shared/components/RawPsbtViewer.jsx';
import { WatcherResultPanel } from '../../../packages/core/src/shared/components/WatcherResultPanel.jsx';
import * as clipboard from '../../../packages/core/src/shared/clipboard.js';
import { HapticProvider } from '../../../packages/core/src/shared/hooks/useHaptic.js';

let writeText;

beforeEach(() => {
    writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete navigator.clipboard;
});

describe('clipboard control feedback', () => {
    it('confirms a successful watcher transaction copy inline', async () => {
        writeText.mockResolvedValueOnce(undefined);
        render(
            <WatcherResultPanel
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        expect(await screen.findByText('Copied')).toBeTruthy();
        expect(writeText).toHaveBeenCalledWith('deadbeef');
    });

    it('reports a plain failure when raw transaction copying is unavailable', async () => {
        render(<RawPsbtViewer developerMode psbtHex="deadbeef" />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        expect(await screen.findByText('Copy failed: clipboard unavailable')).toBeTruthy();
        expect(writeText).toHaveBeenCalledWith('deadbeef');
    });

    it('reports a plain failure when watcher transaction copying is unavailable', async () => {
        render(
            <WatcherResultPanel
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        expect(await screen.findByText('Copy failed: clipboard unavailable')).toBeTruthy();
        expect(writeText).toHaveBeenCalledWith('deadbeef');
    });

    it('turns a rejected watcher copy into failure feedback', async () => {
        vi.spyOn(clipboard, 'copyText').mockRejectedValueOnce(new Error('bridge failed'));
        render(
            <WatcherResultPanel
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        expect(await screen.findByText('Copy failed: clipboard unavailable')).toBeTruthy();
    });

    it('ignores a copy result after the transaction payload changes', async () => {
        let resolveCopy;
        vi.spyOn(clipboard, 'copyText').mockReturnValueOnce(new Promise((resolve) => {
            resolveCopy = resolve;
        }));
        const { rerender } = render(
            <WatcherResultPanel
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        rerender(
            <WatcherResultPanel
                result={{ psbtHex: 'cafebabe' }}
                onDone={() => {}}
            />,
        );
        await act(async () => resolveCopy({ ok: true }));

        expect(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }))
            .toHaveTextContent('Copy hex');
    });

    it('ignores a copy result after the panel unmounts', async () => {
        let resolveCopy;
        const tap = vi.fn();
        vi.spyOn(clipboard, 'copyText').mockReturnValueOnce(new Promise((resolve) => {
            resolveCopy = resolve;
        }));
        const { unmount } = render(
            <HapticProvider value={{ tap, error: vi.fn() }}>
                <WatcherResultPanel
                    result={{ psbtHex: 'deadbeef' }}
                    onDone={() => {}}
                />
            </HapticProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        unmount();
        await act(async () => resolveCopy({ ok: true }));

        expect(tap).not.toHaveBeenCalled();
    });

    it('clears the prior feedback timer when a new payload is copied', async () => {
        vi.useFakeTimers();
        vi.spyOn(clipboard, 'copyText').mockResolvedValue({ ok: true });
        const { rerender } = render(
            <WatcherResultPanel
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));
        await act(async () => {});
        expect(screen.getByText('Copied')).toBeTruthy();

        act(() => vi.advanceTimersByTime(1000));
        rerender(
            <WatcherResultPanel
                result={{ psbtHex: 'cafebabe' }}
                onDone={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));
        await act(async () => {});
        act(() => vi.advanceTimersByTime(500));

        expect(screen.getByText('Copied')).toBeTruthy();
    });

    it('clears the feedback timer when the panel unmounts', async () => {
        vi.useFakeTimers();
        vi.spyOn(clipboard, 'copyText').mockResolvedValueOnce({ ok: true });
        const { unmount } = render(
            <WatcherResultPanel
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));
        await act(async () => {});
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });
});
