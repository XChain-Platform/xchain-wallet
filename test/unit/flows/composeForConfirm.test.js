// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// composeForConfirm single-encode pipeline ( §5.3.1).

import { describe, it, expect, vi } from 'vitest';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';

function makeHarness({ adsEnabled = false, adsCanSubmit = false } = {}) {
    const createTx = vi.fn(async ({ data, ...opts }) => ({ psbt: 'PSBTHEX', encoding: 'OP_RETURN', _opts: opts }));
    const createAction = vi.fn(() => ({ actionString: 'SEND|0|JDOG|1|addr', action: 'SEND', version: 0 }));
    const sdk = { encoder: { createTx }, actions: { createAction } };
    const sdkRegistry = { get: () => sdk };
    const chainRegistry = { get: () => ({ coin: 'BTC', networkKind: 'regtest', adsDonationAddress: adsCanSubmit ? 'donateHere' : 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }) };
    const settings = adsEnabled
        ? { ads: { enabled: true, perChain: { btc: { accumulatedSats: 5000, triggerAmountSats: 1000, perTxAmountSats: 1, lifetimeTxCount: 0, lifetimeDonatedSats: 0 } } } }
        : { ads: { enabled: false, perChain: {} } };
    const vault = { settings: { get: async () => settings } };
    return { sdk, sdkRegistry, chainRegistry, vault, createTx, createAction };
}

const BASE_ARGS = (h) => ({
    sdkRegistry: h.sdkRegistry, chainRegistry: h.chainRegistry, vault: h.vault,
    chainId: 'btc', actionData: { action: 'SEND', params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: 'addr' } },
    encoderOpts: { pubkey: 'pub', change: 'chg' }, source: 'chg',
});

describe('composeForConfirm', () => {

    it('runs createAction -> encoder.createTx and returns the composed PSBT + expectedOutputs', async () => {
        const h = makeHarness();
        const composed = await composeForConfirm(BASE_ARGS(h));
        expect(composed.psbt).toBe('PSBTHEX');
        expect(composed.encoding).toBe('OP_RETURN');
        expect(composed.actionString).toBe('SEND|0|JDOG|1|addr');
        expect(composed.expectedOutputs.encoding).toBe('OP_RETURN');
        expect(h.createAction).toHaveBeenCalledOnce();
        expect(h.createTx).toHaveBeenCalledOnce();
    });

    it('folds the ADS donation output into customOutputs pre-modal but does NOT advance the accumulator', async () => {
        const h = makeHarness({ adsEnabled: true, adsCanSubmit: true });
        const putSpy = vi.fn();
        h.vault.settings.put = putSpy;
        const composed = await composeForConfirm(BASE_ARGS(h));
        // The donation output is inside the encoderOpts used to build the PSBT...
        const custom = composed.encoderOpts.customOutputs;
        expect(custom.some((o) => o.address === 'donateHere' && o.value === 5000)).toBe(true);
        // ...and whitelisted-but-flagged in expectedOutputs.
        expect(composed.expectedOutputs.addressed.find((s) => s.address === 'donateHere').isAds).toBe(true);
        // ...but the accumulator was NOT committed (no settings write).
        expect(putSpy).not.toHaveBeenCalled();
        expect(composed.adsPlan.canSubmit).toBe(true);
    });

    it('propagates a createAction failure unwrapped (pre-modal reject path)', async () => {
        const h = makeHarness();
        h.sdk.actions.createAction = () => { throw new Error('bad params'); };
        await expect(composeForConfirm(BASE_ARGS(h))).rejects.toThrow('bad params');
    });

    it('throws when the chain is unknown', async () => {
        const h = makeHarness();
        h.chainRegistry.get = () => null;
        await expect(composeForConfirm(BASE_ARGS(h))).rejects.toThrow(/unknown chain/);
    });

    it('throws when the encoder is not initialized', async () => {
        const h = makeHarness();
        h.sdk.encoder = null;
        await expect(composeForConfirm(BASE_ARGS(h))).rejects.toThrow(/encoder not initialized/);
    });

    // . The §5.3.2 check-3 verifier fails CLOSED when it gets no scripts,
    // so dropping them here did not weaken a check, it made every chunk-lane
    // action impossible to send: a three-recipient SEND is past one OP_RETURN,
    // takes the P2SH lane, and the confirm pipeline rejected it as tampered
    // before the modal opened. Every test around the check passed its own
    // scripts in, so this gap was invisible until a browser drove the form.
    it('carries the encoder\'s carrier scripts through to the tamper check', async () => {
        const h = makeHarness();
        h.sdk.encoder.createTx = vi.fn(async () => ({
            psbt: 'PSBTHEX', encoding: 'P2SH', carrierScripts: ['aa11', 'bb22'],
        }));
        const composed = await composeForConfirm(BASE_ARGS(h));
        expect(composed.encoding).toBe('P2SH');
        expect(composed.carrierScripts).toEqual(['aa11', 'bb22']);
    });

    it('reports no carrier scripts as an empty list, never undefined', async () => {
        // An encoder that returns none (older build, stripped response) must
        // still produce the shape the check reads, so "missing" reaches the
        // verifier as missing rather than as a malformed argument.
        const h = makeHarness();
        const composed = await composeForConfirm(BASE_ARGS(h));
        expect(composed.carrierScripts).toEqual([]);
    });
});

