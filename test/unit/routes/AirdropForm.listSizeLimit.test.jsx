// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An airdrop of a couple of hundred recipients composed a LIST over 8 KB,
// which the encoder carried in a Taproot envelope the wallet cannot verify
// yet, and Approve then refused it as "does not match what you approved".
// The form now names the limit before anything is composed, and offers to
// keep the first airdrop's worth of addresses.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import bitcoin from 'bitcoinjs-lib';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qexampleexampleexampleexampleexampleex';
// Real 42-character mainnet addresses, so the network-aware parser counts
// every one valid; 190 of them fit one LIST.
const address = (i) => bitcoin.payments.p2wpkh({
    hash: Buffer.from(String(i + 1).padStart(40, '0'), 'hex'),
    network: bitcoin.networks.bitcoin,
}).address;
const addresses = (n) => Array.from({ length: n }, (_, i) => address(i));

function mountAirdrop() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'addr-1', address: SOURCE, publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'XCHAIN', divisibility: 8, locks: {}, allowList: null, blockList: null,
        }),
        getListByActionIndex: vi.fn().mockResolvedValue({ type: '2', status: 'valid', list: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ tick: 'XCHAIN', total: 0, data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: 'XCHAIN', quantity: '100000000000000', divisibility: 8 }],
                },
            }],
        }),
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
            React.createElement(AirdropForm, {
                walletId: 'w', initialChainId: CHAIN, initialTick: 'XCHAIN', onBack() {},
            }),
        ),
    );
    return messaging;
}

async function flushTimers() {
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    }
}

const recipientsBox = () => screen.getByRole('textbox', { name: 'Recipients' });
const submitButton = () => screen.getByRole('button', { name: /^Review recipients$/ });

async function fillForm(list) {
    await flushTimers();
    fireEvent.change(screen.getByLabelText(/^Per-recipient amount/), { target: { value: '1' } });
    fireEvent.change(recipientsBox(), { target: { value: list.join('\n') } });
    await flushTimers();
}

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.useRealTimers();
});

describe('AirdropForm refuses a recipient list too large to verify, before compose', () => {
    it('names how many of these addresses fit and keeps review closed', async () => {
        const messaging = mountAirdrop();
        await fillForm(addresses(200));

        expect(screen.getByTestId('airdrop-list-too-large')).toHaveTextContent(
            'This airdrop lists 200 addresses, more than this wallet can verify in one airdrop: '
            + 'up to 190 of these fit. Split it into 2 airdrops of up to 190 addresses each.',
        );
        expect(submitButton()).toBeDisabled();
        fireEvent.submit(submitButton().closest('form'));
        await flushTimers();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toMatch(/Review address list/);
    });

    it('says nothing for a list that fits', async () => {
        mountAirdrop();
        await fillForm(addresses(190));
        expect(screen.queryByTestId('airdrop-list-too-large')).toBeNull();
        expect(submitButton()).not.toBeDisabled();
    });

    it('keeps the first batch for review and sets the rest aside to copy', async () => {
        mountAirdrop();
        const list = addresses(200);
        await fillForm(list);

        fireEvent.click(screen.getByRole('button', { name: 'Keep the first 190 addresses' }));
        await flushTimers();

        expect(recipientsBox()).toHaveValue(list.slice(0, 190).join('\n'));
        expect(screen.queryByTestId('airdrop-list-too-large')).toBeNull();
        expect(screen.getByTestId('airdrop-set-aside')).toHaveTextContent(
            '10 more addresses were set aside for another airdrop.',
        );
        expect(screen.getByRole('button', { name: /Copy the other 10/ })).toBeTruthy();

        fireEvent.click(submitButton());
        await flushTimers();
        expect(document.body.textContent).toMatch(/Review address list/);
    });
});
