// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The pending file upload routes against a real Vault, not a mocked one: the
// list and discard routes once called collection methods the vault does not
// have, and every Attach artwork, Publish file and Gated publish form showed
// "could not continue" on mount because the stubs had them.

import { describe, expect, it } from 'vitest';
import {
    handleDiscardPendingFileUpload,
    handleListPendingFileUploads,
} from '../../../packages/core/src/flows/fileMultipartRoutes.js';
import { createPendingFileUpload } from '../../../packages/core/src/schemas/pendingFileUpload.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

function record(walletId) {
    return createPendingFileUpload({
        walletId,
        chainId: 'bitcoin-regtest',
        sourceAddress: 'bcrt1qsource',
        originalSha256: 'a'.repeat(64),
        fileHash: 'b'.repeat(64),
        meta: { name: `${walletId}.png`, type: 'image/png' },
        gate: null,
        compression: '',
        totalParts: 2,
        totalBytes: 500_000,
        partDigests: ['c'.repeat(64), 'd'.repeat(64)],
        fundingOutputs: [21_000, 22_000, 23_000],
        linkTarget: null,
    });
}

async function vaultWith(records) {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32) });
    await vault.open();
    for (const item of records) await vault.pendingFileUploads.put(item);
    return vault;
}

describe('pending file upload routes on a real vault', () => {
    it('lists only the asking wallet\'s uploads', async () => {
        const mine = record('wallet-1');
        const vault = await vaultWith([mine, record('wallet-2')]);
        const { uploads } = await handleListPendingFileUploads({ walletId: 'wallet-1' }, { vault });
        expect(uploads.map(({ id }) => id)).toEqual([mine.id]);
    });

    it('discards an owned upload from the vault', async () => {
        const mine = record('wallet-1');
        const vault = await vaultWith([mine]);
        await expect(handleDiscardPendingFileUpload(
            { walletId: 'wallet-1', id: mine.id }, { vault },
        )).resolves.toEqual({ removed: true, paidTransactions: 0 });
        expect(await vault.pendingFileUploads.get(mine.id)).toBeNull();
    });
});
