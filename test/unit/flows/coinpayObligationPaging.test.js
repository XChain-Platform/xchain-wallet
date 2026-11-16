// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The sign-time check refuses a row with no status, and a busy address's older
// pending obligation is still found past the first page.

import { describe, it, expect } from 'vitest';
import {
    getCoinpayObligationsForAddress,
    verifyCoinpayObligation,
} from '../../../packages/core/src/flows/coinpayQueries.js';

const PAYER = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
const PAYEE = 'n2eMqTT929pb1RDNuqEnxdaLau1rxy3efi';

const base = (i, extra = {}) => ({
    action_index: String(i),
    payer_address: PAYER,
    payee_address: PAYEE,
    coin_amount: '0.0025',
    expiration: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
});

function registry(getCoinpayObligations) {
    const sdk = { getCoinpayObligations };
    return { get: () => sdk };
}

const ask = (sdkRegistry, orderMatchActionIndex = '7') => verifyCoinpayObligation({
    sdkRegistry, chainId: 'bitcoin-testnet', payerAddress: PAYER, orderMatchActionIndex, payeeAddress: PAYEE, coinAmount: 250000,
});

describe('verifyCoinpayObligation status gate', () => {
    it('refuses a row that carries no status field', async () => {
        const reg = registry(async () => [base(7)]);
        await expect(ask(reg)).rejects.toThrow(/"missing", not pending/);
    });

    it('refuses an empty status and an unknown status', async () => {
        await expect(ask(registry(async () => [base(7, { coinpay_status: '' })]))).rejects.toThrow(/not pending/);
        await expect(ask(registry(async () => [base(7, { coinpay_status: 'invalid' })]))).rejects.toThrow(/"invalid", not pending/);
    });

    it('reads the camelCase and bare spellings the other consumers accept', async () => {
        const camel = await ask(registry(async () => [base(7, { coinpayStatus: 'pending_coinpay' })]));
        expect(camel.action_index).toBe('7');
        const fulfilled = registry(async () => [base(7, { coinpayStatus: 'fulfilled' })]);
        await expect(ask(fulfilled)).rejects.toThrow(/"fulfilled", not pending/);
    });
});

describe('getCoinpayObligationsForAddress paging', () => {
    function pagedReader(newest, oldest, calls) {
        return async (_address, _type, opts = {}) => {
            calls.push(opts);
            const before = opts.before === undefined ? Infinity : Number(opts.before);
            const all = [];
            for (let i = newest; i >= oldest; i -= 1) {
                if (i < before) all.push(base(i, { coinpay_status: i === oldest ? 'pending_coinpay' : 'fulfilled' }));
            }
            const data = all.slice(0, 100);
            return { total: all.length, data, next_before: data.length ? data[data.length - 1].action_index : undefined };
        };
    }

    it('returns a pending obligation that sits below the first page', async () => {
        const calls = [];
        const reg = registry(pagedReader(250, 1, calls));
        const resp = await getCoinpayObligationsForAddress({ sdkRegistry: reg, chainId: 'c', address: PAYER });
        const found = resp.data.find((r) => r.action_index === '1');
        expect(found.coinpay_status).toBe('pending_coinpay');
        expect(resp.data).toHaveLength(250);
        expect(calls.map((c) => c.before)).toEqual([undefined, '151', '51']);
    });

    it('costs one read for an address whose rows fit one page', async () => {
        const calls = [];
        const reg = registry(pagedReader(10, 1, calls));
        await getCoinpayObligationsForAddress({ sdkRegistry: reg, chainId: 'c', address: PAYER });
        expect(calls).toHaveLength(1);
    });

    it('lets the sign-time check find a match below the page cap with one exact read', async () => {
        const calls = [];
        const reg = registry(pagedReader(5000, 1, calls));
        const row = await ask(reg, '1');
        expect(row.coinpay_status).toBe('pending_coinpay');
        expect(calls[calls.length - 1]).toMatchObject({ before: '2', fresh: true });
    });
});
