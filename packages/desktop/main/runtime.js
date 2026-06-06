// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Desktop main-process runtime — everything that isn't Electron-specific.
//
// Splitting this out of `index.js` lets the IPC dispatch + auto-unlock
// path be unit-tested under plain Node (no `electron` import). `index.js`
// imports this module, injects the real Electron deps (`app`,
// `safeStorage`, `ipcMain`, `BrowserWindow`), and glues the lifecycle
// events together.
//
// The runtime is a single mutable object carrying:
//
//   - Three backends (storage/session/meta) that live for the whole
//     app lifecycle. The session backend is OS-keychain-backed and
//     survives app restarts; the others are file-backed under
//     `app.getPath('userData')`.
//   - A ChainRegistry + SDKRegistry (static for the whole lifecycle).
//   - A Vault + MessageHost that come and go with lock/unlock.
//
// State transitions:
//
//   startup → ensureHost():
//     - No cached session key → host stays null, state = 'locked'
//       (or 'no-wallet' if meta has no kdfParams). Renderer drives
//       `wallet.unlock` (or `wallet.create`/`wallet.import`) via the
//       pre-host pipeline to build the host.
//     - Cached session key present → open vault, build host, state =
//       'unlocked'. Renderer sees no lock screen.
//
//   `wallet.unlock` / `wallet.create` / `wallet.import` → on success,
//     the pre-host handlers persist the master key via
//     `sessionBackend.save` and fire `onUnlocked`, which re-runs
//     ensureHost to bring the vault online.
//
//   `wallet.lock` → pre-host handler clears the session backend and
//     fires `onLocked`, which tears down the host + closes the vault.
//
//   Any non-pre-host message when the host is null returns
//     `WalletLockedError` in the standard envelope.

// Cross-package relative paths — the pnpm workspace symlink makes the
// `@xchain-wallet/*` specifiers work at build time, but the core smoke
// harness runs files via Node directly (no workspace setup) and
// resolves these paths instead. Same convention as messageHost.js.
import { storage as storageLib } from '../../core/src/index.js';
import {
    dispatchPreHost,
    PRE_HOST_MESSAGE_TYPES,
} from '../../extension/src/background/sessionMeta.js';

import { createDesktopMessageHost } from './messageHost.js';

/**
 * @typedef {Object} DesktopRuntimeDeps
 * @property {{ load: () => Promise<Uint8Array | null>, save: (blob: Uint8Array) => Promise<void>, clear: () => Promise<void> }} storageBackend
 * @property {{ load: () => Promise<Uint8Array | null>, save: (blob: Uint8Array) => Promise<void>, clear: () => Promise<void> }} sessionBackend
 * @property {{ load: () => Promise<unknown | null>, save: (obj: unknown) => Promise<void>, clear: () => Promise<void> }} metaBackend
 * @property {import('@xchain-wallet/core').registry.ChainRegistry} chainRegistry
 * @property {import('@xchain-wallet/core').sdk.SDKRegistry} sdkRegistry
 * @property {() => Promise<{env?: object, build?: object}>} [getDiagnosticContext]
 *        §50 / Cluster L FOLLOWUP 4 — supplied by main/index.js so the
 *        diagnostic dump records electron version + OS + walletVersion.
 *
 * @typedef {DesktopRuntimeDeps & {
 *   vault: import('@xchain-wallet/core').storage.Vault | null,
 *   host: ReturnType<typeof createDesktopMessageHost> | null,
 * }} DesktopRuntime
 */

/**
 * @param {DesktopRuntimeDeps} deps
 * @returns {DesktopRuntime}
 */
export function createRuntime(deps) {
    if (!deps?.storageBackend) throw new Error('createRuntime: storageBackend is required');
    if (!deps?.sessionBackend) throw new Error('createRuntime: sessionBackend is required');
    if (!deps?.metaBackend) throw new Error('createRuntime: metaBackend is required');
    if (!deps?.chainRegistry) throw new Error('createRuntime: chainRegistry is required');
    if (!deps?.sdkRegistry) throw new Error('createRuntime: sdkRegistry is required');
    return {
        storageBackend: deps.storageBackend,
        sessionBackend: deps.sessionBackend,
        metaBackend: deps.metaBackend,
        chainRegistry: deps.chainRegistry,
        sdkRegistry: deps.sdkRegistry,
        getDiagnosticContext: deps.getDiagnosticContext,
        vault: null,
        host: null,
    };
}

