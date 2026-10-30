/**
 * @vitest-environment node
 *
 * Node, not jsdom: this is Electron main-process code, driven through the
 * same IPC entry point the preload reaches.
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The desktop runtime holds ONE broadcast-queue store for every host it
// builds, as the extension and web shells do. Each lock drops the host, so a
// store built per host lost the queue, the owed-settlement journal and the
// in-flight claims at every lock, and the next host started empty.

import { describe, it, expect, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRuntime, ensureHost, tearDownHost, wipeRuntimeStores, handleIpcMessage } from '../../../packages/desktop/main/runtime.js';
import { FileBroadcastQueueStorage, broadcastQueuePathFor } from '../../../packages/desktop/main/broadcastQueueStorage.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import { signedTxFor, trackerFor } from '../../helpers/signedTx.js';

const W = 'wallet-1';
const CHAIN = 'bitcoin-testnet';
const SIGNED = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });

/** In-memory byte backend with the load/save/clear shape the runtime takes. */
function memoryBackend(initial = null) {
    let blob = initial;
    return {
        load: async () => blob,
        save: async (b) => { blob = b; },
        clear: async () => { blob = null; },
    };
}

/** A runtime whose session key is cached, so ensureHost opens a real vault. */
function unlockableRuntime({ queueStorage, storageBackend = memoryBackend(), broadcastTx } = {}) {
    const tracker = trackerFor(SIGNED.prevouts, networks.testnet);
    const sdk = {
        encoder: { broadcastTx: broadcastTx ?? (async () => ({ txid: 'test-txid' })), getUTXOs: tracker.getUTXOs },
        wallet: { getBitcoinNetwork: () => networks.testnet },
    };
    return createRuntime({
        storageBackend,
        sessionBackend: memoryBackend(new Uint8Array(32).fill(7)),
        metaBackend: memoryBackend(),
        ...(queueStorage ? { broadcastQueueStorage: queueStorage } : {}),
        chainRegistry: new ChainRegistry(),
        sdkRegistry: {
            get: () => sdk,
            async getSdk() { return sdk; },
            async has() { return true; },
            async listChainIds() { return [CHAIN]; },
        },
    });
}

const call = (runtime, type, request) => handleIpcMessage(runtime, { type, request });
const listedHexes = async (runtime) => (await call(runtime, 'broadcast.queue.list', { walletId: W })).result.map((e) => e.signedTxHex);

describe('desktop runtime shares one broadcast-queue store across hosts', () => {
    it('keeps a queued entry across a lock and unlock', async () => {
        const runtime = unlockableRuntime();
        const store = runtime.broadcastQueueStore;
        await ensureHost(runtime);
        const enq = await call(runtime, 'broadcast.queue.enqueue', { walletId: W, chainId: CHAIN, signedTxHex: SIGNED.txHex, summary: 'A' });
        expect(enq.ok).toBe(true);
        const firstHost = runtime.host;

        tearDownHost(runtime);
        await ensureHost(runtime);

        expect(runtime.host).not.toBe(firstHost);
        expect(runtime.broadcastQueueStore).toBe(store);
        expect(await listedHexes(runtime)).toEqual([SIGNED.txHex]);
    });

    it('keeps an in-flight claim visible to the host built after an unlock', async () => {
        const runtime = unlockableRuntime();
        await ensureHost(runtime);
        runtime.broadcastQueueStore.inFlight.add('claim-1');
        tearDownHost(runtime);
        await ensureHost(runtime);
        expect(runtime.broadcastQueueStore.inFlight.has('claim-1')).toBe(true);
    });

    it('seals the store on wipe and hands the next unlock a fresh one', async () => {
        const runtime = unlockableRuntime();
        await ensureHost(runtime);
        await call(runtime, 'broadcast.queue.enqueue', { walletId: W, chainId: CHAIN, signedTxHex: SIGNED.txHex });
        const sealed = runtime.broadcastQueueStore;

        await wipeRuntimeStores(runtime);
        expect(sealed.sealed).toBe(true);
        expect(runtime.broadcastQueueStore).not.toBe(sealed);
        expect(runtime.broadcastQueueStore.sealed).toBe(false);

        await runtime.sessionBackend.save(new Uint8Array(32).fill(7));
        expect(await ensureHost(runtime)).not.toBe(null);
        expect(await listedHexes(runtime)).toEqual([]);
    });
});

describe('desktop runtime persists its broadcast queue across relaunches', () => {
    it('restores identical raw transaction bytes and retry state in a fresh runtime', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'xchain-desktop-broadcast-queue-'));
        const path = broadcastQueuePathFor(dir);
        const first = unlockableRuntime({
            queueStorage: new FileBroadcastQueueStorage(path),
            broadcastTx: async () => { throw new Error('ECONNREFUSED'); },
        });
        await ensureHost(first);
        const enqueued = await call(first, 'broadcast.queue.enqueue', {
            walletId: W,
            chainId: CHAIN,
            signedTxHex: SIGNED.txHex,
            summary: 'Raw signed transaction',
        });
        expect(enqueued.ok).toBe(true);
        const failed = await call(first, 'broadcast.queue.broadcast', { walletId: W, id: enqueued.result.id });
        expect(failed.ok).toBe(false);
        const before = { ...first.broadcastQueueStore.queues.get(W)[0] };
        expect(before).toMatchObject({
            signedTxHex: SIGNED.txHex,
            retryAttempt: 1,
            nextRetryAt: expect.any(Number),
        });
        tearDownHost(first);

        const relaunched = unlockableRuntime({
            queueStorage: new FileBroadcastQueueStorage(path),
        });
        await ensureHost(relaunched);
        const listed = await call(relaunched, 'broadcast.queue.list', { walletId: W });

        expect(listed.ok).toBe(true);
        expect(listed.result).toEqual([before]);
    });

    it('logs a warning and starts empty when the queue file is corrupt', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'xchain-desktop-broadcast-corrupt-'));
        const path = broadcastQueuePathFor(dir);
        await writeFile(path, '{not-json', 'utf8');
        const logger = { warn: vi.fn() };
        const runtime = unlockableRuntime({
            queueStorage: new FileBroadcastQueueStorage(path, logger),
        });
        await ensureHost(runtime);

        await expect(call(runtime, 'broadcast.queue.list', { walletId: W })).resolves.toEqual({
            ok: true,
            result: [],
        });
        expect(logger.warn).toHaveBeenCalledOnce();
        expect(logger.warn.mock.calls[0][0]).toMatch(/starting with an empty queue/);
    });

    it('reports an unreadable file write through the queue persistence verdict', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'xchain-desktop-broadcast-refused-'));
        const blockedParent = join(dir, 'not-a-directory');
        await writeFile(blockedParent, 'blocked', 'utf8');
        const logger = { warn: vi.fn() };
        const runtime = unlockableRuntime({
            queueStorage: new FileBroadcastQueueStorage(
                join(blockedParent, 'broadcast-queue.json'),
                logger,
            ),
        });
        await ensureHost(runtime);

        const result = await call(runtime, 'broadcast.queue.enqueue', {
            walletId: W,
            chainId: CHAIN,
            signedTxHex: SIGNED.txHex,
        });

        expect(result.ok).toBe(true);
        expect(result.result.persisted).toBe(false);
        expect(logger.warn).toHaveBeenCalledOnce();
    });
});
