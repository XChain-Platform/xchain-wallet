// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Litecoin chain descriptors. No p2tr at launch (reserved per §16.1).
// No staking / smart-contract actions at launch (BTC-exclusive).

import { LITECOIN_ACTIONS } from '../actions.js';
import { ADS_DONATION_ADDRESS_PLACEHOLDER } from '../validate.js';

const COMMON = {
    coin: 'litecoin',
    displayName: 'Litecoin',
    color: '#345D9D',
    addressTypes: ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh'],
    defaultAddressType: 'p2wpkh',
    // SLIP-44 coin-type stays at the mainnet slot (2') on every network:
    // testnet and regtest deliberately reuse it to match xchain-sdk and the
    // backend CryptoNetworks, not SLIP-44's generic 1' testnet slot.
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
    supportedActions: LITECOIN_ACTIONS,
    uriScheme: 'litecoin',
    adsDonationAddress: ADS_DONATION_ADDRESS_PLACEHOLDER,
};

/** @type {import('../validate.js').ChainDescriptor[]} */
export const litecoinDescriptors = [
    {
        ...COMMON,
        id: 'litecoin-mainnet',
        networkKind: 'mainnet',
        icon: 'litecoin-mainnet-icon-20.png',
        wifVersionByte: 0xb0,
        explorer: { defaultUrl: 'https://explorer.xchain.io/LTC', defaultPort: 443 },
        encoder: { defaultUrl: 'https://encoder.xchain.io/LTC', defaultPort: 443 },
        hub: { defaultUrl: 'https://hub.xchain.io/LTC', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'litecoin-testnet',
        networkKind: 'testnet',
        icon: 'litecoin-testnet-icon-20.png',
        wifVersionByte: 0xef,
        explorer: { defaultUrl: 'https://explorer.xchain.io/TLTC', defaultPort: 443 },
        encoder: { defaultUrl: 'https://encoder.xchain.io/TLTC', defaultPort: 443 },
        hub: { defaultUrl: 'https://hub.xchain.io/TLTC', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'litecoin-regtest',
        networkKind: 'regtest',
        icon: 'litecoin-regtest-icon-20.png',
        wifVersionByte: 0xef,
        explorer: { defaultUrl: 'http://localhost', defaultPort: 18080 },
        encoder: { defaultUrl: 'http://localhost', defaultPort: 3223 },
        hub: { defaultUrl: 'http://localhost', defaultPort: 10000 },
    },
];
