// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DIVIDEND pays holders of an XChain token named in TICK: the chain's own
// coin is not one, and neither is a TICK or DIVIDEND_TICK the network has
// never issued. Both were previously caught only by the confirm-time dry
// run's one generic sentence; these cases pin the field-level guards that
// now catch them earlier, with the field's own message and the submit
// button disabled.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DividendForm } from '../../../packages/core/src/shared/routes/DividendForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qexampleexampleexampleexampleexampleex';

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

/**
 * @param {Record<string, 'missing' | Error>} verdictByTick   per-tick override;
 *        anything left out resolves as a real, found token, so an
 *        incidental lookup never breaks a case that isn't testing it.
 */
function mountDividend(verdictByTick = {}) {
    const getTokenInfo = vi.fn(({ tick }) => {
        const v = verdictByTick[tick];
        if (v instanceof Error) return Promise.reject(v);
        if (v === 'missing') {
            return Promise.resolve({
                chainId: CHAIN, tick, creator: null, totalSupply: null,
                canonicalTick: null, divisibility: null, locks: {},
            });
        }
        return Promise.resolve({
            chainId: CHAIN, tick, creator: '1exampleCreatorAddr',
            totalSupply: '1000', divisibility: 8, locks: {},
        });
    });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getHoldersForToken: vi.fn().mockResolvedValue({ tick: 'GOODTOK', total: 0, data: [] }),
        getTokenInfo,
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [
                        { tick: 'GOODTOK', quantity: '1000', divisibility: 8 },
                        { tick: 'GOODPAY', quantity: '1000', divisibility: 8 },
                        { tick: 'GHOSTTOK', quantity: '1000', divisibility: 8 },
                        { tick: 'GHOSTPAY', quantity: '1000', divisibility: 8 },
                    ],
                },
            }],
        }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        dividendAction: vi.fn(),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DividendForm, { walletId: 'w', initialChainId: CHAIN, onBack() {} }),
        ),
    );
    return messaging;
}

async function openPicker(fieldLabel) {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(fieldLabel, 'i') }));
}

async function pickRow(tick) {
    const row = await waitFor(() => {
        const hit = Array.from(document.querySelectorAll('button'))
            .find((b) => (b.textContent || '').includes(tick));
        if (!hit) throw new Error(`no ${tick} row in the token picker`);
        return hit;
    }, { timeout: 3000 });
    fireEvent.click(row);
}

const amountField = () => screen.findByLabelText(/^Per-unit amount/);
const submitButton = () => screen.getByRole('button', { name: /^(Pay dividend|Preview)$/ });
const expectText = (re, timeout = 3000) => waitFor(
    () => expect(document.body.textContent).toMatch(re),
    { timeout },
);

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('DividendForm TICK / DIVIDEND_TICK existence checks', () => {
    it('names the chain\'s own coin at the holder-of field and disables submit', async () => {
        const messaging = mountDividend();
        await openPicker('Holder-of token');
        await pickRow('BTC');
        await openPicker('Dividend token');
        await pickRow('GOODPAY');
        fireEvent.change(await amountField(), { target: { value: '1' } });
        await expectText(/BTC is Bitcoin itself, not an XChain token/);
        expect(submitButton().disabled).toBe(true);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('names an unknown holder-of ticker and disables submit', async () => {
        mountDividend({ GHOSTTOK: 'missing' });
        await openPicker('Holder-of token');
        await pickRow('GHOSTTOK');
        await openPicker('Dividend token');
        await pickRow('GOODPAY');
        fireEvent.change(await amountField(), { target: { value: '1' } });
        await expectText(/No token named GHOSTTOK exists on Bitcoin\./);
        await waitFor(() => expect(submitButton().disabled).toBe(true));
    });

    it('names an unknown dividend ticker and disables submit', async () => {
        mountDividend({ GHOSTPAY: 'missing' });
        await openPicker('Holder-of token');
        await pickRow('GOODTOK');
        await openPicker('Dividend token');
        await pickRow('GHOSTPAY');
        fireEvent.change(await amountField(), { target: { value: '1' } });
        await expectText(/No token named GHOSTPAY exists on Bitcoin\./);
        await waitFor(() => expect(submitButton().disabled).toBe(true));
    });

    it('enables submit once both tickers resolve to real tokens', async () => {
        const messaging = mountDividend();
        await openPicker('Holder-of token');
        await pickRow('GOODTOK');
        await openPicker('Dividend token');
        await pickRow('GOODPAY');
        fireEvent.change(await amountField(), { target: { value: '1' } });
        await waitFor(() => expect(submitButton().disabled).toBe(false), { timeout: 3000 });
        fireEvent.click(submitButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled(), { timeout: 3000 });
    });

    it('a lookup error shows the non-blocking style and leaves the dry run as the final check', async () => {
        const messaging = mountDividend({ GOODTOK: new Error('explorer unreachable') });
        await openPicker('Holder-of token');
        await pickRow('GOODTOK');
        await openPicker('Dividend token');
        await pickRow('GOODPAY');
        fireEvent.change(await amountField(), { target: { value: '1' } });
        await expectText(/Couldn't verify this token: explorer unreachable/);
        await waitFor(() => expect(submitButton().disabled).toBe(false), { timeout: 3000 });
        fireEvent.click(submitButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled(), { timeout: 3000 });
    });
});
