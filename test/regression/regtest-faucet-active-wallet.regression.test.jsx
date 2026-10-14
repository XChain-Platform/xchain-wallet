// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: Developer Mode regtest faucet state.
//
//   [P1] 2026-10-13: Faucet funding follows the active wallet and account,
//        activated networks stop offering activation, and conditional faucet
//        visibility preserves React's hook order.

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../../packages/core/src/schemas/settings.js';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';

let messaging;
let settings;

vi.mock('../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));
vi.mock('../../packages/core/src/shared/components/LogConsole.jsx', () => ({ LogConsole: () => null }));

const { DeveloperModeSection } = await import(
    '../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx'
);
const { Settings } = await import('../../packages/core/src/shared/routes/Settings.jsx');

const ACTIVE_WALLET = { id: 'wallet-active', name: 'Active wallet' };
const ACTIVE_ACCOUNT = { id: 'account-active', name: 'Active account', index: 1 };

function enabledSettings(fees = {}) {
    return {
        ...createDefaultSettings(),
        developerMode: true,
        fees,
    };
}

function baseMessaging() {
    return {
        listConnectedSites: vi.fn(async () => []),
        listWallets: vi.fn(async () => [
            { id: 'wallet-first', name: 'First wallet' },
            ACTIVE_WALLET,
        ]),
        listCustomChains: vi.fn(async () => ({ descriptors: [] })),
        getNewestAddress: vi.fn(async () => ({ address: 'bcrt1qactiveaccount' })),
    };
}

function mount(ui) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {ui}
        </MessagingProvider>,
    );
}

beforeEach(() => {
    localStorage.clear();
    settings = enabledSettings({
        'bitcoin-regtest': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
    });
    messaging = baseMessaging();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('regression/regtest-faucet-active-wallet', () => {
    it('[REGRESSION P1] funds the active wallet and account from Developer mode', async () => {
        const fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ result: 'tx-active-account' }),
        }));
        vi.stubGlobal('fetch', fetch);

        mount(
            <Settings
                onBack={vi.fn()}
                initialSubpageId="developer"
                activeWallet={ACTIVE_WALLET}
                activeAccount={ACTIVE_ACCOUNT}
            />,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Get test BTC' }));

        await waitFor(() => expect(messaging.getNewestAddress).toHaveBeenCalledWith(
            ACTIVE_WALLET.id,
            'bitcoin-regtest',
            ACTIVE_ACCOUNT.id,
        ));
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        expect(JSON.parse(fetch.mock.calls[0][1].body).params).toEqual({
            address: 'bcrt1qactiveaccount',
            amount: 10,
        });
    });

    it('[REGRESSION P1] removes Activate from the Bitcoin regtest row once it becomes active', () => {
        settings = enabledSettings({
            'dogecoin-regtest': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
        });
        const view = mount(<DeveloperModeSection />);
        const bitcoinRow = screen.getByRole('heading', { name: 'Bitcoin' }).closest('section');
        expect(within(bitcoinRow).getByRole('button', { name: 'Activate…' })).toBeTruthy();

        settings = enabledSettings({
            'bitcoin-regtest': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
            'dogecoin-regtest': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
        });
        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <DeveloperModeSection />
            </MessagingProvider>,
        );

        expect(within(bitcoinRow).queryByRole('button', { name: 'Activate…' })).toBeNull();
        expect(within(bitcoinRow).getByText('Active')).toBeTruthy();
    });

    it('[REGRESSION P1] renders the faucet without a hook-order warning when activation makes it visible', () => {
        settings = enabledSettings();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const view = mount(<DeveloperModeSection />);
        expect(screen.queryByRole('heading', { name: 'Regtest faucet' })).toBeNull();

        settings = enabledSettings({
            'bitcoin-regtest': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
        });
        expect(() => view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <DeveloperModeSection />
            </MessagingProvider>,
        )).not.toThrow();

        expect(screen.getByRole('heading', { name: 'Regtest faucet' })).toBeTruthy();
        expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/change in the order of hooks|rendered more hooks/i);
    });
});
