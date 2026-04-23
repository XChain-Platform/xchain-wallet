// In-page MessageHost + Vault for the web shell (§9.3.3).
//
// Extension shells dispatch messages across a service-worker boundary
// via chrome.runtime; the web shell runs the whole thing in one
// process. This module owns module-scoped `vault` + `host` so state
// survives component re-renders but is gone on tab close / reload (the
// web key-isolation tradeoff the spec calls out).
//
// Session semantics:
//   - The master key lives in `vault` (in-memory). There is no
//     `chrome.storage.session` equivalent — a page refresh re-locks
//     the wallet, by design.
//   - kdfParams live in `localStorage` via WebMetaBackend so the
//     unlock flow can derive the master key before touching the
//     IndexedDB ciphertext.
//
// The `sendMessage(type, request)` function exposes the MessageHost
// under the same envelope shape the extension's popup uses (popup's
// `chromeMessaging.sendMessage` wrapper). Keeps the route-level
// messaging helpers nearly identical across shells.

import {
    crypto as cryptoLib,
    registry as registryLib,
    sdk as sdkLib,
    storage as storageLib,
} from '@xchain-wallet/core';
// Cross-package relative path rather than `@xchain-wallet/extension` so
// this module resolves under Node without the pnpm workspace symlink
// (needed for smoke tests) while still bundling cleanly through Vite
// at build time. Candidate for a lower-level package extraction once a
// third shell appears.
import { createBackgroundHost } from '../../extension/src/background/createBackgroundHost.js';
import { IndexedDBStorageBackend } from './storage/IndexedDBStorageBackend.js';
import { WebMetaBackend } from './storage/WebMetaBackend.js';

const chainRegistry = registryLib.defaultRegistry();

// Stub SDK factory — the real SDK wiring for the web shell lands
// alongside the extension's SDK integration in a later piece.
const scaffoldSdkFactory = () => ({
    wallet: {
        deriveAddress() { throw new Error('SDK not yet wired'); },
        signPsbt() { throw new Error('SDK not yet wired'); },
        validateAddress() {
            return { valid: false, type: null, network: null, error: 'SDK not wired' };
        },
        broadcastTx() { return Promise.reject(new Error('SDK not yet wired')); },
        importWIF() { throw new Error('SDK not yet wired'); },
    },
    auth: {
        signMessage() { throw new Error('SDK not yet wired'); },
        verifyMessage() { return false; },
        generateChallenge() { return ''; },
    },
});

const sdkRegistry = new sdkLib.SDKRegistry({
    chainRegistry,
    sdkFactory: scaffoldSdkFactory,
});

let host = null;
let vault = null;

/**
 * Classify the current wallet-session state — matches the extension's
 * `session.status` response shape so route code can be shared verbatim.
 *
 * @returns {Promise<{ hasWallet: boolean, hasSession: boolean, state: 'no-wallet' | 'locked' | 'unlocked' }>}
 */
export async function getSessionStatus() {
    const storage = new IndexedDBStorageBackend();
    const blob = await storage.load();
    const hasWallet = blob !== null;
    const hasSession = host !== null;
    return {
        hasWallet,
        hasSession,
        state: !hasWallet ? 'no-wallet' : hasSession ? 'unlocked' : 'locked',
    };
}

export class InvalidPasswordError extends Error {
    constructor() {
        super('Incorrect password.');
        this.name = 'InvalidPasswordError';
    }
}

export class NoVaultError extends Error {
    constructor() {
        super('No wallet exists to unlock.');
        this.name = 'NoVaultError';
    }
}

/**
 * Derive the master key from `password`, open the encrypted vault,
 * and build the MessageHost in-page.
 *
 * @param {{ password: string }} req
 * @returns {Promise<{ unlocked: true }>}
 */
export async function unlockWalletLocal(req) {
    const password = req?.password;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.unlock: password is required');
    }
    const meta = /** @type {any} */ (await new WebMetaBackend().load());
    if (!meta || !meta.kdfParams) {
        throw new NoVaultError();
    }

    const masterKey = cryptoLib.deriveMasterKey(password, meta.kdfParams);
    try {
        const storage = new IndexedDBStorageBackend();
        const v = new storageLib.Vault({ backend: storage, masterKey });
        try {
            await v.open();
        } catch (err) {
            if (isAeadAuthFailure(err)) throw new InvalidPasswordError();
            throw err;
        }
        vault = v;
        host = createBackgroundHost({
            vault,
            chainRegistry,
            sdkRegistry,
        });
        return { unlocked: true };
    } finally {
        masterKey.fill(0);
    }
}

/**
 * Close the vault + drop the host. Matches the extension's
 * `wallet.lock` behaviour.
 *
 * @returns {Promise<{ locked: true }>}
 */
export async function lockWalletLocal() {
    if (vault) {
        try { vault.close(); } catch (_err) { /* best-effort */ }
    }
    vault = null;
    host = null;
    return { locked: true };
}

/**
 * Envelope-returning host dispatcher. Matches the `sendMessage` shape
 * used by the extension's popup so route code is swap-compatible.
 *
 * @param {string} type
 * @param {unknown} [request]
 * @returns {Promise<unknown>}
 */
export async function sendMessage(type, request) {
    if (!host) {
        throw Object.assign(new Error('wallet is locked'), { name: 'VaultClosedError' });
    }
    const response = await host.handle({ type, request });
    if (response.ok) return response.result;
    throw Object.assign(new Error(response.error.message), {
        name: response.error.name,
    });
}

/** Test hook — expose module state without touching real IDB/localStorage. */
export function __resetForTests() {
    vault = null;
    host = null;
}

function isAeadAuthFailure(err) {
    if (!err) return false;
    const name = err.name || '';
    const msg = err.message || String(err);
    return (
        name === 'OperationError' ||
        name === 'InvalidAccessError' ||
        /operation[- ]?error|auth|tag/i.test(msg)
    );
}
