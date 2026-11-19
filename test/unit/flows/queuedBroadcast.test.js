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

const GENESIS_COINBASE = '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';

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

    it('keeps a landed reveal queued when panic mode activates during its commit request', async () => {
        const pendingTxs = memCollection([queuedPendingTx({
            txid: 'commit-id', revealTxHex: 'reveal-hex', revealTxid: 'reveal-id',
        })]);
        const sent = [];
        const sdkRegistry = { get: () => ({ encoder: { broadcastTx: async (hex) => {
            sent.push(hex);
            if (sent.length === 1) activatePanicMode({ durationMs: 60 * 60 * 1000 });
            return {};
        } } }) };

        await expect(drainQueuedBroadcast({
            vault: { pendingTxs }, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
        })).rejects.toBeInstanceOf(PanicModeActiveError);
        expect(sent).toEqual(['deadbeef']);
        expect(await pendingTxs.get('ptx-1')).toMatchObject({
            status: 'queued', txid: 'reveal-id', txHex: 'reveal-hex', commitLanded: true,
        });

        deactivatePanicMode();
        await drainQueuedBroadcast({
            vault: { pendingTxs }, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
        });
        expect(sent).toEqual(['deadbeef', 'reveal-hex']);
        expect((await pendingTxs.get('ptx-1')).status).toBe('broadcast');
    });
});

describe('drainQueuedBroadcast: in-flight / idempotency guard', () => {
    afterEach(() => {
        deactivatePanicMode();
    });

    it('short-circuits a concurrent drain of the same record so broadcastTx runs once', async () => {
        const pendingTxs = memCollection([queuedPendingTx()]);
        const vault = { pendingTxs };
        let broadcastCalls = 0;
        let releaseBroadcast;
        const sdkRegistry = {
            get: () => ({
                encoder: {
                    broadcastTx: () => {
                        broadcastCalls += 1;
                        return new Promise((resolve) => { releaseBroadcast = resolve; });
                    },
                },
            }),
        };

        // First drain claims the record and parks inside broadcastTx.
        const first = drainQueuedBroadcast({
            vault, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
        });
        // Second drain, started before the first resolves, must not broadcast.
        const second = drainQueuedBroadcast({
            vault, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
        });

        await expect(second).rejects.toThrow(/already being broadcast/);

        releaseBroadcast({ txid: 'tx123' });
        const firstResult = await first;

        expect(broadcastCalls).toBe(1);
        expect(firstResult.broadcast).toBe(true);
        expect(firstResult.pendingTx.status).toBe('broadcast');
    });

    it('resumes a record left in broadcasting by an interrupted drain', async () => {
        const pendingTxs = memCollection([queuedPendingTx({ status: 'broadcasting' })]);
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

    it('reverts to queued and records the error when broadcast fails', async () => {
        const pendingTxs = memCollection([queuedPendingTx()]);
        const vault = { pendingTxs };
        const sdkRegistry = {
            get: () => ({
                encoder: {
                    broadcastTx: async () => { throw new Error('network down'); },
                },
            }),
        };

        const result = await drainQueuedBroadcast({
            vault, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
        });

        expect(result.broadcast).toBe(false);
        expect(result.error).toMatch(/network down/);
        const after = await pendingTxs.get('ptx-1');
        expect(after.status).toBe('queued');
        expect(after.error).toMatch(/network down/);
    });

    // The queue applies the SAME permanence split as the submit
    // path, on every retry. Without it the drain reverted everything to
    // 'queued', so a transaction whose inputs were already spent sat on the
    // rebroadcast surface forever, inviting the user to retry bytes that can
    // never confirm.
    it('marks the record failed when the inputs are gone, so it stops being retried', async () => {
        const pendingTxs = memCollection([queuedPendingTx()]);
        const vault = { pendingTxs };
        const sdkRegistry = {
            get: () => ({
                encoder: {
                    broadcastTx: async () => {
                        throw new Error('bad-txns-inputs-missingorspent');
                    },
                },
            }),
        };

        const result = await drainQueuedBroadcast({
            vault, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
        });

        expect(result.broadcast).toBe(false);
        expect(result.permanence).toBe('permanent');
        const after = await pendingTxs.get('ptx-1');
        expect(after.status).toBe('failed');
        expect(after.error).toMatch(/missingorspent/);

        // And a 'failed' record is terminal: a later drain refuses rather than
        // re-broadcasting bytes the chain has already rejected for good.
        await expect(drainQueuedBroadcast({
            vault, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
        })).rejects.toThrow(/is not queued/);
    });

    it('settles a retry the node already holds as broadcast, from queued or an interrupted claim', async () => {
        for (const status of ['queued', 'broadcasting']) {
            const pendingTxs = memCollection([{ ...queuedPendingTx(), status }]);
            const sdkRegistry = {
                get: () => ({ encoder: { broadcastTx: async () => { throw new Error('txn-already-known'); } } }),
            };
            const result = await drainQueuedBroadcast({
                vault: { pendingTxs }, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
            });
            expect(result).toMatchObject({ broadcast: true, error: null, alreadyOnNetwork: true });
            expect((await pendingTxs.get('ptx-1')).status, status).toBe('broadcast');
        }
    });

    it('keeps an ambiguous failure queued, because a still-valid signed tx must stay recoverable', async () => {
        const pendingTxs = memCollection([queuedPendingTx()]);
        const vault = { pendingTxs };
        const sdkRegistry = {
            get: () => ({
                encoder: {
                    broadcastTx: async () => { throw new Error('something nobody classified'); },
                },
            }),
        };

        const result = await drainQueuedBroadcast({
            vault, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
        });

        expect(result.permanence).toBe('transient');
        expect((await pendingTxs.get('ptx-1')).status).toBe('queued');
    });

    it('releases the in-flight claim so a later drain of the same id can proceed', async () => {
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

        // Fail the first drain, then re-queue and drain again: the claim from
        // the first attempt must not linger and block the retry.
        const failing = {
            get: () => ({ encoder: { broadcastTx: async () => { throw new Error('boom'); } } }),
        };
        await drainQueuedBroadcast({ vault, sdkRegistry: failing, chainRegistry, pendingTxId: 'ptx-1' });

        const result = await drainQueuedBroadcast({
            vault, sdkRegistry, chainRegistry, pendingTxId: 'ptx-1',
        });
        expect(broadcastCalls).toBe(1);
        expect(result.broadcast).toBe(true);
    });

    it('records normalized transaction ids for successful and already-known deliveries', async () => {
        const responseRows = memCollection([queuedPendingTx()]);
        const responseSdk = {
            get: () => ({ encoder: { broadcastTx: async () => ({ txid: 'AB'.repeat(32) }) } }),
        };
        const response = await drainQueuedBroadcast({
            vault: { pendingTxs: responseRows }, sdkRegistry: responseSdk,
            chainRegistry, pendingTxId: 'ptx-1',
        });
        expect(response.pendingTx.txid).toBe('ab'.repeat(32));

        const knownRows = memCollection([queuedPendingTx({ txHex: GENESIS_COINBASE })]);
        const knownSdk = {
            get: () => ({ encoder: { broadcastTx: async () => { throw new Error('txn-already-known'); } } }),
        };
        const known = await drainQueuedBroadcast({
            vault: { pendingTxs: knownRows }, sdkRegistry: knownSdk,
            chainRegistry, pendingTxId: 'ptx-1',
        });
        expect(known.pendingTx.txid).toBe('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b');
    });
});
