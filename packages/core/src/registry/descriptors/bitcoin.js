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
        // Display-only, never consensus. The operator fills this with the
        // platform's documented list-owner addresses.
        platformListOwners: [],
        icon: 'bitcoin-mainnet-icon-20.png',
        wifVersionByte: 0x80,
        adsDonationAddresses: {
            DONATE1: '1Donate1GERVKPW6GFQcnGeTa8dgL6Abyp',
            DONATE2: '1Donate2LkbBrsanwCVRPWZCXAqQcvcqGz',
            EXPLORER: '1Donate3GBGSZzzrS9U9gUgURYKscAE6Yn',
        },
        adsDonationAddress: '1Donate1GERVKPW6GFQcnGeTa8dgL6Abyp',
        explorer: { defaultUrl: 'https://explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://encoder.xchain.io/BTC', defaultPort: 443 },
        hub: { defaultUrl: 'https://hub.xchain.io/BTC', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'bitcoin-testnet',
        networkKind: 'testnet',
        // Display-only, never consensus. The operator fills this with the
        // platform's documented list-owner addresses.
        platformListOwners: [],
        icon: 'bitcoin-testnet-icon-20.png',
        wifVersionByte: 0xef,
        adsDonationAddresses: {
            DONATE1: 'mfztXKX1HeVdCQf6pDCZFEzo5i5wYNHAM6',
            DONATE2: 'myBbbZ4t7BPoyNcT4sHtFwZDuiyYGDXLQM',
            EXPLORER: 'n1jbLKMrhvFae7NwTj37ZtkN4uPy29o9aM',
        },
        adsDonationAddress: 'mfztXKX1HeVdCQf6pDCZFEzo5i5wYNHAM6',
        explorer: { defaultUrl: 'https://explorer.xchain.io', defaultPort: 443 },
        encoder: { defaultUrl: 'https://encoder.xchain.io/TBTC', defaultPort: 443 },
    },
    {
        ...COMMON,
        id: 'bitcoin-regtest',
        networkKind: 'regtest',
        // Display-only, never consensus. The operator fills this with the
        // platform's documented list-owner addresses.
        platformListOwners: [],
        icon: 'bitcoin-regtest-icon-20.png',
        wifVersionByte: 0xef,
        adsDonationAddresses: {
            DONATE1: 'muYHF9MMnK6Nmd5zx7EBtqEYZdaf2Xy8JX',
            DONATE2: 'mkQd27aJSqsQ666z1Q4MLFmd3Ybqzy3TNw',
            EXPLORER: 'mrDH7rA2ZmGoh4Qx5guhDBJbZotUd6XyVH',
        },
        adsDonationAddress: 'muYHF9MMnK6Nmd5zx7EBtqEYZdaf2Xy8JX',
        explorer: { defaultUrl: 'http://localhost', defaultPort: 18080 },
        encoder: { defaultUrl: 'http://localhost', defaultPort: 3023 },
        hub: { defaultUrl: 'http://localhost', defaultPort: 10000 },
    },
];

if (import.meta.vitest) {
    const { describe, expect, it } = import.meta.vitest;
    const mainnet = bitcoinDescriptors.find((descriptor) => descriptor.networkKind === 'mainnet');
    const testnet = bitcoinDescriptors.find((descriptor) => descriptor.networkKind === 'testnet');
    const registry = { get: (chainId) => chainId === testnet.id ? testnet : undefined };
    const settingsFor = (donationAddressRole) => ({
        ads: {
            enabled: true,
            perChain: {
                [testnet.id]: {
                    perTxAmountSats: null,
                    triggerAmountSats: null,
                    accumulatedSats: testnet.adsDefaults.triggerAmountSats,
                    lifetimeDonatedSats: 0,
                    lifetimeTxCount: 25,
                    ...(donationAddressRole ? { donationAddressRole } : {}),
                },
            },
        },
    });

    describe('Bitcoin ADS donation routing', () => {
        it('defaults to the testnet DONATE1 address', async () => {
            const { resolveAdsPlanForNextTx } = await import('../../flows/ads.js');
            const plan = resolveAdsPlanForNextTx(settingsFor(), testnet.id, registry);

            expect(plan).toMatchObject({
                canSubmit: true,
                donationAddress: testnet.adsDonationAddresses.DONATE1,
            });
            expect(Object.values(mainnet.adsDonationAddresses)).not.toContain(plan.donationAddress);
        });

        it.each(['DONATE1', 'DONATE2', 'EXPLORER'])(
            'adds the selected testnet %s address to the donation output',
            async (role) => {
                const { applyAdsPlanToEncoderOpts } = await import('../../flows/ads.js');
                const existingOutput = { address: 'recipient', value: 1 };
                const result = applyAdsPlanToEncoderOpts(
                    settingsFor(role),
                    testnet.id,
                    registry,
                    { customOutputs: [existingOutput] },
                );

                expect(result.adsPlan.canSubmit).toBe(true);
                expect(result.encoderOpts.customOutputs).toEqual([
                    existingOutput,
                    {
                        address: testnet.adsDonationAddresses[role],
                        value: testnet.adsDefaults.triggerAmountSats,
                    },
                ]);
                expect(Object.values(mainnet.adsDonationAddresses)).not.toContain(
                    result.adsPlan.donationAddress,
                );
            },
        );
    });
}
