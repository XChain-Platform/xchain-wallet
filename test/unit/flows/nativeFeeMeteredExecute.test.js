// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet side of the indexer's EXECUTE_NATIVE_METERED_GAS gate.
//
// Once the gate is armed, a native-paid EXECUTE on LTC/DOGE runs only the gas its fee
// output pays for, so the wallet has to pay the dry-run quote (estimate plus a 20 percent
// margin) and must never pay a base-only amount. The three quote shapes below are the
// ones the indexer's own static_quotes.test.js pins for EXECUTE (xchain-indexer 391d7588d):
// the pre-gate schedule quote, the metered dry-run quote, and the base-only answer it
// gives when that dry run cannot finish.

import { describe, it, expect } from 'vitest';
import {
    applyNativeFeePreflight,
    isBaseOnlyExecuteQuote,
    nativeFeeErrorMessage,
    NativeFeeForfeitError,
} from '../../../packages/core/src/sdk/nativeFeePreflight.js';
import {
    compareNativeFeeQuote,
    isNativeFeeRefusal,
} from '../../../packages/core/src/flows/nativeFeeRequote.js';

const LTC_DEST = 'Lfees7tszAx5Gqam2fuqf6biaX3LXafM4H';
const EXECUTE = { action: 'EXECUTE', params: { CONTRACT_ACTION_INDEX: '6441', METHOD: 'spin', PARAMS: ['1'] } };

const QUOTE_BASE = Object.freeze({
    supported: true, action: 'EXECUTE', coin: 'LTC', feeDestination: LTC_DEST,
    toleranceMin: '0.95000000', toleranceMax: '1.10000000',
});

// After the gate: 50,000 gas estimated, 60,000 quoted with the 20 percent margin.
const METERED = Object.freeze({
    ...QUOTE_BASE, valid: true, validated: true, status: 'valid',
    estimatedGasCost: 50000, gasSafetyMarginPercent: 20, gasCost: 60000,
    xchainFee: '0.60000000', requiredFeeNative: '0.00600000',
    requiredFeeSats: 600000, requiredFeeSatsExact: '600000',
    expectedNative: '0.00600000', minAcceptable: '0.00570000', maxAcceptable: '0.00660000',
});

// Before the gate: the schedule's base fee, which buys the protocol gas ceiling.
const STATIC = Object.freeze({
    ...QUOTE_BASE, valid: null, validated: false, staticQuote: true, gasCost: 1000,
    xchainFee: '0.01000000', requiredFeeNative: '0.00010000',
    requiredFeeSats: 10000, requiredFeeSatsExact: '10000',
    expectedNative: '0.00010000', minAcceptable: '0.00009500', maxAcceptable: '0.00011000',
});

// After the gate, when the dry run did not finish: the base fee alone, no staticQuote.
const BASE_ONLY = Object.freeze({
    ...QUOTE_BASE, valid: null, validated: false, gasCost: 1000,
    xchainFee: '0.01000000', requiredFeeNative: '0.00010000',
    requiredFeeSats: 10000, requiredFeeSatsExact: '10000',
    expectedNative: '0.00010000', minAcceptable: '0.00009500', maxAcceptable: '0.00011000',
    note: 'EXECUTE dry-run gas estimation was unavailable; this quote covers only the base fee.',
});

function ltcSdk(quote) {
    return {
        calls: 0,
        options: { network: 'litecoin-mainnet' },
        wallet: { getBitcoinNetwork: () => ({ dustThreshold: 5460 }) },
        async quoteNativeFee() {
            this.calls += 1;
            return { ...quote };
        },
    };
}

function preflight(quote) {
    return applyNativeFeePreflight({
        sdk: ltcSdk(quote), actionData: EXECUTE, encoderOpts: { payFeeInNativeCoin: true }, source: 'src',
    });
}

