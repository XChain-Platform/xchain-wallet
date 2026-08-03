// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §49.1 checkReachability, specifically the DEFAULT probe layer.
//
// The probes had no coverage at all, and one of them was wrong in a way that
// only a real outage shows: `hub.ping()` REPORTS failure by resolving `false`
// rather than throwing, while `runProbe` counts any resolved value as
// reachable. The hub was therefore eternally reachable, so a chain could never
// be classified 'offline' (that needs all three services down) and neither
// could `overall`. A device with no connectivity told the user "partly
// unavailable; some features may not work" instead of "can't reach the
// network". Measured on an Android emulator,  SSC-6 session ().

import { describe, it, expect } from 'vitest';
import { checkReachability } from '../../../packages/core/src/flows/reachability.js';

/** An SDK whose hub ping resolves `answer` and whose other services are dead. */
function sdkWithHub(answer) {
    return {
        pingHub: async () => answer,
        pingEncoder: async () => { throw new Error('Encoder request failed: Network Error'); },
        explorer: {
            _get: async () => { throw new Error('Explorer request failed: Network Error'); },
        },
    };
}

const registryFor = (sdk) => ({ get: () => sdk });

describe('checkReachability default probes', () => {
    it('treats a hub ping that resolves false as UNREACHABLE, not reachable', async () => {
        const res = await checkReachability({
            sdkRegistry: registryFor(sdkWithHub(false)),
            chainIds: ['litecoin-regtest'],
            timeoutMs: 500,
        });

        expect(res.perChain[0].services.hub).toBe('unreachable');
        // All three down is what 'offline' means; before the fix this said
        // 'degraded' and the user was told some features might not work.
        expect(res.perChain[0].mode).toBe('offline');
        expect(res.overall).toBe('offline');
    });

    it('still counts a hub ping that resolves true as reachable', async () => {
        const res = await checkReachability({
            sdkRegistry: registryFor(sdkWithHub(true)),
            chainIds: ['litecoin-regtest'],
            timeoutMs: 500,
        });

        expect(res.perChain[0].services.hub).toBe('reachable');
        expect(res.perChain[0].mode).toBe('degraded');
        expect(res.overall).toBe('degraded');
    });

    it('treats a hub ping that resolves null/undefined as unreachable', async () => {
        for (const answer of [null, undefined]) {
            const res = await checkReachability({
                sdkRegistry: registryFor(sdkWithHub(answer)),
                chainIds: ['litecoin-regtest'],
                timeoutMs: 500,
            });
            expect(res.perChain[0].services.hub).toBe('unreachable');
            expect(res.perChain[0].mode).toBe('offline');
        }
    });

    it('records why each service failed, so the banner can say more than "down"', async () => {
        const res = await checkReachability({
            sdkRegistry: registryFor(sdkWithHub(false)),
            chainIds: ['litecoin-regtest'],
            timeoutMs: 500,
        });

        expect(res.perChain[0].errors.encoder).toMatch(/Network Error/);
        expect(res.perChain[0].errors.explorer).toMatch(/Network Error/);
        expect(res.perChain[0].errors.hub).toMatch(/unreachable/i);
    });

    it('a chain whose services all answer is normal', async () => {
        const live = {
            pingHub: async () => true,
            pingEncoder: async () => ({ ok: true }),
            explorer: { _get: async () => ({ ok: true }) },
        };
        const res = await checkReachability({
            sdkRegistry: registryFor(live),
            chainIds: ['litecoin-regtest'],
            timeoutMs: 500,
        });
        expect(res.perChain[0].mode).toBe('normal');
        expect(res.overall).toBe('normal');
    });
});
