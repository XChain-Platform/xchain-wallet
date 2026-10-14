// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    discardQueuedBroadcast,
    drainQueuedBroadcast,
    enqueueSignedTx,
    listQueuedBroadcasts,
    NoQueuedTxError,
} from '../../../packages/core/src/flows/queuedBroadcast.js';

function collection(initial = []) {
    const records = new Map(initial.map((row) => [row.id, structuredClone(row)]));
    return {
        get: vi.fn(async (id) => records.has(id) ? structuredClone(records.get(id)) : null),
        put: vi.fn(async (row) => { records.set(row.id, structuredClone(row)); }),
        delete: vi.fn(async (id) => records.delete(id)),
        findBy: vi.fn(async (field, value) => [...records.values()]
            .filter((row) => row[field] === value).map((row) => structuredClone(row))),
        records,
    };
}

function queued(overrides = {}) {
    return {
        id: 'queued-1',
        chain: 'bitcoin',
        network: 'regtest',
        fromAddress: 'source',
        toAddress: 'destination',
        action: 'SEND',
        params: {},
        actionSummary: 'Send token',
        psbtHex: 'psbt',
        txHex: 'deadbeef',
        txid: null,
        status: 'queued',
        error: null,
        broadcastAt: null,
        ...overrides,
    };
}

const chainRegistry = {
    chainIdFor: (coin, network) => coin === 'bitcoin' && network === 'regtest'
        ? 'bitcoin-regtest'
        : null,
    get: () => ({ coin: 'bitcoin', networkKind: 'regtest' }),
};

function drainHarness(row = queued(), broadcastTx = vi.fn(async () => ({ txid: 'tx-1' }))) {
    const pendingTxs = collection([row]);
    return {
        pendingTxs,
        args: {
            vault: { pendingTxs },
            sdkRegistry: { get: () => ({ encoder: { broadcastTx } }) },
            chainRegistry,
            pendingTxId: row.id,
        },
        broadcastTx,
    };
}

describe('enqueueSignedTx edge branches', () => {
    it.each([
        [{}, /vault is required/],
        [{ vault: { pendingTxs: collection() }, txHex: '' }, /txHex is required/],
        [{ vault: { pendingTxs: collection() }, txHex: 123 }, /txHex is required/],
    ])('validates input %#', async (input, message) => {
        await expect(enqueueSignedTx(input)).rejects.toThrow(message);
    });

    it('creates a queued record with the signed bytes', async () => {
        const pendingTxs = collection();
        const result = await enqueueSignedTx({
            vault: { pendingTxs },
            chain: 'bitcoin',
            network: 'regtest',
            fromAddress: 'source',
            toAddress: 'destination',
            action: 'SEND',
            actionSummary: 'Send token',
            txHex: 'deadbeef',
            psbtHex: 'psbt',
        });

        expect(result.pendingTx).toMatchObject({ status: 'queued', txHex: 'deadbeef', psbtHex: 'psbt' });
        expect(await pendingTxs.get(result.pendingTxId)).toMatchObject({ status: 'queued' });
    });

    it('updates an existing record while preserving its original PSBT', async () => {
        const existing = queued({ id: 'existing', status: 'failed', psbtHex: 'original', error: 'old' });
        const pendingTxs = collection([existing]);

        const result = await enqueueSignedTx({
            vault: { pendingTxs }, txHex: 'replacement', psbtHex: 'new', existingPendingTxId: 'existing',
        });

        expect(result.pendingTx).toMatchObject({
            id: 'existing', status: 'queued', txHex: 'replacement', psbtHex: 'original', error: null,
        });
    });

    it('uses the supplied PSBT when the existing record has none', async () => {
        const pendingTxs = collection([queued({ id: 'existing', psbtHex: '' })]);
        const result = await enqueueSignedTx({
            vault: { pendingTxs }, txHex: 'replacement', psbtHex: 'fallback', existingPendingTxId: 'existing',
        });
        expect(result.pendingTx.psbtHex).toBe('fallback');
    });

    it('throws a typed error when the record to update disappeared', async () => {
        await expect(enqueueSignedTx({
            vault: { pendingTxs: collection() }, txHex: 'signed', existingPendingTxId: 'missing',
        })).rejects.toBeInstanceOf(NoQueuedTxError);
    });
});

