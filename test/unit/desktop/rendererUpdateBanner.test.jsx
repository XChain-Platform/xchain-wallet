// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopUpdateBanner } from '../../../packages/desktop/renderer/DesktopUpdateBanner.jsx';

function installBridge() {
    let listener;
    const unsubscribe = vi.fn();
    const bridge = {
        install: vi.fn().mockResolvedValue({ ok: true }),
        onEvent: vi.fn((next) => {
            listener = next;
            return unsubscribe;
        }),
        emit(event) {
            act(() => listener(event));
        },
        unsubscribe,
    };
    window.xchainWalletUpdater = bridge;
    return bridge;
}

afterEach(() => {
    delete window.xchainWalletUpdater;
});

describe('desktop update banner lifecycle', () => {
    it('dismisses the current offer and reveals a later offer', () => {
        const bridge = installBridge();
        render(<DesktopUpdateBanner />);
        bridge.emit({ type: 'available', info: { version: '1.2.3' } });

        act(() => {
            screen.getByRole('button', { name: /dismiss update notice/i }).click();
        });
        expect(screen.queryByRole('status')).toBeNull();

        bridge.emit({ type: 'available', info: { version: '1.2.4' } });
        expect(screen.getByRole('status').textContent).toContain('1.2.4');
    });

    it('shows the constant refusal copy for a rejected live event', () => {
        const bridge = installBridge();
        render(<DesktopUpdateBanner />);

        bridge.emit({ type: 'rejected', info: { reason: 'remote controlled text' } });

        const text = screen.getByRole('status').textContent;
        expect(text).toContain('could not be downloaded or verified');
        expect(text).not.toContain('remote controlled text');
    });

    it('turns an install rejection into a refusal', async () => {
        const bridge = installBridge();
        bridge.install.mockRejectedValue(new Error('download failed'));
        render(<DesktopUpdateBanner />);
        bridge.emit({ type: 'available', info: { version: '1.2.3' } });

        await act(async () => {
            screen.getByRole('button', { name: /download update/i }).click();
            await Promise.resolve();
        });

        expect(screen.getByRole('status').textContent).toContain('wallet is untouched');
    });

    it('names a read-only location when a verified update cannot be installed', async () => {
        const bridge = installBridge();
        bridge.install.mockResolvedValue({
            ok: false, cause: 'read-only', reason: 'remote controlled text', retryable: false,
        });
        render(<DesktopUpdateBanner />);
        bridge.emit({ type: 'ready', info: { version: '1.2.3' } });

        await act(async () => {
            screen.getByRole('button', { name: /restart to update/i }).click();
            await Promise.resolve();
        });

        const text = screen.getByRole('status').textContent;
        expect(text).toContain('read-only location');
        expect(text).not.toContain('could not be downloaded or verified');
        expect(text).not.toContain('remote controlled text');
    });

    it('keeps the restart-blocked copy for an unclassified retryable failure', async () => {
        const bridge = installBridge();
        bridge.install.mockResolvedValue({ ok: false, retryable: true });
        render(<DesktopUpdateBanner />);
        bridge.emit({ type: 'ready', info: { version: '1.2.3' } });

        await act(async () => {
            screen.getByRole('button', { name: /restart to update/i }).click();
            await Promise.resolve();
        });

        expect(screen.getByRole('status').textContent).toContain('Finish the current wallet operation');
    });

    it('unsubscribes when the renderer removes the banner', () => {
        const bridge = installBridge();
        const view = render(<DesktopUpdateBanner />);

        view.unmount();

        expect(bridge.unsubscribe).toHaveBeenCalledOnce();
    });
});
