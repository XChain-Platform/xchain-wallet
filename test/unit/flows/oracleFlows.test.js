// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-30 oracle flows: composing a PRICE v1 publish, and the read side that
// tells a publisher what is live, what is still maturing, and who is
// pricing against them.
//
// The rule under most of these cases is the 24h activation delay: EVERY
// publish (first one included) is effective at block_time + 86400, so the
// newest row is usually NOT the one settlement uses. DISPENSER.md claimed
// first publishes were immediate until 2026-07-24 and was wrong; the
// wallet must not repeat that.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'price-tx-1' })),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address, publicKey: from.publicKey,
        derivationPath: from.derivationPath || null, addressId: from.addressId || null,
    })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { oraclePriceAction } from '../../../packages/core/src/flows/oraclePriceAction.js';
import {
    myOracleFeeds,
    oracleConsumers,
    toQuote,
    pairKey,
    quoteDeviationPct,
    activationCountdownText,
    ORACLE_ACTIVATION_DELAY_S,
} from '../../../packages/core/src/flows/oracleQueries.js';

const FROM = { address: 'oracle-addr', publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", addressId: 'a1' };
const NOW = 1_800_000_000;

function opts(params, extra = {}) {
    return {
        vault: {}, walletId: 'w1', password: 'pw', chainRegistry: {}, sdkRegistry: {},
        chainId: 'bitcoin-regtest', from: FROM, params, ...extra,
    };
}

// A published row as the explorer returns it (hub-mirrored oracle_prices).
function row(over = {}) {
    const blockTime = over.block_time ?? NOW - 2 * ORACLE_ACTIVATION_DELAY_S;
    return {
        coin: 'BTC', tick: 'PEPECASH', fiat: 'USD', value: '0.05', fee: '0.01',
        block_time: blockTime,
        effective_at: over.effective_at ?? blockTime + ORACLE_ACTIVATION_DELAY_S,
        action_index: 100, memo: null,
        ...over,
    };
}

function registryWith(sdk) {
    return { get: () => sdk };
}

beforeEach(() => {
    vi.mocked(submitAction).mockClear();
    vi.mocked(submitAction).mockResolvedValue({ txid: 'price-tx-1' });
});

describe('oraclePriceAction', () => {
    it('composes a PRICE v1 publish and forwards prebuiltPsbt', async () => {
        const prebuilt = { psbtHex: 'de', encoding: 'op_return', actionString: 'PRICE|1|BTC|PEPECASH|USD|0.05|0.01|', version: 1 };
        await oraclePriceAction(opts(
            { VERSION: '1', COIN: 'BTC', TICK: 'PEPECASH', FIAT: 'USD', VALUE: '0.05', FEE: '0.01' },
            { prebuiltPsbt: prebuilt },
        ));
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.actionData).toEqual({
            action: 'PRICE',
            params: { VERSION: '1', COIN: 'BTC', TICK: 'PEPECASH', FIAT: 'USD', VALUE: '0.05', FEE: '0.01' },
        });
        expect(call.prebuiltPsbt).toBe(prebuilt);
    });

    it('defaults VERSION to 1 when the caller omits it', async () => {
        await oraclePriceAction(opts({ COIN: 'BTC', TICK: 'PEPECASH', FIAT: 'USD', VALUE: '0.05' }));
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.actionData.params.VERSION).toBe('1');
    });

    // v0 is the validator federation's PBFT-signed COIN/FIAT snapshot. A
    // wallet composing one builds a transaction the network cannot accept
    // from it, so refuse rather than spend a miner fee proving it.
    it('refuses PRICE v0 (validator snapshot, not user-encodable)', async () => {
        await expect(oraclePriceAction(opts({ VERSION: '0', COIN: 'BTC', TICK: 'X', FIAT: 'USD', VALUE: '1' })))
            .rejects.toThrow(/only PRICE v1/);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it.each(['COIN', 'TICK', 'FIAT', 'VALUE'])('requires %s', async (field) => {
        const params = { COIN: 'BTC', TICK: 'PEPECASH', FIAT: 'USD', VALUE: '0.05' };
        delete params[field];
        await expect(oraclePriceAction(opts(params))).rejects.toThrow(new RegExp(`params.${field} is required`));
    });

    it('names the token and price in the pending-tx summary', async () => {
        await oraclePriceAction(opts({ COIN: 'BTC', TICK: 'pepecash', FIAT: 'usd', VALUE: '0.05' }));
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.pendingTxMeta.actionSummary).toBe('Publish oracle price PEPECASH = 0.05 USD');
    });
});

