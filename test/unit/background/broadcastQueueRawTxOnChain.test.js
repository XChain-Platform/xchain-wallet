// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A raw signed transaction (a queue entry that names no PendingTx) whose
// removal after a landed broadcast failed to save comes back from the blob on
// the next boot. Nothing in the vault can judge it, so the first list asks the
// chain for its txid: one a block carries leaves the queue instead of being
// offered as unsent for a second send.

import { describe, it, expect, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const CHAIN = 'bitcoin-regtest';
const W = 'w1';
const SENT = 'a'.repeat(64);
const UNSENT = 'b'.repeat(64);
const COMMIT = 'c'.repeat(64);

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function memStorage(initial) {
    let backing = JSON.parse(JSON.stringify(initial));
    const saves = [];
    return {
        saves,
        current: () => backing,
        adapter: {
            load: async () => JSON.parse(JSON.stringify(backing)),
            save: async (snapshot) => {
                backing = JSON.parse(JSON.stringify(snapshot));
                saves.push(backing);
            },
            clear: async () => { backing = {}; },
        },
    };
}

function makeHost({ storage, getTxBlock, getTransaction }) {
    const sdk = {
        encoder: { broadcastTx: vi.fn(), ...(getTxBlock ? { getTxBlock } : {}) },
        ...(getTransaction ? { getTransaction } : {}),
    };
    const host = createBackgroundHost({
        vault: {
            pendingTxs: { get: async () => null, findBy: async () => [], put: async () => {} },
            wallets: { list: async () => [{ id: W }], get: async (id) => ({ id, importedKeys: [] }) },
            accounts: { findBy: async () => [] },
            addresses: { list: async () => [] },
            settings: { get: async () => ({ schemaVersion: 2 }), put: async () => {} },
        },
        chainRegistry: { get: () => ({ id: CHAIN }), list: () => [], chainIdFor: () => CHAIN },
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: storage.adapter,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return async () => (await host.handle({ type: 'broadcast.queue.list', request: { walletId: W } })).result;
}

const raw = (id, txid, extra = {}) => ({
    id, chainId: CHAIN, signedTxHex: `hex-${id}`, summary: `Raw ${id}`, signedAt: 1, txid, ...extra,
});

describe('a queued raw transaction the chain already carries', () => {
    it('leaves the queue on the first list after a restart, and the blob drops it', async () => {
        const storage = memStorage({ [W]: [raw('q-sent', SENT), raw('q-unsent', UNSENT)] });
        const getTxBlock = vi.fn(async (txid) => (txid === SENT ? { block_index: 120 } : null));
        const list = makeHost({ storage, getTxBlock });

        const listed = await list();
        await settle();

        expect(listed.map((e) => e.id)).toEqual(['q-unsent']);
        expect(storage.current()[W].map((e) => e.id)).toEqual(['q-unsent']);
        expect(getTxBlock).toHaveBeenCalledWith(SENT);
    });

    it('asks the explorer when the encoder has no answer', async () => {
        const storage = memStorage({ [W]: [raw('q-sent', SENT)] });
        const getTransaction = vi.fn(async (txid) => (txid === SENT ? { data: { block_index: 7 } } : null));
        const list = makeHost({ storage, getTxBlock: async () => null, getTransaction });

        expect(await list()).toEqual([]);
        expect(getTransaction).toHaveBeenCalledWith(SENT, 'tx_hash');
    });

    it('keeps the entry when the lookup fails, and asks once per worker', async () => {
        const storage = memStorage({ [W]: [raw('q-sent', SENT)] });
        const getTxBlock = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
        const list = makeHost({ storage, getTxBlock });

        expect((await list()).map((e) => e.id)).toEqual(['q-sent']);
        expect((await list()).map((e) => e.id)).toEqual(['q-sent']);
        expect(getTxBlock).toHaveBeenCalledTimes(1);
    });

    it('never judges a two-phase entry by its commit txid', async () => {
        const storage = memStorage({ [W]: [raw('q-commit', COMMIT, { revealTxHex: 'hex-reveal' })] });
        const getTxBlock = vi.fn(async () => ({ block_index: 9 }));
        const list = makeHost({ storage, getTxBlock });

        expect((await list()).map((e) => e.id)).toEqual(['q-commit']);
        expect(getTxBlock).not.toHaveBeenCalled();
    });
});
