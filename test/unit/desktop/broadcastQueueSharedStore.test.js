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

import { describe, it, expect } from 'vitest';

import { createRuntime, ensureHost, tearDownHost, wipeRuntimeStores, handleIpcMessage } from '../../../packages/desktop/main/runtime.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';

const W = 'wallet-1';
const CHAIN = 'bitcoin-testnet';

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
function unlockableRuntime() {
    return createRuntime({
        storageBackend: memoryBackend(),
        sessionBackend: memoryBackend(new Uint8Array(32).fill(7)),
        metaBackend: memoryBackend(),
        chainRegistry: new ChainRegistry(),
        sdkRegistry: { async getSdk() { throw new Error('offline'); }, async has() { return false; }, async listChainIds() { return []; } },
    });
}

const call = (runtime, type, request) => handleIpcMessage(runtime, { type, request });
const listedHexes = async (runtime) => (await call(runtime, 'broadcast.queue.list', { walletId: W })).result.map((e) => e.signedTxHex);

describe('desktop runtime shares one broadcast-queue store across hosts', () => {
    it('keeps a queued entry across a lock and unlock', async () => {
        const runtime = unlockableRuntime();
        const store = runtime.broadcastQueueStore;
        await ensureHost(runtime);
        const enq = await call(runtime, 'broadcast.queue.enqueue', { walletId: W, chainId: CHAIN, signedTxHex: 'hex-A', summary: 'A' });
        expect(enq.ok).toBe(true);
        const firstHost = runtime.host;

        tearDownHost(runtime);
        await ensureHost(runtime);

        expect(runtime.host).not.toBe(firstHost);
        expect(runtime.broadcastQueueStore).toBe(store);
        expect(await listedHexes(runtime)).toEqual(['hex-A']);
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
        await call(runtime, 'broadcast.queue.enqueue', { walletId: W, chainId: CHAIN, signedTxHex: 'hex-B' });
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
