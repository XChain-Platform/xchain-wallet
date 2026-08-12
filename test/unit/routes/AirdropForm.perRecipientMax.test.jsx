// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (wallet E2E D-86, second form): Airdrop's Max dropped the WHOLE
// balance into a PER-RECIPIENT field, so one click proposed paying every
// address the full balance - a total of balance x recipients, N times the
// "total ~" figure the form printed one line below it, with submit still
// live. Same defect the sibling Pay dividend form was fixed for, with the
// recipient count standing in for the units held.
//
// These drive the real component: the number Max fills must be an amount
// whose recipient-count total the balance can actually pay, and a
// hand-typed over-payout must stop at the form rather than after a LIST
// has already been broadcast and paid for.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qexampleexampleexampleexampleexampleex';
// Real bitcoin-mainnet addresses: the recipient parser is network-aware
//, so placeholder strings would be counted as invalid and never
// reach the divisor.
const RECIPIENTS = [
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs',
];

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: SOURCE,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    }],
};

// Wallet balances arrive base-scaled; the balance lookup divides by
// divisibility, so the mock hands over the shape the host really does
// rather than a display string.
function baseUnits(decimalAmount, divisibility = 8) {
    const [int = '0', frac = ''] = String(decimalAmount).split('.');
    return `${int}${frac.padEnd(divisibility, '0')}`.replace(/^0+(?=\d)/, '');
}

/**
 * @param {object} opts
 * @param {string} [opts.balance]       XCHAIN the source address holds
 * @param {number} [opts.divisibility]  divisibility of the dropped token
 * @param {number} [opts.holderCount]   holder rows returned for the token-list mode
 */
function mountAirdrop({ balance = '4999', divisibility = 8, holderCount = 4 } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'XCHAIN', divisibility, locks: {},
        }),
        getHoldersForToken: vi.fn().mockResolvedValue({
            tick: 'S19MINT',
            total: holderCount,
            data: Array.from({ length: holderCount }, (_, i) => ({
                address: `bc1qholder${i}`, amount: '1',
            })),
        }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [
                        { tick: 'XCHAIN', quantity: baseUnits(balance, divisibility), divisibility },
                    ],
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
                walletId: 'w',
                initialChainId: CHAIN,
                initialTick: 'XCHAIN',
                onBack() {},
            }),
        ),
    );
    return messaging;
}

const amountField = () => screen.findByLabelText(/^Per-recipient amount/);
const maxButton = () => screen.getByRole('button', { name: /max available/i });
// Hidden Max and inert Max are both acceptable; a LIVE Max on an
// uncomputable amount is not.
const maxButtonOrNull = () => screen.queryByRole('button', { name: /max available/i });
const submitButton = () => screen.getByRole('button', { name: /^Review recipients$/ });

// The route loads its addresses asynchronously, so every case waits for
// the compose form itself before touching a field.
async function pasteRecipients(list = RECIPIENTS) {
    await amountField();
    const box = document.querySelector('textarea');
    if (!box) throw new Error('no recipients textarea');
    fireEvent.change(box, { target: { value: list.join('\n') } });
}

/** Wait until the balance lookup (400ms debounce) has armed Max. */
const maxReady = () => waitFor(
    () => expect(maxButton().disabled).toBe(false),
    { timeout: 3000 },
);

// The summary line is assembled from several JSX expressions inside one
// paragraph, so its text lands in separate DOM text nodes; match against
// the rendered text as a whole.
const expectText = (re, timeout = 3000) => waitFor(
    () => expect(document.body.textContent).toMatch(re),
    { timeout },
);

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('AirdropForm Max fills a per-recipient share, not the balance', () => {
    it('fills balance / recipients, not the whole balance', async () => {
        mountAirdrop();
        await pasteRecipients();
        await maxReady();
        fireEvent.click(maxButton());
        // 4,999 XCHAIN across two addresses = 2,499.5 each. The old, wrong
        // number was the balance itself, once per recipient.
        // The field renders grouped, so the assertion reads as the user sees it.
        await waitFor(async () => expect((await amountField()).value).toBe('2,499.5'));
        expect((await amountField()).value).not.toBe('4,999');
    });

    it('quotes a total the balance can actually pay', async () => {
        mountAirdrop();
        await pasteRecipients();
        await maxReady();
        fireEvent.click(maxButton());
        // The form's own summary line: 2,499.5 x 2 = 4,999, the balance.
        // It used to read ~9,998 off the same click.
        await expectText(/total ~4,999 XCHAIN/);
        expect(document.body.textContent).not.toMatch(/total ~9,998/);
    });

    it('names the per-recipient ceiling next to the available balance', async () => {
        mountAirdrop();
        await pasteRecipients();
        await expectText(/4,999 XCHAIN available · up to 2,499\.5 each/);
    });

    it('floors the share to the dropped token divisibility', async () => {
        // An indivisible token cannot pay 3.33333333 to each of three
        // addresses, so the ceiling is a whole number.
        mountAirdrop({ balance: '10', divisibility: 0 });
        await pasteRecipients([...RECIPIENTS, 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3']);
        await maxReady();
        fireEvent.click(maxButton());
        await waitFor(async () => expect((await amountField()).value).toBe('3'));
    });

    it('offers no Max before there is anyone to divide by', async () => {
        mountAirdrop();
        // Balance is known, recipients are not: the old Max was live here
        // and filled the whole balance.
        await expectText(/4,999 XCHAIN available/);
        const max = maxButtonOrNull();
        expect(max === null || max.disabled).toBe(true);
        expect((await amountField()).value).toBe('');
    });

    it('divides by the previewed holder count for a token-holder list', async () => {
        mountAirdrop({ holderCount: 4 });
        const mode = await screen.findByLabelText(/^Airdrop to/);
        fireEvent.change(mode, { target: { value: 'holders' } });
        const ticks = document.querySelector('textarea');
        if (!ticks) throw new Error('no token-list textarea');
        fireEvent.change(ticks, { target: { value: 'S19MINT' } });
        await maxReady();
        fireEvent.click(maxButton());
        // Four current holders of S19MINT, 4,999 to spread across them.
        await waitFor(async () => expect((await amountField()).value).toBe('1,249.75'));
    });

    it('blocks a hand-typed over-payout at the form, before the LIST is composed', async () => {
        const messaging = mountAirdrop();
        await pasteRecipients();
        await maxReady();
        fireEvent.change(await amountField(), { target: { value: '4999' } });
        fireEvent.click(submitButton());
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This pays ~9,998 XCHAIN in total, more than the 4,999 XCHAIN this address holds.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('lets a payable amount through to the recipient review', async () => {
        mountAirdrop();
        await pasteRecipients();
        await maxReady();
        fireEvent.change(await amountField(), { target: { value: '2499.5' } });
        fireEvent.click(submitButton());
        await expectText(/Review address list/);
    });

    it('stays ungated when the balance cannot be read', async () => {
        // An explorer hiccup must not block every airdrop; the confirm
        // page's preflight is still behind it.
        const messaging = mountAirdrop();
        messaging.getWalletBalances.mockRejectedValue(new Error('explorer down'));
        cleanup();
        __clearTokenInfoCache();
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(AirdropForm, {
                    walletId: 'w',
                    initialChainId: CHAIN,
                    initialTick: 'XCHAIN',
                    onBack() {},
                }),
            ),
        );
        await pasteRecipients();
        fireEvent.change(await amountField(), { target: { value: '4999' } });
        fireEvent.click(submitButton());
        await expectText(/Review address list/);
    });
});
