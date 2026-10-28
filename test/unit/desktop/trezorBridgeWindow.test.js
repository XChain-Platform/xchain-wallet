// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The main-owned Trezor Connect bridge window (§40.12). Main builds the
// window itself so it lands on the isolated no-HID session (a window.open
// child keeps its opener's session), loads a packaged file rather than a
// data: URL, and relays only Connect-shaped traffic between it and the app
// renderer. A window the person closes settles every waiting call as the
// retryable "Nothing was broadcast" disconnect.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import {
    BRIDGE_CLOSED_MESSAGE,
    CONNECT_METHODS,
    TREZOR_BRIDGE_READY_CHANNEL,
    TREZOR_BRIDGE_REPLY_CHANNEL,
    TREZOR_BRIDGE_REQUEST_CHANNEL,
    TREZOR_CONNECT_MANIFEST,
    bridgeWindowOptions,
    createTrezorBridge,
    isValidBridgeCall,
    isValidBridgeReply,
} from '../../../packages/desktop/main/trezorBridgeWindow.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, '../../../packages/desktop');
const DOCUMENT_PATH = join(DESKTOP, 'main', 'trezorBridge', 'connect.html');
const BRIDGE_PRELOAD_PATH = join(DESKTOP, 'main', 'trezorBridge', 'preload.cjs');
const BRIDGE_RESPONDER_PATH = join(DESKTOP, 'main', 'trezorBridge', 'responder.js');
const APP_PRELOAD_PATH = join(DESKTOP, 'preload.cjs');
const DOCUMENT_URL = pathToFileURL(DOCUMENT_PATH).href;

// The pattern useConfirmAction reads as "reconnect and Approve again".
const RETRYABLE_DISCONNECT = /transport.*(?:disconnected|unavailable|missing)/i;

/** A stand-in BrowserWindow: records its options, IPC listeners and sends. */
function fakeElectron() {
    const windows = [];
    class FakeWindow extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.destroyed = false;
            this.loadFile = vi.fn(async () => {});
            this.loadURL = vi.fn(async () => {});
            const ipc = new EventEmitter();
            const contents = new EventEmitter();
            contents.ipc = ipc;
            contents.mainFrame = { url: DOCUMENT_URL };
            contents.sent = [];
            contents.send = vi.fn((channel, message) => { contents.sent.push([channel, message]); });
            this.webContents = contents;
            windows.push(this);
        }

        isDestroyed() { return this.destroyed; }

        close() {
            if (this.destroyed) return;
            this.destroyed = true;
            this.emit('closed');
        }

        /** An IPC event as Electron hands it to a webContents.ipc listener. */
        event(frame = this.webContents.mainFrame, sender = this.webContents) {
            return { sender, senderFrame: frame };
        }

        ready(event = this.event()) {
            this.webContents.ipc.emit(TREZOR_BRIDGE_READY_CHANNEL, event);
        }

        reply(message, event = this.event()) {
            this.webContents.ipc.emit(TREZOR_BRIDGE_REPLY_CHANNEL, event, message);
        }

        requests() {
            return this.webContents.sent
                .filter(([channel]) => channel === TREZOR_BRIDGE_REQUEST_CHANNEL)
                .map(([, message]) => message);
        }

        /** Answer the window's pending init. */
        async acceptInit() {
            await vi.waitFor(() => expect(this.requests().some((r) => r.method === 'init')).toBe(true));
            const init = this.requests().find((r) => r.method === 'init');
            this.reply({ id: init.id, ok: true, result: undefined });
        }
    }
    return { BrowserWindow: FakeWindow, windows };
}

function makeBridge(overrides = {}) {
    const electron = fakeElectron();
    const isolatedSession = { partition: 'trezor-connect-isolated' };
    const show = vi.fn();
    const bridge = createTrezorBridge({
        BrowserWindow: electron.BrowserWindow,
        getSession: () => isolatedSession,
        preloadPath: BRIDGE_PRELOAD_PATH,
        documentPath: DOCUMENT_PATH,
        show,
        ...overrides,
    });
    return { bridge, isolatedSession, show, ...electron };
}

