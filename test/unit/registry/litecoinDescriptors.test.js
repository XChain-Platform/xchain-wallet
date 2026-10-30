// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { LITECOIN_ACTIONS } from '../../../packages/core/src/registry/actions.js';
import { litecoinDescriptors } from '../../../packages/core/src/registry/descriptors/litecoin.js';
import { validateChainDescriptor } from '../../../packages/core/src/registry/validate.js';

describe('litecoinDescriptors', () => {
    it('defines exactly one descriptor for each supported network', () => {
        expect(litecoinDescriptors.map(({ id, networkKind }) => [id, networkKind])).toEqual([
            ['litecoin-mainnet', 'mainnet'],
            ['litecoin-testnet', 'testnet'],
            ['litecoin-regtest', 'regtest'],
        ]);
    });

    it('shares the Litecoin address, fee, action, and donation-default contracts', () => {
        for (const descriptor of litecoinDescriptors) {
            expect(descriptor).toMatchObject({
                coin: 'litecoin',
                displayName: 'Litecoin',
                color: '#345D9D',
                addressTypes: ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh'],
                defaultAddressType: 'p2wpkh',
                derivationPaths: {
                    p2pkh: "m/44'/2'/A'/C/I",
                    'p2sh-p2wpkh': "m/49'/2'/A'/C/I",
                    p2wpkh: "m/84'/2'/A'/C/I",
                },
                feeStrategy: {
                    unit: 'sats-per-vbyte',
                    supportedStrategies: ['low', 'normal', 'fast', 'custom'],
                    defaultStrategy: 'normal',
                    rbfSupported: true,
                },
                uriScheme: 'litecoin',
                adsDefaults: {
                    perTxAmountSats: 100_000,
                    triggerAmountSats: 2_500_000,
                },
            });
            expect(descriptor.supportedActions).toBe(LITECOIN_ACTIONS);
        }
    });

    it('uses the expected WIF byte and service endpoints on each network', () => {
        expect(litecoinDescriptors.map((descriptor) => ({
            id: descriptor.id,
            wifVersionByte: descriptor.wifVersionByte,
            explorer: descriptor.explorer,
            encoder: descriptor.encoder,
            hub: descriptor.hub,
        }))).toEqual([
            {
                id: 'litecoin-mainnet',
                wifVersionByte: 0xb0,
                explorer: { defaultUrl: 'https://explorer.xchain.io', defaultPort: 443 },
                encoder: { defaultUrl: 'https://encoder.xchain.io/LTC', defaultPort: 443 },
                hub: { defaultUrl: 'https://hub.xchain.io/LTC', defaultPort: 443 },
            },
            {
                id: 'litecoin-testnet',
                wifVersionByte: 0xef,
                explorer: { defaultUrl: 'https://explorer.xchain.io', defaultPort: 443 },
                encoder: { defaultUrl: 'https://encoder.xchain.io/TLTC', defaultPort: 443 },
                hub: undefined,
            },
            {
                id: 'litecoin-regtest',
                wifVersionByte: 0xef,
                explorer: { defaultUrl: 'http://localhost', defaultPort: 18080 },
                encoder: { defaultUrl: 'http://localhost', defaultPort: 3223 },
                hub: { defaultUrl: 'http://localhost', defaultPort: 10000 },
            },
        ]);
    });

    // Donation addresses are per network, never shared: a testnet or regtest
    // wallet must not route a donation to a mainnet address. The literals are
    // xchain-indexer src/coins/LTC.js DONATE1, DONATE2 and EXPLORER per network.
    it('carries per-network donation addresses, with DONATE1 as the default', () => {
        expect(litecoinDescriptors.map(({ id, adsDonationAddress, adsDonationAddresses }) => ({
            id,
            adsDonationAddress,
            adsDonationAddresses,
        }))).toEqual([
            {
                id: 'litecoin-mainnet',
                adsDonationAddress: 'Ldonate18tNZcVThKm5MX33EjvhaanJ6Mg',
                adsDonationAddresses: {
                    DONATE1: 'Ldonate18tNZcVThKm5MX33EjvhaanJ6Mg',
                    DONATE2: 'Ldonate2io846q2e7q8dUArh3TNnaq9ENb',
                    EXPLORER: 'Ldonate3FfyqbYQAYxo3qjFLcu28oUdAfn',
                },
            },
            {
                id: 'litecoin-testnet',
                adsDonationAddress: 'mybp5CceJvVV5tNCCiF7oBiZWko2fNkmnT',
                adsDonationAddresses: {
                    DONATE1: 'mybp5CceJvVV5tNCCiF7oBiZWko2fNkmnT',
                    DONATE2: 'muKEjejjXQvLY7Lp7Ecpn29gM2TCb5BLTF',
                    EXPLORER: 'mzCXcxcECbY5aNSXsfWjzKQN1YwoefEcG8',
                },
            },
            {
                id: 'litecoin-regtest',
                adsDonationAddress: 'mgNY2ZXbnNEkRT5ZRF8yGamivrSX2QH97h',
                adsDonationAddresses: {
                    DONATE1: 'mgNY2ZXbnNEkRT5ZRF8yGamivrSX2QH97h',
                    DONATE2: 'n2DLJPppXUi8jC6fLiSkthZi2sc9UKiZHd',
                    EXPLORER: 'myL7sZGPEG3LhFXn7RFCZ321r8bxgmgDBz',
                },
            },
        ]);
    });

    it('keeps every shipped Litecoin descriptor valid', () => {
        for (const descriptor of litecoinDescriptors) {
            const result = validateChainDescriptor(descriptor);
            expect(result.ok, `${descriptor.id}: ${result.errors.join('; ')}`).toBe(true);
        }
    });
});
