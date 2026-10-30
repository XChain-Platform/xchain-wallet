// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Electron preload: the single bridge between renderer and main.
//
// §9.3.2: "keys never cross the contextBridge IPC boundary into the
// renderer." This preload upholds that by exposing, via contextBridge, only
// the named function-only worlds pinned in BRIDGE_WORLDS
// (test/integration/shells/desktop-preload-contract.test.js) and enumerated
// below. Nothing about Node, the filesystem, Electron internals, or native
// modules is exposed to the renderer. Adding a world means editing that list,
// deliberately; the list is the count, so no number is written down here (a
// count and a prose list drift apart silently, and this one did).
//
//   - `xchainWalletBridge.sendMessage(message)`: request/response for
//     every MessageHost call (unlock, sendToken, etc.). Mirrors the
//     extension popup + web shell wire format.
//
//   - `xchainWalletBridge.wipeStorage()`. The shared
//     `wipeWalletStorage` helper can only reach localStorage +
//     IndexedDB, and this shell keeps its vault, kdfParams meta,
//     session key and unlock throttle in files under userData. Without
//     this call the demo exit and the Locked "forgot password" wipe are
//     silent no-ops. Deliberately takes no arguments: the renderer says
//     "wipe", main decides what that means, so a compromised renderer
//     cannot aim it at an arbitrary path.
//
//   - `xchainWalletBridge.saveBackupFile({ fileName, content })`. Saves
//     an encrypted wallet backup through the native save dialog and
//     answers with the written path or "not saved", so the backup counts
//     as done only for a file that exists. Same shape of trust as
//     `wipeStorage`: the renderer offers a file and a name, main shows
//     the dialog and writes where the user chose; no path crosses in.
//
//   - `xchainWalletSignerBridge.{postMessage,onMessage}`:
//     duplex port for the hardware-signer RPC. Renderer-hosted
//     Trezor/Ledger signers expose their status + sign methods back
//     to the main process over this channel. Shaped as a neutral
//     {postMessage, onMessage} adapter so the desktop renderer +
//     main reuse the same `signerPortProtocol` helpers the extension
//     uses over `chrome.runtime.connect` ports.
//     TWO methods, not three: the synthetic port in
//     main/signerBridgeListener.js also carries `onDisconnect`, but that
//     half stays main-side, where the webContents document-end events
//     (`DOCUMENT_END_EVENTS` in main/signerBridgeListener.js: destroy,
//     reload and crash alike) observe the renderer going away. Nothing
//     renderer-side consumes it (renderer/signerBridge.js builds its
//     PortLike from these two), and exposing it would widen this boundary
//     for a capability no consumer wants. This list is pinned by
//     test/integration/shells/desktop-preload-contract.test.js.
//
//   - `xchainWalletWindow.openDetached({ initialView, initialContext })`:
//     §24.6 / Cluster Y FOLLOWUP 4 detach-pending-tx. The renderer
//     asks main to spawn a fresh BrowserWindow pre-routed to the
//     specified view + context (e.g. a pending tx detail).
//     `xchainWalletWindow.onStateChange(listener)` keeps sibling windows
//     aligned when the shared main-process session, active wallet, settings,
//     active network, or a wallet or account record changes.
//     `xchainWalletWindow.onHidden(listener)` reports native minimize and hide
//     transitions that do not reliably reach the DOM event system.
//     `xchainWalletWindow.setScreenProtected(boolean)` turns screen capture
//     protection on or off for the calling window only, while a screen
//     shows key material (renderer/screenGuardBridge.js). One boolean in,
//     no window id: a renderer cannot aim it at another window.
//
//   - `xchainWalletRegistry.getRemoteDescriptors()`: §9.7 / G007
//     chain-registry sync. The renderer CSP pins connect-src 'self',
//     so main performs the hub fetch + Ed25519 verification and the
//     renderer pulls the verified descriptor batch through this call
//     to hot-swap its own registry realm.
//
//   - `xchainWalletUpdater.{onEvent,getState,install}`: the renderer's
//     half of the update path. Main runs the check, the K1 signature
//     gate and `quitAndInstall`; the renderer subscribes to status
//     (`onEvent`), reads status that landed before it mounted
//     (`getState`), and asks for check, download, or restart steps
//     (`install`).
//     Read-and-ask only: nothing here hands the renderer a path, a
//     URL, or a way to skip the signature gate.
//
//   - `xchainWalletDeepLink.{onUri,takePending}`: the renderer's half
//     of `xchain:` deep links. Main parks each OS-delivered link in a
//     one-slot store and nudges the focused window (`onUri`); the
//     renderer claims the link with `takePending`, on mount and on each
//     nudge, so a link clicked while the app was closed is applied once.
//     Links are attacker-controlled input: the renderer only ever turns
//     one into a prefilled form the user still has to act on.
//
//   - `xchainWalletTrezorBridge.{call,close}`: the renderer's half of the
//     Trezor Connect relay (§40.12). `call(method, args)` asks main to run
//     one Connect method the signer uses in the bridge window main owns on
//     the isolated no-HID session, and resolves to `{ ok, result }` or
//     `{ ok: false, error }`. `close()` closes that window, settling any
//     waiting call. The renderer never gets a handle to the window, its
//     session or the hosted script.

