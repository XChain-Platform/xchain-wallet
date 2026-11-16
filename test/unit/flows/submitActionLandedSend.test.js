// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A send that is already on the network reports success even when the vault
// refuses the closing bookkeeping write (a full disk, a storage backend that
// went away between the broadcast and the write). Rejecting there tells the
// user the send failed while the coins have moved, and invites a second send.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitWithSignerMock = vi.fn();
vi.mock('../../../packages/core/src/sdk/submitWithSigner.js', async (importOriginal) => ({
    ...(await importOriginal()),
    submitWithSigner: (...args) => submitWithSignerMock(...args),
}));

const { submitAction } = await import('../../../packages/core/src/flows/submitAction.js');

function harness({ refuseStatus = null, sequence = 0xfffffffd } = {}) {
    const records = new Map();
    const pendingTxs = {
        async put(record) {
            if (refuseStatus && record.status === refuseStatus) throw new Error('QuotaExceededError');
            records.set(record.id, structuredClone(record));
        },
        async get(id) { return records.get(id) ?? null; },
        async list() { return [...records.values()].map((record) => structuredClone(record)); },
        async findBy(field, value) { return [...records.values()].filter((r) => r[field] === value); },
    };
    const sdkRegistry = {
        get: () => ({
            wallet: {
                decomposePsbt: () => ({
                    inputs: [{ sequence, value: 10000 }],
                    outputs: [{ address: 'bcrt1qsource', value: 9000 }],
                }),
            },
        }),
    };
    return {
        pendingTxs,
        vault: { pendingTxs, settings: { get: async () => ({}), put: async () => {} } },
        chainRegistry: { get: () => ({ coin: 'bitcoin', networkKind: 'regtest' }) },
        sdkRegistry,
    };
}

function run(h) {
    return submitAction({
        vault: h.vault,
        walletId: 'wallet-1',
        chainRegistry: h.chainRegistry,
        sdkRegistry: h.sdkRegistry,
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
        pendingTxMeta: { fromAddress: 'bcrt1qsource', toAddress: null, actionSummary: 'Broadcast' },
    });
}

beforeEach(() => {
    submitWithSignerMock.mockReset();
    submitWithSignerMock.mockResolvedValue({ txid: 'txid-1', signed: { txHex: 'signed-transaction' } });
});

describe('submitAction after the transaction is on the network', () => {
    it('resolves with the txid when the closing PendingTx write is refused', async () => {
        const h = harness({ refuseStatus: 'broadcast' });
        const result = await run(h).catch((err) => err);

        expect(result).not.toBeInstanceOf(Error);
        expect(result.txid).toBe('txid-1');
        expect(result.pendingTxId).toEqual(expect.any(String));
        expect(result.pendingTxWriteError).toMatch(/QuotaExceededError/);
    });

    it('carries no write error when the closing write lands', async () => {
        const h = harness();
        const result = await run(h);

        expect(result.txid).toBe('txid-1');
        expect(result.pendingTxWriteError).toBeUndefined();
        expect((await h.pendingTxs.list()).at(-1)).toMatchObject({ status: 'broadcast', txid: 'txid-1' });
    });

    it.each([
        [0xfffffffd, true],
        [0xffffffff, false],
    ])('records a hardware PSBT and its bytes-derived rbf flag for sequence %i', async (sequence, rbf) => {
        const h = harness({ sequence });
        submitWithSignerMock.mockImplementationOnce(async (opts) => {
            await opts.beforeBroadcast({
                signed: { signedPsbtHex: '', txHex: 'signed-transaction', txid: 'txid-1' },
                revealSigned: null,
                psbtHex: 'unsigned-hardware-psbt',
                finalPsbtHex: 'unsigned-hardware-psbt',
            });
            return { txid: 'txid-1', signed: { txHex: 'signed-transaction' } };
        });

        await run(h);

        expect((await h.pendingTxs.list()).at(-1)).toMatchObject({
            psbtHex: 'unsigned-hardware-psbt',
            rbf,
            params: { MESSAGE: 'hello' },
        });
    });
});
