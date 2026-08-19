// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Bitcoin chain descriptors: mainnet, testnet, regtest.
// Derivation paths per §16.1. Address types p2pkh / p2sh-p2wpkh /
// p2wpkh / p2tr; p2wpkh is the default. URLs are placeholders per §5.5;
// real endpoints resolve before launch.
//
// `icon` carries an tick filename resolved by `branding.brandingUrl()`;
// per-network icons live in packages/core/src/branding/images/.

import { BITCOIN_ACTIONS } from '../actions.js';
import { ADS_DONATION_ADDRESS_PLACEHOLDER } from '../validate.js';

const COMMON = {
    coin: 'bitcoin',
    displayName: 'Bitcoin',
    color: '#F7931A',
    addressTypes: ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'],
    defaultAddressType: 'p2wpkh',
    // SLIP-44 coin-type stays at the mainnet slot (0') on every network:
    // testnet and regtest deliberately reuse it to match xchain-sdk and the
    // backend CryptoNetworks, not SLIP-44's generic 1' testnet slot.
    derivationPaths: {
        p2pkh: "m/44'/0'/A'/C/I",
        'p2sh-p2wpkh': "m/49'/0'/A'/C/I",
        p2wpkh: "m/84'/0'/A'/C/I",
        p2tr: "m/86'/0'/A'/C/I",
    },
    feeStrategy: {
        unit: 'sats-per-vbyte',
        supportedStrategies: ['low', 'normal', 'fast', 'custom'],
        defaultStrategy: 'normal',
        rbfSupported: true,
    },
    supportedActions: BITCOIN_ACTIONS,
    uriScheme: 'bitcoin',
    adsDonationAddress: ADS_DONATION_ADDRESS_PLACEHOLDER,
    // §36.1 per-coin ADS defaults: 1,000 sats per tx, donation output
    // attached to the next tx once 25,000 sats have accumulated.
    adsDefaults: { perTxAmountSats: 1000, triggerAmountSats: 25000 },
};

/** @type {import('../validate.js').ChainDescriptor[]} */
export const bitcoinDescriptors = [
    {
        ...COMMON,
        id: 'bitcoin-mainnet',
        networkKind: 'mainnet',
        icon: 'bitcoin-mainnet-icon-20.png',
        wifVersionByte: 0x80,
        explorer: { defaultUrl: 'https://explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://encoder.xchain.io/BTC', defaultPort: 443 },
        hub: { defaultUrl: 'https://hub.xchain.io/BTC', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'bitcoin-testnet',
        networkKind: 'testnet',
        icon: 'bitcoin-testnet-icon-20.png',
        wifVersionByte: 0xef,
        explorer: { defaultUrl: 'https://explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://encoder.xchain.io/TBTC', defaultPort: 443 },
        hub: { defaultUrl: 'https://hub.xchain.io/TBTC', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'bitcoin-regtest',
        networkKind: 'regtest',
        icon: 'bitcoin-regtest-icon-20.png',
        wifVersionByte: 0xef,
        explorer: { defaultUrl: 'http://localhost', defaultPort: 18080 },
        encoder: { defaultUrl: 'http://localhost', defaultPort: 3003 },
        hub: { defaultUrl: 'http://localhost', defaultPort: 10000 },
    },
];
