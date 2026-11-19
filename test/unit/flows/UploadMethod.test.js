// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The upload method choice shared by Publish file, Gated publish and Attach
// artwork: availability and its reasons, the default, the ceiling and compose
// request per method, and the per-method fee estimate.

import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import {
    estimateUploadMethodFees,
    gatedFileCompiledBytes,
    publicFileCompiledBytes,
    resolveUploadMethod,
    standardUnavailableReason,
    taprootUnavailableReason,
    uploadMethodCeilingOpts,
    uploadMethodEncoderOpts,
    uploadMethodSizes,
    UPLOAD_METHODS,
} from '../../../packages/core/src/flows/uploadMethod.js';
import {
    estimateNativeSendFeeTiers,
    customFeeEstimate,
} from '../../../packages/core/src/flows/feeEstimate.js';
import {
    AES_GCM_ENVELOPE_BYTES,
    gatedBatchActionString,
    publicFileActionString,
} from '../../../packages/core/src/flows/fileSizeLimits.js';
import { compiledPayloadByteLen } from '../../../packages/core/src/flows/envelopeSelection.js';

const registry = defaultRegistry();
const BTC = registry.get('bitcoin-mainnet');
const LTC = registry.get('litecoin-mainnet');
const DOGE = registry.get('dogecoin-mainnet');
const HD = { id: 'a1', address: 'bc1qexample', source: 'hd' };

describe('upload method availability', () => {
    it('lists Taproot envelope first, then Standard', () => {
        expect(UPLOAD_METHODS).toEqual(['taproot', 'standard']);
    });

    it('offers the envelope to a software key on a Taproot chain', () => {
        expect(taprootUnavailableReason({ descriptor: BTC, fromAddress: HD })).toBeNull();
        expect(taprootUnavailableReason({ descriptor: BTC, fromAddress: { source: 'imported-wif' } })).toBeNull();
    });

    it.each([
        ['hardware (Trezor)', { descriptor: BTC, fromAddress: { source: 'trezor' } }, 'hardware'],
        ['hardware (Ledger)', { descriptor: BTC, fromAddress: { source: 'ledger' } }, 'hardware'],
        ['another phone signs', { descriptor: BTC, fromAddress: HD, isWatcherMode: true }, 'watcher'],
        ['a watch-only address', { descriptor: BTC, fromAddress: { source: 'watch-only' } }, 'watchOnly'],
        ['an unknown signer source', { descriptor: BTC, fromAddress: { source: 'multisig' } }, 'signer'],
        ['no From yet', { descriptor: BTC, fromAddress: null }, 'signer'],
        ['Dogecoin', { descriptor: DOGE, fromAddress: HD }, 'noTaproot'],
        ['an unknown chain', { descriptor: null, fromAddress: HD }, 'chain'],
    ])('refuses the envelope for %s', (_name, args, reason) => {
        expect(taprootUnavailableReason(args)).toBe(reason);
    });

    it('names the chain reason before a signer reason', () => {
        expect(taprootUnavailableReason({ descriptor: DOGE, fromAddress: { source: 'trezor' } })).toBe('noTaproot');
    });

    it('refuses Standard only for a file larger than its ceiling', () => {
        expect(standardUnavailableReason({ fileBytes: 9000, standardCap: 8000 })).toBe('tooLarge');
        expect(standardUnavailableReason({ fileBytes: 8000, standardCap: 8000 })).toBeNull();
        expect(standardUnavailableReason({ fileBytes: null, standardCap: 8000 })).toBeNull();
    });
});

describe('the method in use', () => {
    const open = { taproot: null, standard: null };

    it('defaults to the Taproot envelope whenever it is available', () => {
        expect(resolveUploadMethod({ picked: null, reasons: open })).toBe('taproot');
    });

    it('keeps an explicit Standard pick', () => {
        expect(resolveUploadMethod({ picked: 'standard', reasons: open })).toBe('standard');
    });

    it('falls back to Standard when the envelope becomes unusable', () => {
        expect(resolveUploadMethod({ picked: 'taproot', reasons: { taproot: 'hardware', standard: null } })).toBe('standard');
        expect(resolveUploadMethod({ picked: null, reasons: { taproot: 'noTaproot', standard: null } })).toBe('standard');
    });

    it('moves to the envelope when the file is too large for Standard', () => {
        expect(resolveUploadMethod({ picked: 'standard', reasons: { taproot: null, standard: 'tooLarge' } })).toBe('taproot');
    });

    it('sizes the ceiling and the compose request by the method', () => {
        expect(uploadMethodCeilingOpts('taproot')).toEqual({ encoding: 'TAPROOT' });
        expect(uploadMethodCeilingOpts('standard')).toEqual({});
        expect(uploadMethodEncoderOpts('taproot', HD)).toEqual({
            encoding: 'AUTO', options: { signerSupportsTapscript: true },
        });
        expect(uploadMethodEncoderOpts('standard', HD)).toEqual({});
    });
});

