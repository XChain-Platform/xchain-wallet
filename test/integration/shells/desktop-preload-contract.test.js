// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shell integration: the Electron preload contract (G164 / ).
//
// `packages/desktop/preload.cjs` is the ONLY thing the desktop renderer can
// reach main through (§9.3.2: contextIsolation on, nodeIntegration off, keys
// never cross the boundary). It is also the one file in the desktop shell that
// cannot be exercised by importing it: it runs for its side effects, it is
// CommonJS on purpose, and everything it does goes through `require('electron')`
// -- which outside Electron resolves to a path string, so a plain import would
// throw before exposing anything. So it was covered only by smokes that read
// its source text, which cannot tell you whether a bridge actually forwards.
//
// This drives the real file: `require('electron')` is intercepted at the module
// loader, the preload runs, and the objects it hands to `exposeInMainWorld` are
// then driven the way the renderer drives them -- including through the real
// renderer-side consumers (core's `wipeWalletStorage`, the desktop renderer's
// `sendMessage`), so a drift on either side of the boundary fails here.
//
// The invariants that matter, in order:
//   1. The exposed surface stays narrow. Anything beyond these four worlds, or
//      any non-function value, is a hole in the renderer sandbox.
//   2. Every channel the preload talks on is a channel main answers on. A typo
//      either side is a dead feature that looks fine in review.
//   3. `wipeStorage` stays argument-free, so a compromised renderer cannot aim
//      a delete at a path of its choosing.
//   4. The signer-bridge listener sees the message only, never the raw
//      IpcRendererEvent (which carries `sender`, i.e. a handle to the frame).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { IPC_CHANNEL } from '../../../packages/desktop/main/messageHost.js';
import { SIGNER_BRIDGE_CHANNEL } from '../../../packages/desktop/main/signerBridgeListener.js';
import { wipeWalletStorage } from '../../../packages/core/src/shared/utils/wipeWalletStorage.js';
import { sendMessage as rendererSendMessage } from '../../../packages/desktop/renderer/bridgeMessaging.js';

// Path arithmetic goes through node:path, not `new URL(rel, import.meta.url)`:
// under the jsdom environment the global URL resolves relative specifiers
// against the jsdom document origin (http://localhost:3000/), not the module.
const HERE = dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = resolve(HERE, '../../../packages/desktop/preload.cjs');
const MAIN_PATH = resolve(HERE, '../../../packages/desktop/main/index.js');

/**
 * Run the real preload with a stand-in `electron` module and return everything
 * it exposed plus a record of what it did to ipcRenderer.
 *
 * The interception is at `Module._load` rather than vitest's module mocker
 * because the preload is loaded by Node's CJS loader (that is how Electron
 * loads a sandboxed preload, and the .cjs extension exists precisely so it
 * stays out of the ESM pipeline).
 */
function runPreload() {
    /** @type {Map<string, any>} */
    const worlds = new Map();
    /** @type {any[][]} */
    const invokes = [];
    /** @type {any[][]} */
    const sends = [];
    /** @type {Map<string, Set<Function>>} */
    const listeners = new Map();
    let reply = async () => ({ ok: true, result: null });

    const ipcRenderer = {
        invoke(...args) {
            invokes.push(args);
            return reply(...args);
        },
        send(...args) {
            sends.push(args);
        },
        on(channel, fn) {
            if (!listeners.has(channel)) listeners.set(channel, new Set());
            listeners.get(channel).add(fn);
        },
        removeListener(channel, fn) {
            listeners.get(channel)?.delete(fn);
        },
    };

    const contextBridge = {
        exposeInMainWorld(key, value) {
            if (worlds.has(key)) {
                throw new Error(`exposeInMainWorld: world "${key}" exposed twice`);
            }
            worlds.set(key, value);
        },
    };

    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, ...rest) {
        if (request === 'electron') return { contextBridge, ipcRenderer };
        return originalLoad.call(this, request, ...rest);
    };
    try {
        const require = createRequire(import.meta.url);
        // Fresh evaluation per test: the preload's side effects ARE its API.
        delete require.cache[require.resolve(PRELOAD_PATH)];
        require(PRELOAD_PATH);
    } finally {
        Module._load = originalLoad;
    }

    return {
        worlds,
        invokes,
        sends,
        ipcRenderer,
        /** Channel of the nth (default: only) invoke. */
        lastInvoke: () => invokes[invokes.length - 1],
        /** Swap what main "answers" with. */
        setReply(fn) { reply = fn; },
        /** Main → renderer push, exactly as Electron delivers it: (event, msg). */
        emit(channel, message, event = { sender: 'ipc-sender-handle', ports: [] }) {
            for (const fn of listeners.get(channel) ?? []) fn(event, message);
        },
        listenerCount: (channel) => listeners.get(channel)?.size ?? 0,
        /** Install the exposed worlds as the renderer realm sees them. */
        installGlobals() {
            for (const [key, value] of worlds) globalThis[key] = value;
        },
    };
}

