// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: wipeWalletStorage across the three shells.
//
// The wipe is the escape hatch behind both "exit the demo" and Locked's
// "forgot password". It has to clear whatever store the *host shell*
// treats as "a wallet already exists", or the reload that follows lands
// on an unlock screen for a vault the user just destroyed. Web and
// extension keep that in localStorage + IndexedDB; the desktop shell
// keeps it in files under userData that no renderer API can touch, so
// there it has to ask the main process through the preload bridge.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wipeWalletStorage } from '../../../packages/core/src/shared/utils/wipeWalletStorage.js';
import { WALLET_LOCAL_KEYS } from '../../../packages/extension/src/background/wipeExtensionStorage.js';
import {
    getLockoutState,
    __resetLockoutPersistenceForTests,
} from '../../../packages/core/src/flows/lockoutTracking.js';

const META_KEY = 'xchain-wallet:vault-meta';
const QUEUE_KEY = 'xchain.broadcastQueue';
// Literal, not the exported constant, so a renamed prefix fails here.
const PRUNED_PREFIX = 'xchain.broadcastQueue.pruned.';
// Literal for the same reason: the Locked screen's failed-unlock ladder.
const LOCKOUT_KEY = 'xchain-wallet:lockout';
const HIGH_LADDER = JSON.stringify({ failedAttempts: 7, lockedUntilMs: Date.now() + 900_000 });

/** Minimal stand-in for the IndexedDB delete request handshake. */
function stubIndexedDB(outcome = 'onsuccess') {
    const deleted = [];
    globalThis.indexedDB = {
        deleteDatabase(name) {
            deleted.push(name);
            const req = {};
            queueMicrotask(() => { req[outcome]?.(); });
            return req;
        },
    };
    return deleted;
}

beforeEach(() => {
    globalThis.localStorage?.clear?.();
    delete globalThis.xchainWalletBridge;
    __resetLockoutPersistenceForTests();
});

afterEach(() => {
    delete globalThis.indexedDB;
    delete globalThis.xchainWalletBridge;
});

describe('wipeWalletStorage on renderer-backed shells', () => {
    it('clears the localStorage vault meta and deletes the IndexedDB vault', async () => {
        globalThis.localStorage.setItem(META_KEY, '{"kdfParams":"x"}');
        const deleted = stubIndexedDB();

        await wipeWalletStorage();

        expect(globalThis.localStorage.getItem(META_KEY)).toBe(null);
        expect(deleted).toEqual(['xchain-wallet']);
    });

    it('resolves when the IndexedDB delete errors or is blocked, since the caller reloads anyway', async () => {
        stubIndexedDB('onerror');
        await expect(wipeWalletStorage()).resolves.toBeUndefined();
        stubIndexedDB('onblocked');
        await expect(wipeWalletStorage()).resolves.toBeUndefined();
    });

    it('removes the page-hosted broadcast queue, which holds signed tx bytes', async () => {
        globalThis.localStorage.setItem(QUEUE_KEY, '{"queues":{"w1":[{"signedTxHex":"00"}]}}');
        stubIndexedDB();
        await wipeWalletStorage();
        expect(globalThis.localStorage.getItem(QUEUE_KEY)).toBe(null);
        expect(WALLET_LOCAL_KEYS).toContain(QUEUE_KEY);
    });

    // One ledger key per walletId, so it is swept by prefix; a freshly loaded
    // Locked page never built the queue store whose seal would erase it.
    it('sweeps the queue\'s pruned-wallet ledger keys and nothing else', async () => {
        globalThis.localStorage.setItem(`${PRUNED_PREFIX}w-a`, '1');
        globalThis.localStorage.setItem(`${PRUNED_PREFIX}w-b`, '1');
        globalThis.localStorage.setItem('unrelated.pref', 'keep');
        stubIndexedDB();
        await wipeWalletStorage();
        expect(globalThis.localStorage.getItem(`${PRUNED_PREFIX}w-a`)).toBe(null);
        expect(globalThis.localStorage.getItem(`${PRUNED_PREFIX}w-b`)).toBe(null);
        expect(globalThis.localStorage.getItem('unrelated.pref')).toBe('keep');
    });

    // An inherited ladder would put the next wallet's first typo at the cap.
    it('clears the Locked screen failed-unlock ladder so the next wallet starts at zero', async () => {
        globalThis.localStorage.setItem(LOCKOUT_KEY, HIGH_LADDER);
        stubIndexedDB();
        await wipeWalletStorage();
        expect(globalThis.localStorage.getItem(LOCKOUT_KEY)).toBe(null);
        expect(getLockoutState()).toEqual({ failedAttempts: 0, lockedUntilMs: 0 });
    });

    it('resolves where there is no IndexedDB at all', async () => {
        await expect(wipeWalletStorage()).resolves.toBeUndefined();
    });

    it('does not invent a shell hook: a bridge without wipeStorage is left alone', async () => {
        stubIndexedDB();
        globalThis.xchainWalletBridge = { sendMessage: vi.fn() };
        await expect(wipeWalletStorage()).resolves.toBeUndefined();
        expect(globalThis.xchainWalletBridge.sendMessage).not.toHaveBeenCalled();
    });
});

