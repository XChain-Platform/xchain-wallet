// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Fee quote replies that are malformed, wrong-chain or stale. The native and
// oracle pre-flights compose real outputs from these replies, so each case pins
// whether a bad reply is refused or reaches the composed outputs. A case
// marked it.fails encodes the correct behaviour for an open defect at this
// head; it turns red once the pre-flight refuses that reply, and the fix then
// changes it to it.

import { describe, expect, it, vi } from 'vitest';
import { applyNativeFeePreflight } from '../../../packages/core/src/sdk/nativeFeePreflight.js';
import { applyOracleFeePreflight } from '../../../packages/core/src/sdk/oracleFeePreflight.js';

const NATIVE_ACTION = { action: 'DEPLOY', params: {} };
const DOGE_DUST = 100000;
const USER_ORACLE = 'mUserNamedOracleAddressRegtest';

const nativeSdk = (quote, dust = DOGE_DUST) => ({
    wallet: { getBitcoinNetwork: () => ({ dustThreshold: dust }) },
    quoteNativeFee: vi.fn(async () => quote),
});

const goodNative = (over = {}) => ({
    supported: true,
    valid: true,
    chainId: 'DOGE',
    coin: 'DOGE',
    requiredFeeSats: 200000,
    requiredFeeNative: '0.00200000',
    feeDestination: 'mFeeDestinationRegtest',
    ...over,
});

const oracleAction = (over = {}) => ({
    action: 'DISPENSER',
    params: {
        GIVE_TICK: 'TOKEN',
        GIVE_ESCROW: '10',
        FIAT_CODE: 'USD',
        ORACLE_ADDRESS: USER_ORACLE,
        ...over,
    },
});

const oracleSdk = (quote) => ({
    explorer: { getOracleFeeQuote: vi.fn(async () => quote) },
});

const goodOracle = (over = {}) => ({
    valid: true,
    oracleAddress: USER_ORACLE,
    requiredFeeSats: 250000,
    requiredFeeNative: '0.00250000',
    belowDust: false,
    ...over,
});

async function nativeOutcome(quote, dust) {
    try {
        const out = await applyNativeFeePreflight({
            sdk: nativeSdk(quote, dust),
            actionData: NATIVE_ACTION,
            encoderOpts: { payFeeInNativeCoin: true },
        });
        return { outputs: out.encoderOpts.customOutputs, quote: out.quote };
    } catch (err) {
        return { error: err };
    }
}

describe('native fee quote reply integrity', () => {
    it('composes the fee output to the quoted destination for a well-formed reply', async () => {
        const res = await nativeOutcome(goodNative());
        expect(res.error).toBeUndefined();
        expect(res.outputs).toEqual([{ address: 'mFeeDestinationRegtest', value: 200000 }]);
    });

    for (const [label, feeDestination] of [
        ['missing', undefined],
        ['empty', ''],
        ['whitespace', '   '],
        ['a number', 12345],
        ['an object', { address: 'x' }],
    ]) {
        it(`never composes an output whose address is ${label}`, async () => {
            const res = await nativeOutcome(goodNative({ feeDestination }));
            const bad = (res.outputs || []).filter((o) => typeof o.address !== 'string' || !o.address.trim());
            expect(bad).toEqual([]);
        });
    }

    for (const [label, requiredFeeSats] of [
        ['exponent string', '1e3'],
        ['hex string', '0x10'],
        ['negative', -5],
        ['beyond 2^53', Number.MAX_SAFE_INTEGER + 2],
        ['NaN', NaN],
        ['nested object', { sats: 1000 }],
    ]) {
        it(`refuses a requiredFeeSats that is a ${label}`, async () => {
            const res = await nativeOutcome(goodNative({ requiredFeeSats }));
            expect(res.error).toBeDefined();
            expect(res.outputs).toBeUndefined();
        });
    }

    it('raises a below-dust native quote to the chain floor of the sdk network', async () => {
        const res = await nativeOutcome(goodNative({ requiredFeeSats: 600 }));
        expect(res.outputs).toEqual([{ address: 'mFeeDestinationRegtest', value: DOGE_DUST }]);
    });

    it('carries a wrong-chain reply identity unchanged so the requote identity check compares it', async () => {
        const res = await nativeOutcome(goodNative({ chainId: 'BTC', coin: 'BTC' }));
        // The pre-flight has no chain identity of its own to compare; the
        // requote compares this composed identity with the fresh one.
        expect(res.quote?.chainId).toBe('BTC');
        expect(res.quote?.coin).toBe('BTC');
    });
});

