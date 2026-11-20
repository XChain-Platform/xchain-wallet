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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DividendForm } from '../../../packages/core/src/shared/routes/DividendForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { useFakeTimeouts } from '../../helpers/fakeTimeouts.js';

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
 * @param {Record<string, unknown>} [formProps]   extra DividendForm props (a prefilled tick)
 */
function mountDividend(verdictByTick = {}, formProps = {}) {
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
            React.createElement(DividendForm, { walletId: 'w', initialChainId: CHAIN, onBack() {}, ...formProps }),
        ),
    );
    return messaging;
}

async function openPicker(fieldLabel) {
    await flushTimers();
    // Anchored: the field's own help tip is named "About <label>".
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${fieldLabel}`, 'i') }));
    await flushTimers();
}

async function pickRow(tick) {
    const row = Array.from(document.querySelectorAll('button'))
        .find((button) => (button.textContent || '').includes(tick));
    if (!row) throw new Error(`no ${tick} row in the token picker`);
    fireEvent.click(row);
}

const amountField = () => screen.getByLabelText(/^Per-unit amount/);
const submitButton = () => screen.getByRole('button', { name: 'Pay Dividend' });

async function flushTimers() {
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });
    }
}

const expectText = async (re) => {
    await flushTimers();
    expect(document.body.textContent).toMatch(re);
};

beforeEach(() => {
    useFakeTimeouts();
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.useRealTimers();
});

describe('DividendForm TICK / DIVIDEND_TICK existence checks', () => {
    it('offers no coin in either token picker', async () => {
        mountDividend();
        await openPicker('Holder-of token');
        await expect(pickRow('BTC')).rejects.toThrow('no BTC row');
        await pickRow('GOODTOK');
        await openPicker('Dividend token');
        await expect(pickRow('BTC')).rejects.toThrow('no BTC row');
        // The list was loaded when BTC was looked for: its tokens are there.
        await pickRow('GOODPAY');
    });

    it('answers a tap on the network coin with the field error and sends nothing', async () => {
        // The picker no longer offers the coin, so it arrives as a prefilled tick.
        const messaging = mountDividend({}, { initialTick: 'BTC' });
        await openPicker('Dividend token');
        await pickRow('GOODPAY');
        fireEvent.change(amountField(), { target: { value: '1' } });
        await expectText(/BTC is the active network itself, not an XChain token/);
        expect(submitButton()).toBeEnabled();
        fireEvent.click(submitButton());
        expect(screen.getByRole('alert', { name: /form errors/i }))
            .toHaveTextContent(/BTC is the active network itself/);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('answers an unknown holder-of ticker tap instead of disabling submit', async () => {
        mountDividend({ GHOSTTOK: 'missing' });
        await openPicker('Holder-of token');
        await pickRow('GHOSTTOK');
        await openPicker('Dividend token');
        await pickRow('GOODPAY');
        fireEvent.change(amountField(), { target: { value: '1' } });
        await expectText(/No token named GHOSTTOK exists on the active network\./);
        expect(submitButton()).toBeEnabled();
        fireEvent.click(submitButton());
        expect(screen.getByRole('alert', { name: /form errors/i }))
            .toHaveTextContent(/No token named GHOSTTOK/);
    });

    it('answers an unknown dividend ticker tap instead of disabling submit', async () => {
        mountDividend({ GHOSTPAY: 'missing' });
        await openPicker('Holder-of token');
        await pickRow('GOODTOK');
        await openPicker('Dividend token');
        await pickRow('GHOSTPAY');
        fireEvent.change(amountField(), { target: { value: '1' } });
        await expectText(/No token named GHOSTPAY exists on the active network\./);
        expect(submitButton()).toBeEnabled();
        fireEvent.click(submitButton());
        expect(screen.getByRole('alert', { name: /form errors/i }))
            .toHaveTextContent(/No token named GHOSTPAY/);
    });

    it('enables submit once both tickers resolve to real tokens', async () => {
        const messaging = mountDividend();
        await openPicker('Holder-of token');
        await pickRow('GOODTOK');
        await openPicker('Dividend token');
        await pickRow('GOODPAY');
        fireEvent.change(amountField(), { target: { value: '1' } });
        await flushTimers();
        expect(submitButton().disabled).toBe(false);
        fireEvent.click(submitButton());
        await flushTimers();
        expect(messaging.composeForConfirm).toHaveBeenCalled();
    });

    it('a lookup error shows the non-blocking style and leaves the dry run as the final check', async () => {
        const messaging = mountDividend({ GOODTOK: new Error('explorer unreachable') });
        await openPicker('Holder-of token');
        await pickRow('GOODTOK');
        await openPicker('Dividend token');
        await pickRow('GOODPAY');
        fireEvent.change(amountField(), { target: { value: '1' } });
        await expectText(/Couldn't verify this token: explorer unreachable/);
        expect(submitButton().disabled).toBe(false);
        fireEvent.click(submitButton());
        await flushTimers();
        expect(messaging.composeForConfirm).toHaveBeenCalled();
    });
});
