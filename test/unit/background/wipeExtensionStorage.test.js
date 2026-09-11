// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Extension "wipe wallet data": the chrome.storage clear core cannot reach.
//
// The defect this pins: core's wipeWalletStorage() cleared localStorage +
// IndexedDB and handed off to a shell hook the extension never published,
// so the vault, the kdfParams meta, the session master key, the CACHED
// PLAINTEXT PASSWORD and the unlock throttle all survived a wipe the user
// was told had succeeded. Each assertion below is written so it fails on
// the pre-fix shape: a fake chrome.storage seeded with all five secrets is
// read back AFTER the wipe, and a survivor is a red test rather than a
// missing one.

import { describe, it, expect, vi } from 'vitest';

import {
    WALLET_LOCAL_KEYS,
    WIPE_STORAGE_MESSAGE_TYPE,
    wipeExtensionStorage,
    attachWipeStorageListener,
} from '@xchain-wallet/extension/src/background/wipeExtensionStorage.js';
import { installExtensionWipeHook } from '@xchain-wallet/extension/src/storage/wipeHook.js';
import { attachChromeRuntime } from '@xchain-wallet/extension/src/background/ChromeRuntimeAdapter.js';

/** A trusted extension page, the sender shape both listeners gate on. */
const trustedSender = { id: 'ext-id', url: 'chrome-extension://ext-id/popup.html' };

/** A chrome.storage area backed by a plain Map, with real remove/clear. */
function fakeArea(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        map,
        async get(keys) {
            if (keys == null) return Object.fromEntries(map);
            const list = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(list.filter((k) => map.has(k)).map((k) => [k, map.get(k)]));
        },
        async set(items) { for (const [k, v] of Object.entries(items)) map.set(k, v); },
        async remove(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) map.delete(k); },
        async clear() { map.clear(); },
    };
}

function seededStores() {
    const local = fakeArea({
        'xchain-wallet:vault': 'ENCRYPTED-VAULT-BLOB',
        'xchain-wallet:vault-meta': '{"kdfParams":{"salt":"aa"}}',
        'xchain:unlockThrottle': '{"failures":4}',
        'xchain:autolock': '{"armed":true,"idleMs":900000}',
        'xchain.panicMode': 'true',
        'xchain.signThrottle': '{"count":2}',
        'xchain.broadcastQueue': '[]',
        'xchain.logConsole': '[]',
        'xchain.layoutMode': 'sidepanel',
    });
    const session = fakeArea({
        'xchain-wallet:session': 'MASTER-KEY-BYTES',
        'xchain-wallet:session-signing-secret': 'hunter2-the-plaintext-password',
        'xchain.confirmAction': '{"pending":1}',
        'xchain.connectedTabs': '[7]',
    });
    return { local, session };
}

describe('background/wipeExtensionStorage', () => {
    it('erases the vault, the kdfParams meta and the unlock throttle from chrome.storage.local', async () => {
        const { local, session } = seededStores();
        const res = await wipeExtensionStorage({ local, session });
        expect(res.ok).toBe(true);
        expect(await local.get('xchain-wallet:vault')).toEqual({});
        expect(await local.get('xchain-wallet:vault-meta')).toEqual({});
        expect(await local.get('xchain:unlockThrottle')).toEqual({});
    });

    it('erases the session master key AND the cached plaintext password', async () => {
        const { local, session } = seededStores();
        await wipeExtensionStorage({ local, session });
        const survivors = await session.get(null);
        expect(survivors).toEqual({});
        // Named individually so a regression says WHICH secret survived.
        expect(session.map.has('xchain-wallet:session')).toBe(false);
        expect(session.map.has('xchain-wallet:session-signing-secret')).toBe(false);
    });

    it('leaves no wallet-owned local key behind, and leaves the cosmetic one alone', async () => {
        const { local, session } = seededStores();
        await wipeExtensionStorage({ local, session });
        const left = Object.keys(await local.get(null));
        expect(left.filter((k) => WALLET_LOCAL_KEYS.includes(k))).toEqual([]);
        // layoutMode is a window preference, not wallet state.
        expect(left).toEqual(['xchain.layoutMode']);
    });

    it('reports the failure instead of throwing when the store refuses', async () => {
        const local = { remove: async () => { throw new Error('QUOTA_BYTES exceeded'); } };
        const res = await wipeExtensionStorage({ local, session: fakeArea() });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/QUOTA_BYTES/);
    });

    it('reports the failure when chrome.storage.session is present but refuses', async () => {
        const { local } = seededStores();
        const session = { clear: async () => { throw new Error('session store locked'); } };
        const res = await wipeExtensionStorage({ local, session });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/session store locked/);
    });
});

