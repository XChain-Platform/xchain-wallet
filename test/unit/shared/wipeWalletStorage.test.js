// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: wipeWalletStorage across the three shells .
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

const META_KEY = 'xchain-wallet:vault-meta';

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
