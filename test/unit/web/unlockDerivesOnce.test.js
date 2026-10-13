// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// One Argon2id round per unlock. The vault key and the onboarding wallet's
// seal share a password, a salt and a cost, and one round costs about 5.5 s
// on an LG K51, so the lanes lend the vault key to every later derivation
// whose params are identical and derive normally for any other wallet.
//
// Everything is real except three seams: the KDF (a counting stand-in keyed
// on password, salt and cost, so a wrong password still yields a wrong key
// and the real AEAD still refuses it), the storage backends (in memory), and
// the notification watchers (inert). The KDF is mocked at kdf.js itself, not
// at the barrel, because walletBlob and the flows import it directly: a
// barrel spy would miss exactly the derivations this test counts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const state = vi.hoisted(() => ({
    /** @type {Uint8Array[]} every key the KDF handed out */
    issued: [],
    /** @type {string[]} the salt of each derivation, in order */
    salts: [],
    storageBlob: null,
    meta: null,
    watcherStarts: 0,
    watcherRefreshes: 0,
    idleCallbacks: [],
}));

/** The stand-in derivation: deterministic, cheap, and sensitive to every input. */
function fakeKey(password, params, base64ToBytes) {
    const h = createHash('sha256');
    h.update('fake-argon2id\0');
    h.update(password);
    h.update('\0');
    h.update(base64ToBytes(params.salt));
    h.update(`\0${params.iterations}\0${params.memory}\0${params.parallelism}`);
    return new Uint8Array(h.digest());
}

vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        deriveMasterKeyAsync: async (password, params) => {
            actual.validateKdfParams(params);
            const key = fakeKey(password, params, actual.base64ToBytes);
            state.issued.push(key);
            state.salts.push(params.salt);
            return key;
        },
        // No lane here may fall back to the blocking JS derivation.
        deriveMasterKey: () => { throw new Error('sync KDF reached in a web lane'); },
    };
});

// The web host imports each watcher from its own module, so each module
// is replaced with a counting stand-in that never polls.
const InertModuleWatcher = vi.hoisted(() => class {
    async start() { state.watcherStarts += 1; }
    stop() { /* nothing started */ }
    refresh() { state.watcherRefreshes += 1; return Promise.resolve(); }
});
vi.mock('../../../packages/core/src/notifications/NotificationService.js', () => ({ NotificationService: InertModuleWatcher }));
vi.mock('../../../packages/core/src/notifications/PriceAlertWatcher.js', () => ({ PriceAlertWatcher: InertModuleWatcher }));
vi.mock('../../../packages/core/src/notifications/GovernancePollWatcher.js', () => ({ GovernancePollWatcher: InertModuleWatcher }));
vi.mock('../../../packages/core/src/notifications/CoinpayAutopayWatcher.js', () => ({ CoinpayAutopayWatcher: InertModuleWatcher }));
vi.mock('../../../packages/core/src/notifications/DeadlineWatcher.js', () => ({ DeadlineWatcher: InertModuleWatcher }));
vi.mock('../../../packages/core/src/notifications/DispenserEscrowWatcher.js', () => ({ DispenserEscrowWatcher: InertModuleWatcher }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    class InertWatcher {
        async start() { state.watcherStarts += 1; }
        stop() { /* nothing started */ }
        refresh() { state.watcherRefreshes += 1; return Promise.resolve(); }
    }
    return {
        ...actual,
        notifications: {
            ...actual.notifications,
            NotificationService: InertWatcher,
            PriceAlertWatcher: InertWatcher,
            GovernancePollWatcher: InertWatcher,
            CoinpayAutopayWatcher: InertWatcher,
            DeadlineWatcher: InertWatcher,
            DispenserEscrowWatcher: InertWatcher,
        },
    };
});

vi.mock('../../../packages/web/src/storage/backends.js', () => ({
    createStorageBackend: () => ({
        load: async () => state.storageBlob,
        save: async (blob) => { state.storageBlob = blob; },
        clear: async () => { state.storageBlob = null; },
    }),
    createMetaBackend: () => ({
        load: async () => state.meta,
        save: async (m) => { state.meta = m; },
        clear: async () => { state.meta = null; },
    }),
    installNativeWipeHook: () => {},
    installNativeScreenGuard: () => {},
}));

