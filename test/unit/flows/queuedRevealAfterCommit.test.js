// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A reveal (or P2SH phase-2 spend) that fails TRANSIENTLY after its commit
// landed is queued. A later retry can still be refused permanently, for example
// "missing inputs" from a node that has not seen the commit. The commit's spend
// is on the network either way, so the record must stay 'broadcast' on the
// commit's txid, never 'failed' and never deleted, the same rule submitAction
// applies to an immediate permanent refusal after the commit.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const submitWithSignerMock = vi.fn();
vi.mock('../../../packages/core/src/sdk/submitWithSigner.js', async (importOriginal) => ({
    ...(await importOriginal()),
    submitWithSigner: (...args) => submitWithSignerMock(...args),
}));

const { submitAction } = await import('../../../packages/core/src/flows/submitAction.js');
const { drainQueuedBroadcast, discardQueuedBroadcast } = await import('../../../packages/core/src/flows/queuedBroadcast.js');
const { BroadcastFailedError } = await import('../../../packages/core/src/sdk/submitWithSigner.js');
const { validatePendingTx } = await import('../../../packages/core/src/schemas/pendingTx.js');

function memCollection() {
    const m = new Map();
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, structuredClone(rec)); },
        list: async () => Array.from(m.values()).map((r) => structuredClone(r)),
        delete: async (id) => m.delete(id),
        findBy: async (field, value) => Array.from(m.values())
            .filter((r) => r[field] === value).map((r) => structuredClone(r)),
    };
}

function harness() {
    const pendingTxs = memCollection();
    return {
        pendingTxs,
        vault: {
            pendingTxs,
            accounts: memCollection(),
            addresses: memCollection(),
            wallets: memCollection(),
            settings: { get: async () => ({}), put: async () => {} },
        },
        chainRegistry: {
            get: () => ({ coin: 'bitcoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'] }),
            chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'regtest' ? 'bitcoin-regtest' : null),
        },
        signer: { id: 'signer-1', kind: 'software' },
    };
}

function submit(h, onBroadcastFailure) {
    return submitAction({
        vault: h.vault,
        walletId: 'w1',
        chainRegistry: h.chainRegistry,
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        actionData: { action: 'BROADCAST', params: { MESSAGE: 'hi' } },
        encoderOpts: { pubkey: 'ab', change: 'bcrt1qsrc', sourceAddress: 'bcrt1qsrc' },
        signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
        signer: h.signer,
        pendingTxMeta: { fromAddress: 'bcrt1qsrc', toAddress: null, actionSummary: 'Broadcast' },
        onBroadcastFailure,
    });
}

function refusal(phase, txid, message) {
    return new BroadcastFailedError({
        cause: new Error(message),
        signedTxHex: `${txid}-hex`,
        txid,
        chainId: 'bitcoin-regtest',
        signedAt: 1,
        encoding: 'p2sh',
        phase,
    });
}

/** Queue a reveal that timed out after its commit landed; returns the queued record. */
async function queueStrandedReveal(h, phase, progress, data) {
    const onBroadcastFailure = vi.fn();
    submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
        await onProgress('broadcasting', { txid: 'commit-txid' });
        onProgress(progress, data);
        throw refusal(phase, 'reveal-txid', 'ETIMEDOUT');
    });
    await submit(h, onBroadcastFailure).catch(() => {});
    const [row] = await h.pendingTxs.list();
    return { row, onBroadcastFailure };
}

function sdkRefusing(message) {
    return { get: () => ({ encoder: { broadcastTx: async () => { throw new Error(message); } } }) };
}

beforeEach(() => { submitWithSignerMock.mockReset(); });

describe('queued reveal after a landed commit', () => {
    const LANDED = [
        ['envelope_reveal', 'envelope_revealing', { commitTxid: 'commit-txid' }],
        ['phase2', 'p2sh_spending', { phase1Txid: 'commit-txid' }],
    ];

    for (const [phase, progress, data] of LANDED) {
        it(`marks a transiently failed ${phase} as commit-landed on the record and the queue entry`, async () => {
            const h = harness();
            const { row, onBroadcastFailure } = await queueStrandedReveal(h, phase, progress, data);
            expect(row.status).toBe('queued');
            expect(row.txid).toBe('reveal-txid');
            expect(row.commitLanded).toBe(true);
            expect(row.commitTxid).toBe('commit-txid');
            expect(validatePendingTx(row).ok).toBe(true);
            expect(onBroadcastFailure).toHaveBeenCalledTimes(1);
            const entry = onBroadcastFailure.mock.calls[0][0];
            expect(entry.commitLanded).toBe(true);
            expect(entry.commitTxid).toBe('commit-txid');
            expect(entry.txid).toBe('reveal-txid');
        });

        it(`keeps a ${phase} retried into a permanent refusal 'broadcast' on the commit txid`, async () => {
            const h = harness();
            const { row } = await queueStrandedReveal(h, phase, progress, data);
            const out = await drainQueuedBroadcast({
                vault: h.vault,
                sdkRegistry: sdkRefusing('missing inputs'),
                chainRegistry: h.chainRegistry,
                pendingTxId: row.id,
            });
            expect(out.broadcast).toBe(false);
            expect(out.permanence).toBe('permanent');
            const after = await h.pendingTxs.get(row.id);
            expect(after.status).toBe('broadcast');
            expect(after.txid).toBe('commit-txid');
            expect(typeof after.broadcastAt).toBe('string');
            expect(after.error).toMatch(/missing inputs/);
        });
    }

    it('keeps a discarded commit-landed reveal as broadcast instead of deleting it', async () => {
        const h = harness();
        const { row } = await queueStrandedReveal(h, 'envelope_reveal', 'envelope_revealing', { commitTxid: 'commit-txid' });
        expect(await discardQueuedBroadcast({ vault: h.vault, pendingTxId: row.id })).toBe(true);
        const after = await h.pendingTxs.get(row.id);
        expect(after).not.toBeNull();
        expect(after.status).toBe('broadcast');
        expect(after.txid).toBe('commit-txid');
    });

    it('still retires a single-phase queued tx as failed on a permanent retry, and leaves it unmarked', async () => {
        const h = harness();
        const onBroadcastFailure = vi.fn();
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            await onProgress('broadcasting', { txid: 'only-txid' });
            throw refusal('phase1', 'only-txid', 'ETIMEDOUT');
        });
        await submit(h, onBroadcastFailure).catch(() => {});
        const [row] = await h.pendingTxs.list();
        expect(row.commitLanded).toBeUndefined();
        expect(onBroadcastFailure.mock.calls[0][0].commitLanded).toBeUndefined();
        await drainQueuedBroadcast({
            vault: h.vault,
            sdkRegistry: sdkRefusing('missing inputs'),
            chainRegistry: h.chainRegistry,
            pendingTxId: row.id,
        });
        expect((await h.pendingTxs.get(row.id)).status).toBe('failed');
        expect(await discardQueuedBroadcast({ vault: h.vault, pendingTxId: row.id })).toBe(false);
    });
});
