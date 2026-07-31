// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Wallet E2E D-155: retargeting the Airdrop form's chain stranded it with no
// source address, on a wallet holding addresses on that chain.
//
// The form defaults From to the newest external HD address, behind a guard that
// returns early once `fromAddressId` is set - so a deliberate pick is not
// clobbered by an unrelated address refresh. Nothing cleared that id when the
// CHAIN changed, so it kept pointing at an address belonging to the old chain,
// resolved to nothing on the new one, and the form rendered "No address on this
// chain. Use Receive to generate one first." over a wallet with plenty. That
// message is not only wrong, it is unactionable twice over: the source picker is
// inside the branch that only renders once an address IS resolved, so there is
// no control on screen to fix it with, and generating another address does not
// help either, because the stale id is still set and the default effect still
// returns early.
//
// TWO entry points re-target the chain and both had to be fixed: the Network
// field, and the token picker (which follows the selected token to its own
// chain). The second is the one a user hits without trying - open Airdrop, pick
// the token you want to drop, and if it does not live on the wallet's first
// chain the form empties itself.
//
// Sibling forms have always done this correctly (ListCreateForm,
// ControllerBindForm, CreateBetFeedForm, CreatePollForm all clear the source
// with the chain), which is what makes this a slip rather than a design choice.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN_A = 'bitcoin-mainnet';
const CHAIN_B = 'litecoin-mainnet';
const SOURCE_A = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const SOURCE_B = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';
/** Lives on CHAIN_B only, so picking it re-targets a form that starts on A. */
const TOKEN_B = 'DROPME';

const ADDRESSES = {
    [CHAIN_A]: [{
        id: 'addr-btc',
        address: SOURCE_A,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    }],
    [CHAIN_B]: [{
        id: 'addr-ltc',
        address: SOURCE_B,
        publicKey: '02cd',
        derivationPath: "m/84'/2'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    }],
};

function mountAirdrop() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN_B, tick: TOKEN_B, divisibility: 8, locks: {},
        }),
        getHoldersForToken: vi.fn().mockResolvedValue({ tick: TOKEN_B, total: 0, data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN_A]: [{
                address: SOURCE_A,
                balances: { native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [] },
            }],
            [CHAIN_B]: [{
                address: SOURCE_B,
                balances: {
                    native: { tick: 'LTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: TOKEN_B, quantity: '100000000000', divisibility: 8 }],
                },
            }],
        }),
        searchTokens: vi.fn().mockResolvedValue([]),
        getListsForSource: vi.fn().mockResolvedValue([]),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn(),
        airdropAction: vi.fn(),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            // No initialChainId / initialTick: this is the form as the palette
            // opens it, which is where the defect lives. Seeded from a token
            // context the chain is locked and cannot be retargeted at all.
            React.createElement(AirdropForm, { walletId: 'w', onBack() {} }),
        ),
    );
    return messaging;
}

const fromField = () => screen.findByLabelText('From');
const strandedAlert = () => screen.queryByText(/No address on this chain/i);

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

/** Opens the Network popover and picks the chain whose option name matches. */
async function switchNetwork(name) {
    fireEvent.click(await screen.findByRole('button', { name: /^Network:/ }));
    const option = await screen.findByRole('option', { name: new RegExp(`^${name}`) });
    fireEvent.click(option);
}

describe('AirdropForm keeps a usable source address across a chain change (D-155)', () => {
    it('re-defaults the source when the Network field retargets the form', async () => {
        mountAirdrop();
        await waitFor(async () => expect((await fromField()).value).toBe(SOURCE_A));

        await switchNetwork('Litecoin');

        await waitFor(async () => expect((await fromField()).value).toBe(SOURCE_B));
        // The message the stranded form used to show, on a wallet that has an
        // address on this exact chain - and with no picker on screen to fix it.
        expect(strandedAlert()).toBeNull();
    });

    it('re-defaults the source when the TOKEN picker retargets the form', async () => {
        mountAirdrop();
        await waitFor(async () => expect((await fromField()).value).toBe(SOURCE_A));

        fireEvent.click(await screen.findByRole('button', { name: /^Token to drop:/ }));
        const row = await screen.findByLabelText(new RegExp(`Open ${TOKEN_B} details`, 'i'), {}, { timeout: 5000 });
        fireEvent.click(row);

        // The token lives on CHAIN_B, so the form follows it there. The source
        // has to follow too, or the drop is composed by nobody.
        await waitFor(async () => expect((await fromField()).value).toBe(SOURCE_B));
        expect(strandedAlert()).toBeNull();
    });
});
