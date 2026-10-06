// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A two-phase submission broadcasts the commit first and the reveal (or the
// P2SH phase-2 spend) second. When the second leg is refused PERMANENTLY after
// the commit landed, the commit has already spent the user's inputs, so the
// PendingTx must stay 'broadcast' on the commit's txid: retiring it as 'failed'
// stops the spend netting out of the balance. A permanent refusal BEFORE the
// commit landed still retires the record as 'failed'.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const submitWithSignerMock = vi.fn();
vi.mock('../../../packages/core/src/sdk/submitWithSigner.js', async (importOriginal) => ({
    ...(await importOriginal()),
    submitWithSigner: (...args) => submitWithSignerMock(...args),
}));

const { submitAction } = await import('../../../packages/core/src/flows/submitAction.js');
const { BroadcastFailedError } = await import('../../../packages/core/src/sdk/submitWithSigner.js');
const { BROADCAST_FAILED_PERMANENT_NAME } = await import('../../../packages/core/src/flows/broadcastPermanence.js');

function memCollection() {
    const m = new Map();
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, structuredClone(rec)); },
        list: async () => Array.from(m.values()).map((r) => structuredClone(r)),
        delete: async (id) => { m.delete(id); },
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
        },
        signer: { id: 'signer-1', kind: 'software' },
    };
}

function run(h, onBroadcastFailure) {
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

/** @param {string} phase @param {string} txid @param {string} message */
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

async function onlyPending(h) {
    const rows = await h.pendingTxs.list();
    expect(rows).toHaveLength(1);
    return rows[0];
}

// A braced body: a function returned from beforeEach is run as a cleanup hook.
beforeEach(() => { submitWithSignerMock.mockReset(); });

describe('submitAction: permanent refusal after the commit landed', () => {
    const LANDED = [
        ['envelope_reveal', 'envelope_revealing', { commitTxid: 'commit-txid' }],
        ['phase2', 'p2sh_spending', { phase1Txid: 'commit-txid' }],
    ];

    for (const [phase, progress, data] of LANDED) {
        it(`keeps the PendingTx 'broadcast' on the commit txid for a refused ${phase}`, async () => {
            const h = harness();
            const onBroadcastFailure = vi.fn();
            submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
                await onProgress('broadcasting', { txid: 'commit-txid' });
                onProgress(progress, data);
                throw refusal(phase, 'reveal-txid', 'dust');
            });
            const err = await run(h, onBroadcastFailure).catch((e) => e);
            expect(err).toBeInstanceOf(BroadcastFailedError);
            expect(err.name).toBe(BROADCAST_FAILED_PERMANENT_NAME);
            const row = await onlyPending(h);
            expect(row.status).toBe('broadcast');
            expect(typeof row.broadcastAt).toBe('string');
            expect(row.txid).toBe('commit-txid');
            expect(row.error).toMatch(/dust/);
            expect(onBroadcastFailure).not.toHaveBeenCalled();
        });
    }

    it("still retires the PendingTx 'failed' when the commit itself was refused", async () => {
        const h = harness();
        const onBroadcastFailure = vi.fn();
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            await onProgress('broadcasting', { txid: 'commit-txid' });
            throw refusal('phase1', 'commit-txid', 'bad-txns-inputs-missingorspent');
        });
        const err = await run(h, onBroadcastFailure).catch((e) => e);
        expect(err.name).toBe(BROADCAST_FAILED_PERMANENT_NAME);
        const row = await onlyPending(h);
        expect(row.status).toBe('failed');
        expect(row.txHex).toBe('commit-txid-hex');
        expect(onBroadcastFailure).not.toHaveBeenCalled();
    });
});
