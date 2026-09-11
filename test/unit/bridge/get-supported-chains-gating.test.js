// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// bridge.getSupportedChains is the one read route that stays reachable
// before connect(), so its gates are the ONLY thing standing between a
// blocked origin and the wallet's chain catalogue (which carries the
// user's own custom chains, not just bundled ones). The sibling reads get
// their blocklist enforcement free, because addBlockedOrigin evicts the
// ConnectedSite record requireSite demands; this route has no record to
// lose, so it has to check for itself.

import { describe, it, expect } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

const CHAINS = [
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

function buildHost(settings) {
    const host = new MessageHost({
        vault: { settings: { get: async () => settings } },
        chainRegistry: {
            get: (id) => CHAINS.find((c) => c.id === id) ?? null,
            supportedChains: () => CHAINS,
        },
        sdkRegistry: {},
    });
    registerBridgeHandlers(host, { getAssetUrl: (p) => `chrome-extension://testext/${p}` });
    return host;
}

const ask = (host, request) => host.handle({ type: 'bridge.getSupportedChains', request });

describe('bridge.getSupportedChains gating', () => {
    it('answers a non-blocked origin with the catalogue', async () => {
        const resp = await ask(buildHost({ blockedOrigins: ['https://evil.example'] }), {
            origin: 'https://dapp.example',
        });
        expect(resp.ok).toBe(true);
        expect(resp.result.map((d) => d.id)).toEqual(['bitcoin-mainnet']);
    });

    it('refuses an origin the user blocked', async () => {
        const resp = await ask(buildHost({ blockedOrigins: ['https://evil.example'] }), {
            origin: 'https://evil.example',
        });
        expect(resp.ok).toBe(false);
        expect(resp.error.code).toBe('BLOCKED_BY_USER');
    });

    it('refuses a request that carries no origin', async () => {
        const resp = await ask(buildHost({ blockedOrigins: [] }), {});
        expect(resp.ok).toBe(false);
        expect(resp.error.code).toBe('INVALID_PARAMS');
    });
});
