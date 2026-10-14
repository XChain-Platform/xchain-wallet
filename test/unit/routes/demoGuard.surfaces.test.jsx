// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Routes that are not plain forms but still compose a transaction (voting,
// the oracle console) show the same inline demo note and keep their action
// buttons disabled in a demo wallet.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';

const CHAIN = 'bitcoin-mainnet';
const DEMO_NOTE = /Demo wallets can't move funds/;
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qvotervotervotervotervotervoterxx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function mount(Route, props, extra = {}) {
    const compose = vi.fn().mockResolvedValue(null);
    const messaging = new Proxy({
        composeVoteForConfirm: compose,
        composeBetForConfirm: compose,
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        ...extra,
    }, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (typeof prop !== 'string') return undefined;
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Route, { walletId: 'demo-w', onBack() {}, ...props }),
    ));
    return compose;
}

beforeEach(() => { clearDemoWalletId(); markDemoWallet('demo-w'); });
afterEach(() => { cleanup(); clearDemoWalletId(); });

describe('demo wallets on non-form compose surfaces', () => {
    it('PollDetail keeps the ballot browsable with Vote disabled', async () => {
        const compose = mount(PollDetail, { chainId: CHAIN, pollIndex: 7 }, {
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 7,
                tick: 'VOTE',
                question: 'Choose a release channel',
                options: ['Stable', 'Preview'],
                tally_mode: 'approval',
                weight_mode: 'balance',
                max_selections: 1,
                end_block: 120,
                poll_status: 'open',
            }),
            governanceVotes: vi.fn().mockResolvedValue([]),
        });

        await screen.findByRole('checkbox', { name: '0: Stable' });
        await waitFor(() => expect(
            screen.getAllByRole('status').some((node) => DEMO_NOTE.test(node.textContent || '')),
        ).toBe(true));
        expect(screen.getByRole('button', { name: 'Vote' })).toBeDisabled();
        expect(compose).not.toHaveBeenCalled();
    });

    it('OracleConsole shows the note above the market list', async () => {
        const compose = mount(OracleConsole, { accountId: 'acct-1' });
        await waitFor(() => expect(
            screen.getAllByRole('status').some((node) => DEMO_NOTE.test(node.textContent || '')),
        ).toBe(true));
        expect(compose).not.toHaveBeenCalled();
    });

    it('PollDetail shows no note for a real wallet', async () => {
        clearDemoWalletId();
        mount(PollDetail, { chainId: CHAIN, pollIndex: 7 }, {
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 7, tick: 'VOTE', question: 'Q', options: ['A', 'B'], tally_mode: 'approval',
                weight_mode: 'balance', max_selections: 1, end_block: 120, poll_status: 'open',
            }),
            governanceVotes: vi.fn().mockResolvedValue([]),
        });
        await screen.findByRole('checkbox', { name: '0: A' });
        expect(screen.queryByText(DEMO_NOTE)).toBeNull();
    });
});
