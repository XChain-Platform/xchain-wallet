// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Removing a custom chain drops its fee entry with it. Left behind, the entry
// renders in the Fees panel with no descriptor to give it a unit or an RBF
// capability, and a re-added chain of the same id inherits its custom rate.

import { describe, it, expect } from 'vitest';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import { addCustomChain, removeCustomChain } from '../../../packages/core/src/flows/customChains.js';

const DESCRIPTOR = Object.freeze({
    id: 'forkcoin-regtest',
    coin: 'forkcoin',
    displayName: 'ForkCoin Regtest',
    networkKind: 'regtest',
    color: '#A1B2C3',
    icon: '',
    derivationPaths: { p2pkh: "m/44'/0'/A'/C/I" },
    addressTypes: ['p2pkh'],
    defaultAddressType: 'p2pkh',
    feeStrategy: {
        unit: 'sats-per-kbyte',
        supportedStrategies: ['low', 'normal', 'fast'],
        defaultStrategy: 'normal',
        rbfSupported: false,
    },
    supportedActions: ['SEND'],
    uriScheme: 'forkcoin',
    wifVersionByte: 0xef,
    explorer: { defaultUrl: 'http://localhost', defaultPort: 18080 },
    encoder: { defaultUrl: 'http://localhost', defaultPort: 18081 },
    hub: { defaultUrl: 'http://localhost', defaultPort: 18082 },
    adsDonationAddress: 'PLACEHOLDER_REPLACE_BEFORE_MAINNET',
});

const BTC_FEES = Object.freeze({ strategy: 'fast', customSatsPerKb: null, rbfByDefault: false });
const ADS_STATE = Object.freeze({ perTxAmountSats: null, triggerAmountSats: null, accumulatedSats: 4200, lifetimeDonatedSats: 0, lifetimeTxCount: 3 });

function createVaultStub(initial) {
    let settings = { schemaVersion: 2, ...initial };
    return {
        settings: {
            async get() { return settings; },
            async put(next) { settings = { ...next }; },
        },
        read: () => settings,
    };
}

describe('removeCustomChain drops the chain\'s fee entry', () => {
    it('drops the removed chain\'s entry and leaves every other chain\'s alone', async () => {
        const vault = createVaultStub();
        const chainRegistry = new ChainRegistry();
        await addCustomChain({ vault, chainRegistry, descriptor: DESCRIPTOR });
        await vault.settings.put({
            ...vault.read(),
            fees: {
                'bitcoin-mainnet': { ...BTC_FEES },
                [DESCRIPTOR.id]: { strategy: 'custom', customSatsPerKb: 100000000, rbfByDefault: null },
            },
            ads: { enabled: true, perChain: { [DESCRIPTOR.id]: { ...ADS_STATE } } },
        });

        const res = await removeCustomChain({ vault, chainRegistry, chainId: DESCRIPTOR.id });

        expect(res.removed).toBe(true);
        const after = vault.read();
        expect(Object.keys(after.fees)).toEqual(['bitcoin-mainnet']);
        expect(after.fees['bitcoin-mainnet']).toEqual(BTC_FEES);
        // Donation counters are not preferences, so a removal does not touch them.
        expect(after.ads.perChain[DESCRIPTOR.id]).toEqual(ADS_STATE);
    });

    it('keeps the entry of a bundled chain whose id a stale custom row shares', async () => {
        const vault = createVaultStub({
            customChains: [{ ...DESCRIPTOR, id: 'bitcoin-mainnet' }],
            fees: { 'bitcoin-mainnet': { ...BTC_FEES } },
        });
        const chainRegistry = new ChainRegistry();

        await expect(removeCustomChain({ vault, chainRegistry, chainId: 'bitcoin-mainnet' }))
            .rejects.toThrow(/bundled chain and cannot be removed/);
        expect(vault.read().fees['bitcoin-mainnet']).toEqual(BTC_FEES);
    });
});