const core = await import('@xchain-wallet/core');
const kdf = await import('../../../packages/core/src/crypto/kdf.js');
const { SignerPool } = await import('../../../packages/core/src/signers/SignerPool.js');
const {
    createWalletLocal,
    importMnemonicLocal,
    unlockWalletLocal,
    lockWalletLocal,
    InvalidPasswordError,
} = await import('../../../packages/web/src/hostBridge.js');

const PASSWORD = 'correct horse battery';
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const zeroed = (key) => key.every((b) => b === 0);

/** What each populate call returned, with the pool it filled. */
let populated;

beforeEach(async () => {
    await lockWalletLocal();
    state.storageBlob = null;
    state.meta = null;
    state.issued.length = 0;
    state.salts.length = 0;
    state.watcherStarts = 0;
    state.watcherRefreshes = 0;
    state.idleCallbacks.length = 0;
    populated = [];
    vi.stubGlobal('requestIdleCallback', vi.fn((callback) => {
        state.idleCallbacks.push(callback);
        return state.idleCallbacks.length - 1;
    }));
    vi.stubGlobal('cancelIdleCallback', vi.fn((id) => {
        state.idleCallbacks[id] = null;
    }));
    const realPopulate = SignerPool.prototype.populate;
    vi.spyOn(SignerPool.prototype, 'populate').mockImplementation(async function populateSpy(opts) {
        const summary = await realPopulate.call(this, opts);
        populated.push({ pool: this, summary });
        return summary;
    });
    // The label-sync restore asks explorers; refuse at once so the import
    // lane stays offline and fast. It is best-effort and swallows this.
    vi.stubGlobal('fetch', async () => { throw new Error('offline unit test'); });
});

