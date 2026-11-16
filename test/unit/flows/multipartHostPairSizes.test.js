// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The host binds the pair-size estimators a multi-part quote needs. The route
// drops any sizes a renderer sends, so a host that binds none fails every
// multi-part start at its quote, before the wallet calls the encoder.

import { describe, expect, it, vi } from 'vitest';
import { handleFileMultipart } from '../../../packages/core/src/flows/fileMultipartRoutes.js';
import { multipartQuoteLanes } from '../../../packages/core/src/flows/multipartQuoteLanes.js';
import { quoteMultipartFile } from '../../../packages/core/src/flows/multipartFilePlan.js';
import {
    MULTIPART_MANIFEST_ALLOWANCE_BYTES,
    multipartPairSizes,
    uploadMethodSizes,
} from '../../../packages/core/src/flows/uploadMethod.js';
import { bitcoinDescriptors } from '../../../packages/core/src/registry/descriptors/bitcoin.js';

const REGTEST = bitcoinDescriptors.find(({ id }) => id === 'bitcoin-regtest');

function fakePlan(sizes) {
    return {
        totalParts: sizes.length,
        parts: sizes.map((size, partIndex) => ({
            partIndex, rawData: new Uint8Array(size), digest: String(partIndex + 1).repeat(64),
        })),
    };
}

function quoteThroughRoute(multipartSizesFor) {
    const sdk = { waitForAction: vi.fn() };
    const publishMultipartFile = vi.fn(async (opts) => {
        const lanes = multipartQuoteLanes({ descriptor: opts.chainRegistry.get(opts.chainId) });
        return { quote: quoteMultipartFile(fakePlan([900, 900]), opts.rate, lanes[opts.lane], opts.sizes) };
    });
    return handleFileMultipart({
        walletId: 'wallet-1',
        chainId: REGTEST.id,
        sourceAddress: 'bcrt1source',
        bytes: Uint8Array.of(1, 2, 3),
        rate: 2,
        lane: 'envelope',
        buildMode: 'one_call',
        sizes: {},
    }, {
        publishMultipartFile,
        multipartSizesFor,
        vault: {},
        sdkRegistry: { get: () => sdk },
        chainRegistry: { get: () => REGTEST },
        signer: {},
    });
}

describe('host multi-part pair sizes', () => {
    it('lets an envelope quote price every piece through the route', async () => {
        const { quote } = await quoteThroughRoute(multipartPairSizes);
        expect(quote.transactions).toBe(1 + 2 * 3);
        expect(quote.outputs).toHaveLength(3);
        expect(quote.outputs.every((value) => Number.isSafeInteger(value) && value > 0)).toBe(true);
    });

    it('fails the quote when the host binds no estimators', async () => {
        await expect(quoteThroughRoute(undefined)).rejects.toThrow(/pair-size estimator is required/);
    });

    it('prices a large piece as its lane pair, as the upload method does', () => {
        const sizes = multipartPairSizes(REGTEST);
        expect(sizes.envelopePairVbytes(900)).toBe(uploadMethodSizes({ compiledBytes: 900, descriptor: REGTEST }).taproot);
        expect(sizes.standardPairBytes(900)).toBe(uploadMethodSizes({ compiledBytes: 900, descriptor: REGTEST }).standard);
    });

    it('prices a small piece as its envelope pair, never as one OP_RETURN transaction', () => {
        const sizes = multipartPairSizes(REGTEST);
        expect(sizes.envelopePairVbytes(40)).toBeGreaterThan(uploadMethodSizes({ compiledBytes: 40, descriptor: REGTEST }).taproot);
    });

    it('funds the manifest slot above what the encoder asked for on the rail', async () => {
        // 2026-11-16 rail drive: a manifest funded at 2184 sats failed with
        // "selected inputs total 2184 but 2436 is required" at 6 sat/vB.
        const sizes = multipartPairSizes(REGTEST);
        expect(sizes.envelopePairVbytes(0)).toBe(sizes.envelopePairVbytes(MULTIPART_MANIFEST_ALLOWANCE_BYTES));
        const lanes = multipartQuoteLanes({ descriptor: REGTEST });
        const quote = quoteMultipartFile(fakePlan([900, 900]), 6, lanes.envelope, sizes);
        expect(quote.outputs[0]).toBeGreaterThan(2436);
    });
});