// CommonJS on purpose: Electron loads sandboxed preloads (webPreferences
// sandbox: true) through its CJS wrapper, so an ESM `import` here throws
// "Cannot use import statement outside a module" and NO bridge gets
// exposed. The package's "type": "module" makes plain .js files ESM,
// hence the .cjs extension. `require('electron')` is the only module a
// sandboxed preload may pull in.
const { contextBridge, ipcRenderer } = require('electron');

const MESSAGE_CHANNEL = 'xchain-wallet:message';
const SIGNER_BRIDGE_CHANNEL = 'xchain-wallet:signer-bridge';
const OPEN_WINDOW_CHANNEL = 'xchain:open-window';
const STATE_CHANGE_CHANNEL = 'xchain:state-changed';
const WIPE_STORAGE_CHANNEL = 'xchain:wipe-storage';
const SAVE_BACKUP_CHANNEL = 'xchain:save-backup';
const CHAIN_REGISTRY_CHANNEL = 'xchain:chain-registry';
const UPDATER_EVENT_CHANNEL = 'xchain:updater';
const UPDATER_INSTALL_CHANNEL = 'xchain:updater-install';
const UPDATER_STATE_CHANNEL = 'xchain:updater-state';
const DEEP_LINK_CHANNEL = 'xchain:uri';
const DEEP_LINK_TAKE_CHANNEL = 'xchain:deep-link-take';
const SCREEN_PROTECTION_CHANNEL = 'xchain:screen-protection';
const TREZOR_BRIDGE_CALL_CHANNEL = 'xchain:trezor-bridge-call';
const TREZOR_BRIDGE_CLOSE_CHANNEL = 'xchain:trezor-bridge-close';
// Matches main/trezorBridgeWindow.js CONNECT_METHODS: a call main refuses
// throws here instead.
const TREZOR_CONNECT_METHODS = ['getFeatures', 'getAddress', 'getPublicKey', 'signTransaction', 'signMessage'];
const WINDOW_HIDDEN_CHANNEL = 'xchain:window-hidden';

function assertArgumentCount(method, args, expected) {
    if (args.length !== expected) {
        throw new TypeError(`${method}: expected ${expected} argument${expected === 1 ? '' : 's'}`);
    }
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(method, value) {
    if (!isRecord(value)) throw new TypeError(`${method}: expected an object`);
}

function assertAllowedKeys(method, value, allowed) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) throw new TypeError(`${method}: unexpected property "${key}"`);
    }
}

