// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the native-coin fee pre-flight guardrail.

import { describe, it, expect } from 'vitest';
import {
    applyNativeFeePreflight,
    NativeFeeForfeitError,
    NATIVE_FEE_WARNING,
    nativeFeeErrorMessage,
} from '../../../packages/core/src/sdk/nativeFeePreflight.js';

// Minimal SDK stub whose quoteNativeFee returns a canned quote and records its args.
function makeSdk(quote) {
    return {
        seen: null,
        async quoteNativeFee(actionData, opts) {
            this.seen = { actionData, opts };
            return Object.assign(
                { supported: true, valid: true, requiredFeeSats: 2000, feeDestination: 'feeDest' },
                quote || {},
            );
        },
    };
}

const ACTION = { action: 'ISSUE', params: { tick: 'NEWTICK' } };

describe('applyNativeFeePreflight', () => {
    it('is a no-op when payFeeInNativeCoin is not set', async () => {
        const sdk = makeSdk();
        const encoderOpts = { pubkey: 'pk', customOutputs: [{ address: 'x', value: 1 }] };
        const out = await applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts });
        expect(out.quote).toBe(null);
        expect(out.encoderOpts).toBe(encoderOpts); // same reference, untouched
        expect(sdk.seen).toBe(null); // no quote fetched
    });

    it('sizes the FEE_DESTINATION output to requiredFeeSats and strips the flag', async () => {
        const sdk = makeSdk();
        const out = await applyNativeFeePreflight({
            sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true, pubkey: 'pk' }, source: 'src1',
        });
        expect(out.quote.requiredFeeSats).toBe(2000);
        expect(out.encoderOpts.customOutputs).toEqual([{ address: 'feeDest', value: 2000 }]);
        expect(out.encoderOpts.payFeeInNativeCoin).toBeUndefined();
        expect(out.encoderOpts.pubkey).toBe('pk');
        expect(sdk.seen.opts.source).toBe('src1');
    });

    it('merges the native output with caller-supplied customOutputs', async () => {
        const sdk = makeSdk();
        const out = await applyNativeFeePreflight({
            sdk, actionData: ACTION,
            encoderOpts: { payFeeInNativeCoin: true, customOutputs: [{ address: 'extra', value: 5 }] },
        });
        expect(out.encoderOpts.customOutputs).toHaveLength(2);
        expect(out.encoderOpts.customOutputs.map(o => o.address)).toContain('extra');
        expect(out.encoderOpts.customOutputs.map(o => o.address)).toContain('feeDest');
    });

    it('does not mutate the caller-supplied customOutputs array', async () => {
        const sdk = makeSdk();
        const original = [{ address: 'extra', value: 5 }];
        await applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true, customOutputs: original } });
        expect(original).toHaveLength(1);
    });

    it('refuses (throws NativeFeeForfeitError) when the quote is unsupported', async () => {
        const sdk = makeSdk({ supported: false, valid: false, error: 'not supported' });
        await expect(
            applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true } }),
        ).rejects.toMatchObject({ name: 'NativeFeeForfeitError', reason: 'unsupported' });
    });

    it('refuses when the oracle price is stale/invalid', async () => {
        const sdk = makeSdk({ supported: true, valid: false, error: 'missing or stale beyond 1800s' });
        let err;
        try {
            await applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true } });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(NativeFeeForfeitError);
        expect(err.reason).toBe('invalid');
        expect(err.quote.error).toMatch(/stale/);
    });

    it('adds no output when the required native fee is zero', async () => {
        const sdk = makeSdk({ requiredFeeSats: 0 });
        const out = await applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true } });
        expect(out.encoderOpts.customOutputs).toEqual([]);
        expect(out.quote.requiredFeeSats).toBe(0);
    });

    // Measured live on Bitcoin regtest: a DIVIDEND to a single holder quotes
    // requiredFeeSats 2 (DIVIDEND_PER_RECIPIENT 100 gas), the wallet attached that output,
    // and bitcoind rejected the whole transaction as `dust` - after which the wallet still
    // reported the dividend as sent. Refusing at the guardrail is what keeps the doomed
    // transaction from being built at all.
    it('refuses a fee priced below the chain dust threshold instead of building a doomed tx', async () => {
        const sdk = makeSdk({ requiredFeeSats: 2, requiredFeeNative: '0.00000002' });
        let err = null;
        try {
            await applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true } });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(NativeFeeForfeitError);
        expect(err.reason).toBe('dust');
        expect(err.quote.requiredFeeSats).toBe(2);
    });

    it('reads the dust threshold off the SDK network, so DOGE refuses what Bitcoin allows', async () => {
        // 600 sats clears Bitcoin's 546 and is far below Dogecoin's 100000.
        const withNetwork = (dustThreshold) => Object.assign(makeSdk({ requiredFeeSats: 600 }), {
            wallet: { getBitcoinNetwork: () => ({ dustThreshold }) },
        });
        const btc = await applyNativeFeePreflight({
            sdk: withNetwork(546), actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true },
        });
        expect(btc.encoderOpts.customOutputs).toEqual([{ address: 'feeDest', value: 600 }]);

        let err = null;
        try {
            await applyNativeFeePreflight({
                sdk: withNetwork(100000), actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true },
            });
        } catch (e) { err = e; }
        expect(err).toBeInstanceOf(NativeFeeForfeitError);
        expect(err.reason).toBe('dust');
    });

    it('still attaches a fee at or above the threshold', async () => {
        const sdk = makeSdk({ requiredFeeSats: 546 });
        const out = await applyNativeFeePreflight({ sdk, actionData: ACTION, encoderOpts: { payFeeInNativeCoin: true } });
        expect(out.encoderOpts.customOutputs).toEqual([{ address: 'feeDest', value: 546 }]);
    });

    it('exposes a non-empty forfeiture warning string', () => {
        expect(NATIVE_FEE_WARNING).toMatch(/forfeit/i);
    });
});

