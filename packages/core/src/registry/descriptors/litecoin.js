// Litecoin chain descriptors. No p2tr at launch (reserved per §16.1).
// No staking / smart-contract actions at launch (BTC-exclusive).

import { LITECOIN_ACTIONS } from '../actions.js';

const COMMON = {
    coin: 'litecoin',
    displayName: 'Litecoin',
    color: '#345D9D',
    icon: '',
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
    supportedActions: LITECOIN_ACTIONS,
    uriScheme: 'litecoin',
};

/** @type {import('../validate.js').ChainDescriptor[]} */
export const litecoinDescriptors = [
    {
        ...COMMON,
        id: 'litecoin-mainnet',
        networkKind: 'mainnet',
        wifVersionByte: 0xb0,
        explorer: { defaultUrl: 'https://ltc.explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://ltc.encoder.xchain.io', defaultPort: 443 },
        hub: { defaultUrl: 'https://hub.xchain.io', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'litecoin-testnet',
        networkKind: 'testnet',
        wifVersionByte: 0xef,
        explorer: { defaultUrl: 'https://testnet.ltc.explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://testnet.ltc.encoder.xchain.io', defaultPort: 443 },
        hub: { defaultUrl: 'https://testnet.hub.xchain.io', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'litecoin-regtest',
        networkKind: 'regtest',
        wifVersionByte: 0xef,
        explorer: { defaultUrl: 'http://localhost', defaultPort: 19081 },
        encoder: { defaultUrl: 'http://localhost', defaultPort: 19082 },
        hub: { defaultUrl: 'http://localhost', defaultPort: 18000 },
    },
];
