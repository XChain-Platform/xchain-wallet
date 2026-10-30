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
// Dogecoin's fork, so rbfSupported:false caps every stored or per-send RBF flag.

import { DOGECOIN_ACTIONS } from '../actions.js';

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
    // §36.1 per-coin ADS defaults: 0.05 DOGE per tx (5,000,000 koinu),
    // donation attached once 1.25 DOGE has accumulated (~25 txs).
    adsDefaults: { perTxAmountSats: 5_000_000, triggerAmountSats: 125_000_000 },
};

/** @type {import('../validate.js').ChainDescriptor[]} */
export const dogecoinDescriptors = [
    {
        ...COMMON,
        id: 'dogecoin-mainnet',
        networkKind: 'mainnet',
        // Display-only, never consensus. The operator fills this with the
        // platform's documented list-owner addresses.
        platformListOwners: [],
        icon: 'dogecoin-mainnet-icon-20.png',
        wifVersionByte: 0x9e,
        adsDonationAddresses: {
            DONATE1: 'DDonate1RBcwGnCRNnVtwuCmQyWW1Gn25f',
            DONATE2: 'DDonate2o3Sg4phybp92oFpkmv8S9ZhGSV',
            EXPLORER: 'DDonate3FCoUgi1bxW5r9c2p75uKTLw9qE',
        },
        adsDonationAddress: 'DDonate1RBcwGnCRNnVtwuCmQyWW1Gn25f',
        explorer: { defaultUrl: 'https://explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://encoder.xchain.io/DOGE', defaultPort: 443 },
        hub: { defaultUrl: 'https://hub.xchain.io/DOGE', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'dogecoin-testnet',
        networkKind: 'testnet',
        // Display-only, never consensus. The operator fills this with the
        // platform's documented list-owner addresses.
        platformListOwners: [],
        icon: 'dogecoin-testnet-icon-20.png',
        wifVersionByte: 0xf1,
        adsDonationAddresses: {
            DONATE1: 'ndonate1dE87UXUFf4gjyhPg7hfQRJXVXr',
            DONATE2: 'ndonate2wev8vKDgvd1DHhtJtvkRbn2usJ',
            EXPLORER: 'ndonate3xHD56SnmmSxbjX7UMSPfN7XmVA',
        },
        adsDonationAddress: 'ndonate1dE87UXUFf4gjyhPg7hfQRJXVXr',
        explorer: { defaultUrl: 'https://explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://encoder.xchain.io/TDOGE', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'dogecoin-regtest',
        networkKind: 'regtest',
        // Display-only, never consensus. The operator fills this with the
        // platform's documented list-owner addresses.
        platformListOwners: [],
        icon: 'dogecoin-regtest-icon-20.png',
        // Dogecoin Core in regtest uses Bitcoin-testnet base58 prefixes (0xef
        // for WIF), not Dogecoin-testnet (0xf1). Matches xchain-sdk
        // networks.js and the four backend services' CryptoNetworks.
        wifVersionByte: 0xef,
        adsDonationAddresses: {
            DONATE1: 'mzdg8wGxgP3Jk45FuZPspumCL3Ruup37ob',
            DONATE2: 'mmXU8RU7q3BUsyT66rtw1H6P7B2ZZd9c5Y',
            EXPLORER: 'n1AvTJLLSA1NHamHd5KFj9mRn6BEcwnVbf',
        },
        adsDonationAddress: 'mzdg8wGxgP3Jk45FuZPspumCL3Ruup37ob',
        explorer: { defaultUrl: 'http://localhost', defaultPort: 18080 },
        encoder: { defaultUrl: 'http://localhost', defaultPort: 3123 },
        hub: { defaultUrl: 'http://localhost', defaultPort: 10000 },
    },
];
