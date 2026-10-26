// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Switching the holder-of token while the next holder read is in flight drops
// the first token's holders: the hint and the payout total describe the token
// on screen, never the one just replaced.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DividendForm } from '../../../packages/core/src/shared/routes/DividendForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qexampleexampleexampleexampleexampleex';

function mountDividend() {
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
        getHoldersForToken: vi.fn(({ tick }) => (tick === 'GOODTOK'
            ? Promise.resolve({ tick, total: 1, data: [{ address: 'bc1qholderone', amount: '100' }] })
            : new Promise(() => {}))),
        getTokenInfo: vi.fn(({ tick }) => Promise.resolve({
            chainId: CHAIN, tick, creator: '1c', totalSupply: '1000', divisibility: 8, locks: {},
        })),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: ['GOODTOK', 'GOODPAY', 'GHOSTTOK'].map((tick) => ({ tick, quantity: '1000', divisibility: 8 })),
                },
            }],
        }),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(DividendForm, { walletId: 'w', initialChainId: CHAIN, onBack() {} }),
    ));
    return messaging;
}

async function flushTimers() {
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    }
}
async function pick(fieldLabel, tick) {
    await flushTimers();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(fieldLabel, 'i') }));
    await flushTimers();
    const row = Array.from(document.querySelectorAll('button'))
        .find((button) => (button.textContent || '').includes(tick));
    fireEvent.click(row);
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); __clearTokenInfoCache(); vi.useRealTimers(); });

describe('DividendForm holder read for a replaced holder-of token', () => {
    it('shows no payout total while the new token\'s holders load', async () => {
        mountDividend();
        await pick('Holder-of token', 'GOODTOK');
        await pick('Dividend token', 'GOODPAY');
        fireEvent.change(screen.getByLabelText(/^Per-unit amount/), { target: { value: '2' } });
        await flushTimers();
        expect(document.body.textContent).toMatch(/total distribution ~200 GOODPAY/);

        await pick('Holder-of token', 'GHOSTTOK');
        await flushTimers();
        expect(document.body.textContent).toMatch(/Counting holders/);
        expect(document.body.textContent).not.toMatch(/total distribution/);
    });
});
