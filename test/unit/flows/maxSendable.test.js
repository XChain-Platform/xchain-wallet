// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// quoteMaxSendable: Max priced by the encoder that builds the send.
//
// THE NUMBERS IN THIS FILE ARE THE MEASURED ONES. BTC regtest, 2026-07-29, one
// address holding exactly 50,000,000 sats: Max offered 49,998,500 (balance
// minus the static 250 vB x 6 sat/vB = 1500), the transaction paid 924, and 576
// satoshis stayed at the address the user had emptied. 924 is not arbitrary
// either - it is the encoder's own size for that transaction, 154 bytes
// (68 input + 43 payment output + 43 unconditional change padding) at 6 sat/vB.
// A quote that returns 49,999,076 leaves nothing behind, and that equality is
// what these tests hold onto.

import { describe, it, expect, vi } from 'vitest';
import { quoteMaxSendable, insufficientFundsQuote } from '../../../packages/core/src/flows/maxSendable.js';

const BALANCE = 50_000_000;
const REAL_FEE = 924;

/**
 * An encoder that prices like the real one: it refuses a transaction whose
 * outputs consume every input, and states what it would have charged.
 *
 * `extraOutputSats` models what the compose pipeline adds on top of the payment
 * (an ADS donation), which the sweep also has to leave room for.
 */
function encoderThatRefuses({ fee = REAL_FEE, available = BALANCE, extraOutputSats = 0 } = {}) {
    return vi.fn(async (opts) => {
        const outputs = (opts.customOutputs || [])
            .reduce((sum, o) => sum + Number(o.value), 0);
        if (outputs + fee > available) {
            const err = new Error('Encoder RPC error: insufficient funds');
            err.name = 'SDKEncoderError';
            err.details = {
                rpcError: {
                    code: -32010,
                    data: {
                        reason: 'INSUFFICIENT_FUNDS',
                        required: outputs + fee,
                        available,
                        outputs,
                        fee,
                    },
                },
            };
            err.details.context = err.details.rpcError.data;
            throw err;
        }
        return { psbt: 'PSBTHEX', encoding: 'OP_RETURN' };
    });
}

function makeHarness({ createTx, utxos = [{ value: BALANCE }], ads = null } = {}) {
    const sdk = {
        encoder: {
            createTx: createTx || encoderThatRefuses(),
            getUTXOs: vi.fn(async () => ({ utxos })),
        },
        actions: { createAction: vi.fn(() => ({ actionString: 'x', action: 'SEND', version: 0 })) },
    };
    const settings = ads
        ? { ads: { enabled: true, perChain: { btc: ads } } }
        : { ads: { enabled: false, perChain: {} } };
    return {
        sdk,
        sdkRegistry: { get: () => sdk },
        chainRegistry: { get: () => ({ coin: 'bitcoin', networkKind: 'regtest', adsDonationAddress: 'donateHere' }) },
        vault: { settings: { get: async () => settings } },
    };
}

const ARGS = (h, over = {}) => ({
    sdkRegistry: h.sdkRegistry,
    chainRegistry: h.chainRegistry,
    vault: h.vault,
    chainId: 'btc',
    source: 'src-address',
    destination: 'dst-address',
    encoderOpts: { pubkey: 'pub', change: 'src-address' },
    ...over,
});

