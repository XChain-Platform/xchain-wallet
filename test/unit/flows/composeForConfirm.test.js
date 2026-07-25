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
