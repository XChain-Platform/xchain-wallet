// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createPendingTx } from '../../../packages/core/src/schemas/pendingTx.js';

const KEY = new Uint8Array(32).fill(31);

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function pendingTx() {
    return createPendingTx({
        chain: 'BTC', network: 'mainnet', fromAddress: 'from', toAddress: 'to',
        action: 'SEND', actionSummary: 'Send', psbtHex: '70736274ff',
    });
}

describe('Vault collection update', () => {
    it('updates a collection from queued state inside the write slot', async () => {
        const firstSave = deferred();
        const firstStarted = deferred();
        let saveCalls = 0;
        class PausedBackend extends InMemoryBackend {
            async save(blob) {
                saveCalls += 1;
                if (saveCalls === 1) {
                    firstStarted.resolve();
                    await firstSave.promise;
                }
                await super.save(blob);
            }
        }
        const vault = new Vault({ backend: new PausedBackend(), masterKey: KEY });
        await vault.open();
        const record = pendingTx();
        const put = vault.pendingTxs.put({ ...record, status: 'broadcasting' });
        await firstStarted.promise;
        const update = vault.pendingTxs.update(record.id, (current) => ({
            ...current, status: 'broadcast', txid: 'ab'.repeat(32), broadcastAt: new Date().toISOString(),
        }));

        firstSave.resolve();
        await put;
        await expect(update).resolves.toBe(true);
        expect(await vault.pendingTxs.get(record.id)).toMatchObject({
            status: 'broadcast', txid: 'ab'.repeat(32),
        });
    });

    it('does not persist a refused collection update', async () => {
        const backend = new InMemoryBackend();
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();
        const saveSpy = vi.spyOn(backend, 'save');

        await expect(vault.pendingTxs.update('missing', () => null)).resolves.toBe(false);
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it('rejects an invalid replacement without changing the record', async () => {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: KEY });
        await vault.open();
        const record = pendingTx();
        await vault.pendingTxs.put(record);

        await expect(vault.pendingTxs.update(record.id, (current) => ({ ...current, status: 'unknown' })))
            .rejects.toThrow();
        expect(await vault.pendingTxs.get(record.id)).toEqual(record);
    });
});
