// Bitcoin chain descriptors — mainnet, testnet, regtest.
// Derivation paths per §16.1. Address types p2pkh / p2sh-p2wpkh /
// p2wpkh / p2tr; p2wpkh is the default. URLs are placeholders per §5.5
// — real endpoints resolve before launch.
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
        encoder: { defaultUrl: 'https://encoder.xchain.io', defaultPort: 443 },
        hub: { defaultUrl: 'https://hub.xchain.io', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'bitcoin-testnet',
        networkKind: 'testnet',
        icon: 'bitcoin-testnet-icon-20.png',
        wifVersionByte: 0xef,
        explorer: { defaultUrl: 'https://testnet.explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://testnet.encoder.xchain.io', defaultPort: 443 },
        hub: { defaultUrl: 'https://testnet.hub.xchain.io', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'bitcoin-regtest',
        networkKind: 'regtest',
        icon: 'bitcoin-regtest-icon-20.png',
        wifVersionByte: 0xef,
        explorer: { defaultUrl: 'http://localhost', defaultPort: 18081 },
        encoder: { defaultUrl: 'http://localhost', defaultPort: 18082 },
        hub: { defaultUrl: 'http://localhost', defaultPort: 18000 },
    },
];