/** Open a bridge, bring it up, and return the window plus the first call. */
async function liveBridge(rig, message = { method: 'getFeatures' }) {
    const call = rig.bridge.call(message);
    await vi.waitFor(() => expect(rig.windows).toHaveLength(1));
    const win = rig.windows[0];
    win.ready();
    await win.acceptInit();
    await vi.waitFor(() => expect(win.requests()).toHaveLength(2));
    return { win, call, request: win.requests()[1] };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('desktop Trezor bridge window: isolation', () => {
    it('builds the window on the isolated session with only the bridge preload, sandboxed', async () => {
        const rig = makeBridge();
        void rig.bridge.call({ method: 'getFeatures' });
        await vi.waitFor(() => expect(rig.windows).toHaveLength(1));
        const { options } = rig.windows[0];

        expect(options.webPreferences.session).toBe(rig.isolatedSession);
        expect(options.webPreferences).toMatchObject({
            preload: BRIDGE_PRELOAD_PATH,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            devTools: false,
        });
        expect(options.webPreferences.preload).not.toBe(APP_PRELOAD_PATH);
        expect(options.show).toBe(false);
    });

    it('loads the packaged bridge document from a file, never a data: URL', async () => {
        const rig = makeBridge();
        void rig.bridge.call({ method: 'getFeatures' });
        await vi.waitFor(() => expect(rig.windows).toHaveLength(1));
        const win = rig.windows[0];

        expect(win.loadFile).toHaveBeenCalledExactlyOnceWith(DOCUMENT_PATH);
        expect(win.loadURL).not.toHaveBeenCalled();
        const html = readFileSync(DOCUMENT_PATH, 'utf8');
        expect(html).not.toMatch(/data:/);
        expect(html).toContain('<script src="https://connect.trezor.io/9/trezor-connect.js"></script>');
        expect(html).toContain('<script src="responder.js"></script>');
        expect(html).not.toMatch(/<script>(?!<\/script>)/);
    });

    it('declares a CSP that admits only its own script and the Connect origin', () => {
        const html = readFileSync(DOCUMENT_PATH, 'utf8');
        const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
        const directives = Object.fromEntries(csp.split(';').map((part) => part.trim().split(/\s+/))
            .map(([name, ...sources]) => [name, sources]));
        expect(directives).toEqual({
            'default-src': ["'none'"],
            'script-src': ["'self'", 'https://connect.trezor.io'],
            'connect-src': ['https://connect.trezor.io'],
            'frame-src': ['https://connect.trezor.io'],
            'style-src': ["'unsafe-inline'"],
        });
    });

    it('shows the window through the focus policy once it is ready to show', async () => {
        const rig = makeBridge();
        void rig.bridge.call({ method: 'getFeatures' });
        await vi.waitFor(() => expect(rig.windows).toHaveLength(1));
        const win = rig.windows[0];
        expect(rig.show).not.toHaveBeenCalled();
        win.emit('ready-to-show');
        expect(rig.show).toHaveBeenCalledExactlyOnceWith(win);
    });

    it('pins the option object main hands Electron', () => {
        const session = {};
        expect(bridgeWindowOptions({ session, preloadPath: '/p.cjs', devTools: true }).webPreferences)
            .toEqual({
                session,
                preload: '/p.cjs',
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                webSecurity: true,
                devTools: true,
            });
    });
});

describe('desktop Trezor bridge window: relay', () => {
    it('initializes Connect once per window with main\'s manifest, then relays the call', async () => {
        const rig = makeBridge();
        const { win, call, request } = await liveBridge(rig, { method: 'getAddress', args: { path: "m/84'/0'/0'/0/0" } });

        const init = win.requests()[0];
        expect(init).toEqual({
            id: init.id,
            method: 'init',
            args: { manifest: { ...TREZOR_CONNECT_MANIFEST }, lazyLoad: true, popup: false },
        });
        expect(request).toEqual({ id: request.id, method: 'getAddress', args: { path: "m/84'/0'/0'/0/0" } });
        win.reply({ id: request.id, ok: true, result: { success: true, payload: { address: 'bc1qexample' } } });
        await expect(call).resolves.toEqual({ ok: true, result: { success: true, payload: { address: 'bc1qexample' } } });

        const second = rig.bridge.call({ method: 'getFeatures' });
        await vi.waitFor(() => expect(win.requests()).toHaveLength(3));
        expect(win.requests().filter((r) => r.method === 'init')).toHaveLength(1);
        win.reply({ id: win.requests()[2].id, ok: false, error: 'Device disconnected' });
        await expect(second).resolves.toEqual({ ok: false, error: 'Device disconnected' });
        expect(rig.windows).toHaveLength(1);
    });

    it('refuses calls that are not a Connect method the signer uses, and opens no window for them', async () => {
        const rig = makeBridge();
        for (const message of [
            { method: 'init', args: { manifest: { email: 'x', appUrl: 'https://evil.example' } } },
            { method: 'wipeDevice' },
            { method: 'getFeatures', args: [] },
            { method: 'getFeatures', args: 'path' },
            { method: 'getFeatures', extra: true },
            { method: 'constructor' },
            { method: '__proto__' },
            null,
            'getFeatures',
            ['getFeatures'],
        ]) {
            await expect(rig.bridge.call(message)).resolves.toEqual({
                ok: false,
                error: 'desktop trezorFactory: the Trezor Connect bridge refuses this call',
            });
        }
        expect(rig.windows).toHaveLength(0);
        for (const method of CONNECT_METHODS) {
            expect(isValidBridgeCall({ method, args: { path: "m/84'/0'/0'" } })).toBe(true);
            expect(isValidBridgeCall({ method })).toBe(true);
        }
    });

    it('ignores replies from another sender, a subframe, another URL, or an unknown id', async () => {
        const rig = makeBridge();
        const { win, call, request } = await liveBridge(rig);
        const settled = vi.fn();
        call.then(settled);

        const other = new EventEmitter();
        win.reply({ id: request.id, ok: true, result: 'from another sender' }, win.event(win.webContents.mainFrame, other));
        win.reply({ id: request.id, ok: true, result: 'from a subframe' }, win.event({ url: DOCUMENT_URL }));
        win.webContents.mainFrame.url = 'https://connect.trezor.io/9/popup.html';
        win.reply({ id: request.id, ok: true, result: 'after navigating away' });
        win.webContents.mainFrame.url = DOCUMENT_URL;
        win.reply({ id: '999', ok: true, result: 'unknown id' });
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();

        win.reply({ id: request.id, ok: true, result: 'real' });
        await expect(call).resolves.toEqual({ ok: true, result: 'real' });
    });

    it('ignores reply shapes outside the Connect envelope', async () => {
        const rig = makeBridge();
        const { win, call, request } = await liveBridge(rig);
        const settled = vi.fn();
        call.then(settled);

        for (const message of [
            { id: request.id, ok: true, result: 1, error: 'both' },
            { id: request.id, ok: false, result: 1, error: 'both' },
            { id: request.id, ok: false },
            { id: request.id, ok: false, error: '' },
            { id: request.id, ok: false, error: 'x'.repeat(2001) },
            { id: request.id, ok: 'yes', result: 1 },
            { id: Number(request.id), ok: true, result: 1 },
            { id: request.id, ok: true, result: 1, kind: 'response' },
            { type: 'xchain-trezor-bridge-ready' },
            null,
        ]) {
            expect(isValidBridgeReply(message)).toBe(false);
            win.reply(message);
        }
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        win.reply({ id: request.id, ok: true, result: 1 });
        await expect(call).resolves.toEqual({ ok: true, result: 1 });
    });

    it('waits for a ready signal from the bridge document only', async () => {
        const rig = makeBridge();
        void rig.bridge.call({ method: 'getFeatures' });
        await vi.waitFor(() => expect(rig.windows).toHaveLength(1));
        const win = rig.windows[0];
        win.ready(win.event({ url: DOCUMENT_URL }));
        win.ready(win.event(win.webContents.mainFrame, new EventEmitter()));
        await new Promise((done) => { setTimeout(done, 20); });
        expect(win.requests()).toHaveLength(0);
        win.ready();
        await vi.waitFor(() => expect(win.requests()).toHaveLength(1));
    });
});

describe('desktop Trezor bridge window: closing', () => {
    it('settles a sign in flight as a retryable disconnect when the window closes', async () => {
        const rig = makeBridge();
        const { win, call } = await liveBridge(rig, { method: 'signTransaction', args: { inputs: [] } });
        win.close();

        const reply = await call;
        expect(reply).toEqual({ ok: false, error: BRIDGE_CLOSED_MESSAGE });
        expect(reply.error).toMatch(RETRYABLE_DISCONNECT);
        expect(reply.error).toMatch(/Nothing was broadcast/);
    });

    it('settles a call waiting on init or on the ready signal when the window closes', async () => {
        const rig = makeBridge();
        const beforeReady = rig.bridge.call({ method: 'getFeatures' });
        await vi.waitFor(() => expect(rig.windows).toHaveLength(1));
        rig.windows[0].close();
        await expect(beforeReady).resolves.toEqual({ ok: false, error: BRIDGE_CLOSED_MESSAGE });

        const beforeInit = rig.bridge.call({ method: 'getFeatures' });
        await vi.waitFor(() => expect(rig.windows).toHaveLength(2));
        rig.windows[1].ready();
        await vi.waitFor(() => expect(rig.windows[1].requests()).toHaveLength(1));
        rig.windows[1].close();
        await expect(beforeInit).resolves.toEqual({ ok: false, error: BRIDGE_CLOSED_MESSAGE });
    });

    it('opens a fresh window for the next call and ignores the closed one\'s late reply', async () => {
        const rig = makeBridge();
        const first = await liveBridge(rig, { method: 'signTransaction', args: { inputs: [] } });
        first.win.close();
        await expect(first.call).resolves.toMatchObject({ ok: false });

        const retry = rig.bridge.call({ method: 'signTransaction', args: { inputs: [] } });
        await vi.waitFor(() => expect(rig.windows).toHaveLength(2));
        const second = rig.windows[1];
        second.ready();
        await second.acceptInit();
        await vi.waitFor(() => expect(second.requests()).toHaveLength(2));
        first.win.reply({ id: first.request.id, ok: true, result: 'stale' });
        second.reply({ id: first.request.id, ok: true, result: 'stale' });
        const live = second.requests()[1];
        expect(live.id).not.toBe(first.request.id);
        second.reply({ id: live.id, ok: true, result: 'fresh' });
        await expect(retry).resolves.toEqual({ ok: true, result: 'fresh' });
    });

    it('closes the window on request and when its document fails to load', async () => {
        const rig = makeBridge();
        const { win, call } = await liveBridge(rig);
        expect(rig.bridge.close()).toEqual({ ok: true });
        await expect(call).resolves.toEqual({ ok: false, error: BRIDGE_CLOSED_MESSAGE });
        expect(rig.bridge.window()).toBe(null);
        expect(rig.bridge.close()).toEqual({ ok: true });

        const failing = rig.bridge.call({ method: 'getFeatures' });
        await vi.waitFor(() => expect(rig.windows).toHaveLength(2));
        rig.windows[1].webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', DOCUMENT_URL, true);
        await expect(failing).resolves.toEqual({ ok: false, error: BRIDGE_CLOSED_MESSAGE });
        expect(win.isDestroyed()).toBe(true);
    });

    it('closes the window and reports the failure when init fails', async () => {
        const rig = makeBridge();
        const call = rig.bridge.call({ method: 'getFeatures' });
        await vi.waitFor(() => expect(rig.windows).toHaveLength(1));
        const win = rig.windows[0];
        win.ready();
        await vi.waitFor(() => expect(win.requests()).toHaveLength(1));
        win.reply({ id: win.requests()[0].id, ok: false, error: 'TrezorConnect not loaded' });
        await expect(call).resolves.toEqual({ ok: false, error: 'TrezorConnect not loaded' });
        expect(win.isDestroyed()).toBe(true);
    });
});

/** Run a CommonJS preload with a stand-in electron module and return its worlds and IPC record. */
function runPreload(path) {
    const worlds = new Map();
    const sends = [];
    const invokes = [];
    const listeners = new Map();
    const ipcRenderer = {
        send: (...args) => { sends.push(args); },
        invoke: async (...args) => { invokes.push(args); return { ok: true, result: null }; },
        on: (channel, fn) => { listeners.set(channel, fn); },
    };
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, ...rest) {
        if (request === 'electron') return { contextBridge: { exposeInMainWorld: (k, v) => worlds.set(k, v) }, ipcRenderer };
        return originalLoad.call(this, request, ...rest);
    };
    try {
        const require = createRequire(import.meta.url);
        delete require.cache[require.resolve(path)];
        require(path);
    } finally {
        Module._load = originalLoad;
    }
    return { worlds, sends, invokes, listeners };
}

