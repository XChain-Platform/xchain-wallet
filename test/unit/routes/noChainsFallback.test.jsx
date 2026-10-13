// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import { hasAvailableChain } from '../../../packages/core/src/shared/utils/chainAvailability.js';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

vi.mock('../../../packages/core/src/shared/routes/Settings.jsx', () => ({
    Settings: ({ initialSubpageId }) => (
        <div data-testid="settings-panel">Settings: {initialSubpageId}</div>
    ),
}));

const DISABLED_SETTINGS = {
    activeNetwork: 'mainnet',
    fees: {},
};

function messaging() {
    const methods = {
        getSettings: vi.fn().mockResolvedValue(DISABLED_SETTINGS),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Wallet' }]),
        listAccounts: vi.fn().mockResolvedValue([{ id: 'account-1', walletId: 'wallet-1', index: 0 }]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('not configured')),
    };
    return new Proxy(methods, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const fallback = vi.fn().mockResolvedValue(null);
            target[property] = fallback;
            return fallback;
        },
    });
}

function mount(route) {
    render(
        <MessagingProvider shell="web" messaging={messaging()}>
            {route}
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('chain availability', () => {
    it('rejects an empty registry and an explicitly empty configured set', () => {
        const emptyRegistry = new ChainRegistry({ bundled: [] });
        const bundledRegistry = new ChainRegistry();

        expect(hasAvailableChain({ settings: null, loading: true }, emptyRegistry)).toBe(false);
        expect(hasAvailableChain({ settings: DISABLED_SETTINGS, loading: false }, bundledRegistry)).toBe(false);
        expect(hasAvailableChain({
            settings: { activeNetwork: 'mainnet', fees: { 'bitcoin-mainnet': {} } },
            loading: false,
        }, bundledRegistry)).toBe(true);
    });
});

describe('screens with no available chains', () => {
    const screens = [
        ['Home', <Home activeWalletId="wallet-1" activeAccountId="account-1" />],
        ['Send', <Send walletId="wallet-1" accountId="account-1" onBack={() => {}} />],
        ['Receive', <Receive walletId="wallet-1" accountId="account-1" onBack={() => {}} />],
        ['History', <History walletId="wallet-1" accountId="account-1" onBack={() => {}} />],
    ];

    it.each(screens)('%s explains the state and opens Network settings', async (_name, route) => {
        mount(route);

        expect(await screen.findByText('No networks available')).toBeTruthy();
        expect(screen.getByText(/chain registry could not be loaded/i)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Open Network settings' }));
        expect(await screen.findByText('Settings: network')).toBeTruthy();
    });
});
