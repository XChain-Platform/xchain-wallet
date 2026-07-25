// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the PC-15 wallet-wide COINPAY scan (the pure half of
// useCoinpayObligations). Covers the payer-side filter, envelope
// tolerance, per-address failure isolation, and deadline sort: the
// nav badge count and the queue rows both come straight from this.

import { describe, it, expect } from 'vitest';
import { scanCoinpayObligations } from '../../../packages/core/src/shared/hooks/useCoinpayObligations.js';

const A1 = 'bc1qpayeraaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const A2 = 'ltc1qpayerbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function messagingWith({ byChain, obligations }) {
    return {
        getAddressesByChain: async () => byChain,
        getCoinpayObligationsForAddress: async ({ chainId, address }) => {
            const key = `${chainId}:${address}`;
            const entry = obligations[key];
            if (entry instanceof Error) throw entry;
            return entry ?? [];
        },
    };
}

function row(overrides = {}) {
    return {
        action_index: '900001',
        coinpay_status: 'pending_coinpay',
        payer_address: A1,
        payee_address: 'bc1qseller',
        coin_amount: '150000000',
        expiration: 1753387200,
        ...overrides,
    };
}

describe('hooks/scanCoinpayObligations', () => {
    it('returns pending obligations where the scanned address is the payer', async () => {
        const messaging = messagingWith({
            byChain: { 'btc-regtest': [{ address: A1 }] },
            obligations: { [`btc-regtest:${A1}`]: [row()] },
        });
        const out = await scanCoinpayObligations({ messaging, walletId: 'w1' });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            chainId: 'btc-regtest',
            address: A1,
            orderMatchActionIndex: '900001',
            payeeAddress: 'bc1qseller',
            coinAmount: '150000000',
            expiration: 1753387200,
        });
    });

    it('drops rows where the address is only the payee, and non-pending rows', async () => {
        const messaging = messagingWith({
            byChain: { 'btc-regtest': [{ address: A1 }] },
            obligations: {
                [`btc-regtest:${A1}`]: [
                    row({ payer_address: 'bc1qsomeoneelse', payee_address: A1 }),
                    row({ action_index: '900002', coinpay_status: 'fulfilled' }),
                    row({ action_index: '900003', coinpay_status: 'expired' }),
                ],
            },
        });
        const out = await scanCoinpayObligations({ messaging, walletId: 'w1' });
        expect(out).toHaveLength(0);
    });

    it('tolerates enveloped responses and isolates per-address failures', async () => {
        const messaging = messagingWith({
            byChain: {
                'btc-regtest': [{ address: A1 }],
                'ltc-regtest': [{ address: A2 }],
            },
            obligations: {
                // BTC lookup dies; the LTC obligation must still land.
                [`btc-regtest:${A1}`]: new Error('explorer down'),
                [`ltc-regtest:${A2}`]: {
                    coinpay_obligations: [row({ payer_address: A2, chainId: undefined })],
                },
            },
        });
        const out = await scanCoinpayObligations({ messaging, walletId: 'w1' });
        expect(out).toHaveLength(1);
        expect(out[0].chainId).toBe('ltc-regtest');
    });

    it('sorts by soonest deadline first, sinking rows with no usable expiration', async () => {
        const messaging = messagingWith({
            byChain: { 'btc-regtest': [{ address: A1 }] },
            obligations: {
                [`btc-regtest:${A1}`]: [
                    row({ action_index: '1', expiration: 2000 }),
                    row({ action_index: '2', expiration: null }),
                    row({ action_index: '3', expiration: 1000 }),
                ],
            },
        });
        const out = await scanCoinpayObligations({ messaging, walletId: 'w1' });
        expect(out.map((o) => o.orderMatchActionIndex)).toEqual(['3', '1', '2']);
    });

    it('returns [] when the messaging layer lacks the obligation methods', async () => {
        const out = await scanCoinpayObligations({ messaging: {}, walletId: 'w1' });
        expect(out).toEqual([]);
    });
});