describe('wipeWalletStorage on a shell that owns its own store (desktop)', () => {
    it('asks the shell to clear the stores the renderer cannot reach', async () => {
        globalThis.localStorage.setItem(META_KEY, '{"kdfParams":"x"}');
        stubIndexedDB();
        const wipeStorage = vi.fn(async () => ({ ok: true, cleared: ['storage', 'meta'] }));
        globalThis.xchainWalletBridge = { sendMessage: vi.fn(), wipeStorage };

        await wipeWalletStorage();

        // Argument-free by design: the renderer says "wipe", main decides
        // what that means, so a compromised renderer cannot aim it.
        expect(wipeStorage).toHaveBeenCalledTimes(1);
        expect(wipeStorage).toHaveBeenCalledWith();
        expect(globalThis.localStorage.getItem(META_KEY)).toBe(null);
    });

    it('throws when the shell reports the wipe failed, instead of reloading into a stale unlock screen', async () => {
        stubIndexedDB();
        globalThis.xchainWalletBridge = {
            wipeStorage: async () => ({ ok: false, error: 'meta: EPERM' }),
        };

        await expect(wipeWalletStorage()).rejects.toThrow(/meta: EPERM/);
    });

    it('keeps the queued signed txs when the shell wipe fails, since the wallet survives', async () => {
        globalThis.localStorage.setItem(QUEUE_KEY, '{}');
        stubIndexedDB();
        globalThis.xchainWalletBridge = { wipeStorage: async () => ({ ok: false, error: 'EPERM' }) };
        await expect(wipeWalletStorage()).rejects.toThrow(/EPERM/);
        expect(globalThis.localStorage.getItem(QUEUE_KEY)).toBe('{}');
    });

    it('keeps the pruned-wallet ledger with the queue it guards when the shell wipe fails', async () => {
        globalThis.localStorage.setItem(`${PRUNED_PREFIX}w-a`, '1');
        stubIndexedDB();
        globalThis.xchainWalletBridge = { wipeStorage: async () => ({ ok: false, error: 'EPERM' }) };
        await expect(wipeWalletStorage()).rejects.toThrow(/EPERM/);
        expect(globalThis.localStorage.getItem(`${PRUNED_PREFIX}w-a`)).toBe('1');
    });

    it('clears the failed-unlock ladder once the shell wipe succeeds', async () => {
        globalThis.localStorage.setItem(LOCKOUT_KEY, HIGH_LADDER);
        stubIndexedDB();
        globalThis.xchainWalletBridge = { wipeStorage: async () => ({ ok: true }) };
        await wipeWalletStorage();
        expect(globalThis.localStorage.getItem(LOCKOUT_KEY)).toBe(null);
    });

    it('keeps the failed-unlock ladder when the shell wipe fails, since the vault it guards survives', async () => {
        globalThis.localStorage.setItem(LOCKOUT_KEY, HIGH_LADDER);
        stubIndexedDB();
        globalThis.xchainWalletBridge = { wipeStorage: async () => ({ ok: false, error: 'EPERM' }) };
        await expect(wipeWalletStorage()).rejects.toThrow(/EPERM/);
        expect(globalThis.localStorage.getItem(LOCKOUT_KEY)).toBe(HIGH_LADDER);
    });

    it('throws when the shell call itself rejects', async () => {
        stubIndexedDB();
        globalThis.xchainWalletBridge = {
            wipeStorage: async () => { throw new Error('bridge is gone'); },
        };

        await expect(wipeWalletStorage()).rejects.toThrow(/bridge is gone/);
    });

    it('throws on a malformed reply rather than reporting a wipe that may not have happened', async () => {
        stubIndexedDB();
        globalThis.xchainWalletBridge = { wipeStorage: async () => undefined };

        await expect(wipeWalletStorage()).rejects.toThrow(/did not say why/);
    });
});
