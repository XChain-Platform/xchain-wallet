// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What the manual COINPAY path writes into the PendingTx `actionSummary`.
//
// Two contracts meet in this one string and they pull in opposite directions:
//
//   1. It is USER COPY. submitAction.js documents the field as the §21.1
//      plain-English summary, submitAction copies it onto the queued-broadcast
//      entry, and QueuedBroadcastBanner renders it verbatim. The old default
//      read "Pay COINPAY: 250000 (base units) for ORDER_MATCH #14": two raw
//      opcodes and an unconverted base-unit amount with no ticker.
//   2. It is LOAD-BEARING. pendingTxReferencesMatch() in
//      notifications/CoinpayAutopayWatcher.js is the double-pay guard, and when
//      a PendingTx row carries no params snapshot it falls back to matching
//      `match #<index>` in this text. Rewording it out is how a restarted
//      watcher pays the same match twice.
//
// So the tests below pin both: the copy has no wire vocabulary, AND the guard
// still recognizes the new wording (as well as the legacy wording already
// persisted on shipped installs).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'coinpay-tx-1' })),
}));
vi.mock('../../../packages/core/src/flows/coinpayQueries.js', () => ({
    verifyCoinpayObligation: vi.fn(async () => ({
        payee_address: 'bc1qpayee',
        coin_amount: '250000',
    })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { verifyCoinpayObligation } from '../../../packages/core/src/flows/coinpayQueries.js';
import { coinpayAction } from '../../../packages/core/src/flows/coinpayAction.js';
import { pendingTxReferencesMatch } from '../../../packages/core/src/notifications/CoinpayAutopayWatcher.js';

const FROM = { address: 'bc1qpayer', publicKey: '03dd4688', derivationPath: "m/84'/0'/0'/0/0" };

function opts(extra = {}) {
    return {
        vault: {},
        walletId: 'w1',
        password: 'pw',
        // Only `coin` is read here (ticker resolution); assertValidDestination
        // needs a coin+network pair to run its address check, and this
        // descriptor deliberately omits `network` so the fixture payee passes.
        chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
        sdkRegistry: { get: () => ({}) },
        chainId: 'bitcoin-mainnet',
        from: FROM,
        orderMatchActionIndex: '14',
        payeeAddress: 'bc1qpayee',
        coinAmount: '250000',
        ...extra,
    };
}

const summary = () => vi.mocked(submitAction).mock.calls[0][0].pendingTxMeta.actionSummary;

describe('coinpayAction pending-tx summary', () => {
    beforeEach(() => {
        vi.mocked(submitAction).mockClear();
        vi.mocked(verifyCoinpayObligation).mockClear();
    });

    it('reads as plain English at coin scale with a ticker', async () => {
        await coinpayAction(opts());
        expect(summary()).toBe('Pay 0.0025 BTC for match #14');
    });

    it('carries no wire vocabulary at all', async () => {
        await coinpayAction(opts());
        expect(summary()).not.toMatch(/COINPAY|ORDER_MATCH|base units/);
    });

    it('resolves the ticker per chain rather than hardcoding BTC', async () => {
        await coinpayAction(opts({
            chainRegistry: { get: () => ({ coin: 'dogecoin' }) },
            chainId: 'dogecoin-mainnet',
            payeeAddress: 'DPayee',
        }));
        expect(summary()).toBe('Pay 0.0025 DOGE for match #14');
    });

    it('degrades to the chain id when the registry has no descriptor', async () => {
        await coinpayAction(opts({
            chainRegistry: { get: () => undefined },
            chainId: 'litecoin-mainnet',
        }));
        // 'litecoin-mainnet' -> 'litecoin' -> 'LTC'; never a blank ticker.
        expect(summary()).toBe('Pay 0.0025 LTC for match #14');
    });

    it('never renders a blank ticker, even with no registry and no chain id', async () => {
        await coinpayAction(opts({ chainRegistry: undefined, chainId: undefined }));
        expect(summary()).toBe('Pay 0.0025 COIN for match #14');
    });

    it('still lets an explicit caller summary (the auto-pay wording) win', async () => {
        await coinpayAction(opts({ actionSummary: 'Auto-paid match #14 for order #7' }));
        expect(summary()).toBe('Auto-paid match #14 for order #7');
    });

    // The point of the whole exercise: new copy, guard still bites.
    it('is still recognized by the auto-pay double-pay guard', async () => {
        await coinpayAction(opts());
        const tx = { action: 'COINPAY', actionSummary: summary() };
        expect(pendingTxReferencesMatch(tx, '14')).toBe(true);
        // Digit boundary: '#14' must not be read as a reference to match 141.
        expect(pendingTxReferencesMatch(tx, '141')).toBe(false);
        expect(pendingTxReferencesMatch(tx, '1')).toBe(false);
    });

    // Rows written by already-shipped versions are sitting in users' local
    // storage right now; the guard's ORDER_MATCH alternative is what keeps
    // recognizing them, so the rewrite must not cost that.
    it('still recognizes the legacy wording persisted by shipped installs', () => {
        expect(pendingTxReferencesMatch(
            { action: 'COINPAY', actionSummary: 'Pay COINPAY: 250000 (base units) for ORDER_MATCH #14' },
            '14',
        )).toBe(true);
    });
});
