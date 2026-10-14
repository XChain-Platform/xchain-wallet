// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopUpdateBanner } from '../../../packages/desktop/renderer/DesktopUpdateBanner.jsx';

function installBridge(install = vi.fn().mockResolvedValue({ ok: true })) {
    let listener;
    const bridge = {
        install,
        onEvent: vi.fn((next) => {
            listener = next;
            return vi.fn();
        }),
        emit(event) {
            act(() => listener(event));
        },
    };
    window.xchainWalletUpdater = bridge;
    return bridge;
}

afterEach(() => {
    cleanup();
    delete window.xchainWalletUpdater;
});

describe('desktop update banner fallback branches', () => {
    it('uses constant copy for a missing version and nonnumeric progress', () => {
        const bridge = installBridge();
        render(<DesktopUpdateBanner />);

        bridge.emit({ type: 'available' });
        expect(screen.getByRole('status').textContent).toContain('A newer version is available');

        bridge.emit({ type: 'progress', info: { percent: 'not-a-number' } });
        expect(screen.getByRole('status').textContent).toContain('Downloading update');
        expect(screen.getByRole('status').textContent).not.toContain('%');
    });

    it('keeps one download in flight and retries it after a live error', async () => {
        let settle;
        const install = vi.fn(() => new Promise((resolve) => { settle = resolve; }));
        const bridge = installBridge(install);
        render(<DesktopUpdateBanner />);
        bridge.emit({ type: 'available', info: { version: '1.2.3' } });
        const download = screen.getByRole('button', { name: /download update/i });

        act(() => {
            download.click();
            download.click();
        });
        expect(install).toHaveBeenCalledOnce();

        bridge.emit({ type: 'error', userInitiated: true });
        expect(screen.getByRole('status').textContent).toContain("couldn't be downloaded or verified");

        await act(async () => {
            settle({ ok: true });
            await Promise.resolve();
        });
    });

    it('falls back to a generic install error for a nonretryable restart failure', async () => {
        const bridge = installBridge(vi.fn().mockResolvedValue({ ok: false, retryable: false }));
        render(<DesktopUpdateBanner />);
        bridge.emit({ type: 'ready' });

        await act(async () => {
            screen.getByRole('button', { name: /restart to update/i }).click();
            await Promise.resolve();
        });

        expect(screen.getByRole('status').textContent).toContain("couldn't be downloaded or verified");
    });
});
