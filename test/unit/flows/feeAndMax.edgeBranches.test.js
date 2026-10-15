// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    customFeeEstimate,
    displayRateToPerByte,
    displayRateToSettingsCustom,
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    fetchNativeSendFeeTiers,
    perByteRateToDisplay,
    satsToCoinDecimal,
    settingsCustomToDisplayRate,
} from '../../../packages/core/src/flows/feeEstimate.js';
import {
    insufficientFundsQuote,
    quoteMaxSendable,
} from '../../../packages/core/src/flows/maxSendable.js';

const bitcoinRegistry = {
    get: () => ({ coin: 'bitcoin', feeStrategy: { unit: 'sats-per-vbyte' } }),
};

describe('fee estimate guard and boundary branches', () => {
    it('returns null when required lookup inputs or a known fee table are absent', async () => {
        const noCoin = { get: () => ({}) };
        const customCoin = { get: () => ({ coin: 'custom' }) };

        expect(estimateNativeSendFee()).toBeNull();
        expect(estimateNativeSendFee({ chainId: 'x', chainRegistry: noCoin })).toBeNull();
        expect(estimateNativeSendFeeTiers({ chainId: 'x', chainRegistry: customCoin })).toBeNull();
        expect(customFeeEstimate({ chainId: 'x', chainRegistry: customCoin, rate: 1 })).toBeNull();
        await expect(fetchNativeSendFeeTiers({ chainId: 'x', chainRegistry: noCoin }))
            .resolves.toBeNull();
    });

    it('returns no estimate for a chain without safe static tiers', () => {
        expect(estimateNativeSendFee({
            chainId: 'custom', chainRegistry: { get: () => ({ coin: 'custom' }) }, speed: 'fast',
        })).toBeNull();
    });

    it('keeps the Dogecoin slow default at its relay floor', () => {
        const chainRegistry = {
            get: () => ({ coin: 'dogecoin', feeStrategy: { unit: 'sats-per-kbyte' } }),
        };
        expect(estimateNativeSendFee({ chainId: 'doge', chainRegistry, speed: 'low' }))
            .toMatchObject({ rateValue: 1, sats: 25_000_000 });
    });

    it.each(['-1', '0.000000001', 'not-a-rate'])('refuses an invalid custom rate %s', (rate) => {
        expect(customFeeEstimate({ chainId: 'btc', chainRegistry: bitcoinRegistry, rate })).toBeNull();
    });

    it('returns no estimate when a registry lookup fails', async () => {
        const chainRegistry = { get: () => { throw new Error('registry unavailable'); } };
        expect(estimateNativeSendFee({ chainId: 'btc', chainRegistry })).toBeNull();
        await expect(fetchNativeSendFeeTiers({ chainId: 'btc', chainRegistry })).resolves.toBeNull();
    });

    it.each([
        ['below the relay floor', 0.005],
        ['above the chain sanity ceiling', 100_000],
    ])('falls back when a live rate is %s', async (_label, rate) => {
        const tiers = await fetchNativeSendFeeTiers({
            chainId: 'btc',
            chainRegistry: bitcoinRegistry,
            messaging: { estimateFee: async () => ({ normal: { rate } }) },
        });
        expect(tiers.normal).toMatchObject({
            source: 'static-placeholder', rateValue: 6, sats: 1_500,
        });
    });

    it('keeps fallback tiers at or above a valid live relay floor', async () => {
        const tiers = await fetchNativeSendFeeTiers({
            chainId: 'btc',
            chainRegistry: bitcoinRegistry,
            messaging: { estimateFee: async () => ({ minimumRate: 10 }) },
        });
        expect(tiers.minimumRate).toBe(10);
        expect(tiers.low).toMatchObject({ source: 'static-placeholder', rateValue: 10, sats: 2_500 });
        expect(tiers.normal).toMatchObject({ source: 'static-placeholder', rateValue: 10, sats: 2_500 });
    });

    it('clamps invalid converter inputs without producing non-finite settings', () => {
        expect(settingsCustomToDisplayRate('sat/vB', Number.NaN)).toBe(0);
        expect(settingsCustomToDisplayRate('DOGE/kB', -1)).toBe(0);
        expect(displayRateToSettingsCustom('sat/vB', Number.POSITIVE_INFINITY)).toBe(0);
        expect(displayRateToSettingsCustom('DOGE/kB', -1)).toBe(0);
        expect(perByteRateToDisplay('DOGE/kB', Number.NaN)).toBe(0);
        expect(displayRateToPerByte('DOGE/kB', Number.NaN)).toBe(0);
        expect(satsToCoinDecimal(-1)).toBe('0');
        expect(satsToCoinDecimal(Number.NaN)).toBe('0');
    });

    it('uses static tiers when no estimator capability exists', async () => {
        const tiers = await fetchNativeSendFeeTiers({
            messaging: {}, chainId: 'btc', chainRegistry: bitcoinRegistry,
        });
        expect(tiers.normal).toMatchObject({ source: 'static-placeholder', sats: 1500 });
    });
});

