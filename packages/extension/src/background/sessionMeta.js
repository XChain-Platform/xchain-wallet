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
//   - `wallet.create.hardware`    Fresh install: onboard with a hardware wallet.
//   - `wallet.hardware.balances`  The connect flow's account balances, vault or not.
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
import { handlePhraseReset, handleRecoveryStatus, handleVerifyBackup } from './walletRecovery.js';
import { handleWalletLock } from './walletLock.js';
import {
    handleHardwareWalletBalances,
    handleWalletCreateHardware,
    handleWalletCreateWithMnemonic,
    handleWalletImport,
    handleWalletImportBackup,
} from './walletCreate.js';
import { SIGNING_SECRET_SESSION_KEY } from './signingSecretSession.js';
import { isTrustedExtensionSender } from '../bridge/publicSurface.js';
import { ChromeUnlockThrottleStore } from './unlockThrottle.js';
import { serializeError } from './MessageHost.js';
import { VaultIncompleteError, vaultErrorKind } from '@xchain-wallet/core/storage/backend.js';

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
 *   signerPool?: import('@xchain-wallet/core').signers.SignerPool,
 *   onUnlocked?: () => Promise<void> | void,
 *   onLocked?: (result: { secretsCleared: boolean }) => Promise<void> | void,
 *   isLockPending?: () => boolean | Promise<boolean>,
 *   startLabelSyncRestore?: (opts: object) => string,
 *   lockedAutopay?: { status: () => object, end: (reason: string) => Promise<boolean> },
 *   beforeSessionStart?: (type: string) => Promise<unknown> | unknown,
 *   readSettings?: () => Promise<unknown> | unknown,
 *   priceOracle?: { getNativePrices: Function } | null,
 *   onPhraseRecoveryReconcile?: (pending: Promise<boolean>) => void,   handed the off-path recovery-record write a create, import, unlock or reset starts (tests await it)
 * }} PreHostDispatchDeps
 *
 * @typedef {Object} PreHostDeps
 * @property {{ status: () => object, end: (reason: string) => Promise<boolean> }} [lockedAutopay]   PC-16 Phase B controller: plain status and Stop for the Locked screen
 * @property {(type: string) => Promise<unknown> | unknown} [beforeSessionStart]   runs before an unlock, create or import opens a vault (ends locked auto pay first)
 * @property {() => Promise<void> | void} [onUnlocked]
 * @property {() => Promise<void> | void} [beforeSessionSave]   invalidates a restore before a new session key becomes visible
 * @property {(result: { secretsCleared: boolean }) => Promise<void> | void} [onLocked]   receives whether both secret clears succeeded, so a shell can keep its auto-lock retry record when they did not
 * @property {() => boolean | Promise<boolean>} [isLockPending]   true while a refused lock's secret clear awaits its retry; status then reads locked
 * @property {(opts: object) => string} [startLabelSyncRestore]
 * @property {import('@xchain-wallet/core').registry.ChainRegistry} [chainRegistry]
 * @property {import('@xchain-wallet/core').sdk.SDKRegistry} [sdkRegistry]
 * @property {import('@xchain-wallet/core').signers.SignerPool | (() => import('@xchain-wallet/core').signers.SignerPool)} [signerPool]
 * @property {() => Promise<unknown> | unknown} [readSettings]   the open vault's settings or null; wallet.hardware.balances honours their price-data switch
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
    // PC-16 Phase B: the Locked screen's auto pay line and its Stop button.
    // Pre-host because they run with the vault closed; trusted senders only,
    // like every type here, and never on the public bridge.
    'autopay.locked.status',
    'autopay.locked.stop',
    // Fresh install whose first wallet is a hardware wallet. The add to an
    // open vault is the host-registered 'wallet.hardware.add'.
    'wallet.create.hardware',
    // The connect flow's accounts step reads balances before any vault
    // exists on a fresh install, so this read answers in every session state.
    'wallet.hardware.balances',
    // Forgot Password (operator ruling 2026-11-16): the lock screen asks which
    // ways back exist, resets with a recovery phrase (a session start), and
    // proves a backup file restores before anything is erased.
    'wallet.recovery.status',
    'wallet.recovery.resetWithPhrase',
    'wallet.recovery.verifyBackup',
]);

