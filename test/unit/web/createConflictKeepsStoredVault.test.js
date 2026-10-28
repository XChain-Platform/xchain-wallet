// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Two creates on one page can both pass the fresh-device check. The first to
// store its vault wins and the second save is refused as a conflict. The
// refused create must leave the stored vault alone: clearing it as a partial
// write would erase the wallet the first create just made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const state = vi.hoisted(() => ({
    storageBlob: null,
    meta: null,
    /** When set, the next blob save stores this blob as another create and is refused. */
    rivalBlob: null,
    conflictError: null,
    /** When set, the kdf params save is refused with this error. */
    metaError: null,
}));

vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        deriveMasterKeyAsync: async (password, params) => {
            actual.validateKdfParams(params);
            const h = createHash('sha256');
            h.update(password);
            h.update(actual.base64ToBytes(params.salt));
            return new Uint8Array(h.digest());
        },
        deriveMasterKey: () => { throw new Error('sync KDF reached in a web lane'); },
    };
});

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    class InertWatcher {
        async start() { /* no polling in a unit test */ }
        stop() { /* nothing started */ }
        refresh() { return Promise.resolve(); }
    }
    return {
        ...actual,
        notifications: {
            ...actual.notifications,
            NotificationService: InertWatcher,
            PriceAlertWatcher: InertWatcher,
            GovernancePollWatcher: InertWatcher,
            CoinpayAutopayWatcher: InertWatcher,
            DeadlineWatcher: InertWatcher,
            DispenserEscrowWatcher: InertWatcher,
        },
    };
});

vi.mock('../../../packages/web/src/storage/backends.js', () => ({
    createStorageBackend: () => ({
        load: async () => state.storageBlob,
        save: async (blob) => {
            if (state.rivalBlob) {
                state.storageBlob = state.rivalBlob;
                state.rivalBlob = null;
                throw state.conflictError;
            }
            state.storageBlob = blob;
        },
        clear: async () => { state.storageBlob = null; },
    }),
    createMetaBackend: () => ({
        load: async () => state.meta,
        save: async (m) => {
            if (state.metaError) throw state.metaError;
            state.meta = m;
        },
        clear: async () => { state.meta = null; },
    }),
    installNativeWipeHook: () => {},
    installNativeScreenGuard: () => {},
}));

const { VaultConflictError } = await import('../../../packages/core/src/storage/backend.js');
const { createWalletLocal, lockWalletLocal } = await import('../../../packages/web/src/hostBridge.js');

beforeEach(async () => {
    await lockWalletLocal();
    state.storageBlob = null;
    state.meta = null;
    state.rivalBlob = null;
    state.conflictError = new VaultConflictError('the stored vault changed');
    state.metaError = null;
    vi.stubGlobal('fetch', async () => { throw new Error('offline unit test'); });
});

afterEach(async () => {
    await lockWalletLocal();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('a create that loses the save conflict', () => {
    it('keeps the vault the other create stored', async () => {
        const rival = new Uint8Array([7, 7, 7, 7]);
        state.rivalBlob = rival;
        await expect(createWalletLocal({ password: 'a device password' })).rejects.toBeInstanceOf(VaultConflictError);
        expect(state.storageBlob).toBe(rival);
    });

    it('still clears its own partial vault on any other failure', async () => {
        state.metaError = new Error('disk full');
        await expect(createWalletLocal({ password: 'a device password' })).rejects.toThrow('disk full');
        expect(state.storageBlob).toBeNull();
    });
});
