// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: a custom chain's cached SDK client must not outlive its
// descriptor.
//
// SDKRegistry caches one instance per chainId and `get()` returns it
// before it re-reads the descriptor, so removing a Developer-Mode chain
// and re-adding the same id against a different node kept every request,
// signed submissions included, pointed at the ORIGINAL endpoints for the
// rest of the session. Re-saving Settings did not heal it: a save with no
// endpoint override reports `changed: []` and tears nothing down.
//
// The negative control is the last case in this file: it drives the same
// sequence with no `sdkRegistry` threaded through and asserts the STALE
// url, so a version of these tests that could not observe the difference
// fails instead of passing quietly.

import { describe, it, expect } from 'vitest';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import {
    addCustomChain,
    removeCustomChain,
} from '../../../packages/core/src/flows/customChains.js';

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
        unit: 'sats-per-vbyte',
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

const RELOCATED = Object.freeze({
    ...DESCRIPTOR,
    explorer: { defaultUrl: 'https://new-node.example', defaultPort: 443 },
    encoder: { defaultUrl: 'https://new-node.example', defaultPort: 443 },
    hub: { defaultUrl: 'https://new-node.example', defaultPort: 443 },
});

function createVaultStub() {
    let settings = { schemaVersion: 2 };
    return {
        settings: {
            async get() { return settings; },
            async put(next) { settings = { ...next }; },
        },
    };
}

function makeHarness() {
    const closed = [];
    const chainRegistry = new ChainRegistry();
    const sdkRegistry = new SDKRegistry({
        chainRegistry,
        sdkFactory: (opts) => ({
            network: opts.network,
            explorerUrl: opts.explorerUrl,
            close() { closed.push(opts.explorerUrl); },
        }),
    });
    return { vault: createVaultStub(), chainRegistry, sdkRegistry, closed };
}

describe('custom chains invalidate the cached SDK client', () => {
    it('re-adding a removed chain with new endpoints rebuilds the client', async () => {
        const { vault, chainRegistry, sdkRegistry, closed } = makeHarness();
        await addCustomChain({ vault, chainRegistry, sdkRegistry, descriptor: DESCRIPTOR });
        // Use the chain, so an instance really is cached.
        expect(sdkRegistry.get(DESCRIPTOR.id).explorerUrl).toBe('http://localhost:18080');

        await removeCustomChain({ vault, chainRegistry, sdkRegistry, chainId: DESCRIPTOR.id });
        expect(closed).toEqual(['http://localhost:18080']);
        expect(sdkRegistry.activeChainIds()).not.toContain(DESCRIPTOR.id);

        await addCustomChain({ vault, chainRegistry, sdkRegistry, descriptor: RELOCATED });
        // joinEndpoint drops the scheme's default port, so 443 is implicit.
        expect(sdkRegistry.get(DESCRIPTOR.id).explorerUrl).toBe('https://new-node.example');
    });

    it('leaves other chains and their sockets alone', async () => {
        const { vault, chainRegistry, sdkRegistry, closed } = makeHarness();
        await addCustomChain({ vault, chainRegistry, sdkRegistry, descriptor: DESCRIPTOR });
        const btc = sdkRegistry.get('bitcoin-mainnet');
        sdkRegistry.get(DESCRIPTOR.id);

        await removeCustomChain({ vault, chainRegistry, sdkRegistry, chainId: DESCRIPTOR.id });
        expect(closed).toEqual(['http://localhost:18080']);
        expect(sdkRegistry.get('bitcoin-mainnet')).toBe(btc);
    });

    it('is a no-op when the chain id was never registered', async () => {
        const { vault, chainRegistry, sdkRegistry, closed } = makeHarness();
        const r = await removeCustomChain({
            vault, chainRegistry, sdkRegistry, chainId: 'never-existed',
        });
        expect(r.removed).toBe(false);
        expect(closed).toEqual([]);
    });

    // Negative control. Same sequence, no sdkRegistry threaded through:
    // this is the shipped behaviour before the fix, and it must still
    // reproduce the stale endpoint. If this case ever agrees with the
    // first one, the first one is no longer measuring anything.
    it('without the registry threaded through, the stale client survives', async () => {
        const { vault, chainRegistry, sdkRegistry, closed } = makeHarness();
        await addCustomChain({ vault, chainRegistry, descriptor: DESCRIPTOR });
        expect(sdkRegistry.get(DESCRIPTOR.id).explorerUrl).toBe('http://localhost:18080');

        await removeCustomChain({ vault, chainRegistry, chainId: DESCRIPTOR.id });
        await addCustomChain({ vault, chainRegistry, descriptor: RELOCATED });

        expect(sdkRegistry.get(DESCRIPTOR.id).explorerUrl).toBe('http://localhost:18080');
        expect(closed).toEqual([]);
    });

    // A settings save with no endpoint override cannot heal the stale
    // client, which is why the mutators have to do it.
    it('a no-override settings save reports no change', async () => {
        const { vault, chainRegistry, sdkRegistry } = makeHarness();
        await addCustomChain({ vault, chainRegistry, descriptor: DESCRIPTOR });
        sdkRegistry.get(DESCRIPTOR.id);
        expect(sdkRegistry.applyEndpointOverridesFromSettings({ schemaVersion: 2 }))
            .toEqual({ changed: [] });
        expect(sdkRegistry.activeChainIds()).toContain(DESCRIPTOR.id);
    });
});
