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
    signers as signersLib,
    storage as storageLib,
} from '@xchain-wallet/core';
// Cross-package relative path rather than `@xchain-wallet/extension` so
// this module resolves under Node without the pnpm workspace symlink
// (needed for smoke tests) while still bundling cleanly through Vite
// at build time. Candidate for a lower-level package extraction once a
// third shell appears.
import { createBackgroundHost } from '../../extension/src/background/createBackgroundHost.js';
import { WALLET_VERSION } from '@xchain-wallet/core/buildInfo.js';
import {
    fakeBalanceFor,
    fakeOwnedTokensFor,
    fakeTokenInfoFor,
    fakeDispensersFor,
    fakeOrdersFor,
    fakeSwapsFor,
    fakeHoldersFor,
    fakeHistoryFor,
} from './devFakeBalances.js';

// §50 / Cluster L FOLLOWUP 4 — shell-specific diagnostic env + build
// for the dump handler. Same shape across all three createBackgroundHost
// call sites (create-from-fresh, create-from-existing, unlock).
const webDiagnosticContext = async () => ({
    env: {
        shell: 'web',
        userAgent:
            typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        platform:
            typeof navigator !== 'undefined' ? navigator.platform : undefined,
    },
    build: {
        walletVersion: WALLET_VERSION,
    },
});
import { IndexedDBStorageBackend } from './storage/IndexedDBStorageBackend.js';
import { WebMetaBackend } from './storage/WebMetaBackend.js';
import { resolveSdkFactory } from './sdkFactory.js';

const chainRegistry = registryLib.defaultRegistry();

// Dev-mode SDK stub — fallback when `xchain-sdk` isn't resolvable.
//
// Production builds load the real SDK via `resolveSdkFactory` which
// dynamically imports `xchain-sdk`. This stub exists so Node smoke
// tests (no workspace install) + RC builds pre-SDK-pin can still
// exercise the onboarding / read flows.
//
// `deriveAddress` returns deterministic pseudo-addresses per
// (pubkey, type) so createWallet / importMnemonic persist real vault
// records. Signing / broadcast / WIF-import throw loudly — those
// paths have no non-SDK implementation.
const createDevMockSdk = (constructorOpts) => {
    // Each per-chain SDK instance carries its own `network` (chainId)
    // so the fake-balance dataset can return chain-appropriate values.
    const chainId = constructorOpts?.network || 'bitcoin-mainnet';

    // Read-side stub. Any `get*` method the wallet calls before the
    // real SDK has finished loading (or when the real SDK isn't
    // resolvable at all) returns an empty list / zero-balance shape
    // rather than crashing with "X.getBalances is not a function".
    // `getBalances` is overridden to return the realistic dev dataset
    // so the UI has something to render. Methods that mutate or sign
    // throw loudly — those paths have no non-SDK implementation.
    const readStub = new Proxy({}, {
        get(_target, prop) {
            if (typeof prop !== 'string') return undefined;
            if (prop === 'getBalances') {
                return async (address /* , opts */) => fakeBalanceFor(address, chainId);
            }
            if (prop === 'getToken') {
                // Single-token lookup powering useTokenInfo + the chart
                // on ManageToken / TokenDetail. Returns the indexer's
                // wire shape (info / supply / locks / market) when the
                // tick is in the dev dataset.
                return async (tick) => fakeTokenInfoFor(tick, chainId);
            }
            if (prop === 'getTokens') {
                // Only the "tokens owned by this address" lookup gets a
                // populated dev response; the substring-search shape
                // (type === 'token') stays empty so dev ReceivePicker
                // doesn't promise fake results from the platform.
                return async (_query, type /* , opts */) => {
                    if (type === 'address') return fakeOwnedTokensFor(chainId);
                    return [];
                };
            }
            // ManageToken tab panels — Dispensers / Orders / Swaps /
            // Holders / Activity. Real explorer isn't reachable from
            // this build (explorer.xchain.io is not yet provisioned),
            // so the dev mock returns realistic populated rows for the
            // tick-scoped queries that ManageToken issues. Other shapes
            // (address-scoped, market-scoped) stay empty to avoid
            // promising fake results elsewhere in the UI.
            if (prop === 'getDispensers') {
                return async (query, type /* , opts */) => {
                    if (type === 'token' && query) return fakeDispensersFor(query, chainId);
                    return [];
                };
            }
            if (prop === 'getOrders') {
                return async (query, type /* , opts */) => {
                    if (type === 'token' && query) return fakeOrdersFor(query, chainId);
                    return [];
                };
            }
            if (prop === 'getSwaps') {
                return async (query, type /* , opts */) => {
                    if (type === 'token' && query) return fakeSwapsFor(query, chainId);
                    return [];
                };
            }
            if (prop === 'getHistory') {
                return async (query, type /* , opts */) => {
                    if (type === 'token' && query) return fakeHistoryFor(query, chainId);
                    return [];
                };
            }
            if (prop === 'getHolders') {
                return async (tick /* , opts */) => {
                    if (tick) return fakeHoldersFor(tick, chainId);
                    return [];
                };
            }
            if (prop.startsWith('get')) {
                return async () => [];
            }
            return undefined;
        },
    });
    const sdk = {
        wallet: {
            /**
             * @param {string} publicKeyHex
             * @param {{ type?: string }} [opts]
             */
            deriveAddress(publicKeyHex, opts) {
                return sdkLib.mockDeriveAddress(chainId, opts?.type ?? 'p2wpkh', publicKeyHex);
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
    };
    // Compose: explicit fields (wallet/auth) win; everything else falls
    // through to the read stub so any sdk.getXxx() call resolves to [].
    return new Proxy(sdk, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            return Reflect.get(readStub, prop, receiver);
        },
    });
};

