// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    customFeeEstimate,
    estimateNativeSendFee,
    fetchNativeSendFeeTiers,
} from '../../../packages/core/src/flows/feeEstimate.js';
import { quoteMaxSendable } from '../../../packages/core/src/flows/maxSendable.js';
import {
    nativeFeeOutputOf,
    withoutCustomOutput,
} from '../../../packages/core/src/flows/nativeFeeLane.js';
import { compareNativeFeeQuote } from '../../../packages/core/src/flows/nativeFeeRequote.js';
import {
    exactNetworkFeeSats,
    exactSats,
    sumExactSats,
    totalNetworkFeeSats,
} from '../../../packages/core/src/flows/psbtNetworkFee.js';
import { normalizeProtocolFee } from '../../../packages/core/src/flows/protocolFeeRow.js';

const chainRegistry = {
    get: (chainId) => (chainId === 'btc'
        ? { coin: 'bitcoin', feeStrategy: { unit: 'sats-per-vbyte' } }
        : null),
};

describe('fee estimate input and response validation', () => {
    it('does not apply a live response carrying another chain unit', async () => {
        const tiers = await fetchNativeSendFeeTiers({
            chainId: 'btc',
            chainRegistry,
            messaging: {
                estimateFee: async () => ({
                    unit: 'DOGE/kB',
                    low: { rate: 2 }, normal: { rate: 3 }, fast: { rate: 4 },
                }),
            },
        });

        expect(tiers.unit).toBe('sat/vB');
        expect(tiers.normal).toMatchObject({ source: 'static-placeholder', rateValue: 6, sats: 1500 });
    });

    it('falls back instead of returning an unsafe live fee', async () => {
        const tiers = await fetchNativeSendFeeTiers({
            chainId: 'btc',
            chainRegistry,
            messaging: { estimateFee: async () => ({ normal: { rate: Number.MAX_VALUE } }) },
        });

        expect(tiers.normal).toMatchObject({ source: 'static-placeholder', sats: 1500 });
    });

    it('refuses a custom fee that cannot be represented exactly', () => {
        expect(customFeeEstimate({ chainId: 'btc', chainRegistry, rate: '999999999999999999999999' }))
            .toBeNull();
    });

    it('labels an invalid speed with the tier it actually uses', () => {
        expect(estimateNativeSendFee({ chainId: 'btc', chainRegistry, speed: 'instant' }))
            .toMatchObject({ speed: 'normal', sats: 1500 });
    });
});

function maxHarness(createTx) {
    const releaseInputs = vi.fn(async () => true);
    const sdk = {
        encoder: {
            createTx,
            getUTXOs: vi.fn(async () => ({ utxos: [{ value: 50_000 }] })),
            releaseInputs,
        },
        actions: { createAction: vi.fn(() => ({ actionString: 'x', action: 'SEND', version: 0 })) },
    };
    return {
        sdk,
        releaseInputs,
        sdkRegistry: { get: () => sdk },
        chainRegistry: {
            get: () => ({ coin: 'bitcoin', networkKind: 'regtest', adsDonationAddress: 'donate' }),
        },
        vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
    };
}

function maxArgs(h, encoderOpts = { change: 'source' }) {
    return {
        sdkRegistry: h.sdkRegistry,
        chainRegistry: h.chainRegistry,
        vault: h.vault,
        chainId: 'btc',
        source: 'source',
        destination: 'destination',
        encoderOpts,
    };
}

describe('Max probe cleanup and coin control', () => {
    it('does not replace an explicitly empty selection with the whole address', async () => {
        const h = maxHarness(vi.fn());

        await expect(quoteMaxSendable(maxArgs(h, { change: 'source', utxos: [] }))).resolves.toBeNull();
        expect(h.sdk.encoder.getUTXOs).not.toHaveBeenCalled();
        expect(h.sdk.encoder.createTx).not.toHaveBeenCalled();
    });

    it('releases encoder inputs when the deliberately failing probe unexpectedly builds', async () => {
        const h = maxHarness(vi.fn(async () => ({
            psbt: 'PSBTHEX', encoding: 'OP_RETURN', reservation: { id: 'probe-reservation' },
        })));

        await expect(quoteMaxSendable(maxArgs(h))).resolves.toBeNull();
        expect(h.releaseInputs).toHaveBeenCalledWith('probe-reservation');
    });

    it('does not apply an insufficient-funds payload selecting more than the requested address owns', async () => {
        const h = maxHarness(vi.fn(async () => {
            const err = new Error('wrong tracker context');
            err.details = {
                context: {
                    reason: 'INSUFFICIENT_FUNDS', available: 60_000, outputs: 50_000, fee: 1_000,
                },
            };
            throw err;
        }));

        await expect(quoteMaxSendable(maxArgs(h))).resolves.toBeNull();
    });
});