// : a plain native-coin payment carries no XChain action.
//
// It used to compose `SEND|0|BTC|...`, which the indexer rejects outright (it
// has no native-coin ledger, so the TICK is unknown). That cost an output on
// every send and, once the pre-flight dry-run became reachable, surfaced as a
// "Will likely fail" verdict that disabled Approve on the wallet's most common
// operation. A payment with nothing to say is now just a payment.
describe('composeForConfirm bare native payments ', () => {
    const NATIVE_ARGS = (h, params = {}) => ({
        ...BASE_ARGS(h),
        actionData: {
            action: 'SEND',
            params: { TICK: 'BTC', AMOUNT: '0.01', DESTINATION: 'bcrt1qdest', ...params },
        },
    });

    it('composes NO action and sends no data to the encoder', async () => {
        const h = makeHarness();
        const composed = await composeForConfirm(NATIVE_ARGS(h));

        expect(h.createAction).not.toHaveBeenCalled();
        expect(h.createTx.mock.calls[0][0].data).toBeUndefined();
        expect(composed.bareNativePayment).toBe(true);
        // Null, not '': callers must branch, not be handed an empty action that
        // looks parseable.
        expect(composed.actionString).toBeNull();
    });

    it('expects NO carrier output, so a stray OP_RETURN would be tamper', async () => {
        // The encoder still reports encoding 'OP_RETURN' (downstream single-tx
        // branches key off it). Passing that through would let the output-set
        // matcher wave through exactly the output this transaction must not have.
        const h = makeHarness();
        const composed = await composeForConfirm(NATIVE_ARGS(h));
        expect(composed.expectedOutputs.encoding).toBe('');
    });

    it('still pays the recipient', async () => {
        const h = makeHarness();
        await composeForConfirm(NATIVE_ARGS(h));
        const outs = h.createTx.mock.calls[0][0].customOutputs || [];
        expect(outs.some((o) => o.address === 'bcrt1qdest' && String(o.value) === '1000000')).toBe(true);
    });

    it('keeps the action when a MEMO is present: a memo needs a carrier', async () => {
        const h = makeHarness();
        const composed = await composeForConfirm(NATIVE_ARGS(h, { MEMO: 'hello' }));
        expect(composed.bareNativePayment).toBe(false);
        expect(h.createAction).toHaveBeenCalledOnce();
        expect(h.createTx.mock.calls[0][0].data).toBe('SEND|0|JDOG|1|addr');
    });

    it('leaves token sends completely alone', async () => {
        const h = makeHarness();
        const composed = await composeForConfirm(BASE_ARGS(h));
        expect(composed.bareNativePayment).toBe(false);
        expect(composed.actionString).toBe('SEND|0|JDOG|1|addr');
        expect(composed.expectedOutputs.encoding).toBe('OP_RETURN');
    });
});