describe('listQueuedBroadcasts filter branches', () => {
    const rows = [
        queued({ id: 'btc-regtest' }),
        queued({ id: 'btc-mainnet', network: 'mainnet' }),
        queued({ id: 'literal-chain', chain: 'custom-chain' }),
    ];

    it('returns every queued row when no chain filter is requested', async () => {
        const pendingTxs = collection(rows);
        await expect(listQueuedBroadcasts({ vault: { pendingTxs } })).resolves.toHaveLength(3);
    });

    it('matches descriptor coin and network when the chain is registered', async () => {
        const pendingTxs = collection(rows);
        await expect(listQueuedBroadcasts({
            vault: { pendingTxs }, chainId: 'bitcoin-regtest', chainRegistry,
        })).resolves.toEqual([expect.objectContaining({ id: 'btc-regtest' })]);
    });

    it('falls back to the stored chain field for an unknown chain id', async () => {
        const pendingTxs = collection(rows);
        await expect(listQueuedBroadcasts({
            vault: { pendingTxs },
            chainId: 'custom-chain',
            chainRegistry: { get: () => null },
        })).resolves.toEqual([expect.objectContaining({ id: 'literal-chain' })]);
    });
});

describe('drainQueuedBroadcast validation and callback fallbacks', () => {
    it.each([
        [{}, /vault is required/],
        [{ vault: {} }, /sdkRegistry is required/],
        [{ vault: {}, sdkRegistry: {} }, /chainRegistry is required/],
        [{ vault: {}, sdkRegistry: {}, chainRegistry: {}, pendingTxId: '' }, /pendingTxId is required/],
    ])('validates input %#', async (input, message) => {
        await expect(drainQueuedBroadcast(input)).rejects.toThrow(message);
    });

    it.each([
        [queued({ status: 'broadcast' }), /is not queued/],
        [queued({ txHex: '' }), /has no txHex/],
    ])('rejects an unusable queued record %#', async (row, message) => {
        const h = drainHarness(row);
        await expect(drainQueuedBroadcast(h.args)).rejects.toThrow(message);
        expect(h.broadcastTx).not.toHaveBeenCalled();
    });

    it('rejects a record whose stored coin and network no longer map to a chain', async () => {
        const h = drainHarness(queued({ chain: 'unknown' }));
        await expect(drainQueuedBroadcast(h.args)).rejects.toThrow(/no registered chain/);
        expect(h.broadcastTx).not.toHaveBeenCalled();
    });

    it('swallows progress callback failures before and after a successful broadcast', async () => {
        const h = drainHarness();
        const onProgress = vi.fn(() => { throw new Error('render callback failed'); });

        await expect(drainQueuedBroadcast({ ...h.args, onProgress })).resolves.toMatchObject({
            broadcast: true, error: null,
        });
        expect(onProgress).toHaveBeenCalledTimes(2);
        expect(h.broadcastTx).toHaveBeenCalledTimes(1);
    });

    it('stringifies a non-Error broadcast rejection and leaves it retryable', async () => {
        const h = drainHarness(queued(), vi.fn(async () => { throw null; }));
        await expect(drainQueuedBroadcast(h.args)).resolves.toMatchObject({
            broadcast: false, error: 'null', permanence: 'transient',
        });
        expect((await h.pendingTxs.get('queued-1')).status).toBe('queued');
    });
});

describe('discardQueuedBroadcast idempotency and in-flight branches', () => {
    it.each([
        [{}, /vault is required/],
        [{ vault: {}, pendingTxId: '' }, /pendingTxId is required/],
    ])('validates input %#', async (input, message) => {
        await expect(discardQueuedBroadcast(input)).rejects.toThrow(message);
    });

    it('returns false for a missing or terminal record', async () => {
        const pendingTxs = collection([queued({ id: 'done', status: 'broadcast' })]);
        await expect(discardQueuedBroadcast({ vault: { pendingTxs }, pendingTxId: 'missing' }))
            .resolves.toBe(false);
        await expect(discardQueuedBroadcast({ vault: { pendingTxs }, pendingTxId: 'done' }))
            .resolves.toBe(false);
        expect(pendingTxs.delete).not.toHaveBeenCalled();
    });

    it('deletes an unclaimed queued record', async () => {
        const pendingTxs = collection([queued()]);
        await expect(discardQueuedBroadcast({ vault: { pendingTxs }, pendingTxId: 'queued-1' }))
            .resolves.toBe(true);
        expect(await pendingTxs.get('queued-1')).toBeNull();
    });

    it('keeps a record while its network broadcast is in flight', async () => {
        let resolveBroadcast;
        let signalEntered;
        const entered = new Promise((resolve) => { signalEntered = resolve; });
        const broadcastTx = vi.fn(() => {
            signalEntered();
            return new Promise((resolve) => { resolveBroadcast = resolve; });
        });
        const h = drainHarness(queued(), broadcastTx);
        const draining = drainQueuedBroadcast(h.args);
        await entered;

        await expect(discardQueuedBroadcast({
            vault: h.args.vault, pendingTxId: 'queued-1',
        })).resolves.toBe(false);
        expect(h.pendingTxs.delete).not.toHaveBeenCalled();

        resolveBroadcast({ txid: 'tx-1' });
        await draining;
    });
});
