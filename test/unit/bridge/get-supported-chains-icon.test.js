// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Bridge.getSupportedChains must hand dApps a resolvable icon URL,
// not an empty string. The handler resolves each descriptor's bare icon
// filename (e.g. `bitcoin-mainnet-icon-20.png`) against the web-accessible
// `chain-icons/` path via an injected getAssetUrl (chrome.runtime.getURL in
// the real service worker). These drive the real registerBridgeHandlers
// through a real MessageHost with an injected resolver.

import { describe, it, expect } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

function makeRegistry(chains) {
    return {
        get: (id) => chains.find((c) => c.id === id) ?? null,
        supportedChains: () => chains,
    };
}

async function getChains(chains, opts = {}) {
    const host = new MessageHost({
        // The route runs assertNotBlocked, which reads settings. A bare `{}`
        // vault threw a TypeError before the icon work could run, failing
        // these cases for a reason that has nothing to do with icons.
        vault: { settings: { get: async () => ({ blockedOrigins: [] }) } },
        chainRegistry: makeRegistry(chains),
        sdkRegistry: {},
    });
    registerBridgeHandlers(host, opts);
    const resp = await host.handle({
        type: 'bridge.getSupportedChains',
        request: { origin: 'https://dapp.example' },
    });
    expect(resp.ok, resp.ok ? '' : resp.error?.message).toBe(true);
    return resp.result;
}

const EXT = (p) => `chrome-extension://testext/${p}`;

describe('bridge.getSupportedChains icon resolution', () => {
    it('resolves a bare icon filename to the web-accessible chain-icons URL', async () => {
        const chains = [
            {
                id: 'bitcoin-mainnet',
                coin: 'bitcoin',
                displayName: 'Bitcoin',
                networkKind: 'mainnet',
                color: '#F7931A',
                icon: 'bitcoin-mainnet-icon-20.png',
                addressTypes: ['p2wpkh'],
                defaultAddressType: 'p2wpkh',
                supportedActions: [],
                uriScheme: 'bitcoin',
            },
        ];
        const [d] = await getChains(chains, { getAssetUrl: EXT });
        expect(d.icon).toBe(
            'chrome-extension://testext/chain-icons/bitcoin-mainnet-icon-20.png',
        );
    });

    it('never emits a bare filename: unresolved icons collapse to empty string', async () => {
        const chains = [
            {
                id: 'bitcoin-mainnet',
                coin: 'bitcoin',
                displayName: 'Bitcoin',
                networkKind: 'mainnet',
                color: '#F7931A',
                icon: 'bitcoin-mainnet-icon-20.png',
                addressTypes: ['p2wpkh'],
                defaultAddressType: 'p2wpkh',
                supportedActions: [],
                uriScheme: 'bitcoin',
            },
        ];
        // No getAssetUrl injected + no chrome global → defaultAssetUrl yields ''.
        const [d] = await getChains(chains);
        expect(d.icon).toBe('');
        expect(d.icon).not.toContain('.png');
    });

    it('passes through an absolute or data URL icon untouched (custom chains)', async () => {
        const chains = [
            {
                id: 'custom-mainnet',
                coin: 'custom',
                displayName: 'Custom',
                networkKind: 'mainnet',
                color: '#123456',
                icon: 'data:image/png;base64,AAAA',
                addressTypes: ['p2wpkh'],
                defaultAddressType: 'p2wpkh',
                supportedActions: [],
                uriScheme: 'custom',
            },
            {
                id: 'https-mainnet',
                coin: 'https',
                displayName: 'Https',
                networkKind: 'mainnet',
                color: '#654321',
                icon: 'https://cdn.example/icon.png',
                addressTypes: ['p2wpkh'],
                defaultAddressType: 'p2wpkh',
                supportedActions: [],
                uriScheme: 'https',
            },
        ];
        const result = await getChains(chains, { getAssetUrl: EXT });
        expect(result[0].icon).toBe('data:image/png;base64,AAAA');
        expect(result[1].icon).toBe('https://cdn.example/icon.png');
    });

    it('handles a missing icon field without throwing', async () => {
        const chains = [
            {
                id: 'noicon-mainnet',
                coin: 'noicon',
                displayName: 'NoIcon',
                networkKind: 'mainnet',
                color: '#000000',
                addressTypes: ['p2wpkh'],
                defaultAddressType: 'p2wpkh',
                supportedActions: [],
                uriScheme: 'noicon',
            },
        ];
        const [d] = await getChains(chains, { getAssetUrl: EXT });
        expect(d.icon).toBe('');
    });
});
