// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The wallet offers only the address types the installed SDK can generate.
// The registry lists p2tr for bitcoin, but SDK 0.23.0 refuses it with
// INVALID_ADDRESS_TYPE, so Add address and Receive offered a type whose
// generation always failed.

import { describe, it, expect } from 'vitest';
import { sdkSupportedAddressTypes } from '../../../packages/core/src/flows/sdkAddressTypes.js';
import { loadSupportedAddressTypes, offeredAddressType } from '../../../packages/core/src/shared/utils/supportedAddressTypes.js';

const REGISTRY_TYPES = ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'];

function sdkBuilding(types) {
    return {
        wallet: {
            deriveAddress(_pub, { type }) {
                if (!types.includes(type)) {
                    throw Object.assign(
                        new Error(`Unknown address type: "${type}". Supported: ${types.join(', ')}`),
                        { name: 'SDKWalletError', code: 'INVALID_ADDRESS_TYPE' },
                    );
                }
                return `addr-${type}`;
            },
        },
    };
}

describe('sdkSupportedAddressTypes', () => {
    it('drops a type the SDK refuses as unknown', () => {
        expect(sdkSupportedAddressTypes(sdkBuilding(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh']), REGISTRY_TYPES))
            .toEqual(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh']);
    });

    it('offers p2tr once the SDK builds it, with no version check', () => {
        expect(sdkSupportedAddressTypes(sdkBuilding(REGISTRY_TYPES), REGISTRY_TYPES)).toEqual(REGISTRY_TYPES);
    });

    it('keeps a type refused for a chain reason rather than an unknown type', () => {
        const sdk = { wallet: { deriveAddress() {
            throw Object.assign(new Error('SegWit addresses are not supported on dogecoin.'), { code: 'SEGWIT_NOT_SUPPORTED' });
        } } };
        expect(sdkSupportedAddressTypes(sdk, ['p2pkh', 'p2wpkh'])).toEqual(['p2pkh', 'p2wpkh']);
    });

    it('answers null when the SDK cannot be asked', () => {
        expect(sdkSupportedAddressTypes({}, REGISTRY_TYPES)).toBeNull();
        expect(sdkSupportedAddressTypes(null, REGISTRY_TYPES)).toBeNull();
        const loading = { wallet: { deriveAddress() { throw new Error('xchain-sdk is not loaded yet'); } } };
        expect(sdkSupportedAddressTypes(loading, REGISTRY_TYPES)).toBeNull();
    });
});

describe('loadSupportedAddressTypes', () => {
    const descriptor = { id: 'bitcoin-mainnet', addressTypes: REGISTRY_TYPES };

    it('narrows the registry list to the host answer', async () => {
        const messaging = { getSupportedAddressTypes: async () => ({ supported: ['p2pkh', 'p2wpkh'] }) };
        expect(await loadSupportedAddressTypes(messaging, descriptor)).toEqual(['p2pkh', 'p2wpkh']);
    });

    it('keeps the registry list when the host cannot answer', async () => {
        expect(await loadSupportedAddressTypes({}, descriptor)).toEqual(REGISTRY_TYPES);
        expect(await loadSupportedAddressTypes({ getSupportedAddressTypes: async () => ({ supported: null }) }, descriptor))
            .toEqual(REGISTRY_TYPES);
        expect(await loadSupportedAddressTypes({ getSupportedAddressTypes: async () => { throw new Error('x'); } }, descriptor))
            .toEqual(REGISTRY_TYPES);
    });
});

describe('offeredAddressType', () => {
    it('falls back to the chain default when a stored p2tr preference is not offered', () => {
        expect(offeredAddressType('p2tr', ['p2pkh', 'p2wpkh'], 'p2wpkh')).toBe('p2wpkh');
    });

    it('keeps an offered pick', () => {
        expect(offeredAddressType('p2pkh', ['p2pkh', 'p2wpkh'], 'p2wpkh')).toBe('p2pkh');
    });
});

describe('loadSupportedAddressTypes with a host that never answers', () => {
    it('keeps the registry list after a short wait', async () => {
        const descriptor = { id: 'bitcoin-mainnet', addressTypes: REGISTRY_TYPES };
        const messaging = { getSupportedAddressTypes: () => new Promise(() => {}) };
        expect(await loadSupportedAddressTypes(messaging, descriptor)).toEqual(REGISTRY_TYPES);
    });
});