/**
 * Every channel main registers a handler on, read off main's own source.
 *
 * Deliberately fails CLOSED: `ipcMain.handle(SOME_CONSTANT` contributes nothing
 * to this set, so moving a channel to a constant shrinks the set and trips the
 * subset assertion below rather than quietly passing. The two channels that are
 * already constants are imported from the modules that define them, so they are
 * checked by identity, not by string.
 */
function mainRegisteredChannels() {
    const src = readFileSync(MAIN_PATH, 'utf8');
    const channels = new Set([IPC_CHANNEL, SIGNER_BRIDGE_CHANNEL]);
    for (const m of src.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)) channels.add(m[1]);
    return channels;
}

const BRIDGE_WORLDS = [
    'xchainWalletBridge',
    'xchainWalletWindow',
    'xchainWalletRegistry',
    'xchainWalletSignerBridge',
];

beforeEach(() => {
    for (const key of BRIDGE_WORLDS) delete globalThis[key];
});

afterEach(() => {
    for (const key of BRIDGE_WORLDS) delete globalThis[key];
});

describe('desktop preload: the renderer sandbox surface', () => {
    it('exposes exactly the four bridge worlds and nothing else', () => {
        const pre = runPreload();
        expect([...pre.worlds.keys()].sort()).toEqual([...BRIDGE_WORLDS].sort());
    });

    it('exposes functions only: no ipcRenderer, require, process or module handle crosses over', () => {
        const pre = runPreload();
        for (const [worldName, world] of pre.worlds) {
            expect(Object.getPrototypeOf(world)).toBe(Object.prototype);
            for (const [key, value] of Object.entries(world)) {
                expect(
                    typeof value,
                    `${worldName}.${key} must be a function, got ${typeof value}`,
                ).toBe('function');
                expect(value).not.toBe(pre.ipcRenderer);
            }
            // The renderer must not be handed the raw IPC object under any name.
            const forbidden = ['ipcRenderer', 'require', 'process', 'module', 'exports', 'electron'];
            for (const name of forbidden) {
                expect(Object.keys(world)).not.toContain(name);
            }
        }
    });

    it('talks only on channels the main process actually answers on', async () => {
        const pre = runPreload();
        const bridge = pre.worlds.get('xchainWalletBridge');
        const win = pre.worlds.get('xchainWalletWindow');
        const registry = pre.worlds.get('xchainWalletRegistry');
        const signer = pre.worlds.get('xchainWalletSignerBridge');

        await bridge.sendMessage({ type: 'session.status' });
        await bridge.wipeStorage();
        await win.openDetached({ initialView: 'history' });
        await registry.getRemoteDescriptors();
        signer.postMessage({ kind: 'announce', signerIds: [] });

        const used = new Set([
            ...pre.invokes.map(([channel]) => channel),
            ...pre.sends.map(([channel]) => channel),
        ]);
        // Sanity: the walk above must actually have produced traffic, or the
        // subset check below is vacuously true.
        expect(used.size).toBe(5);

        const registered = mainRegisteredChannels();
        for (const channel of used) {
            expect(
                registered.has(channel),
                `preload talks on "${channel}" but main registers no handler for it`,
            ).toBe(true);
        }
    });
});

describe('desktop preload: request/response bridge', () => {
    it('forwards the message verbatim and returns main\'s envelope untouched', async () => {
        const pre = runPreload();
        pre.setReply(async () => ({ ok: true, result: { status: 'locked' } }));
        const message = { type: 'session.status', request: { chainId: 'BTC' } };

        const res = await pre.worlds.get('xchainWalletBridge').sendMessage(message);

        expect(pre.invokes).toEqual([[IPC_CHANNEL, message]]);
        expect(res).toEqual({ ok: true, result: { status: 'locked' } });
    });

    it('passes a failure envelope through rather than throwing inside the preload', async () => {
        const pre = runPreload();
        pre.setReply(async () => ({
            ok: false,
            error: { name: 'VaultLockedError', message: 'wallet is locked' },
        }));

        const res = await pre.worlds.get('xchainWalletBridge').sendMessage({ type: 'wallet.list' });

        expect(res).toEqual({
            ok: false,
            error: { name: 'VaultLockedError', message: 'wallet is locked' },
        });
    });

    it('drives the real renderer messaging wrapper end to end', async () => {
        const pre = runPreload();
        pre.installGlobals();
        pre.setReply(async () => ({ ok: true, result: [{ id: 'w1' }] }));

        // bridgeMessaging.sendMessage is what every desktop route calls; it
        // unwraps the envelope, so this proves the two halves agree on shape.
        await expect(rendererSendMessage('wallet.list')).resolves.toEqual([{ id: 'w1' }]);
        expect(pre.invokes).toEqual([[IPC_CHANNEL, { type: 'wallet.list', request: undefined }]]);

        pre.setReply(async () => ({
            ok: false,
            error: { name: 'VaultLockedError', message: 'wallet is locked' },
        }));
        await expect(rendererSendMessage('wallet.list')).rejects.toThrow('wallet is locked');
    });
});

