// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { __clearTokenInfoCache } from '../../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TOKEN = 'DROP';
const LIST_INDEX = '2700';
const ADDRESS = {
    id: 'addr-btc',
    address: SOURCE,
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function listRow({ type = '2', name } = {}) {
    const row = {
        action_index: LIST_INDEX,
        block_index: 10,
        status: 'valid',
        type,
        source: SOURCE,
        list: type === '1' ? ['HOLDERS'] : ['bc1qrecipient'],
    };
    if (name !== undefined) row.name = name;
    return row;
}

function mountAirdrop(row) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: TOKEN, divisibility: 0, locks: {},
        }),
        getHoldersForToken: vi.fn().mockResolvedValue({ tick: 'HOLDERS', total: 1, data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: TOKEN, quantity: '1000', divisibility: 0 }],
                },
            }],
        }),
        searchTokens: vi.fn().mockResolvedValue([]),
        getListsForSource: vi.fn().mockResolvedValue([row]),
        getListByActionIndex: vi.fn().mockResolvedValue(row),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn(),
        airdropAction: vi.fn(),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AirdropForm
                walletId="wallet-1"
                initialChainId={CHAIN}
                initialTick={TOKEN}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

async function chooseExistingList(row) {
    mountAirdrop(row);
    fireEvent.change(await screen.findByLabelText(/^Airdrop to/), {
        target: { value: 'existing' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose list' }));
    fireEvent.click(await screen.findByRole('button', {
        name: new RegExp(`${row.type === '1' ? 'Token' : 'Address'} list #${LIST_INDEX}`),
    }));
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.clearAllMocks();
});

describe('AirdropForm existing-list name', () => {
    it('shows an address-list name before the fallback label and suffix', async () => {
        await chooseExistingList(listRow({ name: 'Treasury wallets' }));

        expect(await screen.findByText('Treasury wallets (List #2700) (address list)')).toBeTruthy();
    });

    it('keeps the token-list suffix after the named label', async () => {
        await chooseExistingList(listRow({ type: '1', name: 'Token holders' }));

        expect(await screen.findByText('Token holders (List #2700) (token list)')).toBeTruthy();
    });

    it.each([
        ['an absent name', undefined],
        ['an empty name', ''],
    ])('keeps today\'s address-list label for %s', async (_case, name) => {
        await chooseExistingList(listRow({ name }));

        expect(await screen.findByText('List #2700 (address list)')).toBeTruthy();
    });

    it('neutralizes U+202E in a loaded list name', async () => {
        await chooseExistingList(listRow({ name: 'Safe\u202Eevil' }));

        expect(await screen.findByText('Safe\u2426evil (List #2700) (address list)')).toBeTruthy();
        expect(screen.queryByText('Safe\u202Eevil (List #2700) (address list)')).toBeNull();
    });
});