// Types that open a vault. Locked auto pay ends before any of them runs, so
// its vault is closed before another one opens.
const SESSION_START_TYPES = new Set([
    'wallet.unlock', 'wallet.create', 'wallet.import', 'wallet.importBackup.fresh',
    'wallet.create.hardware', 'wallet.recovery.resetWithPhrase',
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
                    sessionBackend: new ChromeSessionBackend({ beforeSave: deps.beforeSessionSave }),
                    signingSecretBackend: new ChromeSessionBackend({ key: SIGNING_SECRET_SESSION_KEY }),
                    metaBackend: new ChromeMetaBackend(),
                    unlockThrottleStore: new ChromeUnlockThrottleStore(),
                    chainRegistry: deps.chainRegistry,
                    sdkRegistry: deps.sdkRegistry,
                    signerPool: typeof deps.signerPool === 'function'
                        ? deps.signerPool()
                        : deps.signerPool,
                    onUnlocked: deps.onUnlocked,
                onPhraseRecoveryReconcile: deps.onPhraseRecoveryReconcile,
                    onLocked: deps.onLocked,
                    isLockPending: deps.isLockPending,
                    startLabelSyncRestore: deps.startLabelSyncRestore,
                    lockedAutopay: deps.lockedAutopay,
                    beforeSessionStart: deps.beforeSessionStart,
                    readSettings: deps.readSettings,
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
    if (SESSION_START_TYPES.has(type) && typeof deps.beforeSessionStart === 'function') {
        await deps.beforeSessionStart(type);
    }
    switch (type) {
        case 'autopay.locked.status':
            return deps.lockedAutopay ? deps.lockedAutopay.status() : { active: false };
        case 'autopay.locked.stop':
            if (deps.lockedAutopay) await deps.lockedAutopay.end('stopped');
            return deps.lockedAutopay ? deps.lockedAutopay.status() : { active: false };
        case 'session.status':
            return handleSessionStatus({
                storageBackend: deps.storageBackend,
                sessionBackend: deps.sessionBackend,
                metaBackend: deps.metaBackend,
                isLockPending: deps.isLockPending,
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
                onPhraseRecoveryReconcile: deps.onPhraseRecoveryReconcile,
            });
        case 'wallet.recovery.status':
            return handleRecoveryStatus({ metaBackend: deps.metaBackend });
        case 'wallet.recovery.resetWithPhrase':
            return handlePhraseReset(request, {
                storageBackend: deps.storageBackend,
                sessionBackend: deps.sessionBackend,
                signingSecretBackend: deps.signingSecretBackend,
                metaBackend: deps.metaBackend,
                unlockThrottleStore: deps.unlockThrottleStore,
                signerPool: deps.signerPool,
                chainRegistry: deps.chainRegistry,
                sdkRegistry: deps.sdkRegistry,
                onUnlocked: deps.onUnlocked,
                onPhraseRecoveryReconcile: deps.onPhraseRecoveryReconcile,
            });
        case 'wallet.recovery.verifyBackup':
            return handleVerifyBackup(request, {
                resolveBackupContent: deps.resolveBackupContent,
                metaBackend: deps.metaBackend,
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
                signerPool: deps.signerPool,
                onUnlocked: deps.onUnlocked,
                onPhraseRecoveryReconcile: deps.onPhraseRecoveryReconcile,
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
                signerPool: deps.signerPool,
                onUnlocked: deps.onUnlocked,
                onPhraseRecoveryReconcile: deps.onPhraseRecoveryReconcile,
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
                onPhraseRecoveryReconcile: deps.onPhraseRecoveryReconcile,
                startLabelSyncRestore: deps.startLabelSyncRestore,
            });
        case 'wallet.create.hardware':
            return handleWalletCreateHardware(request, {
                storageBackend: deps.storageBackend,
                sessionBackend: deps.sessionBackend,
                signingSecretBackend: deps.signingSecretBackend,
                metaBackend: deps.metaBackend,
                chainRegistry: deps.chainRegistry,
                sdkRegistry: deps.sdkRegistry,
                onUnlocked: deps.onUnlocked,
                onPhraseRecoveryReconcile: deps.onPhraseRecoveryReconcile,
            });
        case 'wallet.hardware.balances':
            return handleHardwareWalletBalances(request, {
                chainRegistry: deps.chainRegistry,
                sdkRegistry: deps.sdkRegistry,
                readSettings: deps.readSettings,
                ...('priceOracle' in deps ? { priceOracle: deps.priceOracle } : {}),
            });
        default:
            throw new Error(`pre-host: no dispatcher for "${type}"`);
    }
}

/**
 * Answer whether a cached session key exists, zeroing the copy read to find out.
 *
 * Means exactly `load() != null`, so a cached key that will not decrypt is no
 * session; a file-exists check would report 'unlocked' for a host that cannot
 * be built. The fill(0) follows the convention `ensureHost` and `buildHost` keep.
 *
 * @param {{ load: () => Promise<Uint8Array | null> }} sessionBackend
 * @returns {Promise<boolean>}
 */
export async function hasSessionKey(sessionBackend) {
    let bytes = null;
    try {
        bytes = await sessionBackend.load();
        return bytes != null;
    } finally {
        if (bytes instanceof Uint8Array) bytes.fill(0);
    }
}

/**
 * Whether a meta record is on disk while the blob is not: one that loads, or
 * one too damaged to parse. A read that fails any other way says nothing
 * either way, so it answers false and status keeps its plain answer.
 *
 * @param {PreHostBackends['metaBackend']} metaBackend
 * @returns {Promise<boolean>}
 */
async function metaOutlivedVault(metaBackend) {
    try {
        return Boolean(await metaBackend.load());
    } catch (err) {
        return vaultErrorKind(err) === 'corrupt';
    }
}

/**
 * A lock that refused to clear the key leaves it in storage until the retry
 * lands; `isLockPending` reports that window, and status reads locked through it.
 *
 * @param {{ storageBackend: PreHostBackends['storageBackend'], sessionBackend: PreHostBackends['sessionBackend'], metaBackend?: PreHostBackends['metaBackend'], isLockPending?: () => boolean | Promise<boolean> }} deps
 * @throws {VaultIncompleteError} when the meta is on disk and the blob is not
 */
export async function handleSessionStatus({ storageBackend, sessionBackend, metaBackend, isLockPending }) {
    const blob = await storageBackend.load();
    const hasWallet = blob !== null;
    // Meta with no blob is an install nothing can open and onboarding cannot
    // write over: assertFreshVault refuses every create, import and restore
    // while the meta is there, and a meta too damaged to parse refuses them
    // the same way. Answering no-wallet would open that dead end, so the
    // shell gets the incomplete-wallet screen, whose reset clears the meta.
    if (!hasWallet && metaBackend && await metaOutlivedVault(metaBackend)) {
        throw new VaultIncompleteError();
    }
    // Awaited: the extension hook settles only after its persisted marker loads.
    const lockPending = (await isLockPending?.()) === true;
    const hasSession = lockPending ? false : await hasSessionKey(sessionBackend);
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