function assertListener(method, args) {
    assertArgumentCount(method, args, 1);
    if (typeof args[0] !== 'function') throw new TypeError(`${method}: listener must be a function`);
    return args[0];
}

function assertNoArguments(method, args) {
    assertArgumentCount(method, args, 0);
}

function validateMessage(args) {
    const method = 'xchainWalletBridge.sendMessage';
    assertArgumentCount(method, args, 1);
    const message = args[0];
    assertRecord(method, message);
    assertAllowedKeys(method, message, ['type', 'request']);
    if (typeof message.type !== 'string' || message.type.trim().length === 0) {
        throw new TypeError(`${method}: type must be a non-empty string`);
    }
    return message;
}

function validateOpenDetached(args) {
    const method = 'xchainWalletWindow.openDetached';
    assertArgumentCount(method, args, 1);
    const options = args[0];
    assertRecord(method, options);
    assertAllowedKeys(method, options, ['initialView', 'initialContext']);
    if (options.initialView !== undefined
        && (typeof options.initialView !== 'string' || options.initialView.trim().length === 0)) {
        throw new TypeError(`${method}: initialView must be a non-empty string`);
    }
    if (options.initialContext !== undefined && !isRecord(options.initialContext)) {
        throw new TypeError(`${method}: initialContext must be an object`);
    }
    if (options.initialView === undefined && options.initialContext === undefined) {
        throw new TypeError(`${method}: initialView or initialContext is required`);
    }
    return options;
}

function validateTrezorCall(args) {
    const method = 'xchainWalletTrezorBridge.call';
    if (args.length !== 1 && args.length !== 2) throw new TypeError(`${method}: expected 1 or 2 arguments`);
    const [name, request] = args;
    if (!TREZOR_CONNECT_METHODS.includes(name)) throw new TypeError(`${method}: unsupported Connect method`);
    if (request !== undefined) assertRecord(method, request);
    return request === undefined ? { method: name } : { method: name, args: request };
}

// The frame rules match main/security.js isValidSignerBridgeMessage exactly: a
// frame main refuses is dropped with no reply, so it must throw here instead.
const SIGNER_ID_MAX_LENGTH = 256;

function validateSignerMessage(args) {
    const method = 'xchainWalletSignerBridge.postMessage';
    assertArgumentCount(method, args, 1);
    const message = args[0];
    assertRecord(method, message);

    if (message.kind === 'register' || message.kind === 'unregister') {
        assertAllowedKeys(method, message, ['kind', 'signerIds']);
        if (!Array.isArray(message.signerIds)
            || message.signerIds.some((id) => typeof id !== 'string' || id.length === 0
                || id.length > SIGNER_ID_MAX_LENGTH)) {
            throw new TypeError(`${method}: signerIds must be an array of non-empty strings `
                + `of at most ${SIGNER_ID_MAX_LENGTH} characters`);
        }
        return message;
    }

    if (message.kind === 'response') {
        assertAllowedKeys(method, message, ['kind', 'reqId', 'ok', 'result', 'error']);
        if (!Number.isSafeInteger(message.reqId) || message.reqId < 1) {
            throw new TypeError(`${method}: reqId must be a positive safe integer`);
        }
        if (typeof message.ok !== 'boolean') {
            throw new TypeError(`${method}: ok must be a boolean`);
        }
        if (!message.ok) {
            if (!isRecord(message.error)
                || typeof message.error.name !== 'string' || message.error.name.length === 0
                || typeof message.error.message !== 'string' || message.error.message.length === 0) {
                throw new TypeError(`${method}: error must contain non-empty string name and message properties`);
            }
            assertAllowedKeys(method, message.error, ['name', 'message']);
            if (Object.hasOwn(message, 'result')) {
                throw new TypeError(`${method}: failed responses cannot contain result`);
            }
        } else if (Object.hasOwn(message, 'error')) {
            throw new TypeError(`${method}: successful responses cannot contain error`);
        } else if (!Object.hasOwn(message, 'result')) {
            throw new TypeError(`${method}: successful responses must contain result`);
        }
        return message;
    }

    throw new TypeError(`${method}: unsupported message kind`);
}

