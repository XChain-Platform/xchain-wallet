// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A two-phase P2SH or P2WSH action signs its reveal before the commit is
// broadcast, so the durable checkpoint written before the commit goes out holds
// both. Every later send of that record (a resume after a crash or reload, or a
// queue drain) sends the commit and then the reveal; sending the commit alone
// spends its coin into a script that nothing opens. A record written before the
// reveal field existed, or for a single-transaction action, drains as before.

import { describe, it, expect, vi } from 'vitest';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { drainQueuedBroadcast } from '../../../packages/core/src/flows/queuedBroadcast.js';
import { validatePendingTx, queuedRevealOf } from '../../../packages/core/src/schemas/pendingTx.js';

const CHAIN = 'litecoin-regtest';

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

const chainRegistry = {
    get: () => ({ id: CHAIN, coin: 'litecoin', networkKind: 'regtest' }),
    chainIdFor: (coin, network) => (coin === 'litecoin' && network === 'regtest' ? CHAIN : null),
};

const revealLegs = (commitTxid, encoding) => {
    const scriptType = encoding === 'P2WSH' ? 'p2wsh' : 'p2sh';
    const script = { [scriptType === 'p2wsh' ? 'witnessScriptHex' : 'redeemScriptHex']: '0100' };
    return { inputs: [{ prevTxHash: commitTxid, prevTxIndex: 0, scriptType, ...script }], outputs: [{ scriptType }] };
};

