// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Once token-policy inheritance is active the indexer takes an address LIST
// item for any configured coin on the network. The create form reads the
// explorer's gate flag (through messaging.listAnyCoinItems) and only then puts
// another coin's address in the published list; without it the address is
// named as another network's and the form refuses to review the list.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

const { runConfirm } = vi.hoisted(() => ({ runConfirm: vi.fn() }));

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useActionConfirmFlow: () => ({
            open: false,
            composing: false,
            confirmAction: {},
            run: runConfirm,
        }),
    };
});

const BTC = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'btc-source',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const BITCOIN_MEMBER = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const LITECOIN_MEMBER = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

function mount(anyCoins) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        isListTickCoinActive: vi.fn().mockResolvedValue(false),
        listAnyCoinItems: vi.fn().mockResolvedValue(anyCoins),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListCreateForm walletId="wallet-1" chainId={BTC} initialType="2" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

async function enterMembers(messaging) {
    await waitFor(() => expect(messaging.listAnyCoinItems).toHaveBeenCalledWith({
        chainId: BTC, coin: 'bitcoin', networkKind: 'mainnet',
    }));
    const box = await screen.findByLabelText('Addresses');
    fireEvent.change(box, { target: { value: `${BITCOIN_MEMBER}\n${LITECOIN_MEMBER}` } });
    await screen.findByLabelText('From');
    fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));
}

beforeEach(() => {
    runConfirm.mockReset();
    runConfirm.mockRejectedValue(new Error('stop after compose assertion'));
});

afterEach(cleanup);

describe('ListCreateForm other-coin address items', () => {
    it('publishes another coin\'s address when the explorer gate is on', async () => {
        const messaging = mount(['bitcoin', 'litecoin']);
        await enterMembers(messaging);
        await waitFor(() => expect(runConfirm).toHaveBeenCalled());
        expect(runConfirm.mock.calls[0][0].actionData.params.ITEM).toEqual([BITCOIN_MEMBER, LITECOIN_MEMBER]);
        expect(screen.queryByText(/for another/)).toBeNull();
    });

    it('names it as another network\'s and refuses review when the gate is off', async () => {
        const messaging = mount([]);
        await enterMembers(messaging);
        expect(await screen.findByText('Remove 1 invalid address before reviewing.')).toBeTruthy();
        expect(screen.getByText(/for another/)).toBeTruthy();
        expect(runConfirm).not.toHaveBeenCalled();
    });
});
