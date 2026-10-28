// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The COINPAY sign-time re-read decides whether a coin payment goes out, so
// it reads fresh: the per-address GET carries `fresh`, and a coalescing window
// it joins sends its batch and any fallback reads fresh too. The badge scan
// on its own keeps ordinary reads.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getCoinpayObligationsForAddress,
    verifyCoinpayObligation,
    COINPAY_BATCH_WINDOW_MS,
    _resetCoinpayBatching,
} from '../../../packages/core/src/flows/coinpayQueries.js';

const PAYER = 'bcrt1qpayer';
const PAYEE = 'bcrt1qpayee';
const row = { action_index: '42', coinpay_status: 'pending_coinpay', payer_address: PAYER, payee_address: PAYEE, coin_amount: '0.001' };
const listBody = { total: 1, data: [row] };

function makeSdk({ batch }) {
    const sdk = { getCoinpayObligations: vi.fn(async () => listBody) };
    if (batch) {
        sdk.getCoinpayObligationsBatch = vi.fn(async (addresses) => Object.fromEntries(
            addresses.map((a) => [a, { coinpay_obligations: listBody, error: null }]),
        ));
    }
    return sdk;
}

const verify = (sdk) => verifyCoinpayObligation({
    sdkRegistry: { get: () => sdk },
    chainId: 'bitcoin-regtest',
    payerAddress: PAYER,
    orderMatchActionIndex: '42',
    payeeAddress: PAYEE,
    coinAmount: 0.001,
}).catch(() => null);

beforeEach(() => {
    _resetCoinpayBatching();
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
    _resetCoinpayBatching();
});

describe('COINPAY sign-time re-read reads fresh', () => {
    it('reads one address fresh where the explorer has no batch route', async () => {
        const sdk = makeSdk({ batch: false });
        await verify(sdk);
        expect(sdk.getCoinpayObligations).toHaveBeenCalledWith(PAYER, 'address', { fresh: true });
    });

    it('sends the batch fresh when the re-read joins a badge scan window', async () => {
        const sdk = makeSdk({ batch: true });
        const sdkRegistry = { get: () => sdk };
        const scan = getCoinpayObligationsForAddress({ sdkRegistry, chainId: 'bitcoin-regtest', address: 'bcrt1qother' });
        const check = verify(sdk);
        await vi.advanceTimersByTimeAsync(COINPAY_BATCH_WINDOW_MS);
        await Promise.all([scan, check]);
        expect(sdk.getCoinpayObligationsBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getCoinpayObligationsBatch.mock.calls[0][1]).toEqual({ fresh: true });
    });

    it('leaves a badge scan on its own with ordinary reads', async () => {
        const sdk = makeSdk({ batch: true });
        const read = getCoinpayObligationsForAddress({ sdkRegistry: { get: () => sdk }, chainId: 'c', address: PAYER });
        await vi.advanceTimersByTimeAsync(COINPAY_BATCH_WINDOW_MS);
        await read;
        expect(sdk.getCoinpayObligationsBatch.mock.calls[0][1]).toBeUndefined();
    });
});