// "turn it off to pay in XCHAIN" is only actionable advice on a chain
// that HAS an XCHAIN fee lane. On LTC/DOGE it sends the user to build a
// transaction the network rejects outright.
describe('nativeFeeErrorMessage', () => {
    it('names the amount and the XCHAIN lane on a dust refusal', () => {
        const err = { reason: 'dust', quote: { requiredFeeNative: '0.00000002' } };
        const btc = nativeFeeErrorMessage(err, { coinTicker: 'BTC', mandatory: false });
        expect(btc).toMatch(/0\.00000002 BTC/);
        expect(btc).toMatch(/pay in XCHAIN/);
        // No XCHAIN lane off Bitcoin: say the action cannot be submitted, not "turn it off".
        const doge = nativeFeeErrorMessage(err, { coinTicker: 'DOGE', mandatory: true });
        expect(doge).toMatch(/cannot be submitted/);
        expect(doge).not.toMatch(/Turn off/i);
    });

    // The popup/extension gets this error back across the messaging boundary, which carries
    // only { name, message }. Before this, every refusal that crossed it read as
    // "the price is temporarily unavailable" - wrong for a dust fee and wrong for an
    // unpriceable action, neither of which is temporary.
    it('recovers the reason from the message when the boundary stripped the field', () => {
        const crossed = {
            name: 'NativeFeeForfeitError',
            message: 'native-coin fee pre-flight failed (dust): 0.00000002 is below the dust threshold',
        };
        const msg = nativeFeeErrorMessage(crossed, { coinTicker: 'BTC' });
        expect(msg).toMatch(/too small to send/);
        // The amount survives the boundary because the constructor put it in the message.
        expect(msg).toMatch(/0\.00000002 BTC/);
        const unsupported = {
            name: 'NativeFeeForfeitError',
            message: 'native-coin fee pre-flight failed (unsupported): unsupported',
        };
        expect(nativeFeeErrorMessage(unsupported, { coinTicker: 'BTC' })).toMatch(/not available for this action/);
        // An unrecognised error still gets the temporary-price wording.
        expect(nativeFeeErrorMessage(new Error('boom'), { coinTicker: 'BTC' })).toMatch(/temporarily unavailable/);
    });

    it('offers the XCHAIN fallback only where one exists', () => {
        const err = { reason: 'unsupported' };
        expect(nativeFeeErrorMessage(err, { coinTicker: 'BTC', mandatory: false }))
            .toMatch(/Turn it off to pay in XCHAIN/);
        const ltc = nativeFeeErrorMessage(err, { coinTicker: 'LTC', mandatory: true });
        expect(ltc).not.toMatch(/turn it off/i);
        expect(ltc).toMatch(/only way to pay a protocol fee here/);
    });

    it('drops the turn-it-off suggestion from the stale-price message too', () => {
        const err = { reason: 'invalid' };
        expect(nativeFeeErrorMessage(err, { coinTicker: 'BTC', mandatory: false }))
            .toMatch(/turn off native-coin fee payment/);
        expect(nativeFeeErrorMessage(err, { coinTicker: 'DOGE', mandatory: true }))
            .toBe('The DOGE fee price is temporarily unavailable. Try again in a moment.');
    });

    // `invalid` is two situations under one name, and only the price half is
    // temporary. Found live (wallet E2E session 24): a stake larger than the balance
    // answered `invalid: insufficient funds (AMOUNT)` and the wallet told the user the
    // LTC fee price was temporarily unavailable and to try again in a moment. The price
    // was fine, the stake was not, and waiting could never fix it.
    it('reports a non-price rejection as itself instead of blaming the price feed', () => {
        const err = new NativeFeeForfeitError({
            reason: 'invalid',
            quote: { valid: false, error: 'invalid: insufficient funds (AMOUNT)' },
        });
        const msg = nativeFeeErrorMessage(err, { coinTicker: 'LTC', mandatory: true });

        expect(msg).not.toMatch(/temporarily unavailable/);
        expect(msg).not.toMatch(/try again in a moment/i);
        expect(msg).toMatch(/insufficient funds \(AMOUNT\)/);
        // The doubled "invalid:" the indexer prefixes its verdict with is not user copy.
        expect(msg).not.toMatch(/invalid: insufficient/);
        expect(msg).toMatch(/Nothing was signed or sent/);
        expect(msg).toMatch(/Waiting will not change this/);
    });

    it('keeps the temporary wording when the rejection really is the price feed', () => {
        for (const detail of [
            'invalid: no current oracle price for LTC/USD (missing or stale beyond 1800s)',
            'invalid: price snapshot is stale',
        ]) {
            const err = new NativeFeeForfeitError({ reason: 'invalid', quote: { valid: false, error: detail } });
            expect(nativeFeeErrorMessage(err, { coinTicker: 'LTC', mandatory: true }))
                .toBe('The LTC fee price is temporarily unavailable. Try again in a moment.');
        }
    });

    // D-146, found live (wallet E2E session 33) driving the first Mode B
    // dispenser this platform has composed. The oracle-usage-fee verdicts are the
    // one family that contains the words the price heuristic above looks for
    // while being neither temporary nor about the validator feed, so they were
    // swallowed by it: an operator who had just published a quote, and been
    // warned twice on screen that it matures in 24 hours, was told the LTC fee
    // price was temporarily unavailable and to try again in a moment.
    it('names the oracle maturation instead of blaming the coin price feed', () => {
        const err = new NativeFeeForfeitError({
            reason: 'invalid',
            quote: { valid: false, error: 'invalid: ORACLE_ADDRESS (no effective oracle price)' },
        });
        const msg = nativeFeeErrorMessage(err, { coinTicker: 'LTC', mandatory: true });

        expect(msg).not.toMatch(/temporarily unavailable/);
        expect(msg).not.toMatch(/try again in a moment/i);
        expect(msg).not.toMatch(/ORACLE_ADDRESS/);
        expect(msg).toMatch(/24 hours/);
        expect(msg).toMatch(/Nothing was signed or sent/);
    });

    // The four ORACLE_ADDRESS verdicts have four different remedies, and one of
    // them genuinely IS "wait a moment". Collapsing them would trade one wrong
    // sentence for another.
    it('separates the oracle verdicts that are temporary from the ones that are not', () => {
        const say = (detail) => nativeFeeErrorMessage(
            new NativeFeeForfeitError({ reason: 'invalid', quote: { valid: false, error: detail } }),
            { coinTicker: 'LTC', mandatory: true },
        );
        expect(say('invalid: ORACLE_ADDRESS (no validator price to value the oracle fee)'))
            .toMatch(/try again in a moment/i);
        expect(say('invalid: ORACLE_ADDRESS (missing oracle fee output)'))
            .toMatch(/usage fee/i);
        expect(say('invalid: ORACLE_ADDRESS (insufficient oracle fee, paid 0.00001000, expected 0.00002000)'))
            .toMatch(/usage fee/i);
        // An unrecognised ORACLE_ADDRESS verdict still must not be reported as a
        // stale price feed: quoting the chain verbatim is the safe fallback.
        expect(say('invalid: ORACLE_ADDRESS (some future rule)'))
            .toMatch(/Waiting will not change this/);
    });

    // A bare reason with no indexer verdict must not invent one.
    it('still says "temporarily unavailable" when there is no detail to report', () => {
        expect(nativeFeeErrorMessage({ reason: 'invalid' }, { coinTicker: 'LTC', mandatory: true }))
            .toBe('The LTC fee price is temporarily unavailable. Try again in a moment.');
    });

    it('falls back to a generic coin name when the ticker is unknown', () => {
        expect(nativeFeeErrorMessage({ reason: 'unsupported' }, {})).toMatch(/the native coin/);
    });
});