// : a BET composed on a chain where the native coin is the ONLY fee lane.
//
// This is the ledger's verify line one layer below the chain: compose a BET with
// the native-fee mode on and confirm a FEE_DESTINATION output is present in the
// PSBT the user is about to approve. It has to be HERE, inside the composed
// bytes, rather than added at submit time: the confirm page previews and the
// tamper check verifies exactly these outputs, so a fee output that appeared
// later would either be invisible to the user or read as tampering.
describe('composeForConfirm native-coin protocol fee ( BET on LTC)', () => {
    const FEE_DEST = 'rltc1qfeedestination';

    function betHarness({ quote } = {}) {
        const createTx = vi.fn(async ({ data, ...opts }) => ({ psbt: 'PSBTHEX', encoding: 'OP_RETURN', _opts: opts }));
        const createAction = vi.fn(() => ({
            actionString: 'BET|2|2308|0|5', action: 'BET', version: 2,
        }));
        const sdk = {
            encoder: { createTx },
            actions: { createAction },
            quoteNativeFee: vi.fn(async () => quote),
        };
        return {
            createTx,
            sdk,
            args: {
                sdkRegistry: { get: () => sdk },
                chainRegistry: { get: () => ({ coin: 'LTC', networkKind: 'regtest', adsDonationAddress: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }) },
                vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
                chainId: 'litecoin-regtest',
                actionData: { action: 'BET', params: { VERSION: 2, FEED_ACTION_INDEX: '2308', OUTCOME: '0', AMOUNT: '5' } },
                encoderOpts: { pubkey: 'pub', change: 'chg', payFeeInNativeCoin: true },
                source: 'chg',
            },
        };
    }

    it('sizes a FEE_DESTINATION output from the quote and hides the flag from the encoder', async () => {
        const h = betHarness({
            quote: { supported: true, valid: true, feeDestination: FEE_DEST, requiredFeeSats: 31337 },
        });
        const composed = await composeForConfirm(h.args);

        const outs = composed.encoderOpts.customOutputs || [];
        expect(outs.some((o) => o.address === FEE_DEST && o.value === 31337)).toBe(true);
        // The same outputs the encoder was actually handed, not a parallel list.
        const built = h.createTx.mock.calls[0][0].customOutputs || [];
        expect(built.some((o) => o.address === FEE_DEST && o.value === 31337)).toBe(true);
        // `payFeeInNativeCoin` is the wallet's own control word; forwarding it
        // to the encoder would be an unknown param on the wire path.
        expect('payFeeInNativeCoin' in h.createTx.mock.calls[0][0]).toBe(false);
        expect(h.sdk.quoteNativeFee).toHaveBeenCalledOnce();
    });

    it('refuses to build the transaction when the fee cannot be priced', async () => {
        // Refusing costs nothing; building would spend a miner fee on an action
        // the chain rejects, and the native fee itself is never refunded.
        const h = betHarness({ quote: { supported: false, error: 'no oracle round' } });
        await expect(composeForConfirm(h.args)).rejects.toThrow(/native-coin fee pre-flight failed/);
        expect(h.createTx).not.toHaveBeenCalled();
    });

    it('adds nothing when the market is free (a zero-fee quote is still valid)', async () => {
        // Short markets fall inside the shared free window, so the quote is
        // valid with requiredFeeSats 0; a dust output there would be waste.
        const h = betHarness({
            quote: { supported: true, valid: true, feeDestination: FEE_DEST, requiredFeeSats: 0 },
        });
        const composed = await composeForConfirm(h.args);
        expect((composed.encoderOpts.customOutputs || []).some((o) => o.address === FEE_DEST)).toBe(false);
    });
});
