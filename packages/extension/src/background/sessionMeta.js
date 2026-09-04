// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pre-host message dispatcher: answers a small set of types that
// must work BEFORE the MessageHost's vault-backed handlers come online:
//
//   - `session.status`  What state is the wallet in? (no-wallet / locked / unlocked)
//   - `wallet.unlock`   Derive master key from password, open vault, seed session.
//   - `wallet.lock`     Clear the session key and signal teardown.
//   - `wallet.create`   Fresh install: onboard with a generated mnemonic.
//   - `wallet.import`   Fresh install: onboard with an existing mnemonic.
//
// Anything outside `PRE_HOST_MESSAGE_TYPES` falls through to the host
// listener. `ChromeRuntimeAdapter` imports that set to know which types
// it should not handle, keeping the two listeners disjoint (no double
// `sendResponse` on the same message).
//
// The shell-agnostic `dispatchPreHost` + `handleSessionStatus` helpers
// are exported so the desktop shell's ipcMain handler can route pre-host
// messages identically: same handlers, same validation, same error
// shapes; only the backend classes differ (Chrome storage vs file +
// keychain).

import {
    ChromeMetaBackend,
    ChromeSessionBackend,
    ChromeStorageBackend,
} from '../storage/index.js';
import { handleWalletUnlock } from './walletUnlock.js';
import { handleWalletLock } from './walletLock.js';
import {
    handleWalletCreateWithMnemonic,
    handleWalletImport,
    handleWalletImportBackup,
} from './walletCreate.js';
import { SIGNING_SECRET_SESSION_KEY } from './signingSecretSession.js';
import { isTrustedExtensionSender } from '../bridge/publicSurface.js';
import { ChromeUnlockThrottleStore } from './unlockThrottle.js';
import { serializeError } from './MessageHost.js';

/**
 * @typedef {Object} PreHostBackends
 * @property {{ load: () => Promise<Uint8Array | null>, save: (blob: Uint8Array) => Promise<void>, clear: () => Promise<void> }} storageBackend
 * @property {{ load: () => Promise<Uint8Array | null>, save: (blob: Uint8Array) => Promise<void>, clear: () => Promise<void> }} sessionBackend
 * @property {{ load: () => Promise<Uint8Array | null>, save: (blob: Uint8Array) => Promise<void>, clear: () => Promise<void> }} [signingSecretBackend]   extension-only session slot for the cached password (SignerPool rehydration after a service-worker restart); absent on desktop
 * @property {{ load: () => Promise<unknown | null>, save: (obj: unknown) => Promise<void>, clear: () => Promise<void> }} metaBackend
 *
 * @typedef {PreHostBackends & {
 *   chainRegistry?: import('@xchain-wallet/core').registry.ChainRegistry,
 *   sdkRegistry?: import('@xchain-wallet/core').sdk.SDKRegistry,
 *   onUnlocked?: () => Promise<void> | void,
 *   onLocked?: () => Promise<void> | void,
 * }} PreHostDispatchDeps
 *
 * @typedef {Object} PreHostDeps
 * @property {() => Promise<void> | void} [onUnlocked]
 * @property {() => Promise<void> | void} [onLocked]
 * @property {import('@xchain-wallet/core').registry.ChainRegistry} [chainRegistry]
 * @property {import('@xchain-wallet/core').sdk.SDKRegistry} [sdkRegistry]
 */

/** Types the pre-host listener owns. `ChromeRuntimeAdapter` ignores these. */
export const PRE_HOST_MESSAGE_TYPES = new Set([
    'session.status',
    'wallet.unlock',
    'wallet.lock',
    'wallet.create',
    'wallet.import',
    // The FRESH-INSTALL backup restore. Named apart from the
    // host-registered 'wallet.importBackup' on purpose - that one adds a wallet
    // to an open vault, and putting the same string in this set would take it
    // away from the host and break the shipping add lane.
    'wallet.importBackup.fresh',
]);

/**
 * @param {PreHostDeps} [deps]
 * @param {{ onMessage: { addListener: Function, removeListener: Function } }} [chromeRuntime]
 * @returns {() => void} detach fn
 */
