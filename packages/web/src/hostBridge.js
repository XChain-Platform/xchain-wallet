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

// Dev-mode SDK stub — DO NOT USE FOR MAINNET.
//
// The real XChain SDK (a bundled CJS package with bitcoinjs-lib,
// axios, ws, etc.) wires into the web + extension shells in a
// dedicated piece. Until then `deriveAddress` is the only call that
// has to succeed for the create / import onboarding flows to produce
// a persisted wallet record — signing and broadcast legitimately
// can't be fulfilled without the real SDK, so they throw loudly.
//
// Pseudo-addresses derived here are deterministic per (pubkey, type)
// but are NOT valid on-chain. A release candidate replaces this with
// `adaptXChainSDK(XChainSDK)`; until then the wallet will fail gracefully
// on Send / broadcast even after onboarding completes.
const createDevMockSdk = () => ({
    wallet: {
        /**
         * @param {string} publicKeyHex
         * @param {{ type?: string }} [opts]
         */
        deriveAddress(publicKeyHex, opts) {
            const type = opts?.type ?? 'p2wpkh';
            const prefix = {
                p2pkh: '1devmock',
                'p2sh-p2wpkh': '3devmock',
                p2wpkh: 'bc1qdevmock',
                p2tr: 'bc1pdevmock',
            }[type] ?? `${type}:`;
            const tail = String(publicKeyHex || '').slice(0, 24);
            return `${prefix}${tail}`.toLowerCase();
        },
        signPsbt() { throw new Error('Dev SDK stub: signing requires the real xchain-sdk'); },
        validateAddress(addr) {
            return {
                valid: typeof addr === 'string' && addr.length > 0,
                type: null,
                network: null,
                error: null,
            };
        },
        broadcastTx() { return Promise.reject(new Error('Dev SDK stub: broadcast requires the real xchain-sdk')); },
        importWIF() { throw new Error('Dev SDK stub: WIF import requires the real xchain-sdk'); },
    },
    auth: {
        signMessage() { throw new Error('Dev SDK stub: message signing requires the real xchain-sdk'); },
        verifyMessage() { return false; },
        generateChallenge() { return ''; },
    },
});

const sdkRegistry = new sdkLib.SDKRegistry({
    chainRegistry,
    sdkFactory: createDevMockSdk,
});

/** Default active chains for onboarding. Users can change later via Settings. */
export const DEFAULT_ACTIVE_CHAIN_IDS = [
    'bitcoin-mainnet',
    'dogecoin-mainnet',
    'litecoin-mainnet',
];

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
 * Create a fresh BIP39 wallet. Generates kdfParams, derives the master
 * key from `password`, opens a blank Vault, runs the core `createWallet`
 * flow, persists kdfParams to the meta slot, and leaves the host live
 * so the app transitions to `unlocked` on the next `getSessionStatus`.
 *
 * @param {{ password: string, name?: string, strengthBits?: 128 | 160 | 192 | 224 | 256, bip39Passphrase?: string, activeChainIds?: string[] }} req
 * @returns {Promise<{ mnemonic: string, walletName: string }>}
 */
export async function createWalletLocal(req) {
    const password = req?.password;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.create: password is required');
    }
    const {
        name = 'Main Wallet',
        strengthBits = 128,
        bip39Passphrase = '',
        activeChainIds = DEFAULT_ACTIVE_CHAIN_IDS,
    } = req;

    const meta = new WebMetaBackend();
    if (await meta.load()) {
        throw new Error('wallet.create: a wallet already exists — import or reset first');
    }

    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    try {
        const storage = new IndexedDBStorageBackend();
        const v = new storageLib.Vault({ backend: storage, masterKey });
        await v.open();  // blank document
        const flowsNs = await getFlows();
        const result = await flowsNs.createWallet({
            password,
            vault: v,
            chainRegistry,
            sdkRegistry,
            activeChainIds,
            name,
            strengthBits,
            bip39Passphrase,
            kdfParams,
        });
        await v.save();
        vault = v;
        host = createBackgroundHost({ vault, chainRegistry, sdkRegistry });
        await meta.save({ kdfParams });
        return { mnemonic: result.mnemonic, walletName: result.wallet.name };
    } finally {
        masterKey.fill(0);
    }
}

/**
 * Import a pre-existing mnemonic (BIP39 12/24-word or Counterwallet
 * legacy 12-word). Same persistence path as `createWalletLocal` — fresh
 * kdfParams, open vault, run the core `importMnemonic` flow, save meta.
 *
 * @param {{ password: string, mnemonic: string, name?: string, bip39Passphrase?: string, activeChainIds?: string[] }} req
 * @returns {Promise<{ format: 'bip39' | 'counterwallet-legacy', walletName: string }>}
 */
export async function importMnemonicLocal(req) {
    const password = req?.password;
    const mnemonic = req?.mnemonic;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.import: password is required');
    }
    if (typeof mnemonic !== 'string' || mnemonic.trim().length === 0) {
        throw new Error('wallet.import: mnemonic is required');
    }
    const {
        name = 'Imported Wallet',
        bip39Passphrase = '',
        activeChainIds = DEFAULT_ACTIVE_CHAIN_IDS,
    } = req;

    const meta = new WebMetaBackend();
    if (await meta.load()) {
        throw new Error('wallet.import: a wallet already exists — unlock or reset first');
    }

    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    try {
        const storage = new IndexedDBStorageBackend();
        const v = new storageLib.Vault({ backend: storage, masterKey });
        await v.open();
        const flowsNs = await getFlows();
        const result = await flowsNs.importMnemonic({
            password,
            mnemonic,
            vault: v,
            chainRegistry,
            sdkRegistry,
            activeChainIds,
            name,
            bip39Passphrase,
            kdfParams,
        });
        await v.save();
        vault = v;
        host = createBackgroundHost({ vault, chainRegistry, sdkRegistry });
        await meta.save({ kdfParams });
        return { format: result.format, walletName: result.wallet.name };
    } finally {
        masterKey.fill(0);
    }
}

/** Lazy-load the flows namespace so tests that don't touch onboarding
 * don't pay the cost of pulling every flow + BIP39 wordlist at module
 * init. */
let _flowsCache = null;
async function getFlows() {
    if (_flowsCache) return _flowsCache;
    const mod = await import('@xchain-wallet/core');
    _flowsCache = mod.flows;
    return _flowsCache;
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