contextBridge.exposeInMainWorld('xchainWalletBridge', {
    /**
     * @param {{ type: string, request?: unknown }} message
     * @returns {Promise<import('./main/messageHost.js').IpcResponse>}   type-only: this sandboxed preload may require nothing but electron
     */
    sendMessage(message) {
        return ipcRenderer.invoke(MESSAGE_CHANNEL, validateMessage(arguments));
    },
    /**
     * Clear every wallet store this shell owns under userData (vault
     * blob, kdfParams meta, cached session key, unlock throttle) and
     * drop the in-memory host. `{ ok: false, error }` means at least
     * one store survived, and the caller must surface that rather than
     * reload into a stale unlock screen.
     * @returns {Promise<{ ok: true, cleared: string[] } | { ok: false, cleared?: string[], error: string }>}
     */
    wipeStorage() {
        assertNoArguments('xchainWalletBridge.wipeStorage', arguments);
        return ipcRenderer.invoke(WIPE_STORAGE_CHANNEL);
    },
    /**
     * Save an encrypted backup through the native save dialog.
     * `{ ok: true, saved: true, path }` means the file is written there;
     * `{ ok: true, saved: false }` means the user cancelled.
     * @param {{ fileName: string, content: string }} request
     * @returns {Promise<{ ok: true, saved: true, path: string } | { ok: true, saved: false } | { ok: false, error: string }>}
     */
    saveBackupFile(request) {
        const method = 'xchainWalletBridge.saveBackupFile';
        assertArgumentCount(method, arguments, 1);
        assertRecord(method, request);
        assertAllowedKeys(method, request, ['fileName', 'content']);
        if (typeof request.fileName !== 'string' || typeof request.content !== 'string') {
            throw new TypeError(`${method}: fileName and content must be strings`);
        }
        return ipcRenderer.invoke(SAVE_BACKUP_CHANNEL, { fileName: request.fileName, content: request.content });
    },
});

contextBridge.exposeInMainWorld('xchainWalletWindow', {
    /**
     * Ask main to open a fresh BrowserWindow pre-routed to the given
     * view + context. Used by §24.6 detach-pending-tx and any future
     * "Open in new window" affordance.
     * @param {{ initialView?: string, initialContext?: object }} args
     * @returns {Promise<{ ok: true, windowId: number } | { ok: false, error: string }>}
     */
    openDetached(args) {
        return ipcRenderer.invoke(OPEN_WINDOW_CHANNEL, validateOpenDetached(arguments));
    },
    /**
     * Subscribe to process-wide session, active-wallet, settings, network,
     * wallet record and account record changes made by a sibling window.
     * Returns an unsubscribe function.
     * @param {(change: { kind: 'session' } | { kind: 'active-wallet', walletId: string }
     *   | { kind: 'settings' | 'network', settings: Record<string, unknown> }
     *   | { kind: 'wallets', change: 'added' }
     *   | { kind: 'wallets', change: 'renamed' | 'removed', walletId: string }
     *   | { kind: 'accounts', change: 'added' | 'renamed', walletId: string, accountId: string }) => void} listener
     * @returns {() => void}
     */
    onStateChange(listener) {
        listener = assertListener('xchainWalletWindow.onStateChange', arguments);
        const wrapped = (_event, payload) => { listener(payload); };
        ipcRenderer.on(STATE_CHANGE_CHANNEL, wrapped);
        return function unsubscribe() {
            assertNoArguments('xchainWalletWindow.onStateChange unsubscribe', arguments);
            ipcRenderer.removeListener(STATE_CHANGE_CHANNEL, wrapped);
        };
    },
    /**
     * Subscribe to native minimize and hide transitions for this window.
     * Returns an unsubscribe function.
     * @param {() => void} listener
     * @returns {() => void}
     */
    onHidden(listener) {
        listener = assertListener('xchainWalletWindow.onHidden', arguments);
        const wrapped = () => { listener(); };
        ipcRenderer.on(WINDOW_HIDDEN_CHANNEL, wrapped);
        return function unsubscribe() {
            assertNoArguments('xchainWalletWindow.onHidden unsubscribe', arguments);
            ipcRenderer.removeListener(WINDOW_HIDDEN_CHANNEL, wrapped);
        };
    },
    /**
     * Turn screen capture protection on or off for this window. Core's
     * screen guard calls it as a key-material screen mounts and unmounts.
     * @param {boolean} protectedNow
     * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
     */
    setScreenProtected(protectedNow) {
        const method = 'xchainWalletWindow.setScreenProtected';
        assertArgumentCount(method, arguments, 1);
        if (typeof protectedNow !== 'boolean') throw new TypeError(`${method}: expected a boolean`);
        return ipcRenderer.invoke(SCREEN_PROTECTION_CHANNEL, protectedNow);
    },
});

