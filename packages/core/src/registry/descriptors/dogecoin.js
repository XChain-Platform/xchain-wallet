// Dogecoin chain descriptors. P2PKH only (no segwit on Dogecoin at launch).
// Fee unit is sats-per-kbyte (koinu/kB) per §44.1. RBF is not standard on
// Dogecoin's fork, but per-chain Settings still drive behavior.

import { DOGECOIN_ACTIONS } from '../actions.js';

const COMMON = {
    coin: 'dogecoin',
    displayName: 'Dogecoin',
    color: '#C2A633',
    icon: '',
    addressTypes: ['p2pkh'],
    defaultAddressType: 'p2pkh',
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
};

/** @type {import('../validate.js').ChainDescriptor[]} */
export const dogecoinDescriptors = [
    {
        ...COMMON,
        id: 'dogecoin-mainnet',
        networkKind: 'mainnet',
        wifVersionByte: 0x9e,
        explorer: { defaultUrl: 'https://doge.explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://doge.encoder.xchain.io', defaultPort: 443 },
        hub: { defaultUrl: 'https://hub.xchain.io', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'dogecoin-testnet',
        networkKind: 'testnet',
        wifVersionByte: 0xf1,
        explorer: { defaultUrl: 'https://testnet.doge.explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://testnet.doge.encoder.xchain.io', defaultPort: 443 },
        hub: { defaultUrl: 'https://testnet.hub.xchain.io', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'dogecoin-regtest',
        networkKind: 'regtest',
        wifVersionByte: 0xf1,
        explorer: { defaultUrl: 'http://localhost', defaultPort: 20081 },
        encoder: { defaultUrl: 'http://localhost', defaultPort: 20082 },
        hub: { defaultUrl: 'http://localhost', defaultPort: 18000 },
    },
];