async function oracleOutcome(quote, actionOver) {
    try {
        const out = await applyOracleFeePreflight({
            sdk: oracleSdk(quote),
            actionData: oracleAction(actionOver),
            encoderOpts: {},
        });
        return { outputs: out.encoderOpts.customOutputs, quote: out.oracleFeeQuote };
    } catch (err) {
        return { error: err };
    }
}

describe('oracle fee quote reply integrity', () => {
    it('pays the user-named oracle for a well-formed reply', async () => {
        const res = await oracleOutcome(goodOracle());
        expect(res.outputs).toEqual([{ address: USER_ORACLE, value: 250000 }]);
    });

    it('never pays the oracle fee to an address the user did not name', async () => {
        const res = await oracleOutcome(goodOracle({ oracleAddress: 'mSomeOtherAddressRegtest' }));
        const paidElsewhere = (res.outputs || []).filter((o) => o.address !== USER_ORACLE);
        expect(paidElsewhere).toEqual([]);
    });

    it('refuses a reply that redirects a small oracle fee to another address', async () => {
        const res = await oracleOutcome(goodOracle({ oracleAddress: 'attacker', requiredFeeSats: 1000 }));
        expect((res.outputs || []).some((o) => o.address === 'attacker')).toBe(false);
        expect(res.error?.name).toBe('OracleFeeUnpayableError');
        expect(res.error?.reason).toBe('unquotable');
    });

    it.fails('never drops a fee far above the dust floor because the reply says belowDust', async () => {
        const res = await oracleOutcome(goodOracle({ belowDust: true, requiredFeeSats: 50000000 }));
        // Either refuse the reply or pay the fee; composing no output is a
        // create the indexer rejects as unpaid.
        if (!res.error) {
            expect(res.outputs).toEqual([{ address: USER_ORACLE, value: 50000000 }]);
        }
    });

    it('drops a zero fee that the reply marks belowDust', async () => {
        const res = await oracleOutcome(goodOracle({ belowDust: true, requiredFeeSats: 0, requiredFeeNative: '0' }));
        expect(res.outputs).toEqual([]);
    });

    for (const [label, requiredFeeSats] of [
        ['exponent string', '1e3'],
        ['hex string', '0x10'],
        ['negative', -5],
        ['beyond 2^53', Number.MAX_SAFE_INTEGER + 2],
        ['NaN', NaN],
        ['nested object', { sats: 1000 }],
    ]) {
        it(`refuses an oracle requiredFeeSats that is a ${label}`, async () => {
            const res = await oracleOutcome(goodOracle({ requiredFeeSats }));
            expect(res.error).toBeDefined();
            expect(res.outputs).toBeUndefined();
        });
    }
});

describe('fee quote replies that resolve after an abort', () => {
    it('forwards the abort signal to the native quote', async () => {
        const controller = new AbortController();
        const sdk = nativeSdk(goodNative());
        await applyNativeFeePreflight({
            sdk, actionData: NATIVE_ACTION,
            encoderOpts: { payFeeInNativeCoin: true }, signal: controller.signal,
        });
        expect(sdk.quoteNativeFee.mock.calls[0][1].signal).toBe(controller.signal);
    });

    it.fails('refuses a native quote that resolves after the signal aborts', async () => {
        const controller = new AbortController();
        const sdk = {
            wallet: { getBitcoinNetwork: () => ({ dustThreshold: DOGE_DUST }) },
            quoteNativeFee: vi.fn(async () => { controller.abort(); return goodNative(); }),
        };
        await expect(applyNativeFeePreflight({
            sdk, actionData: NATIVE_ACTION,
            encoderOpts: { payFeeInNativeCoin: true }, signal: controller.signal,
        })).rejects.toThrow();
    });

    it.fails('refuses an oracle quote that resolves after the signal aborts', async () => {
        const controller = new AbortController();
        const sdk = {
            explorer: { getOracleFeeQuote: vi.fn(async () => { controller.abort(); return goodOracle(); }) },
        };
        await expect(applyOracleFeePreflight({
            sdk, actionData: oracleAction(), encoderOpts: {}, signal: controller.signal,
        })).rejects.toThrow();
    });
});
