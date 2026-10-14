// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';

const messaging = {
    getSettings: () => new Promise(() => {}),
    listConnectedSites: vi.fn().mockResolvedValue([]),
};

function mount() {
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'desktop' }}>
            <Settings onBack={() => {}} activeWallet={{ id: 'wallet-1', name: 'Primary Vault' }} />
        </MessagingContext.Provider>,
    );
}

function installBridge() {
    let listener;
    const bridge = {
        install: vi.fn().mockResolvedValue({ ok: true }),
        onEvent: vi.fn((next) => { listener = next; return vi.fn(); }),
        emit(event) { act(() => listener(event)); },
    };
    window.xchainWalletUpdater = bridge;
    return bridge;
}

afterEach(() => { cleanup(); delete window.xchainWalletUpdater; });

describe('Settings check for updates', () => {
    it('is absent when the shell has no updater bridge', () => {
        mount();
        expect(screen.queryByRole('button', { name: /check for updates/i })).toBeNull();
    });

    it('runs the visible check and shows the up-to-date result', async () => {
        const bridge = installBridge();
        mount();
        await act(async () => {
            screen.getByRole('button', { name: /check for updates/i }).click();
            await Promise.resolve();
        });
        expect(bridge.install).toHaveBeenCalledWith('check');
        bridge.emit({ type: 'not-available', userInitiated: true });
        expect(screen.getByText(/you are up to date/i)).toBeTruthy();
    });

    it('shows an available version only when it is plain semver', async () => {
        const bridge = installBridge();
        mount();
        await act(async () => {
            screen.getByRole('button', { name: /check for updates/i }).click();
            await Promise.resolve();
        });
        bridge.emit({ type: 'available', info: { version: '1.2.3' } });
        expect(screen.getByText('Version 1.2.3 is available.')).toBeTruthy();
    });

    it('shows a constant error when the check is refused', async () => {
        const bridge = installBridge();
        bridge.install.mockResolvedValue({ ok: false, reason: 'remote text' });
        mount();
        await act(async () => {
            screen.getByRole('button', { name: /check for updates/i }).click();
            await Promise.resolve();
        });
        expect(screen.getByText(/could not check for updates/i)).toBeTruthy();
        expect(screen.queryByText(/remote text/)).toBeNull();
    });
});