// Build the SDKRegistry against a boot-time-resolved factory. Starts
// with the dev mock so the module is usable synchronously; the real
// factory swaps in once the dynamic import settles. A lazy swap like
// this is safe because `SDKRegistry._instances` caches per chain, so
// early-bind calls (onboarding) get the mock and post-resolution
// calls (Send) get the real SDK. For a clean production run users
// should onboard AFTER the swap — the `sdkResolved` promise below
// gives callers a handle on that.
let sdkRegistry = new sdkLib.SDKRegistry({
    chainRegistry,
    sdkFactory: createDevMockSdk,
});

export const sdkResolved = resolveSdkFactory({ devMockFactory: createDevMockSdk })
    .then((result) => {
        sdkRegistry = new sdkLib.SDKRegistry({
            chainRegistry,
            sdkFactory: result.factory,
        });
        return result.source;
    })
    .catch(() => 'dev-mock');

/** Default active chains for onboarding. Users can change later via Settings. */
export const DEFAULT_ACTIVE_CHAIN_IDS = [
    'bitcoin-mainnet',
    'dogecoin-mainnet',
    'litecoin-mainnet',
];

let host = null;
let vault = null;
let signerPool = null;

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
        signerPool = new signersLib.SignerPool();
        await signerPool.populate({
            vault,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
        host = createBackgroundHost({
            vault,
            chainRegistry,
            sdkRegistry,
            signerPool,
            getDiagnosticContext: webDiagnosticContext,
        });
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
        signerPool = new signersLib.SignerPool();
        await signerPool.populate({
            vault,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
        host = createBackgroundHost({
            vault,
            chainRegistry,
            sdkRegistry,
            signerPool,
            getDiagnosticContext: webDiagnosticContext,
        });
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

        // Populate the SignerPool while the password is in scope so
        // subsequent HD-derive ops (account.create, receive.getAddress
        // for software signers) reuse pre-unlocked signers without
        // re-prompting. Pool is cleared in lockWalletLocal.
        signerPool = new signersLib.SignerPool();
        await signerPool.populate({
            vault,
            password,
            chainRegistry,
            sdkRegistry,
        });

        host = createBackgroundHost({
            vault,
            chainRegistry,
            sdkRegistry,
            signerPool,
            getDiagnosticContext: webDiagnosticContext,
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
    if (signerPool) {
        try { signerPool.lockAll(); } catch (_err) { /* best-effort */ }
    }
    signerPool = null;
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