describe('native fee output validation', () => {
    const output = { address: 'fee-address', value: 2084 };

    it('refuses fractional and unsafe satoshi counts', () => {
        expect(nativeFeeOutputOf({ feeDestination: 'fee-address', requiredFeeSats: 1.5 })).toBeNull();
        expect(nativeFeeOutputOf({
            feeDestination: 'fee-address', requiredFeeSats: Number.MAX_SAFE_INTEGER + 1,
        })).toBeNull();
        expect(nativeFeeOutputOf({ feeDestination: '   ', requiredFeeSats: 2084 })).toBeNull();
    });

    it('removes one fee output without hiding an identical unrelated output', () => {
        expect(withoutCustomOutput({ customOutputs: [output, output] }, output).customOutputs)
            .toEqual([output]);
    });
});

describe('native fee re-quote binding and exactness', () => {
    const composed = {
        chainId: 'ltc', coin: 'LTC', feeDestination: 'ltc-fee', requiredFeeSats: 2_000_000,
    };
    const fresh = {
        chainId: 'ltc', coin: 'LTC', feeDestination: 'ltc-fee',
        supported: true, valid: true, requiredFeeSats: 2_000_000,
        minAcceptable: '0.01900000', maxAcceptable: '0.02200000',
    };

    it('does not apply a quote returned for another network', () => {
        expect(compareNativeFeeQuote({
            composed,
            fresh: { ...fresh, chainId: 'doge', coin: 'DOGE', feeDestination: 'doge-fee' },
        })).toMatchObject({ verdict: 'unavailable', reason: expect.stringContaining('chainId') });
    });

    it('does not round fractional satoshis into a successful comparison', () => {
        expect(compareNativeFeeQuote({ composed: { ...composed, requiredFeeSats: 1.5 }, fresh }))
            .toMatchObject({ verdict: 'unavailable', paidSats: 0 });
        expect(compareNativeFeeQuote({ composed, fresh: { ...fresh, requiredFeeSats: 2_000_000.5 } }))
            .toMatchObject({ verdict: 'unavailable' });
    });

    it('refuses an inverted acceptance band', () => {
        expect(compareNativeFeeQuote({
            composed,
            fresh: { ...fresh, minAcceptable: '0.02200000', maxAcceptable: '0.01900000' },
        })).toMatchObject({ verdict: 'unavailable', reason: expect.stringContaining('acceptance band') });
    });

    it('does not apply a malformed compose-time dust threshold', () => {
        expect(compareNativeFeeQuote({
            composed: { ...composed, dustThresholdSats: 5460.5 }, fresh,
        })).toMatchObject({ verdict: 'unavailable', reason: expect.stringContaining('dust threshold') });
    });
});

describe('exact PSBT network fee validation', () => {
    const funding = {
        inputs: [{ value: 10_000 }],
        outputs: [{ value: 9_000, scriptType: 'p2sh', address: 'carrier' }],
    };

    it('rejects unsafe numbers and non-satoshi objects without coercion', () => {
        expect(exactSats(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
        expect(exactSats({ toString: () => '1000' })).toBeNull();
        expect(exactSats('9007199254740993')).toBe(9007199254740993n);
        expect(sumExactSats(null)).toBeNull();
    });

    it('does not report all inputs as a fee for a decomposition with no outputs', () => {
        expect(exactNetworkFeeSats({ inputs: [{ value: 10_000 }], outputs: [] })).toBeNull();
    });

    it('does not turn malformed chunk metadata into a single-transaction success', () => {
        expect(totalNetworkFeeSats(funding, { carrierScripts: '52ae' })).toBeNull();
        expect(totalNetworkFeeSats(funding, { carrierScripts: ['52ae'], ownAddresses: null })).toBeNull();
    });
});

describe('protocol fee quote validity', () => {
    it('keeps rejected quote amounts unknown', () => {
        expect(normalizeProtocolFee({ supported: true, valid: false, xchainFee: '0.00000000' }))
            .toEqual({ known: false, free: false, amount: null });
        expect(normalizeProtocolFee({ supported: false, xchainFee: '0.16500000' }))
            .toEqual({ known: false, free: false, amount: null });
    });
});
