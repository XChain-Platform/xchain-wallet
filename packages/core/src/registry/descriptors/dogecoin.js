// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Dogecoin chain descriptors. P2PKH only (no segwit on Dogecoin at launch).
// Fee unit is sats-per-kbyte (koinu/kB) per §44.1. RBF is not standard on
// Dogecoin's fork, but per-chain Settings still drive behavior.

import { DOGECOIN_ACTIONS } from '../actions.js';
import { ADS_DONATION_ADDRESS_PLACEHOLDER } from '../validate.js';

const COMMON = {
    coin: 'dogecoin',
    displayName: 'Dogecoin',
    color: '#C2A633',
    addressTypes: ['p2pkh'],
    defaultAddressType: 'p2pkh',
    // SLIP-44 coin-type stays at the mainnet slot (3') on every network:
    // testnet and regtest deliberately reuse it to match xchain-sdk and the
    // backend CryptoNetworks, not SLIP-44's generic 1' testnet slot.
    derivationPaths: {
        p2pkh: "m/44'/3'/A'/C/I",
    },
    feeStrategy: {
        unit: 'sats-per-kbyte',
        supportedStrategies: ['low', 'normal', 'fast', 'custom'],
        defaultStrategy: 'normal',
        rbfSupported: false,
    },
    supportedActions: DOGECOIN_ACTIONS,
    uriScheme: 'dogecoin',
    adsDonationAddress: ADS_DONATION_ADDRESS_PLACEHOLDER,
};

/** @type {import('../validate.js').ChainDescriptor[]} */
export const dogecoinDescriptors = [
    {
        ...COMMON,
        id: 'dogecoin-mainnet',
        networkKind: 'mainnet',
        icon: 'dogecoin-mainnet-icon-20.png',
        wifVersionByte: 0x9e,
        explorer: { defaultUrl: 'https://explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://encoder.xchain.io/DOGE', defaultPort: 443 },
        hub: { defaultUrl: 'https://hub.xchain.io/DOGE', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'dogecoin-testnet',
        networkKind: 'testnet',
        icon: 'dogecoin-testnet-icon-20.png',
        wifVersionByte: 0xf1,
        explorer: { defaultUrl: 'https://explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://encoder.xchain.io/TDOGE', defaultPort: 443 },
        hub: { defaultUrl: 'https://hub.xchain.io/TDOGE', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'dogecoin-regtest',
        networkKind: 'regtest',
        icon: 'dogecoin-regtest-icon-20.png',
        // Dogecoin Core in regtest uses Bitcoin-testnet base58 prefixes (0xef
        // for WIF), not Dogecoin-testnet (0xf1). Matches xchain-sdk
        // networks.js and the four backend services' CryptoNetworks.
        wifVersionByte: 0xef,
        explorer: { defaultUrl: 'http://localhost', defaultPort: 18080 },
        encoder: { defaultUrl: 'http://localhost', defaultPort: 3123 },
        hub: { defaultUrl: 'http://localhost', defaultPort: 10000 },
    },
];
