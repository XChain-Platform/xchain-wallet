// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: drainQueuedBroadcast (§49.5) must honor the §26.5 panic-mode
// freeze. Broadcasting an already-signed tx invokes no signer, so without
// an explicit assertSigningAllowed() call this irreversible effector is
// invisible to a freeze scoped to "sign-path" chokepoints (review finding
// uuid:e646a392).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drainQueuedBroadcast, NoQueuedTxError } from '../../../packages/core/src/flows/queuedBroadcast.js';
import {
    activatePanicMode,
    deactivatePanicMode,
    PanicModeActiveError,
} from '../../../packages/core/src/flows/panicMode.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => m.delete(id),
        _map: m,
    };
}

function queuedPendingTx(overrides = {}) {
    return {
        schemaVersion: 1,
        id: 'ptx-1',
        chain: 'bitcoin',
        network: 'regtest',
        fromAddress: '1from',
        toAddress: '1to',
        action: 'SEND',
        actionSummary: 'Send 1 TOK',
        psbtHex: 'aa',
        txHex: 'deadbeef',
        txid: null,
        status: 'queued',
        createdAt: new Date().toISOString(),
        broadcastAt: null,
        confirmedAt: null,
        rbfReplacement: null,
        error: null,
        ...overrides,
    };
}

const chainRegistry = {
    chainIdFor: (coin, network) => (
        coin === 'bitcoin' && network === 'regtest' ? 'bitcoin-regtest' : null
    ),
};

describe('drainQueuedBroadcast: panic-mode freeze', () => {
    afterEach(() => {
        deactivatePanicMode();
    });

    it('broadcasts normally when signing is not frozen', async () => {
        const pendingTxs = memCollection([queuedPendingTx()]);
        const vault = { pendingTxs };
        let broadcastCalls = 0;
        const sdkRegistry = {
            get: () => ({
                encoder: {
                    broadcastTx: async () => { broadcastCalls += 1; return { txid: 'tx123' }; },
                },
            }),
        };

        const result = await drainQueuedBroadcast({
            vault, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
        });

        expect(broadcastCalls).toBe(1);
        expect(result.broadcast).toBe(true);
        expect(result.pendingTx.status).toBe('broadcast');
    });

    it('refuses to broadcast while panic mode is active, and leaves the PendingTx queued', async () => {
        activatePanicMode({ durationMs: 60 * 60 * 1000 });

        const pendingTxs = memCollection([queuedPendingTx()]);
        const vault = { pendingTxs };
        let broadcastCalls = 0;
        const sdkRegistry = {
            get: () => ({
                encoder: {
                    broadcastTx: async () => { broadcastCalls += 1; return { txid: 'tx123' }; },
                },
            }),
        };

        await expect(drainQueuedBroadcast({
            vault, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
        })).rejects.toBeInstanceOf(PanicModeActiveError);

        // No network call, and no state mutation - the record stays exactly
        // as it was queued, recoverable once the freeze lifts.
        expect(broadcastCalls).toBe(0);
        const after = await pendingTxs.get('ptx-1');
        expect(after.status).toBe('queued');
        expect(after.error).toBe(null);
    });

    it('still throws NoQueuedTxError for a missing record even while frozen (validation before the freeze check)', async () => {
        activatePanicMode({ durationMs: 60 * 60 * 1000 });
        const vault = { pendingTxs: memCollection([]) };
        const sdkRegistry = { get: () => ({ encoder: { broadcastTx: async () => ({}) } }) };

        await expect(drainQueuedBroadcast({
            vault, sdkRegistry, chainRegistry, pendingTxId: 'missing',
        })).rejects.toBeInstanceOf(NoQueuedTxError);
    });
});