afterEach(async () => {
    await lockWalletLocal();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** Forget the derivations a fixture step made, so the next count starts at zero. */
function resetCount() {
    state.issued.length = 0;
    state.salts.length = 0;
    populated = [];
}

/**
 * Seal a second wallet into the stored vault under the same password but a
 * FRESH salt, the way a wallet added mid-session is sealed.
 */
async function addSecondWallet() {
    const vaultKey = fakeKey(PASSWORD, state.meta.kdfParams, kdf.base64ToBytes);
    const v = new core.storage.Vault({
        backend: { load: async () => state.storageBlob, save: async (b) => { state.storageBlob = b; } },
        masterKey: vaultKey,
    });
    vaultKey.fill(0);
    await v.open();
    const params = kdf.makeFreshKdfParams();
    const mnemonicBytes = new TextEncoder().encode(core.crypto.generateBip39Mnemonic(128));
    const { encryptedSeed, kdfParams } = await core.crypto.encryptWalletSeed({
        password: PASSWORD,
        seed: mnemonicBytes,
        kdfParams: params,
    });
    mnemonicBytes.fill(0);
    const record = core.schemas.createWallet({
        name: 'Second',
        origin: 'created',
        format: 'bip39',
        passphraseEnabled: false,
        encryptedSeed,
        kdfParams,
    });
    await v.wallets.put(record);
    await v.save();
    v.close();
    return { record, params };
}

describe('the web onboarding lanes derive the master key once', () => {
    it('defers notification price and history watchers until idle', async () => {
        await createWalletLocal({ password: PASSWORD });

        expect(state.watcherStarts).toBe(0);
        expect(state.watcherRefreshes).toBe(0);
        expect(state.idleCallbacks.filter(Boolean)).toHaveLength(1);

        state.idleCallbacks.find(Boolean)();

        expect(state.watcherStarts).toBe(6);
        expect(state.watcherRefreshes).toBe(1);
    });

    it('createWalletLocal: vault, wallet seal and signer pool share one derivation', async () => {
        await createWalletLocal({ password: PASSWORD });
        expect(state.issued).toHaveLength(1);
        expect(state.issued.every(zeroed)).toBe(true);
        expect(populated).toHaveLength(1);
        expect(populated[0].summary.pooled).toHaveLength(1);
        expect(populated[0].summary.skipped).toEqual([]);
    });

    it('importMnemonicLocal: vault, seal, pool and label-sync restore share one derivation', async () => {
        await importMnemonicLocal({ password: PASSWORD, mnemonic: PHRASE });
        expect(state.issued).toHaveLength(1);
        expect(state.issued.every(zeroed)).toBe(true);
        expect(populated[0].summary.pooled).toHaveLength(1);
    });
});

describe('unlockWalletLocal derives once per distinct set of KDF params', () => {
    it('one wallet: a single derivation, the signer pooled, the lent key zeroed', async () => {
        await createWalletLocal({ password: PASSWORD });
        await lockWalletLocal();
        resetCount();

        const res = await unlockWalletLocal({ password: PASSWORD });
        expect(res).toEqual({ unlocked: true, passphraseCaptureNeeded: [] });
        expect(state.issued).toHaveLength(1);
        expect(state.salts).toEqual([state.meta.kdfParams.salt]);

        const [{ pool, summary }] = populated;
        expect(summary.pooled).toHaveLength(1);
        expect(summary.skipped).toEqual([]);
        // The bridge's key is gone; the signer kept its own copy, not an alias.
        expect(state.issued.every(zeroed)).toBe(true);
        const signerKey = pool.get(summary.pooled[0]).getMasterKey();
        expect(signerKey).toBeInstanceOf(Uint8Array);
        expect(zeroed(signerKey)).toBe(false);
    });

    it('two wallets with different salts: two derivations, both signers pooled', async () => {
        await createWalletLocal({ password: PASSWORD });
        await lockWalletLocal();
        const second = await addSecondWallet();
        resetCount();

        await unlockWalletLocal({ password: PASSWORD });
        expect(state.issued).toHaveLength(2);
        expect([...state.salts].sort()).toEqual([state.meta.kdfParams.salt, second.params.salt].sort());
        const [{ summary }] = populated;
        expect(summary.pooled).toHaveLength(2);
        expect(summary.pooled).toContain(second.record.id);
        expect(summary.skipped).toEqual([]);
        expect(state.issued.every(zeroed)).toBe(true);
    });

    it('a wrong password fails exactly as before: InvalidPasswordError, one derivation, no pool', async () => {
        await createWalletLocal({ password: PASSWORD });
        await lockWalletLocal();
        resetCount();

        const err = await unlockWalletLocal({ password: 'not the password' }).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(InvalidPasswordError);
        expect(err.name).toBe('InvalidPasswordError');
        expect(err.message).toBe(new InvalidPasswordError().message);
        expect(state.issued).toHaveLength(1);
        expect(populated).toEqual([]);
        expect(state.issued.every(zeroed)).toBe(true);

        // And the right one still opens afterwards.
        await expect(unlockWalletLocal({ password: PASSWORD })).resolves.toMatchObject({ unlocked: true });
    });
});

describe('kdfParamsEqual', () => {
    const base = { algorithm: 'argon2id', salt: 'AAECAwQFBgcICQoLDA0ODw==', iterations: 3, memory: 65536, parallelism: 1 };

    it('matches identical params, and the same salt bytes in another encoding', () => {
        expect(kdf.kdfParamsEqual(base, { ...base })).toBe(true);
        expect(kdf.kdfParamsEqual(base, { ...base, salt: 'AAECAwQFBgcICQoLDA0ODw' })).toBe(true);
    });

    it('refuses any differing field', () => {
        expect(kdf.kdfParamsEqual(base, { ...base, salt: 'AQECAwQFBgcICQoLDA0ODw==' })).toBe(false);
        expect(kdf.kdfParamsEqual(base, { ...base, iterations: 4 })).toBe(false);
        expect(kdf.kdfParamsEqual(base, { ...base, memory: 65537 })).toBe(false);
        expect(kdf.kdfParamsEqual(base, { ...base, parallelism: 2 })).toBe(false);
        expect(kdf.kdfParamsEqual(base, { ...base, algorithm: 'scrypt' })).toBe(false);
    });

    it('treats missing or malformed params as unequal instead of throwing', () => {
        expect(kdf.kdfParamsEqual(base, undefined)).toBe(false);
        expect(kdf.kdfParamsEqual(null, base)).toBe(false);
        expect(kdf.kdfParamsEqual(base, { ...base, salt: 42 })).toBe(false);
        expect(kdf.kdfParamsEqual({ ...base, salt: '' }, { ...base, salt: '' })).toBe(false);
    });
});
