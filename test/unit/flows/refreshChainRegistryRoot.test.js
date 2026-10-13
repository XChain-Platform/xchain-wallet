// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The descriptors' hub URL carries a per-chain prefix (/BTC), but the hub
// serves the registry once at its root; Settings > Refresh now must reach it.

import { describe, it, expect } from 'vitest';
import { refreshChainRegistry } from '../../../packages/core/src/flows/refreshChainRegistry.js';

function hub(routes) {
    const calls = [];
    const fetcher = async (url) => {
        calls.push(url);
        const body = routes[url];
        if (!body) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => body };
    };
    return { calls, fetcher };
}

const REGISTRY = { descriptors: [{ id: 'bitcoin-mainnet' }], generatedAt: '2026-10-12T00:00:00Z' };

describe('refreshChainRegistry against a per-chain hub URL', () => {
    it('falls back to the hub root when the prefixed path is a 404', async () => {
        const { calls, fetcher } = hub({ 'https://hub.xchain.io/api/v1/chain-registry': REGISTRY });
        const r = await refreshChainRegistry({ hubUrl: 'https://hub.xchain.io/BTC', fetcher });
        expect(r.ok).toBe(true);
        expect(r.hubUrl).toBe('https://hub.xchain.io/api/v1/chain-registry');
        expect(calls).toEqual([
            'https://hub.xchain.io/BTC/api/v1/chain-registry',
            'https://hub.xchain.io/api/v1/chain-registry',
        ]);
    });

    it('keeps a hub hosted under its own path when that path answers', async () => {
        const { calls, fetcher } = hub({ 'https://example.org/hub/api/v1/chain-registry': REGISTRY });
        const r = await refreshChainRegistry({ hubUrl: 'https://example.org/hub/', fetcher });
        expect(r.ok).toBe(true);
        expect(calls).toEqual(['https://example.org/hub/api/v1/chain-registry']);
    });

    it('reports the root URL when both answer 404', async () => {
        const { fetcher } = hub({});
        const r = await refreshChainRegistry({ hubUrl: 'https://hub.xchain.io/BTC', fetcher });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/404/);
    });
});