describe('quoteMaxSendable', () => {

    it('offers balance minus the fee the encoder would actually charge, not the static estimate', async () => {
        const h = makeHarness();
        const quote = await quoteMaxSendable(ARGS(h));
        expect(quote).not.toBeNull();
        expect(quote.feeSats).toBe(String(REAL_FEE));
        expect(quote.maxSats).toBe(String(BALANCE - REAL_FEE));
        // The defect's number, stated as the thing this must not be: the static
        // 1500-sat estimate would have offered 49,998,500 and stranded 576.
        expect(quote.maxSats).not.toBe(String(BALANCE - 1500));
    });

    it('leaves nothing behind: offered + fee is exactly what the address holds', async () => {
        const h = makeHarness();
        const quote = await quoteMaxSendable(ARGS(h));
        expect(BigInt(quote.maxSats) + BigInt(quote.feeSats)).toBe(BigInt(BALANCE));
    });

    it('prices the WHOLE utxo set, so a multi-utxo address is swept in one transaction', async () => {
        // Two inputs, so the encoder charges for two: 68 more bytes at 6 sat/vB.
        const fee = REAL_FEE + 68 * 6;
        const h = makeHarness({
            createTx: encoderThatRefuses({ fee }),
            utxos: [{ value: 30_000_000 }, { value: 20_000_000 }],
        });
        const quote = await quoteMaxSendable(ARGS(h));
        expect(quote.inputSats).toBe(String(BALANCE));
        expect(quote.maxSats).toBe(String(BALANCE - fee));
        // The probe asked for every satoshi the address holds; anything less
        // could let the encoder stop selecting early and price a smaller tx.
        const probed = h.sdk.encoder.createTx.mock.calls[0][0].customOutputs
            .find((o) => o.address === 'dst-address');
        expect(Number(probed.value)).toBe(BALANCE);
    });

    it('leaves room for the outputs the compose pipeline adds on top of the payment', async () => {
        const donation = 5_000;
        const h = makeHarness({
            createTx: encoderThatRefuses(),
            ads: {
                accumulatedSats: donation, triggerAmountSats: 1_000, perTxAmountSats: 1,
                lifetimeTxCount: 0, lifetimeDonatedSats: 0,
            },
        });
        const quote = await quoteMaxSendable(ARGS(h));
        expect(quote.otherOutputSats).toBe(String(donation));
        expect(quote.maxSats).toBe(String(BALANCE - REAL_FEE - donation));
        // Still exact: payment + donation + fee is the whole balance.
        expect(BigInt(quote.maxSats) + BigInt(quote.otherOutputSats) + BigInt(quote.feeSats))
            .toBe(BigInt(BALANCE));
    });

    it('trusts the encoder\'s own input total over the balance API, so a lagging balance cannot strand coin', async () => {
        // The encoder selected less than the utxo list summed (an unconfirmed
        // output it will not spend). The sweep must be sized to what it spends.
        const h = makeHarness({ createTx: encoderThatRefuses({ available: 40_000_000 }) });
        const quote = await quoteMaxSendable(ARGS(h));
        expect(quote.inputSats).toBe('40000000');
        expect(quote.maxSats).toBe(String(40_000_000 - REAL_FEE));
    });

    it('survives a satoshi count past 2^53-1, which the encoder serializes as a string', async () => {
        const huge = 9_007_199_254_740_993n; // 2^53 + 1
        const createTx = vi.fn(async () => {
            const err = new Error('Encoder RPC error: insufficient funds');
            err.name = 'SDKEncoderError';
            err.details = {
                context: {
                    reason: 'INSUFFICIENT_FUNDS',
                    required: huge.toString(),
                    available: huge.toString(),
                    outputs: huge.toString(),
                    fee: 1_000,
                },
            };
            throw err;
        });
        const h = makeHarness({ createTx, utxos: [{ value: huge.toString() }] });
        const quote = await quoteMaxSendable(ARGS(h));
        expect(quote.maxSats).toBe((huge - 1000n).toString());
    });

    // EVERY refusal below must return null rather than a number. Over-estimating
    // strands satoshis; under-estimating makes Max unbuildable, which is worse -
    // so a quote that cannot be trusted is not offered at all and the form keeps
    // the static estimate it always had.

    it('says nothing when the encoder answers with a different failure', async () => {
        const h = makeHarness({
            createTx: vi.fn(async () => { throw new Error('utxo-tracker view is not synced'); }),
        });
        expect(await quoteMaxSendable(ARGS(h))).toBeNull();
    });

    it('says nothing when the probe unexpectedly BUILDS a transaction', async () => {
        const h = makeHarness({ createTx: vi.fn(async () => ({ psbt: 'PSBTHEX', encoding: 'OP_RETURN' })) });
        expect(await quoteMaxSendable(ARGS(h))).toBeNull();
    });

    it('says nothing when the address has no utxos to sweep', async () => {
        const h = makeHarness({ utxos: [] });
        expect(await quoteMaxSendable(ARGS(h))).toBeNull();
    });

    it('says nothing when the utxo read fails', async () => {
        const h = makeHarness();
        h.sdk.encoder.getUTXOs = vi.fn(async () => { throw new Error('tracker down'); });
        expect(await quoteMaxSendable(ARGS(h))).toBeNull();
    });

    it('says nothing when the fee would consume everything the address holds', async () => {
        const h = makeHarness({ createTx: encoderThatRefuses({ fee: BALANCE }) });
        expect(await quoteMaxSendable(ARGS(h))).toBeNull();
    });

    it('says nothing without a destination to size the payment output against', async () => {
        const h = makeHarness();
        expect(await quoteMaxSendable(ARGS(h, { destination: '  ' }))).toBeNull();
        expect(h.sdk.encoder.createTx).not.toHaveBeenCalled();
    });

    it('says nothing on an unknown chain', async () => {
        const h = makeHarness();
        h.chainRegistry.get = () => null;
        expect(await quoteMaxSendable(ARGS(h))).toBeNull();
    });
});

describe('insufficientFundsQuote', () => {

    it('reads the details off either spelling the SDK wraps them in', async () => {
        const data = { reason: 'INSUFFICIENT_FUNDS', available: 10, outputs: 9, fee: 2 };
        expect(insufficientFundsQuote({ details: { context: data } }))
            .toEqual({ available: 10n, outputs: 9n, fee: 2n });
        expect(insufficientFundsQuote({ details: { rpcError: { data } } }))
            .toEqual({ available: 10n, outputs: 9n, fee: 2n });
    });

    it('refuses a payload that is not an insufficient-funds refusal', () => {
        expect(insufficientFundsQuote({ details: { context: { reason: 'NO_UTXOS' } } })).toBeNull();
        expect(insufficientFundsQuote(new Error('nope'))).toBeNull();
        expect(insufficientFundsQuote(null)).toBeNull();
    });

    it('refuses a fee that is not an exact satoshi count', () => {
        const base = { reason: 'INSUFFICIENT_FUNDS', available: 10, outputs: 9 };
        expect(insufficientFundsQuote({ details: { context: { ...base, fee: 1.5 } } })).toBeNull();
        expect(insufficientFundsQuote({ details: { context: { ...base, fee: null } } })).toBeNull();
        expect(insufficientFundsQuote({ details: { context: { ...base, fee: 'lots' } } })).toBeNull();
    });
});