describe('desktop Trezor bridge preloads', () => {
    it('gives the bridge page one world that answers Connect requests and nothing else', () => {
        const pre = runPreload(BRIDGE_PRELOAD_PATH);
        expect([...pre.worlds.keys()]).toEqual(['xchainTrezorConnectBridge']);
        const world = pre.worlds.get('xchainTrezorConnectBridge');
        expect(Object.keys(world).sort()).toEqual(['onRequest', 'ready', 'reply']);

        const seen = [];
        world.onRequest((request) => seen.push(request));
        expect(() => world.onRequest(() => {})).toThrow(/already set/);
        const deliver = pre.listeners.get(TREZOR_BRIDGE_REQUEST_CHANNEL);
        deliver({}, { id: '1', method: 'init', args: { lazyLoad: true } });
        deliver({}, { id: '2', method: 'signTransaction', args: { inputs: [] } });
        for (const bad of [
            { id: '3', method: 'wipeDevice' },
            { id: '4', method: 'getFeatures', extra: 1 },
            { id: 'x', method: 'getFeatures' },
            { id: '5', method: 'getFeatures', args: [] },
            null,
        ]) deliver({}, bad);
        expect(seen.map((r) => r.id)).toEqual(['1', '2']);

        world.ready();
        world.reply({ id: '2', ok: true, result: { success: true } });
        world.reply({ id: '1', ok: false, error: 'TrezorConnect not loaded' });
        expect(pre.sends).toEqual([
            [TREZOR_BRIDGE_READY_CHANNEL],
            [TREZOR_BRIDGE_REPLY_CHANNEL, { id: '2', ok: true, result: { success: true } }],
            [TREZOR_BRIDGE_REPLY_CHANNEL, { id: '1', ok: false, error: 'TrezorConnect not loaded' }],
        ]);
        for (const bad of [
            { id: '2', ok: true, result: 1, error: 'x' },
            { id: '2', ok: false },
            { id: '2', ok: false, result: 1, error: 'x' },
            { id: 'x', ok: true, result: 1 },
            { id: '2', ok: true, result: 1, kind: 'response' },
            { type: 'xchain-wallet:message' },
        ]) {
            expect(() => world.reply(bad)).toThrow(TypeError);
        }
        expect(() => world.ready('x')).toThrow(TypeError);
        expect(pre.sends).toHaveLength(3);
    });

    it('keeps the bridge preload channel names and methods equal to main\'s', () => {
        const src = readFileSync(BRIDGE_PRELOAD_PATH, 'utf8');
        expect(src).toContain(`const REQUEST_CHANNEL = '${TREZOR_BRIDGE_REQUEST_CHANNEL}';`);
        expect(src).toContain(`const REPLY_CHANNEL = '${TREZOR_BRIDGE_REPLY_CHANNEL}';`);
        expect(src).toContain(`const READY_CHANNEL = '${TREZOR_BRIDGE_READY_CHANNEL}';`);
        expect(src).toContain(`const REQUEST_METHODS = ${JSON.stringify(['init', ...CONNECT_METHODS]).replaceAll('"', "'").replaceAll(',', ', ')};`);
        const appPreload = readFileSync(APP_PRELOAD_PATH, 'utf8');
        expect(appPreload).toContain(`const TREZOR_CONNECT_METHODS = ${JSON.stringify(CONNECT_METHODS).replaceAll('"', "'").replaceAll(',', ', ')};`);
    });

    it('lets the app renderer call only the signer\'s Connect methods through its relay world', async () => {
        const pre = runPreload(APP_PRELOAD_PATH);
        const world = pre.worlds.get('xchainWalletTrezorBridge');
        expect(Object.keys(world).sort()).toEqual(['call', 'close']);

        await world.call('getFeatures');
        await world.call('signTransaction', { inputs: [] });
        await world.close();
        expect(pre.invokes).toEqual([
            ['xchain:trezor-bridge-call', { method: 'getFeatures' }],
            ['xchain:trezor-bridge-call', { method: 'signTransaction', args: { inputs: [] } }],
            ['xchain:trezor-bridge-close'],
        ]);
        expect(() => world.call('init', {})).toThrow(TypeError);
        expect(() => world.call('wipeDevice')).toThrow(TypeError);
        expect(() => world.call('getFeatures', [])).toThrow(TypeError);
        expect(() => world.call()).toThrow(TypeError);
        expect(() => world.close('extra')).toThrow(TypeError);
        expect(pre.invokes).toHaveLength(3);
    });
});

