// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitWithSignerMock = vi.fn();
vi.mock('../../../packages/core/src/sdk/submitWithSigner.js', async (importOriginal) => ({
    ...(await importOriginal()),
    submitWithSigner: (...args) => submitWithSignerMock(...args),
}));

const { submitAction } = await import('../../../packages/core/src/flows/submitAction.js');
const { BroadcastFailedError } = await import('../../../packages/core/src/sdk/submitWithSigner.js');
const {
    BROADCAST_FAILED_TRANSIENT_NAME,
    BROADCAST_FAILED_TRANSIENT_UNSAVED_NAME,
    broadcastFailureKindFromError,
} = await import('../../../packages/core/src/flows/broadcastPermanence.js');

function memoryCollection({ refuseQueued = false } = {}) {
    const records = new Map();
    return {
        async put(record) {
            if (refuseQueued && record.status === 'queued') throw new Error('vault refused');
            records.set(record.id, structuredClone(record));
        },
        async get(id) { return records.get(id) ?? null; },
        async list() { return [...records.values()].map((record) => structuredClone(record)); },
        async findBy(field, value) {
            return [...records.values()].filter((record) => record[field] === value);
        },
    };
}

function harness({ refuseQueued = false } = {}) {
    const pendingTxs = memoryCollection({ refuseQueued });
    return {
        pendingTxs,
        vault: {
            pendingTxs,
            settings: { get: async () => ({}), put: async () => {} },
        },
        chainRegistry: {
            get: () => ({ coin: 'bitcoin', networkKind: 'regtest' }),
        },
    };
}

function broadcastFailure() {
    return new BroadcastFailedError({
        cause: new Error('ECONNREFUSED'),
        signedTxHex: 'signed-transaction',
        txid: 'txid-1',
        chainId: 'bitcoin-regtest',
        signedAt: 1,
        encoding: 'op_return',
    });
}

function run(h, { pending = false, queueSaved }) {
    return submitAction({
        vault: h.vault,
        walletId: 'wallet-1',
        chainRegistry: h.chainRegistry,
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        actionData: { action: 'BROADCAST', params: { MESSAGE: 'hello' } },
        encoderOpts: { pubkey: 'ab' },
        prebuiltPsbt: {
            psbtHex: 'psbt',
            encoding: 'OP_RETURN',
            actionString: 'BROADCAST|0|hello',
            version: 0,
            deferredFeeOutput: null,
            deferredOutputs: [],
            adsDonation: null,
        },
        signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
        signer: { id: 'signer-1', kind: 'hardware' },
        ...(pending ? {
            pendingTxMeta: {
                fromAddress: 'bcrt1qsource',
                toAddress: null,
                actionSummary: 'Broadcast',
            },
        } : {}),
        onBroadcastFailure: vi.fn(async () => queueSaved),
    });
}

beforeEach(() => {
    submitWithSignerMock.mockReset();
    submitWithSignerMock.mockRejectedValue(broadcastFailure());
});

describe('submitAction transient broadcast durability verdict', () => {
    it('marks signed bytes unsaved when neither durable surface holds them', async () => {
        const error = await run(harness(), { queueSaved: false }).catch((err) => err);

        expect(error.name).toBe(BROADCAST_FAILED_TRANSIENT_UNSAVED_NAME);
        expect(broadcastFailureKindFromError(error)).toBe('transient');
    });

    it('keeps the ordinary transient name when the queue blob lands', async () => {
        const error = await run(harness(), { queueSaved: true }).catch((err) => err);

        expect(error.name).toBe(BROADCAST_FAILED_TRANSIENT_NAME);
    });

    it('keeps the ordinary transient name when the PendingTx write lands', async () => {
        const h = harness();
        const error = await run(h, { pending: true, queueSaved: false }).catch((err) => err);

        expect(error.name).toBe(BROADCAST_FAILED_TRANSIENT_NAME);
        expect((await h.pendingTxs.list()).at(-1)).toMatchObject({
            status: 'queued',
            txHex: 'signed-transaction',
        });
    });

    it('marks signed bytes unsaved when both durable writes are refused', async () => {
        const error = await run(harness({ refuseQueued: true }), {
            pending: true,
            queueSaved: false,
        }).catch((err) => err);

        expect(error.name).toBe(BROADCAST_FAILED_TRANSIENT_UNSAVED_NAME);
        expect(error.pendingTxWriteError).toMatch(/vault refused/);
    });
});
