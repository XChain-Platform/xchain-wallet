// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    announce: vi.fn(),
    copyText: vi.fn(),
    error: vi.fn(),
    tap: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/clipboard.js', () => ({
    copyText: mocks.copyText,
}));

vi.mock('../../../packages/core/src/shared/hooks/useHaptic.js', () => ({
    useHapticFeedback: () => ({ tap: mocks.tap, error: mocks.error }),
}));

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ announce: mocks.announce }),
}));

import { RawPsbtViewer } from '../../../packages/core/src/shared/components/RawPsbtViewer.jsx';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, reject, resolve };
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('RawPsbtViewer copy lifecycle', () => {
    it('turns an unexpected clipboard rejection into visible failure feedback', async () => {
        mocks.copyText.mockRejectedValueOnce(new Error('platform clipboard rejected'));
        render(<RawPsbtViewer developerMode psbtHex="deadbeef" />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        expect(await screen.findByRole('button', {
            name: 'Copy failed: clipboard unavailable',
        })).toBeTruthy();
        expect(mocks.error).toHaveBeenCalledOnce();
        expect(mocks.announce).toHaveBeenCalledWith('Copy failed: clipboard unavailable');
    });

    it('ignores a copy result after the displayed payload changes', async () => {
        const pending = deferred();
        mocks.copyText.mockReturnValueOnce(pending.promise);
        const view = render(<RawPsbtViewer developerMode psbtHex="old-payload" />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));
        view.rerender(<RawPsbtViewer developerMode psbtHex="new-payload" />);
        await act(async () => pending.resolve({ ok: true }));

        expect(screen.getByRole('button', { name: 'Copy unsigned transaction hex' })).toBeTruthy();
        expect(mocks.announce).not.toHaveBeenCalled();
        expect(mocks.tap).not.toHaveBeenCalled();
    });

    it('ignores a pending copy result after unmount', async () => {
        const pending = deferred();
        mocks.copyText.mockReturnValueOnce(pending.promise);
        const view = render(<RawPsbtViewer developerMode psbtHex="deadbeef" />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));
        view.unmount();
        await act(async () => pending.resolve({ ok: true }));

        expect(mocks.announce).not.toHaveBeenCalled();
        expect(mocks.tap).not.toHaveBeenCalled();
    });

    it('replaces the feedback timer and clears it when the viewer unmounts', async () => {
        vi.useFakeTimers();
        mocks.copyText.mockResolvedValue({ ok: true });
        const view = render(<RawPsbtViewer developerMode psbtHex="deadbeef" />);
        const button = screen.getByRole('button', { name: 'Copy unsigned transaction hex' });

        fireEvent.click(button);
        await act(async () => {});
        expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();

        act(() => vi.advanceTimersByTime(1000));
        fireEvent.click(screen.getByRole('button', { name: 'Copied' }));
        await act(async () => {});
        act(() => vi.advanceTimersByTime(600));

        expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
        expect(vi.getTimerCount()).toBe(1);
        view.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