/** Minimal chrome.runtime.onMessage fake that records the listener. */
function fakeRuntime(id = 'ext-id') {
    let listener = null;
    return {
        id,
        onMessage: {
            addListener: (fn) => { listener = fn; },
            removeListener: () => { listener = null; },
        },
        emit(message, sender) {
            return new Promise((resolve) => {
                const handled = listener?.(message, sender, resolve);
                if (!handled) resolve(undefined);
            });
        },
    };
}

describe('background/attachWipeStorageListener', () => {
    const trusted = trustedSender;

    it('wipes and then tears the host down, in that order', async () => {
        const order = [];
        const runtime = fakeRuntime();
        attachWipeStorageListener({
            wipe: async () => { order.push('wipe'); return { ok: true, cleared: ['x'] }; },
            onWiped: () => { order.push('teardown'); },
        }, runtime);
        const res = await runtime.emit({ type: WIPE_STORAGE_MESSAGE_TYPE }, trusted);
        expect(res).toEqual({ ok: true, result: { ok: true, cleared: ['x'] } });
        expect(order).toEqual(['wipe', 'teardown']);
    });

    it('tears the host down even when the clear only partly succeeded', async () => {
        const onWiped = vi.fn();
        const runtime = fakeRuntime();
        attachWipeStorageListener({
            wipe: async () => ({ ok: false, error: 'QUOTA_BYTES exceeded' }),
            onWiped,
        }, runtime);
        const res = await runtime.emit({ type: WIPE_STORAGE_MESSAGE_TYPE }, trusted);
        expect(res.result.ok).toBe(false);
        expect(onWiped).toHaveBeenCalledTimes(1);
    });

    it('refuses a web origin: a page must not be able to erase a wallet', async () => {
        const onWiped = vi.fn();
        const wipe = vi.fn();
        const runtime = fakeRuntime();
        attachWipeStorageListener({ wipe, onWiped }, runtime);
        const res = await runtime.emit(
            { type: WIPE_STORAGE_MESSAGE_TYPE },
            { id: 'ext-id', url: 'https://evil.example/x', tab: { id: 3 } },
        );
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe('FORBIDDEN_SENDER');
        expect(wipe).not.toHaveBeenCalled();
        expect(onWiped).not.toHaveBeenCalled();
    });

    it('ignores message types it does not own', async () => {
        const wipe = vi.fn();
        const runtime = fakeRuntime();
        attachWipeStorageListener({ wipe }, runtime);
        await runtime.emit({ type: 'wallet.lock' }, trusted);
        expect(wipe).not.toHaveBeenCalled();
    });
});

// A store that FAILS is the case the wipe exists for, and both defects below
// reported success over a secret that survived. Each is asserted against the
// real modules composed, because both live in a seam rather than in one module.
describe('a failing store is never reported as a successful wipe', () => {
    const failingLocal = { remove: async () => { throw new Error('QUOTA_BYTES exceeded'); } };

    it('still clears the session store when the local store throws', async () => {
        // The two stores hold different secrets. Sequencing the session clear
        // after the local remove inside one try left the session key resident
        // whenever local failed, so each store is attempted independently now.
        let sessionCleared = false;
        const result = await wipeExtensionStorage({
            local: failingLocal,
            session: { clear: async () => { sessionCleared = true; } },
        });
        expect(sessionCleared).toBe(true);
        expect(result.ok).toBe(false);
    });

    it('answers the bridge with the wipe verdict, not with "the handler ran"', async () => {
        // The ENVELOPE, not res.result.ok: core's wipeShellStorage gates on
        // response.ok !== true, so a hardcoded true told the user a surviving
        // vault was gone. The sibling case above asserts only the inner value,
        // which is why this defect survived it.
        const runtime = fakeRuntime();
        attachWipeStorageListener({
            wipe: () => wipeExtensionStorage({ local: failingLocal, session: { clear: async () => {} } }),
        }, runtime);
        const res = await runtime.emit({ type: WIPE_STORAGE_MESSAGE_TYPE }, trustedSender);
        expect(res.ok).toBe(false);
        expect(res.result.ok).toBe(false);
    });
});

