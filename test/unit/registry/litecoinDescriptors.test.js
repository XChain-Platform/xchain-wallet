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
import {
    ADS_DONATION_ADDRESS_PLACEHOLDER,
    validateChainDescriptor,
} from '../../../packages/core/src/registry/validate.js';

describe('litecoinDescriptors', () => {
    it('defines exactly one descriptor for each supported network', () => {
        expect(litecoinDescriptors.map(({ id, networkKind }) => [id, networkKind])).toEqual([
            ['litecoin-mainnet', 'mainnet'],
            ['litecoin-testnet', 'testnet'],
            ['litecoin-regtest', 'regtest'],
        ]);
    });

    it('shares the Litecoin address, fee, action, and donation contracts', () => {
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
                adsDonationAddress: ADS_DONATION_ADDRESS_PLACEHOLDER,
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
                hub: { defaultUrl: 'https://hub.xchain.io/TLTC', defaultPort: 443 },
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

    it('keeps every shipped Litecoin descriptor valid', () => {
        for (const descriptor of litecoinDescriptors) {
            const result = validateChainDescriptor(descriptor);
            expect(result.ok, `${descriptor.id}: ${result.errors.join('; ')}`).toBe(true);
        }
    });
});