function maxHarness({ createTx, getUTXOs, releaseInputs, descriptor, sdk } = {}) {
    const encoder = {
        createTx: createTx || vi.fn(),
        getUTXOs: getUTXOs || vi.fn(async () => [{ value: 10_000 }]),
        ...(releaseInputs ? { releaseInputs } : {}),
    };
    const resolvedSdk = sdk === undefined ? {
        encoder,
        actions: { createAction: () => ({ actionString: 'SEND|0', action: 'SEND', version: 0 }) },
    } : sdk;
    return {
        encoder,
        sdkRegistry: { get: () => resolvedSdk },
        chainRegistry: { get: () => descriptor === undefined ? { coin: 'bitcoin' } : descriptor },
        vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
    };
}

function maxArgs(h, extra = {}) {
    return {
        sdkRegistry: h.sdkRegistry,
        chainRegistry: h.chainRegistry,
        vault: h.vault,
        chainId: 'btc',
        source: ' source ',
        destination: ' destination ',
        encoderOpts: { change: 'source' },
        ...extra,
    };
}

function insufficient(data) {
    const error = new Error('insufficient');
    error.data = { reason: 'INSUFFICIENT_FUNDS', ...data };
    return error;
}

describe('max-send quote refusal and cleanup branches', () => {
    it('returns null when registry lookup throws or the SDK has no encoder', async () => {
        const h = maxHarness({ sdk: {} });
        await expect(quoteMaxSendable(maxArgs(h))).resolves.toBeNull();

        h.chainRegistry.get = () => { throw new Error('registry unavailable'); };
        await expect(quoteMaxSendable(maxArgs(h))).resolves.toBeNull();
    });

    it.each([
        [null],
        [[{ value: -1 }]],
        [[{ value: 1.5 }]],
        [[{ value: Number.MAX_SAFE_INTEGER + 1 }]],
        [[{ value: 'not-sats' }]],
        [[{ value: 0 }]],
    ])('returns null for an unusable UTXO response %#', async (utxos) => {
        const h = maxHarness({ getUTXOs: vi.fn(async () => utxos) });
        await expect(quoteMaxSendable(maxArgs(h))).resolves.toBeNull();
        expect(h.encoder.createTx).not.toHaveBeenCalled();
    });

    it('swallows release failure after an unexpectedly successful probe', async () => {
        const releaseInputs = vi.fn(async () => { throw new Error('release unavailable'); });
        const h = maxHarness({
            createTx: vi.fn(async () => ({
                psbt: 'PSBT', encoding: 'OP_RETURN', reservation: { id: 'probe-1' },
            })),
            releaseInputs,
        });

        await expect(quoteMaxSendable(maxArgs(h))).resolves.toBeNull();
        expect(releaseInputs).toHaveBeenCalledWith('probe-1');
    });

    it('rejects a quote whose output total is smaller than the sweep probe', async () => {
        const h = maxHarness({
            createTx: vi.fn(async () => {
                throw insufficient({ available: 10_000, outputs: 9_999, fee: 1 });
            }),
        });
        await expect(quoteMaxSendable(maxArgs(h))).resolves.toBeNull();
    });

    it('reads a raw error data payload and trims source and destination', async () => {
        const createTx = vi.fn(async (request) => {
            expect(request.sourceAddress).toBe('source');
            expect(request.customOutputs).toContainEqual({ address: 'destination', value: '10000' });
            throw insufficient({ available: 10_000, outputs: 10_000, fee: 500 });
        });
        const h = maxHarness({ createTx });

        await expect(quoteMaxSendable(maxArgs(h))).resolves.toMatchObject({
            maxSats: '9500', feeSats: '500', inputSats: '10000',
        });
    });
});

describe('insufficientFundsQuote strict payload validation', () => {
    it.each([
        [{ available: 0, outputs: 9, fee: 1 }],
        [{ available: 10, outputs: 0, fee: 1 }],
        [{ available: 10, outputs: 9, fee: 0 }],
        [{ available: {}, outputs: 9, fee: 1 }],
    ])('rejects non-positive or non-satoshi fields %#', (data) => {
        expect(insufficientFundsQuote(insufficient(data))).toBeNull();
    });
});