// The update bridge (row 140/142).
//
// WHAT WAS MISSING, AND IT WAS THE WHOLE LAST MILE. main/index.js has
// broadcast `xchain:updater` events since the updater was wired, and
// under `contextIsolation: true` a renderer cannot call `ipcRenderer.on`,
// so nothing could ever receive them: the channel had one writer and no
// possible reader. `downloadAndInstall()` in main/updater.js - the only
// path to an installed update, and the one that runs the S5 signature
// gate before it calls `quitAndInstall` - had no caller anywhere in the
// repo. So the shipped desktop wallet checked for updates on launch,
// told no one, and could not install one. Both halves are exposed here.
contextBridge.exposeInMainWorld('xchainWalletUpdater', {
    /**
     * Subscribe to updater events: `available`, `verifying`, `rejected`,
     * `error`, `downloaded`. Returns an unsubscribe.
     * @param {(event: {type: string, info?: any}) => void} listener
     * @returns {() => void}
     */
    onEvent(listener) {
        listener = assertListener('xchainWalletUpdater.onEvent', arguments);
        const wrapped = (_event, payload) => { listener(payload); };
        ipcRenderer.on(UPDATER_EVENT_CHANNEL, wrapped);
        return function unsubscribe() {
            assertNoArguments('xchainWalletUpdater.onEvent unsubscribe', arguments);
            ipcRenderer.removeListener(UPDATER_EVENT_CHANNEL, wrapped);
        };
    },
    /**
     * The most recent updater event, or null if none has fired yet.
     *
     * `onEvent` alone cannot see an offer made before the listener
     * existed, and the launch check always finishes first on a locked
     * install (row 148). A mounting renderer asks this instead of
     * waiting for a broadcast that already happened.
     *
     * @returns {Promise<{type: string, info?: any} | null>}
     */
    getState() {
        assertNoArguments('xchainWalletUpdater.getState', arguments);
        return ipcRenderer.invoke(UPDATER_STATE_CHANNEL);
    },
    /**
     * Ask main to check, download, or restart. Download verifies against
     * the K1-signed release manifest and leaves the app running until a
     * separate restart request is safe.
     * @param {'check' | 'download' | 'restart'} [action]
     * @returns {Promise<{ ok: boolean, reason?: string }>}
     */
    install(...args) {
        const method = 'xchainWalletUpdater.install';
        if (args.length > 1) throw new TypeError(`${method}: expected at most 1 argument`);
        const action = args.length === 0 ? 'download' : args[0];
        if (action !== 'check' && action !== 'download' && action !== 'restart') {
            throw new TypeError(`${method}: action must be check, download or restart`);
        }
        return ipcRenderer.invoke(UPDATER_INSTALL_CHANNEL, action);
    },
});

