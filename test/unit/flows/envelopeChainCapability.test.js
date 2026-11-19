// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    chainCarriesEnvelope,
    envelopeAvailableFor,
} from '../../../packages/core/src/flows/envelopeSelection.js';
import { bitcoinDescriptors } from '../../../packages/core/src/registry/descriptors/bitcoin.js';
import { dogecoinDescriptors } from '../../../packages/core/src/registry/descriptors/dogecoin.js';
import { litecoinDescriptors } from '../../../packages/core/src/registry/descriptors/litecoin.js';

describe('descriptor envelope capability', () => {
    it.each([
        ['Bitcoin', bitcoinDescriptors],
        ['Litecoin', litecoinDescriptors],
    ])('marks every %s network as an envelope carrier', (_coin, descriptors) => {
        expect(descriptors).toHaveLength(3);
        for (const descriptor of descriptors) {
            expect(descriptor.taprootEnvelope, descriptor.id).toBe(true);
        }
    });

    it('does not add envelope capability to any Dogecoin network', () => {
        expect(dogecoinDescriptors).toHaveLength(3);
        for (const descriptor of dogecoinDescriptors) {
            expect(descriptor, descriptor.id).not.toHaveProperty('taprootEnvelope');
        }
    });
});

describe('chainCarriesEnvelope', () => {
    it.each([
        [{ taprootEnvelope: true }, true],
        [{ taprootEnvelope: false }, false],
        [{ taprootEnvelope: null }, false],
        [{ taprootEnvelope: undefined }, false],
        [{ taprootEnvelope: 'true' }, false],
        [{ taprootEnvelope: 1 }, false],
        [{}, false],
        [null, false],
        [undefined, false],
    ])('returns strict capability for %j', (descriptor, expected) => {
        expect(chainCarriesEnvelope(descriptor)).toBe(expected);
    });
});

describe('live envelope availability', () => {
    it('is available for a Litecoin descriptor with a software signer', () => {
        expect(envelopeAvailableFor(litecoinDescriptors[0], { kind: 'software' })).toBe(true);
    });
});
