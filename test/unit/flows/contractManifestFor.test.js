// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// PC-39: contractManifestFor's answered/not-answered split.
//
// The flow reads the raw contract row rather than sdk.getContractManifest
// precisely so a 404 or an offline explorer is distinguishable from a
// contract that declared no allowlist. It must never throw, and must
// never report 'unrestricted' for a lookup that did not come back.

import { describe, it, expect } from 'vitest';
import { contractManifestFor } from '../../../packages/core/src/flows/contractDetail.js';

function registryReturning(row) {
    return { get: () => ({ getContract: async () => row }) };
}

function registryThrowing(err) {
    return { get: () => ({ getContract: async () => { throw err; } }) };
}

const ARGS = { chainId: 'bitcoin', contractActionIndex: '2597' };

describe('contractManifestFor', () => {
    it('reports a declared allowlist parsed from a JSON string column', async () => {
        const res = await contractManifestFor({
            sdkRegistry: registryReturning({ permissions: '["SEND","ISSUE"]', max_take_bps: 250 }),
            ...ARGS,
        });
        expect(res).toEqual({ permissions: ['SEND', 'ISSUE'], maxTakeBps: 250, status: 'declared' });
    });

    it('accepts an already-parsed permissions array', async () => {
        const res = await contractManifestFor({
            sdkRegistry: registryReturning({ permissions: ['SEND'], max_take_bps: null }),
            ...ARGS,
        });
        expect(res).toEqual({ permissions: ['SEND'], maxTakeBps: null, status: 'declared' });
    });

    it('keeps an empty allowlist declared (it can emit nothing), not unrestricted', async () => {
        const res = await contractManifestFor({
            sdkRegistry: registryReturning({ permissions: [], max_take_bps: 0 }),
            ...ARGS,
        });
        expect(res.status).toBe('declared');
        expect(res.permissions).toEqual([]);
        expect(res.maxTakeBps).toBe(0);
    });

    it('reports unrestricted when the explorer answered with no manifest row', async () => {
        const res = await contractManifestFor({
            sdkRegistry: registryReturning({ action_index: 2597, permissions: null, max_take_bps: null }),
            ...ARGS,
        });
        expect(res.status).toBe('unrestricted');
        expect(res.permissions).toBeNull();
    });

    it('reports unavailable when the lookup throws (404 / offline explorer)', async () => {
        const res = await contractManifestFor({
            sdkRegistry: registryThrowing(new Error('Request failed with status code 404')),
            ...ARGS,
        });
        expect(res).toEqual({ permissions: null, maxTakeBps: null, status: 'unavailable' });
    });

    it('reports unavailable when the registry itself cannot resolve the chain', async () => {
        const res = await contractManifestFor({
            sdkRegistry: { get: () => { throw new Error('no sdk for chain'); } },
            ...ARGS,
        });
        expect(res.status).toBe('unavailable');
    });

    it('reports unavailable for an SDK instance with no getContract', async () => {
        const res = await contractManifestFor({ sdkRegistry: { get: () => ({}) }, ...ARGS });
        expect(res.status).toBe('unavailable');
    });

    it('reports unavailable for missing arguments instead of guessing', async () => {
        expect((await contractManifestFor({ sdkRegistry: registryReturning({}), chainId: 'bitcoin' })).status)
            .toBe('unavailable');
        expect((await contractManifestFor({ chainId: 'bitcoin', contractActionIndex: '1' })).status)
            .toBe('unavailable');
    });

    it('reports unavailable when the row is not an object', async () => {
        const res = await contractManifestFor({ sdkRegistry: registryReturning(null), ...ARGS });
        expect(res.status).toBe('unavailable');
    });

    it('fails toward caution on a malformed permissions column', async () => {
        // The indexer rejects malformed manifests at deploy time, so this is
        // a corrupt-read path: overstating the contract's reach is the safe
        // direction, understating it is not.
        const res = await contractManifestFor({
            sdkRegistry: registryReturning({ permissions: '{not json', max_take_bps: 'abc' }),
            ...ARGS,
        });
        expect(res.status).toBe('unrestricted');
        expect(res.maxTakeBps).toBeNull();
    });

    it('drops a non-string entry rather than rendering it as a permission', async () => {
        const res = await contractManifestFor({
            sdkRegistry: registryReturning({ permissions: ['SEND', 7], max_take_bps: null }),
            ...ARGS,
        });
        expect(res.status).toBe('unrestricted');
    });
});