export function attachSessionMetaListener(deps = {}, chromeRuntime) {
    const runtime =
        chromeRuntime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (!runtime || !runtime.onMessage) {
        return () => {};
    }

    const listener = (message, sender, sendResponse) => {
        if (!message || typeof message !== 'object') return false;
        const type = message.type;
        if (typeof type !== 'string' || !PRE_HOST_MESSAGE_TYPES.has(type)) {
            return false;
        }
        // Trust boundary: session lifecycle (status / unlock / lock /
        // create / import) is UI-only. None of these are part of the
        // public `bridge.*` surface, so reject them from any sender that
        // is not the extension's own page. Otherwise a web page could
        // probe unlock state (recon) or lock the wallet (DoS) via the
        // content-script relay.
        if (!isTrustedExtensionSender(sender, runtime.id)) {
            sendResponse({
                ok: false,
                error: {
                    name: 'BridgeError',
                    code: 'FORBIDDEN_SENDER',
                    message: 'this message type is not available to web origins',
                },
            });
            return true;
        }
        (async () => {
            try {
                const result = await dispatchPreHost(type, message.request, {
                    storageBackend: new ChromeStorageBackend(),
                    sessionBackend: new ChromeSessionBackend(),
                    signingSecretBackend: new ChromeSessionBackend({ key: SIGNING_SECRET_SESSION_KEY }),
                    metaBackend: new ChromeMetaBackend(),
                    unlockThrottleStore: new ChromeUnlockThrottleStore(),
                    chainRegistry: deps.chainRegistry,
                    sdkRegistry: deps.sdkRegistry,
                    signerPool: typeof deps.signerPool === 'function'
                        ? deps.signerPool()
                        : deps.signerPool,
                    onUnlocked: deps.onUnlocked,
                    onLocked: deps.onLocked,
                });
                sendResponse({ ok: true, result });
            } catch (err) {
                // The same serializer the host lane uses. A hand-rolled
                // { name, message } dropped `code` and the THROTTLED hints
                // (retryAfterMs / burst / windowMs) that the renderer
                // transports all rebuild, and `UnlockThrottledError` carries
                // retryAfterMs on exactly this lane.
                sendResponse(serializeError(err));
            }
        })();
        return true; // async response
    };

    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
}

/**
 * Shell-agnostic pre-host dispatcher. Shells build their own backend
 * trio (storage + session + meta) that implement the three-method
 * contract (load/save/clear) and hand them in here; everything else is
 * shared.
 *
 * @param {string} type
 * @param {unknown} request
 * @param {PreHostDispatchDeps} deps
 */
export async function dispatchPreHost(type, request, deps) {
    if (!deps?.storageBackend) {
        throw new Error('dispatchPreHost: storageBackend is required');
    }
    if (!deps?.sessionBackend) {
        throw new Error('dispatchPreHost: sessionBackend is required');
    }
    if (!deps?.metaBackend) {
        throw new Error('dispatchPreHost: metaBackend is required');
    }
    switch (type) {
        case 'session.status':
            return handleSessionStatus({
                storageBackend: deps.storageBackend,
                sessionBackend: deps.sessionBackend,
            });
        case 'wallet.unlock':
            return handleWalletUnlock(request, {
                storageBackend: deps.storageBackend,
                sessionBackend: deps.sessionBackend,
                signingSecretBackend: deps.signingSecretBackend,
                metaBackend: deps.metaBackend,
                unlockThrottleStore: deps.unlockThrottleStore,
                signerPool: deps.signerPool,
                chainRegistry: deps.chainRegistry,
                sdkRegistry: deps.sdkRegistry,
                onUnlocked: deps.onUnlocked,
            });
        case 'wallet.lock':
            return handleWalletLock(request, {
                sessionBackend: deps.sessionBackend,
                signingSecretBackend: deps.signingSecretBackend,
                onLocked: deps.onLocked,
            });
        case 'wallet.create':
            return handleWalletCreateWithMnemonic(request, {
                storageBackend: deps.storageBackend,
                sessionBackend: deps.sessionBackend,
                signingSecretBackend: deps.signingSecretBackend,
                metaBackend: deps.metaBackend,
                chainRegistry: deps.chainRegistry,
                sdkRegistry: deps.sdkRegistry,
                onUnlocked: deps.onUnlocked,
            });
        case 'wallet.importBackup.fresh':
            return handleWalletImportBackup(request, {
                storageBackend: deps.storageBackend,
                sessionBackend: deps.sessionBackend,
                signingSecretBackend: deps.signingSecretBackend,
                metaBackend: deps.metaBackend,
                chainRegistry: deps.chainRegistry,
                sdkRegistry: deps.sdkRegistry,
                resolveBackupContent: deps.resolveBackupContent,
                onUnlocked: deps.onUnlocked,
            });
        case 'wallet.import':
            return handleWalletImport(request, {
                storageBackend: deps.storageBackend,
                sessionBackend: deps.sessionBackend,
                signingSecretBackend: deps.signingSecretBackend,
                metaBackend: deps.metaBackend,
                chainRegistry: deps.chainRegistry,
                sdkRegistry: deps.sdkRegistry,
                onUnlocked: deps.onUnlocked,
            });
        default:
            throw new Error(`pre-host: no dispatcher for "${type}"`);
    }
}

/**
 * @param {{ storageBackend: PreHostBackends['storageBackend'], sessionBackend: PreHostBackends['sessionBackend'] }} deps
 */
export async function handleSessionStatus({ storageBackend, sessionBackend }) {
    const blob = await storageBackend.load();
    const sessionBytes = await sessionBackend.load();
    const hasWallet = blob !== null;
    const hasSession = sessionBytes !== null;
    return {
        hasWallet,
        hasSession,
        state: !hasWallet
            ? 'no-wallet'
            : hasSession
                ? 'unlocked'
                : 'locked',
    };
}
