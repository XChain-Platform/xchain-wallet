// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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
            <Settings onBack={() => {}} activeWallet={{ id: 'wallet-1', name: 'Primary Vault' }} initialSubpageId="g-advanced" />
        </MessagingContext.Provider>,
    );
}

afterEach(() => { cleanup(); delete window.xchainWalletUpdater; });

describe('Settings check for updates', () => {
    it('is absent from Advanced even when the desktop updater bridge exists', () => {
        window.xchainWalletUpdater = {
            install: vi.fn(),
            onEvent: vi.fn(),
        };
        mount();
        expect(screen.queryByRole('button', { name: /check for updates/i })).toBeNull();
        expect(screen.queryByText('Check for updates')).toBeNull();
    });
});
