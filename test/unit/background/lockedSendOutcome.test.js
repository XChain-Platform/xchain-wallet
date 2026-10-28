// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Another surface locks the wallet while a send is broadcasting. The lock
// closes the vault at once, the send still lands, and its last write to its
// pending record is refused. The next unlock builds a second host over the same
// vault table: it finishes the record from the outcome the first host kept
// outside the vault, and lists that outcome for the unlocked surface. The flow
// is stubbed to settle the way submitAction does after a refused write.

import { describe, it, expect, vi } from 'vitest';

const stubs = vi.hoisted(() => ({ run: null }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, issueToken: (...args) => stubs.run(...args) } };
});

const { createBackgroundHost } = await import(
    '../../../packages/extension/src/background/createBackgroundHost.js'
);
const { createLockedSendOutcomeStore } = await import(
    '../../../packages/extension/src/background/lockedSendOutcomes.js'
);
const { flows } = await import('@xchain-wallet/core');

const CHAIN = 'bitcoin-regtest';
const W = 'w1';

/** A chrome.storage.session double: one per test, shared by both hosts. */
function sessionArea() {
    const items = {};
    return {
        get: (key, cb) => cb({ [key]: items[key] }),
        set: (patch, cb) => { Object.assign(items, JSON.parse(JSON.stringify(patch))); cb(); },
    };
}

/** The vault's PendingTx rows: both hosts' vaults read this one table, as on disk. */
function pendingTable() {
    const rows = new Map();
    return rows;
}

function vaultOver(rows, { wallets = [W] } = {}) {
    let open = true;
    const assertOpen = () => { if (!open) throw new Error('Vault is closed (masterKey cleared)'); };
    return {
        get isOpen() { return open; },
        close() { open = false; },
        pendingTxs: {
            get: async (id) => { assertOpen(); return rows.has(id) ? { ...rows.get(id) } : null; },
            put: async (rec) => { assertOpen(); rows.set(rec.id, { ...rec }); },
            findBy: async (k, v) => { assertOpen(); return [...rows.values()].filter((r) => r[k] === v); },
            list: async () => { assertOpen(); return [...rows.values()]; },
            delete: async (id) => { assertOpen(); rows.delete(id); },
        },
        wallets: {
            get: async (id) => { assertOpen(); return wallets.includes(id) ? { id } : null; },
            list: async () => wallets.map((id) => ({ id })),
        },
        settings: {
            get: async () => ({ schemaVersion: 2, ads: { enabled: false, perChain: {} } }),
            put: async () => {},
        },
    };
}

function makeHost(vault, area) {
    const sdk = { encoder: { broadcastTx: vi.fn() }, waitForAction: vi.fn() };
    const host = createBackgroundHost({
        vault,
        chainRegistry: { get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }), list: () => [] },
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: { load: async () => ({}), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
        lockedSendOutcomes: createLockedSendOutcomeStore({ area }),
    });
    return async (type, request) => host.handle({ type, request });
}

const RECORD = {
    id: 'ptx-1',
    status: 'broadcasting',
    txid: 'aa'.repeat(32),
    txHex: 'beef',
    fromAddress: 'bcrt1qsource',
    actionSummary: 'Send 0.0003 BTC to bcrt1qdest',
};

/** The first host's send: the record reaches its checkpoint, then the lock closes the vault mid-broadcast. */
async function sendAcrossLock({ settle }) {
    const rows = pendingTable();
    const area = sessionArea();
    const first = vaultOver(rows);
    const call = makeHost(first, area);
    stubs.run = async () => {
        rows.set(RECORD.id, { ...RECORD });
        first.close();
        return settle();
    };
    const outcome = await call('action.issue', { walletId: W, chainId: CHAIN, amount: '0.0003', tick: 'BTC' })
        .catch((err) => ({ thrown: err }));
    return { rows, area, outcome };
}

describe('a send that settles after another surface locks the wallet', () => {
    it('finishes the record and lists the outcome at the next unlock', async () => {
        const { rows, area, outcome } = await sendAcrossLock({
            settle: () => ({ txid: RECORD.txid, pendingTxId: RECORD.id, pendingTxWriteError: 'Vault is closed (masterKey cleared)' }),
        });
        expect(outcome.ok).toBe(true);
        expect(outcome.result.txid).toBe(RECORD.txid);
        expect(rows.get(RECORD.id).status).toBe('broadcasting');

        const call = makeHost(vaultOver(rows), area);
        const listed = await call('send.lockedOutcomes.list', { walletId: W });
        expect(listed.ok).toBe(true);
        expect(listed.result).toEqual([expect.objectContaining({
            id: RECORD.id,
            kind: 'sent',
            txid: RECORD.txid,
            amount: '0.0003',
            tick: 'BTC',
            summary: RECORD.actionSummary,
        })]);
        expect(rows.get(RECORD.id)).toMatchObject({ status: 'broadcast', txid: RECORD.txid });
        expect(rows.get(RECORD.id).broadcastAt).toBeTruthy();
        // The note outside the vault carries no signed bytes.
        expect(JSON.stringify(listed.result)).not.toContain(RECORD.txHex);

        await call('send.lockedOutcomes.clear', { ids: [RECORD.id] });
        expect((await call('send.lockedOutcomes.list', { walletId: W })).result).toEqual([]);
    });

    it('keeps a transient failure as queued and hands the error back unchanged', async () => {
        const failure = new Error('connection refused');
        failure.name = flows.BROADCAST_FAILED_TRANSIENT_NAME;
        failure.txid = RECORD.txid;
        failure.pendingTxId = RECORD.id;
        failure.pendingTxWriteError = 'Vault is closed (masterKey cleared)';
        const { rows, area, outcome } = await sendAcrossLock({ settle: () => { throw failure; } });
        expect(outcome.ok).toBe(false);
        expect(outcome.error.name).toBe(flows.BROADCAST_FAILED_TRANSIENT_NAME);

        const call = makeHost(vaultOver(rows), area);
        const listed = await call('send.lockedOutcomes.list', { walletId: W });
        expect(listed.result).toEqual([expect.objectContaining({ id: RECORD.id, kind: 'queued' })]);
        expect(rows.get(RECORD.id).status).toBe('queued');
    });

    it('drops the outcome of a wallet removed before the unlock', async () => {
        const { rows, area } = await sendAcrossLock({
            settle: () => ({ txid: RECORD.txid, pendingTxId: RECORD.id, pendingTxWriteError: 'closed' }),
        });
        const call = makeHost(vaultOver(rows, { wallets: [] }), area);
        expect((await call('send.lockedOutcomes.list', { walletId: W })).result).toEqual([]);
        expect(await createLockedSendOutcomeStore({ area }).list()).toEqual([]);
    });

    it('keeps nothing when the vault is still open', async () => {
        const rows = pendingTable();
        const area = sessionArea();
        const call = makeHost(vaultOver(rows), area);
        stubs.run = async () => ({ txid: RECORD.txid, pendingTxId: RECORD.id, pendingTxWriteError: 'disk full' });
        await call('action.issue', { walletId: W, chainId: CHAIN });
        expect(await createLockedSendOutcomeStore({ area }).list()).toEqual([]);
    });
});