describe('the wipe type is owned by exactly one listener', () => {
    // Both listeners are live at once whenever the wallet is unlocked (the
    // host adapter attaches inside ensureHost, and the demo-exit wipe runs
    // there). Chrome delivers a message to every listener and keeps the
    // FIRST sendResponse, so an overlap would make a wipe that really
    // happened report the host's UnknownMessageTypeError at random.
    it('the host adapter declines the wipe instead of answering it', async () => {
        const runtime = fakeRuntime();
        const host = {
            handle: vi.fn(async () => ({
                ok: false,
                error: { name: 'UnknownMessageTypeError', message: 'unknown type' },
            })),
        };
        attachChromeRuntime(host, runtime);
        const res = await runtime.emit({ type: WIPE_STORAGE_MESSAGE_TYPE }, trustedSender);
        // Declined: the listener returned false, so nothing responded.
        expect(res).toBe(undefined);
        expect(host.handle).not.toHaveBeenCalled();
        // Control: a type the adapter DOES own still reaches the host, so
        // the assertion above is about the skip and not about a dead fake.
        const other = await runtime.emit({ type: 'wallet.list' }, trustedSender);
        expect(host.handle).toHaveBeenCalledTimes(1);
        expect(other.ok).toBe(false);
    });
});

describe('storage/installExtensionWipeHook', () => {
    it('publishes the hook core feature-detects, argument-free', async () => {
        const g = /** @type {any} */ (globalThis);
        const prior = g.xchainWalletBridge;
        delete g.xchainWalletBridge;
        try {
            const send = vi.fn(async () => ({ ok: true, cleared: ['x'] }));
            installExtensionWipeHook({ send });
            expect(typeof g.xchainWalletBridge.wipeStorage).toBe('function');
            const res = await g.xchainWalletBridge.wipeStorage('/etc/passwd', { force: true });
            expect(res).toEqual({ ok: true });
            // Un-aimable, matching the desktop preload contract: the page
            // says "wipe", the worker decides what that means.
            expect(send).toHaveBeenCalledWith(WIPE_STORAGE_MESSAGE_TYPE);
        } finally {
            if (prior) g.xchainWalletBridge = prior; else delete g.xchainWalletBridge;
        }
    });

    it('surfaces a failed wipe as { ok: false } so core throws the user-facing error', async () => {
        const g = /** @type {any} */ (globalThis);
        const prior = g.xchainWalletBridge;
        delete g.xchainWalletBridge;
        try {
            installExtensionWipeHook({ send: async () => ({ ok: false, error: 'QUOTA_BYTES exceeded' }) });
            expect(await g.xchainWalletBridge.wipeStorage()).toEqual({
                ok: false,
                error: 'QUOTA_BYTES exceeded',
            });
            delete g.xchainWalletBridge;
            installExtensionWipeHook({ send: async () => { throw new Error('worker asleep'); } });
            expect(await g.xchainWalletBridge.wipeStorage()).toEqual({
                ok: false,
                error: 'worker asleep',
            });
        } finally {
            if (prior) g.xchainWalletBridge = prior; else delete g.xchainWalletBridge;
        }
    });

    it('never displaces a hook another shell installed', () => {
        const g = /** @type {any} */ (globalThis);
        const prior = g.xchainWalletBridge;
        const existing = async () => ({ ok: true });
        g.xchainWalletBridge = { wipeStorage: existing };
        try {
            installExtensionWipeHook({ send: async () => ({ ok: true }) });
            expect(g.xchainWalletBridge.wipeStorage).toBe(existing);
        } finally {
            if (prior) g.xchainWalletBridge = prior; else delete g.xchainWalletBridge;
        }
    });
});