describe('native-fee EXECUTE under the metered-gas gate: compose and submit', () => {
    it('pays the metered quote exactly, margin included', async () => {
        const out = await preflight(METERED);
        expect(out.encoderOpts.customOutputs).toEqual([{ address: LTC_DEST, value: 600000 }]);
        expect(out.quote.requiredFeeSats).toBe(600000);
    });

    it('sizes from requiredFeeSatsExact, never below it', async () => {
        const out = await preflight({ ...METERED, requiredFeeSats: 600000, requiredFeeSatsExact: '600000' });
        expect(out.encoderOpts.customOutputs[0].value).toBe(Number(METERED.requiredFeeSatsExact));
    });

    it('refuses a reply whose two amounts disagree', async () => {
        await expect(preflight({ ...METERED, requiredFeeSats: 10000, requiredFeeSatsExact: '600000' }))
            .rejects.toThrow(/amounts disagree/);
    });

    it('keeps sizing from requiredFeeSats when an older indexer omits the exact field', async () => {
        const { requiredFeeSatsExact, ...legacy } = METERED;
        const out = await preflight(legacy);
        expect(out.encoderOpts.customOutputs).toEqual([{ address: LTC_DEST, value: 600000 }]);
    });

    it('still pays the pre-gate schedule quote', async () => {
        const out = await preflight(STATIC);
        expect(out.encoderOpts.customOutputs).toEqual([{ address: LTC_DEST, value: 10000 }]);
    });

    it('refuses the base-only answer instead of paying base gas', async () => {
        const err = await preflight(BASE_ONLY).catch((e) => e);
        expect(err).toBeInstanceOf(NativeFeeForfeitError);
        expect(err.reason).toBe('invalid');
        const copy = nativeFeeErrorMessage({ name: err.name, message: err.message }, { coinTicker: 'LTC', mandatory: true });
        expect(copy).toMatch(/could not estimate the gas/);
        expect(copy).toMatch(/nothing was signed or sent/i);
        expect(copy).not.toMatch(/price/i);
    });

    it('recognises only the EXECUTE base-only shape', () => {
        expect(isBaseOnlyExecuteQuote(BASE_ONLY, 'EXECUTE')).toBe(true);
        expect(isBaseOnlyExecuteQuote({ ...BASE_ONLY, action: undefined, actionString: 'EXECUTE|0|6441|spin|1' })).toBe(true);
        expect(isBaseOnlyExecuteQuote(STATIC, 'EXECUTE')).toBe(false);
        expect(isBaseOnlyExecuteQuote(METERED, 'EXECUTE')).toBe(false);
        expect(isBaseOnlyExecuteQuote({ ...BASE_ONLY, action: 'DEPLOY' }, 'DEPLOY')).toBe(false);
        expect(isBaseOnlyExecuteQuote(null, 'EXECUTE')).toBe(false);
    });
});

describe('native-fee EXECUTE under the metered-gas gate: Approve re-quote', () => {
    const composedMetered = { ...METERED };
    const composedStatic = { ...STATIC };

    it('lets a metered compose proceed when the fresh quote could not estimate gas', () => {
        const cmp = compareNativeFeeQuote({ composed: composedMetered, fresh: BASE_ONLY });
        expect(cmp.verdict).toBe('unavailable');
        expect(isNativeFeeRefusal(cmp)).toBe(false);
    });

    it('refuses a base-fee compose once the indexer answers base-only', () => {
        const cmp = compareNativeFeeQuote({ composed: composedStatic, fresh: BASE_ONLY });
        expect(cmp.verdict).toBe('invalid');
        expect(isNativeFeeRefusal(cmp)).toBe(true);
    });

    it('refuses a base-fee compose against a fresh metered quote', () => {
        const cmp = compareNativeFeeQuote({ composed: composedStatic, fresh: METERED });
        expect(cmp.verdict).toBe('short');
        expect(isNativeFeeRefusal(cmp)).toBe(true);
    });

    it('passes an unchanged metered quote', () => {
        const cmp = compareNativeFeeQuote({ composed: composedMetered, fresh: METERED });
        expect(cmp.verdict).toBe('ok');
    });
});
