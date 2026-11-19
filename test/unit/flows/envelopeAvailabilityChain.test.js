// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    envelopeAvailableFor,
    envelopeEncoderOpts,
} from '../../../packages/core/src/flows/envelopeSelection.js';
import { bitcoinDescriptors } from '../../../packages/core/src/registry/descriptors/bitcoin.js';
import { dogecoinDescriptors } from '../../../packages/core/src/registry/descriptors/dogecoin.js';
import { litecoinDescriptors } from '../../../packages/core/src/registry/descriptors/litecoin.js';

const envelopeCapableSigners = [
    { kind: 'software' },
    { source: 'hd' },
    { source: 'imported-wif' },
];
const incapableAddressRecords = [
    { source: 'trezor' },
    { source: 'ledger' },
    { source: 'watch-only' },
];
const allDescriptors = [
    ...bitcoinDescriptors,
    ...litecoinDescriptors,
    ...dogecoinDescriptors,
];

describe('envelope availability on capable chains', () => {
    it.each([
        ['Bitcoin', bitcoinDescriptors],
        ['Litecoin', litecoinDescriptors],
    ])('accepts every %s network with each software signer shape', (_coin, descriptors) => {
        for (const descriptor of descriptors) {
            for (const signer of envelopeCapableSigners) {
                expect(envelopeAvailableFor(descriptor, signer), descriptor.id).toBe(true);
            }
        }
    });
});

describe('envelope availability on Dogecoin', () => {
    it('rejects every network with each software signer shape', () => {
        for (const descriptor of dogecoinDescriptors) {
            for (const signer of envelopeCapableSigners) {
                expect(envelopeAvailableFor(descriptor, signer), descriptor.id).toBe(false);
            }
        }
    });
});

describe('envelope availability for incapable address records', () => {
    it('rejects every hardware and watch-only source on every chain', () => {
        for (const descriptor of allDescriptors) {
            for (const addressRecord of incapableAddressRecords) {
                expect(envelopeAvailableFor(descriptor, addressRecord), descriptor.id).toBe(false);
            }
        }
    });
});

describe('envelope chain declarations', () => {
    it.each([
        [{ taprootEnvelope: true }, true],
        [{ addressTypes: ['p2wpkh', 'p2tr'] }, true],
        [{}, false],
        [null, false],
        [{ taprootEnvelope: 'true' }, false],
    ])('evaluates %j as %s', (descriptor, expected) => {
        expect(envelopeAvailableFor(descriptor, { source: 'hd' })).toBe(expected);
    });
});

describe('envelope encoder options by chain', () => {
    const signer = { source: 'hd' };
    const encoderOpts = { compressedPubKey: `02${'ab'.repeat(32)}` };
    const compiledBytes = 9_000;

    it('selects AUTO for Litecoin regtest', () => {
        expect(envelopeEncoderOpts({
            descriptor: litecoinDescriptors[2], signer, encoderOpts, compiledBytes,
        })).toMatchObject({
            encoding: 'AUTO',
            options: { signerSupportsTapscript: true },
        });
    });

    it('leaves Dogecoin regtest without envelope options', () => {
        expect(envelopeEncoderOpts({
            descriptor: dogecoinDescriptors[2], signer, encoderOpts, compiledBytes,
        })).toBeNull();
    });
});