describe('desktop Trezor bridge responder', () => {
    it('refuses a response-bearing Connect UI event without supplying PIN or passphrase input', async () => {
        let onRequest;
        let onUiEvent;
        const replies = [];
        const never = new Promise(() => {});
        const connect = {
            on: vi.fn((event, listener) => {
                expect(event).toBe('UI_EVENT');
                onUiEvent = listener;
            }),
            cancel: vi.fn(),
            signMessage: vi.fn(() => never),
        };
        const bridge = {
            onRequest: vi.fn((listener) => { onRequest = listener; }),
            reply: vi.fn((message) => replies.push(message)),
            ready: vi.fn(),
        };
        runInNewContext(readFileSync(BRIDGE_RESPONDER_PATH, 'utf8'), {
            window: { TrezorConnect: connect, xchainTrezorConnectBridge: bridge },
            Map,
            Promise,
            Error,
            String,
        });

        for (const [id, type, description] of [
            ['7', 'ui-request_pin', 'PIN entry'],
            ['8', 'ui-request_passphrase', 'passphrase entry'],
            ['9', 'ui-request_permission', 'permission approval'],
        ]) {
            onRequest({ id, method: 'signMessage', args: { message: 'exact message' } });
            await vi.waitFor(() => expect(connect.signMessage).toHaveBeenCalledTimes(replies.length + 1));
            onUiEvent({ event: 'UI_EVENT', type, payload: {} });
            const reply = replies.at(-1);
            expect(reply).toMatchObject({ id, ok: false });
            expect(reply.error).toContain(`requested ${description}`);
            expect(reply.error).toMatch(/refused without supplying a PIN, passphrase, permission grant/);
            expect(reply.error).toMatch(/Nothing was signed or broadcast/);
        }
        expect(replies).toHaveLength(3);
        expect(connect.cancel).toHaveBeenCalledTimes(3);
        for (let i = 0; i < replies.length; i += 1) {
            expect(connect.cancel).toHaveBeenNthCalledWith(i + 1, replies[i].error);
        }
        expect(Object.hasOwn(connect, 'uiResponse')).toBe(false);
    });
});