describe('toQuote', () => {
    it('marks a matured quote effective with no countdown', () => {
        const q = toQuote(row(), NOW);
        expect(q.effective).toBe(true);
        expect(q.secondsUntilEffective).toBeNull();
    });

    it('marks a fresh publish pending, with the remaining delay', () => {
        const blockTime = NOW - 3600;
        const q = toQuote(row({ block_time: blockTime, effective_at: blockTime + ORACLE_ACTIVATION_DELAY_S }), NOW);
        expect(q.effective).toBe(false);
        expect(q.secondsUntilEffective).toBe(ORACLE_ACTIVATION_DELAY_S - 3600);
    });

    it('normalizes the pair identity to upper case', () => {
        expect(pairKey({ coin: 'btc', tick: 'pepecash', fiat: 'usd' })).toBe('BTC/PEPECASH/USD');
    });
});

describe('myOracleFeeds', () => {
    it('splits a pair into its live quote and its still-maturing one', async () => {
        const blockTime = NOW - 3600;
        const sdk = {
            getOraclePrices: vi.fn(async () => ({
                data: [
                    row({ action_index: 100 }),
                    row({ action_index: 200, value: '0.09', block_time: blockTime, effective_at: blockTime + ORACLE_ACTIVATION_DELAY_S }),
                ],
            })),
        };
        const feeds = await myOracleFeeds({ sdkRegistry: registryWith(sdk), chainId: 'bitcoin-regtest', address: 'oracle-addr', nowSec: NOW });
        expect(feeds).toHaveLength(1);
        expect(feeds[0].key).toBe('BTC/PEPECASH/USD');
        expect(feeds[0].live.value).toBe('0.05');
        expect(feeds[0].pending.value).toBe('0.09');
        expect(sdk.getOraclePrices).toHaveBeenCalledWith('oracle-addr', 'address');
    });

    // The API returns rows id-ordered, which is mirror-insertion order. The
    // matcher walks effective_at DESC / action_index DESC, so the wallet must
    // sort the same way or it names a different row "current" than the one
    // settlement uses.
    it('picks the newest by effective_at regardless of API row order', async () => {
        const older = row({ action_index: 500, value: '0.01', block_time: NOW - 5 * ORACLE_ACTIVATION_DELAY_S, effective_at: NOW - 4 * ORACLE_ACTIVATION_DELAY_S });
        const newer = row({ action_index: 1, value: '0.07', block_time: NOW - 3 * ORACLE_ACTIVATION_DELAY_S, effective_at: NOW - 2 * ORACLE_ACTIVATION_DELAY_S });
        const sdk = { getOraclePrices: vi.fn(async () => ({ data: [older, newer] })) };
        const feeds = await myOracleFeeds({ sdkRegistry: registryWith(sdk), chainId: 'bitcoin-regtest', address: 'oracle-addr', nowSec: NOW });
        expect(feeds[0].live.value).toBe('0.07');
    });

    it('separates feeds that differ only by fiat', async () => {
        const sdk = {
            getOraclePrices: vi.fn(async () => ({
                data: [row(), row({ fiat: 'JPY', value: '7.5', action_index: 101 })],
            })),
        };
        const feeds = await myOracleFeeds({ sdkRegistry: registryWith(sdk), chainId: 'bitcoin-regtest', address: 'oracle-addr', nowSec: NOW });
        expect(feeds.map((f) => f.key)).toEqual(['BTC/PEPECASH/JPY', 'BTC/PEPECASH/USD']);
    });

    // The 24h delay applies to first publishes too, so a brand-new feed has
    // no live quote at all. Reporting one would tell an operator their
    // dispenser can settle when every attempt records invalid.
    it('reports a brand-new feed as pending with nothing live', async () => {
        const blockTime = NOW - 60;
        const sdk = {
            getOraclePrices: vi.fn(async () => ({
                data: [row({ block_time: blockTime, effective_at: blockTime + ORACLE_ACTIVATION_DELAY_S })],
            })),
        };
        const feeds = await myOracleFeeds({ sdkRegistry: registryWith(sdk), chainId: 'bitcoin-regtest', address: 'oracle-addr', nowSec: NOW });
        expect(feeds[0].live).toBeNull();
        expect(feeds[0].pending.value).toBe('0.05');
    });

    it('returns nothing when the explorer has no oracle lane', async () => {
        const feeds = await myOracleFeeds({ sdkRegistry: registryWith({}), chainId: 'bitcoin-regtest', address: 'oracle-addr', nowSec: NOW });
        expect(feeds).toEqual([]);
    });
});