/** A two-phase submit whose encoder broadcasts through `broadcastTx`. */
function twoPhase(encoding, broadcastTx) {
    const pendingTxs = memCollection();
    const vault = {
        pendingTxs,
        settings: { get: async () => ({}), put: async () => {} },
    };
    const encoder = {
        createTx: vi.fn(async () => ({ psbt: 'PHASE1', encoding })),
        spendP2sh: vi.fn(async () => ({ psbt: 'PHASE2' })),
        broadcastTx: vi.fn(broadcastTx),
    };
    const sdk = {
        encoder,
        actions: { createAction: () => ({ actionString: 'DEPLOY|0|x|1', action: 'DEPLOY', version: 0 }) },
        wallet: { decomposePsbt: () => revealLegs('txid-PHASE1', encoding) },
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => ({
            signedPsbtHex: `SIGNED(${psbtHex})`, txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}`,
        })),
    };
    const submit = (extra = {}) => submitAction({
        vault,
        walletId: 'w1',
        chainRegistry,
        sdkRegistry: { get: () => sdk },
        chainId: CHAIN,
        actionData: { action: 'DEPLOY', params: { VERSION: '0', CODE: 'x', GAS_LIMIT: '1' } },
        encoderOpts: { pubkey: 'pub' },
        signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        signer,
        pendingTxMeta: { fromAddress: 'rltc1qsrc', toAddress: null, actionSummary: 'Deploy' },
        ...extra,
    });
    return { vault, pendingTxs, encoder, sdk, submit };
}

const never = () => new Promise(() => {});

function drainWith(vault, broadcastTx) {
    const encoder = { broadcastTx: vi.fn(broadcastTx) };
    return {
        encoder,
        drain: (pendingTxId) => drainQueuedBroadcast({
            vault,
            sdkRegistry: { get: () => ({ encoder }) },
            chainRegistry,
            pendingTxId,
        }),
    };
}

describe.each(['P2SH', 'P2WSH'])('%s checkpoint before the commit goes out', (encoding) => {
    it('stores the signed reveal beside the commit, and a valid record', async () => {
        const h = twoPhase(encoding, async () => never());
        void h.submit().catch(() => {});
        await vi.waitFor(() => expect(h.encoder.broadcastTx).toHaveBeenCalledTimes(1));

        const [row] = await h.pendingTxs.list();
        expect(row).toMatchObject({
            status: 'broadcasting',
            txid: 'txid-PHASE1',
            txHex: 'TX(PHASE1)',
            revealTxid: 'txid-PHASE2',
            revealTxHex: 'TX(PHASE2)',
        });
        expect(validatePendingTx(row).ok).toBe(true);
    });

    for (const [when, hungOn] of [
        ['before the commit reached a node', 'TX(PHASE1)'],
        ['after the commit broadcast', 'TX(PHASE2)'],
    ]) {
        it(`a crash ${when} resumes with the commit and then the reveal`, async () => {
            // The submit's worker dies inside a broadcast: the call never settles.
            const h = twoPhase(encoding, async (hex) => (hex === hungOn ? never() : {}));
            void h.submit().catch(() => {});
            await vi.waitFor(() => expect(h.encoder.broadcastTx).toHaveBeenCalledWith(hungOn));
            const [row] = await h.pendingTxs.list();
            expect(row.status).toBe('broadcasting');

            // The next boot resumes the claim. A node that holds the commit
            // answers "already known", which is the commit delivered.
            const sent = [];
            const r = drainWith(h.vault, async (hex) => {
                sent.push(hex);
                if (hex === 'TX(PHASE1)' && hungOn === 'TX(PHASE2)') throw new Error('txn-already-in-mempool');
                return {};
            });
            const out = await r.drain(row.id);

            expect(sent).toEqual(['TX(PHASE1)', 'TX(PHASE2)']);
            expect(out.broadcast).toBe(true);
            const after = await h.pendingTxs.get(row.id);
            expect(after).toMatchObject({
                status: 'broadcast',
                txid: 'txid-PHASE2',
                txHex: 'TX(PHASE2)',
                commitLanded: true,
                commitTxid: 'txid-PHASE1',
            });
            expect(validatePendingTx(after).ok).toBe(true);
        });
    }
});

describe('a drain of a two-phase record', () => {
    const pairRecord = (extra = {}) => ({
        id: 'p1', schemaVersion: 3, chain: 'litecoin', network: 'regtest', fromAddress: 'rltc1qsrc',
        toAddress: null, action: 'DEPLOY', actionSummary: 'Deploy', psbtHex: '',
        txHex: 'TX(PHASE1)', txid: 'txid-PHASE1', status: 'queued',
        revealTxHex: 'TX(PHASE2)', revealTxid: 'txid-PHASE2',
        createdAt: '2026-01-01T00:00:00.000Z', broadcastAt: null, confirmedAt: null,
        rbfReplacement: null, error: 'ETIMEDOUT',
        ...extra,
    });

    it('sends nothing more after a refused commit and keeps the pair queued', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(pairRecord());
        const r = drainWith({ pendingTxs }, async () => { throw new Error('ECONNREFUSED'); });

        const out = await r.drain('p1');

        expect(out).toMatchObject({ broadcast: false, permanence: 'transient' });
        expect(r.encoder.broadcastTx.mock.calls.map(([hex]) => hex)).toEqual(['TX(PHASE1)']);
        expect(await pendingTxs.get('p1')).toMatchObject({
            status: 'queued', txHex: 'TX(PHASE1)', revealTxHex: 'TX(PHASE2)', error: 'ECONNREFUSED',
        });
        expect(queuedRevealOf(await pendingTxs.get('p1'))).toEqual({ txHex: 'TX(PHASE2)', txid: 'txid-PHASE2' });
    });

    it('queues the reveal alone, commit-landed, when only the reveal is refused', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(pairRecord());
        const first = drainWith({ pendingTxs }, async (hex) => {
            if (hex === 'TX(PHASE2)') throw new Error('ETIMEDOUT');
            return {};
        });
        await first.drain('p1');
        const queued = await pendingTxs.get('p1');
        expect(queued).toMatchObject({
            status: 'queued', txid: 'txid-PHASE2', txHex: 'TX(PHASE2)',
            commitLanded: true, commitTxid: 'txid-PHASE1',
        });

        // The retry sends the reveal and never the commit again.
        const second = drainWith({ pendingTxs }, async () => ({}));
        await second.drain('p1');
        expect(second.encoder.broadcastTx.mock.calls.map(([hex]) => hex)).toEqual(['TX(PHASE2)']);
        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'broadcast', txid: 'txid-PHASE2' });
    });

    it('keeps a refused reveal broadcast on the commit txid once the commit landed', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(pairRecord());
        const r = drainWith({ pendingTxs }, async (hex) => {
            if (hex === 'TX(PHASE2)') throw new Error('missing inputs');
            return {};
        });
        const out = await r.drain('p1');
        expect(out.permanence).toBe('permanent');
        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'broadcast', txid: 'txid-PHASE1' });
    });

    it('sends the reveal even when the commit-landed checkpoint write is refused', async () => {
        const pendingTxs = memCollection();
        await pendingTxs.put(pairRecord());
        const put = pendingTxs.put;
        let refused = 0;
        // Refuse only the write that records the commit as landed.
        pendingTxs.put = async (rec) => {
            if (rec.commitLanded === true && rec.status === 'broadcasting' && refused === 0) {
                refused += 1;
                throw new Error('vault locked');
            }
            return put(rec);
        };
        const r = drainWith({ pendingTxs }, async () => ({}));

        const out = await r.drain('p1');

        expect(refused).toBe(1);
        expect(r.encoder.broadcastTx.mock.calls.map(([hex]) => hex)).toEqual(['TX(PHASE1)', 'TX(PHASE2)']);
        expect(out.broadcast).toBe(true);
        expect(await pendingTxs.get('p1')).toMatchObject({ status: 'broadcast', txid: 'txid-PHASE2' });
    });

    it('drains a record written before the reveal field as the one transaction it names', async () => {
        const pendingTxs = memCollection();
        const old = pairRecord();
        delete old.revealTxHex;
        delete old.revealTxid;
        await pendingTxs.put(old);
        expect(validatePendingTx(old).ok).toBe(true);
        expect(queuedRevealOf(old)).toBeNull();
        const r = drainWith({ pendingTxs }, async () => ({}));

        const out = await r.drain('p1');

        expect(out.broadcast).toBe(true);
        expect(r.encoder.broadcastTx.mock.calls.map(([hex]) => hex)).toEqual(['TX(PHASE1)']);
        const after = await pendingTxs.get('p1');
        expect(after).toMatchObject({ status: 'broadcast', txid: 'txid-PHASE1', txHex: 'TX(PHASE1)' });
        expect(after.commitLanded).toBeUndefined();
        expect('revealTxHex' in after).toBe(false);
    });

    it('rejects a reveal field of the wrong type', () => {
        expect(validatePendingTx(pairRecord({ revealTxHex: 7 })).ok).toBe(false);
        expect(validatePendingTx(pairRecord({ revealTxid: '' })).ok).toBe(false);
        expect(validatePendingTx(pairRecord({ revealTxHex: null, revealTxid: null })).ok).toBe(true);
    });
});

describe.each(['P2SH', 'P2WSH'])('a %s commit refused by a temporary broadcast failure', (encoding) => {
    it('queues the commit with its reveal, and a drain sends both in order', async () => {
        const onBroadcastFailure = vi.fn(async () => true);
        const h = twoPhase(encoding, async () => { throw new Error('ECONNREFUSED'); });

        await expect(h.submit({ onBroadcastFailure })).rejects.toMatchObject({ name: 'BroadcastFailedTransientError' });

        // Nothing past the commit was tried: the reveal is held, not sent.
        expect(h.encoder.broadcastTx.mock.calls.map(([hex]) => hex)).toEqual(['TX(PHASE1)']);
        const [row] = await h.pendingTxs.list();
        expect(row).toMatchObject({
            status: 'queued', txid: 'txid-PHASE1', txHex: 'TX(PHASE1)',
            revealTxHex: 'TX(PHASE2)', revealTxid: 'txid-PHASE2',
        });
        expect(row.commitLanded).toBeUndefined();
        expect(validatePendingTx(row).ok).toBe(true);
        expect(onBroadcastFailure).toHaveBeenCalledTimes(1);
        expect(onBroadcastFailure.mock.calls[0][0]).toMatchObject({
            signedTxHex: 'TX(PHASE1)', txid: 'txid-PHASE1', pendingTxId: row.id,
            revealTxHex: 'TX(PHASE2)', revealTxid: 'txid-PHASE2',
        });

        const r = drainWith(h.vault, async () => ({}));
        const out = await r.drain(row.id);

        expect(out.broadcast).toBe(true);
        expect(r.encoder.broadcastTx.mock.calls.map(([hex]) => hex)).toEqual(['TX(PHASE1)', 'TX(PHASE2)']);
        expect(await h.pendingTxs.get(row.id)).toMatchObject({
            status: 'broadcast', txid: 'txid-PHASE2', commitLanded: true, commitTxid: 'txid-PHASE1',
        });
    });

    it('queues a reveal refused after its commit landed as the reveal alone', async () => {
        const onBroadcastFailure = vi.fn(async () => true);
        const h = twoPhase(encoding, async (hex) => {
            if (hex === 'TX(PHASE2)') throw new Error('ETIMEDOUT');
            return {};
        });

        await expect(h.submit({ onBroadcastFailure })).rejects.toMatchObject({ name: 'BroadcastFailedTransientError' });

        const entry = onBroadcastFailure.mock.calls[0][0];
        expect(entry).toMatchObject({ signedTxHex: 'TX(PHASE2)', commitLanded: true, commitTxid: 'txid-PHASE1' });
        expect(entry.revealTxHex).toBeUndefined();
        const [row] = await h.pendingTxs.list();
        const r = drainWith(h.vault, async () => ({}));
        await r.drain(row.id);
        expect(r.encoder.broadcastTx.mock.calls.map(([hex]) => hex)).toEqual(['TX(PHASE2)']);
    });
});
