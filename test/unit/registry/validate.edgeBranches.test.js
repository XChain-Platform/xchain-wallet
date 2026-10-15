// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bitcoinDescriptors } from '../../../packages/core/src/registry/descriptors/bitcoin.js';
import {
    ADS_DONATION_ADDRESS_PLACEHOLDER,
    isDonationAddressConfigured,
    validateChainDescriptor,
} from '../../../packages/core/src/registry/validate.js';

const baseDescriptor = () => structuredClone(bitcoinDescriptors[0]);
const errorsFor = (changes) => validateChainDescriptor({ ...baseDescriptor(), ...changes }).errors;

describe('chain descriptor validation edge branches', () => {
    it('short-circuits values that are not descriptor objects', () => {
        for (const value of [null, [], 'descriptor', 1]) {
            expect(validateChainDescriptor(value)).toEqual({
                ok: false,
                errors: ['descriptor: must be an object'],
            });
        }
    });

    it('rejects each malformed fee-strategy branch', () => {
        for (const feeStrategy of [
            null,
            { unit: 'coins-per-byte', supportedStrategies: ['normal'], defaultStrategy: 'normal', rbfSupported: true },
            { unit: 'sats-per-vbyte', supportedStrategies: 'normal', defaultStrategy: 'normal', rbfSupported: true },
            { unit: 'sats-per-vbyte', supportedStrategies: ['normal', 'turbo'], defaultStrategy: 'normal', rbfSupported: true },
            { unit: 'sats-per-vbyte', supportedStrategies: ['normal'], defaultStrategy: 'fast', rbfSupported: true },
            { unit: 'sats-per-vbyte', supportedStrategies: ['normal'], defaultStrategy: 'normal', rbfSupported: 'yes' },
        ]) {
            expect(errorsFor({ feeStrategy })).toContain('feeStrategy: malformed');
        }
    });

    it('rejects invalid optional metadata while accepting zero ADS defaults', () => {
        expect(errorsFor({ isUserAdded: 'yes' })).toContain('isUserAdded: must be a boolean');
        expect(errorsFor({ adsDefaults: { perTxAmountSats: -1, triggerAmountSats: 1 } }))
            .toContain('adsDefaults: must be { perTxAmountSats, triggerAmountSats } with non-negative integers');
        expect(errorsFor({ adsDefaults: { perTxAmountSats: 1, triggerAmountSats: 1.5 } }))
            .toContain('adsDefaults: must be { perTxAmountSats, triggerAmountSats } with non-negative integers');
        expect(validateChainDescriptor({
            ...baseDescriptor(),
            adsDefaults: { perTxAmountSats: 0, triggerAmountSats: 0 },
        }).ok).toBe(true);
    });

    it('reports missing derivation templates and malformed address arrays', () => {
        const descriptor = baseDescriptor();
        descriptor.addressTypes = ['p2pkh', '', 'missing'];
        delete descriptor.derivationPaths.p2pkh;
        const result = validateChainDescriptor(descriptor);
        expect(result.errors).toContain('addressTypes[1]: must be a non-empty string');
        expect(result.errors).toContain('derivationPaths: missing template for addressType "p2pkh"');
        expect(result.errors).toContain('derivationPaths: missing template for addressType ""');
        expect(result.errors).toContain('derivationPaths: missing template for addressType "missing"');
    });

    it('rejects reserved-id network mismatches and invalid endpoint ports', () => {
        expect(errorsFor({ networkKind: 'testnet' }))
            .toContain('networkKind: must be "mainnet" to match the reserved id "bitcoin-mainnet"');
        expect(errorsFor({ explorer: { defaultUrl: 'https://example.test', defaultPort: -1 } }))
            .toContain('explorer: must be a well-formed https/wss endpoint (http/ws only on regtest or loopback)');
        expect(errorsFor({ hub: { defaultUrl: 'not a url', defaultPort: 443 } }))
            .toContain('hub: must be a well-formed https/wss endpoint (http/ws only on regtest or loopback)');
    });

    it('distinguishes configured donation destinations from absent and placeholder values', () => {
        expect(isDonationAddressConfigured(null)).toBe(false);
        expect(isDonationAddressConfigured({ adsDonationAddress: 123 })).toBe(false);
        expect(isDonationAddressConfigured({ adsDonationAddress: ADS_DONATION_ADDRESS_PLACEHOLDER })).toBe(false);
        expect(isDonationAddressConfigured({ adsDonationAddress: '' })).toBe(true);
        expect(isDonationAddressConfigured({ adsDonationAddress: 'destination' })).toBe(true);
    });
});