describe('desktop preload: wipeStorage stays un-aimable ', () => {
    it('invokes with the channel and NO arguments, whatever the caller passes', async () => {
        const pre = runPreload();
        pre.setReply(async () => ({ ok: true, cleared: ['storage'] }));

        // A compromised renderer trying to point the wipe at a path.
        await pre.worlds.get('xchainWalletBridge').wipeStorage('/Users/someone/.ssh', { force: true });

        expect(pre.invokes).toHaveLength(1);
        expect(pre.invokes[0]).toEqual(['xchain:wipe-storage']);
    });

    it('carries main\'s failure back to core\'s wipe, which must refuse to report success', async () => {
        const pre = runPreload();
        pre.installGlobals();
        pre.setReply(async () => ({ ok: false, cleared: ['meta'], error: 'vault: EPERM' }));

        await expect(wipeWalletStorage()).rejects.toThrow(/vault: EPERM/);
        expect(pre.invokes.map(([channel]) => channel)).toEqual(['xchain:wipe-storage']);
    });

    it('lets core\'s wipe resolve when main clears every store', async () => {
        const pre = runPreload();
        pre.installGlobals();
        pre.setReply(async () => ({ ok: true, cleared: ['storage', 'meta', 'session', 'throttle'] }));

        await expect(wipeWalletStorage()).resolves.toBeUndefined();
    });
});

describe('desktop preload: window + registry bridges', () => {
    it('forwards the detach-window request and returns the new window id', async () => {
        const pre = runPreload();
        pre.setReply(async () => ({ ok: true, windowId: 7 }));
        const args = { initialView: 'txDetail', initialContext: { txid: 'ab'.repeat(32) } };

        const res = await pre.worlds.get('xchainWalletWindow').openDetached(args);

        expect(pre.invokes).toEqual([['xchain:open-window', args]]);
        expect(res).toEqual({ ok: true, windowId: 7 });
    });

    it('asks for the verified registry batch with no arguments', async () => {
        const pre = runPreload();
        pre.setReply(async () => ({ ok: true, descriptors: [{ chainId: 'BTC' }] }));

        const res = await pre.worlds.get('xchainWalletRegistry').getRemoteDescriptors();

        expect(pre.invokes).toEqual([['xchain:chain-registry']]);
        expect(res.descriptors).toEqual([{ chainId: 'BTC' }]);
    });
});

describe('desktop preload: signer-bridge duplex port', () => {
    it('sends renderer → main fire-and-forget (send, never invoke)', () => {
        const pre = runPreload();
        const msg = { kind: 'announce', signerIds: ['trezor-1'] };

        pre.worlds.get('xchainWalletSignerBridge').postMessage(msg);

        expect(pre.sends).toEqual([[SIGNER_BRIDGE_CHANNEL, msg]]);
        expect(pre.invokes).toEqual([]);
    });

    it('hands the listener the message only, never the IpcRendererEvent', () => {
        const pre = runPreload();
        const seen = [];
        pre.worlds.get('xchainWalletSignerBridge').onMessage((...args) => { seen.push(args); });

        pre.emit(SIGNER_BRIDGE_CHANNEL, { kind: 'sign', id: 'req-1' });

        // One argument. An extra `event` would put `event.sender` (a handle to
        // the frame) in reach of renderer code that only asked for a message.
        expect(seen).toEqual([[{ kind: 'sign', id: 'req-1' }]]);
    });

    it('returns an unsubscribe that actually detaches the listener', () => {
        const pre = runPreload();
        const seen = [];
        const off = pre.worlds.get('xchainWalletSignerBridge').onMessage((msg) => { seen.push(msg); });
        expect(pre.listenerCount(SIGNER_BRIDGE_CHANNEL)).toBe(1);

        pre.emit(SIGNER_BRIDGE_CHANNEL, { kind: 'a' });
        off();
        pre.emit(SIGNER_BRIDGE_CHANNEL, { kind: 'b' });

        expect(pre.listenerCount(SIGNER_BRIDGE_CHANNEL)).toBe(0);
        expect(seen).toEqual([{ kind: 'a' }]);
    });

    it('keeps subscriptions independent, so one signer detaching does not mute the others', () => {
        const pre = runPreload();
        const a = [];
        const b = [];
        const offA = pre.worlds.get('xchainWalletSignerBridge').onMessage((m) => a.push(m));
        pre.worlds.get('xchainWalletSignerBridge').onMessage((m) => b.push(m));

        offA();
        pre.emit(SIGNER_BRIDGE_CHANNEL, { kind: 'status' });

        expect(a).toEqual([]);
        expect(b).toEqual([{ kind: 'status' }]);
    });
});