describe('oracleConsumers', () => {
    it('queries dispensers by the oracle lane and drops invalid rows', async () => {
        const sdk = {
            getDispensers: vi.fn(async () => ({
                data: [
                    { action_index: 1, give_tick: 'PEPECASH', status: 'valid' },
                    { action_index: 2, give_tick: 'PEPECASH', status: 'invalid: whatever' },
                ],
            })),
        };
        const res = await oracleConsumers({ sdkRegistry: registryWith(sdk), chainId: 'bitcoin-regtest', address: 'oracle-addr' });
        expect(sdk.getDispensers).toHaveBeenCalledWith('oracle-addr', 'oracle');
        expect(res.supported).toBe(true);
        expect(res.dispensers).toHaveLength(1);
    });

    // "Could not check" must stay distinguishable from "nobody is using it":
    // an operator republishing on a false all-clear is the failure this
    // guards against.
    it('reports unsupported rather than empty when the query fails', async () => {
        const sdk = { getDispensers: vi.fn(async () => { throw new Error('404'); }) };
        const res = await oracleConsumers({ sdkRegistry: registryWith(sdk), chainId: 'bitcoin-regtest', address: 'oracle-addr' });
        expect(res).toEqual({ supported: false, dispensers: [] });
    });

    it('reports unsupported when the SDK has no getDispensers at all', async () => {
        const res = await oracleConsumers({ sdkRegistry: registryWith({}), chainId: 'bitcoin-regtest', address: 'oracle-addr' });
        expect(res.supported).toBe(false);
    });
});

describe('quoteDeviationPct', () => {
    it('measures the move against the publisher own prior price', () => {
        expect(quoteDeviationPct('0.05', '0.10')).toBe(100);
        expect(quoteDeviationPct('0.10', '0.05')).toBe(-50);
    });

    it('returns null when there is nothing to compare', () => {
        expect(quoteDeviationPct(null, '0.05')).toBeNull();
        expect(quoteDeviationPct('0.05', '')).toBeNull();
        expect(quoteDeviationPct('0', '0.05')).toBeNull();
    });

    // The classic fat finger: a misplaced decimal is a 900% move, which is
    // what the typed confirm exists to catch.
    it('flags a slipped decimal as an enormous move', () => {
        expect(quoteDeviationPct('0.05', '0.5')).toBe(900);
    });
});

describe('activationCountdownText', () => {
    it('renders hours and minutes for a fresh publish', () => {
        expect(activationCountdownText(ORACLE_ACTIVATION_DELAY_S)).toBe('24h 0m');
        expect(activationCountdownText(3660)).toBe('1h 1m');
        expect(activationCountdownText(120)).toBe('2m');
        expect(activationCountdownText(30)).toBe('under a minute');
    });

    it('renders nothing once the quote is effective', () => {
        expect(activationCountdownText(null)).toBeNull();
        expect(activationCountdownText(0)).toBeNull();
        expect(activationCountdownText(-10)).toBeNull();
    });
});