/**
 * Build the Vault + MessageHost from the cached session master key, if
 * one is present. Idempotent — returns the existing host if already
 * built. Returns null when no cached key exists (locked state).
 *
 * @param {DesktopRuntime} runtime
 */
export async function ensureHost(runtime) {
    if (runtime.host) return runtime.host;

    const masterKey = await runtime.sessionBackend.load();
    if (!masterKey) return null;

    const vault = new storageLib.Vault({
        backend: runtime.storageBackend,
        masterKey,
    });
    try {
        await vault.open();
        runtime.vault = vault;
        runtime.host = createDesktopMessageHost({
            vault,
            chainRegistry: runtime.chainRegistry,
            sdkRegistry: runtime.sdkRegistry,
            getDiagnosticContext: runtime.getDiagnosticContext,
        });
        return runtime.host;
    } catch (err) {
        // Cached key doesn't decrypt the vault — most likely the user
        // reset the wallet, or the vault file was replaced by a
        // different install. Close the vault (zeros its key copy) and
        // clear the stale session so the renderer sees a clean
        // locked / no-wallet state and can drive unlock or onboarding.
        try { vault.close(); } catch (_err) { /* already closed */ }
        try { await runtime.sessionBackend.clear(); } catch (_err) { /* best-effort */ }
        runtime.vault = null;
        runtime.host = null;
        throw err;
    } finally {
        masterKey.fill(0);
    }
}

/**
 * Close the vault + drop the host. Used by the `wallet.lock` pre-host
 * callback and by app-before-quit. Safe to call when already torn down.
 *
 * @param {DesktopRuntime} runtime
 */
export function tearDownHost(runtime) {
    if (runtime.vault) {
        try { runtime.vault.close(); } catch (_err) { /* already closed */ }
        runtime.vault = null;
    }
    runtime.host = null;
}

/**
 * Route an IPC message to the pre-host dispatcher or the MessageHost,
 * returning the standard `{ ok, result } | { ok, error }` envelope.
 *
 * @param {DesktopRuntime} runtime
 * @param {{ type?: unknown, request?: unknown }} message
 */
export async function handleIpcMessage(runtime, message) {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        return errorEnvelope(Object.assign(
            new Error('desktop: message.type is required'),
            { name: 'InvalidMessageError' },
        ));
    }

    try {
        if (PRE_HOST_MESSAGE_TYPES.has(message.type)) {
            const result = await dispatchPreHost(message.type, message.request, {
                storageBackend: runtime.storageBackend,
                sessionBackend: runtime.sessionBackend,
                metaBackend: runtime.metaBackend,
                chainRegistry: runtime.chainRegistry,
                sdkRegistry: runtime.sdkRegistry,
                onUnlocked: async () => {
                    try { await ensureHost(runtime); } catch (err) {
                        // Logged but not thrown — the unlock itself
                        // succeeded; the host-build failure will
                        // resurface on the next message if it's real.
                        console.error('[xchain] ensureHost after unlock failed:', err);
                    }
                },
                onLocked: () => { tearDownHost(runtime); },
            });
            return { ok: true, result };
        }

        const host = runtime.host ?? await ensureHost(runtime);
        if (!host) {
            return errorEnvelope(Object.assign(
                new Error('Wallet is locked — unlock before calling vault-backed handlers'),
                { name: 'WalletLockedError' },
            ));
        }
        return await host.handle({ type: message.type, request: message.request });
    } catch (err) {
        return errorEnvelope(err);
    }
}

function errorEnvelope(err) {
    return {
        ok: false,
        error: {
            name: (err && err.name) || 'Error',
            message: (err && err.message) || String(err),
        },
    };
}