describe('upload method sizes and fees', () => {
    it('pins the size model for a 1,000-byte payload on Bitcoin', () => {
        // Envelope: commit 11 + 68 + 43 + 31 = 153; reveal 82 stripped + 290 witness + 2.
        // Standard: commit 11 + 68 + 3 x 32 + 31 = 206; reveal 10 + 666 + 666 + 237 + 19 + 31.
        expect(uploadMethodSizes({ compiledBytes: 1000, descriptor: BTC })).toEqual({ taproot: 527, standard: 1835 });
    });

    it('prices a tiny payload the same on both methods (one OP_RETURN output)', () => {
        const sizes = uploadMethodSizes({ compiledBytes: 60, descriptor: BTC });
        expect(sizes.taproot).toBe(sizes.standard);
    });

    it('has no Standard size past the legacy ceiling and no envelope on Dogecoin', () => {
        expect(uploadMethodSizes({ compiledBytes: 9000, descriptor: BTC }).standard).toBeNull();
        expect(uploadMethodSizes({ compiledBytes: 9000, descriptor: BTC }).taproot).toBeGreaterThan(0);
        expect(uploadMethodSizes({ compiledBytes: 5000, descriptor: DOGE }).taproot).toBeNull();
        expect(uploadMethodSizes({ compiledBytes: 5000, descriptor: DOGE }).standard).toBeGreaterThan(0);
    });

    it('prices each option at the rate of the fee the form shows', () => {
        const normal = estimateNativeSendFeeTiers({ chainId: 'bitcoin-mainnet', chainRegistry: registry }).normal;
        const fees = estimateUploadMethodFees({ compiledBytes: 1000, descriptor: BTC, feeEstimate: normal });
        // Normal is 6 sat/vB.
        expect(fees.taproot).toEqual({ sats: 527 * 6, coinAmount: '0.00003162', vbytes: 527 });
        expect(fees.standard).toEqual({ sats: 1835 * 6, coinAmount: '0.0001101', vbytes: 1835 });
        expect(fees.taproot.sats).toBeLessThan(fees.standard.sats);

        const custom = customFeeEstimate({ chainId: 'bitcoin-mainnet', chainRegistry: registry, rate: 20 });
        expect(estimateUploadMethodFees({ compiledBytes: 1000, descriptor: BTC, feeEstimate: custom }).taproot.sats).toBe(527 * 20);
    });

    it('converts a per-kB Dogecoin rate to per byte', () => {
        const normal = estimateNativeSendFeeTiers({ chainId: 'dogecoin-mainnet', chainRegistry: registry }).normal;
        const fees = estimateUploadMethodFees({ compiledBytes: 1000, descriptor: DOGE, feeEstimate: normal });
        const bytes = uploadMethodSizes({ compiledBytes: 1000, descriptor: DOGE }).standard;
        // 0.02 DOGE/kB is 2,000 koinu per byte.
        expect(fees.standard.sats).toBe(bytes * 2_000);
        expect(fees.taproot).toBeNull();
    });

    it('prices nothing without a usable rate or payload', () => {
        expect(estimateUploadMethodFees({ compiledBytes: 1000, descriptor: BTC, feeEstimate: null }))
            .toEqual({ taproot: null, standard: null });
        expect(estimateUploadMethodFees({ compiledBytes: null, descriptor: BTC, feeEstimate: { unit: 'sat/vB', rateValue: 6 } }))
            .toEqual({ taproot: null, standard: null });
    });

    it('measures the payloads the encoder carries', () => {
        const meta = { name: 'a.png', type: 'image/png', title: 'T', memo: 'm' };
        expect(publicFileCompiledBytes(meta, 500)).toBe(
            compiledPayloadByteLen(publicFileActionString(meta), { byteLength: 500 }),
        );
        const gated = { ...meta, gateTicker: 'GATE', coin: 'BTC', address: 'bc1qexample', gateMinAmount: null };
        expect(gatedFileCompiledBytes(gated, 500)).toBe(
            compiledPayloadByteLen(gatedBatchActionString(gated), { byteLength: 500 + AES_GCM_ENVELOPE_BYTES }),
        );
    });
});