contextBridge.exposeInMainWorld('xchainWalletDeepLink', {
    /**
     * Subscribe to main's "a deep link is waiting" nudge. The listener gets
     * the payload only, never the IpcRendererEvent. Returns an unsubscribe.
     * @param {(event: { scheme: string, raw: string, parsed: any }) => void} listener
     * @returns {() => void}
     */
    onUri(listener) {
        listener = assertListener('xchainWalletDeepLink.onUri', arguments);
        const wrapped = (_event, payload) => { listener(payload); };
        ipcRenderer.on(DEEP_LINK_CHANNEL, wrapped);
        return function unsubscribe() {
            assertNoArguments('xchainWalletDeepLink.onUri unsubscribe', arguments);
            ipcRenderer.removeListener(DEEP_LINK_CHANNEL, wrapped);
        };
    },
    /**
     * Claim the parked deep link, or null when there is none. Each link is
     * handed out once, so two windows never both apply it.
     * @returns {Promise<{ scheme: string, raw: string, parsed: any } | null>}
     */
    takePending() {
        assertNoArguments('xchainWalletDeepLink.takePending', arguments);
        return ipcRenderer.invoke(DEEP_LINK_TAKE_CHANNEL);
    },
});

contextBridge.exposeInMainWorld('xchainWalletRegistry', {
    /**
     * Fetch the signature-verified remote chain-registry batch main
     * applied at boot (awaits the in-flight sync, so callers never
     * race it). `{ ok: false, reason }` means the sync failed or was
     * skipped and the bundled descriptors should keep serving.
     * @returns {Promise<{ ok: true, descriptors: object[], generatedAt?: string } | { ok: false, reason?: string }>}
     */
    getRemoteDescriptors() {
        assertNoArguments('xchainWalletRegistry.getRemoteDescriptors', arguments);
        return ipcRenderer.invoke(CHAIN_REGISTRY_CHANNEL);
    },
});

contextBridge.exposeInMainWorld('xchainWalletTrezorBridge', {
    /**
     * Run one Connect method in main's Trezor Connect bridge window.
     * @param {string} method
     * @param {object} [args]
     * @returns {Promise<{ ok: true, result: unknown } | { ok: false, error: string }>}
     */
    call(method, args) {
        return ipcRenderer.invoke(TREZOR_BRIDGE_CALL_CHANNEL, validateTrezorCall(arguments));
    },
    /**
     * Close the bridge window; any waiting call settles as closed.
     * @returns {Promise<{ ok: boolean }>}
     */
    close() {
        assertNoArguments('xchainWalletTrezorBridge.close', arguments);
        return ipcRenderer.invoke(TREZOR_BRIDGE_CLOSE_CHANNEL);
    },
});

contextBridge.exposeInMainWorld('xchainWalletSignerBridge', {
    /**
     * Renderer → main. Fire-and-forget; the reply (when one is
     * warranted) arrives on the `onMessage` stream.
     * @param {{ kind: 'register' | 'unregister', signerIds: string[] }
     *   | { kind: 'response', reqId: number, ok: boolean, result?: unknown,
     *       error?: { name: string, message: string } }} msg
     */
    postMessage(msg) {
        ipcRenderer.send(SIGNER_BRIDGE_CHANNEL, validateSignerMessage(arguments));
    },
    /**
     * Subscribe to main → renderer messages. Returns an unsubscribe.
     * @param {(msg: any) => void} listener
     * @returns {() => void}
     */
    onMessage(listener) {
        listener = assertListener('xchainWalletSignerBridge.onMessage', arguments);
        const wrapped = (_event, msg) => { listener(msg); };
        ipcRenderer.on(SIGNER_BRIDGE_CHANNEL, wrapped);
        return function unsubscribe() {
            assertNoArguments('xchainWalletSignerBridge.onMessage unsubscribe', arguments);
            ipcRenderer.removeListener(SIGNER_BRIDGE_CHANNEL, wrapped);
        };
    },
});
