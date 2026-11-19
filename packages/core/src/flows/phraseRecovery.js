// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Reset a forgotten password with a recovery phrase, erasing nothing
// (operator ruling 2026-11-16). The sealed pieces are in
// crypto/phraseRecovery.js; this file keeps the stored record in step with the
// vault and performs the reset.
//
// The record lives in the vault's meta slot as `phraseRecovery`, beside the
// kdfParams the unlock reads. `reconcilePhraseRecovery` is the one writer: it
// is idempotent, cheap when nothing changed (a few AES-GCM opens), and the
// shells run it after every unlock (the backfill for wallets made before this
// existed), after a create or import, after a password change and after a
// wallet is removed. A wrap can go stale (the blob and the meta are two
// writes), so every run re-checks every key and replaces what no longer opens.

import {
    PASSPHRASE_AAD,
    base64ToBytes,
    decrypt,
    decryptWalletSeed,
    deriveMasterKeyAsync,
    kdfParamsEqual,
    validateKdfParams,
} from '../crypto/index.js';
// The floors straight from kdf.js, the module that owns them.
import { KDF_MIN_ITERATIONS, KDF_MIN_MEMORY_KIB } from '../crypto/kdf.js';
import {
    PHRASE_RECOVERY_VERSION,
    derivePhraseKey,
    makePhraseKdfParams,
    makeRecoveryKey,
    openRecoveryBundle,
    openRecoveryEntry,
    openRecoveryKey,
    sealRecoveryBundle,
    sealRecoveryEntry,
    sealRecoveryKey,
    zeroRecoveryBundle,
} from '../crypto/phraseRecovery.js';
import { normalizeRecoveryPhrase } from '../crypto/recoveryPhrase.js';
import { Vault } from '../storage/Vault.js';
import { rekeyWalletRecord } from './backupFile.js';

/** The words opened none of the stored wraps. Nothing was changed. */
export class RecoveryPhraseMismatchError extends Error {
    constructor() {
        super('That recovery phrase does not match any wallet on this device. Check the words and try again.');
        this.name = 'RecoveryPhraseMismatchError';
    }
}

/** No wallet on this device can reset the password with a phrase (hardware-only, or never backfilled). */
export class PhraseResetUnavailableError extends Error {
    constructor() {
        super('This device has no recovery phrase it can reset the password with.');
        this.name = 'PhraseResetUnavailableError';
    }
}

/**
 * The phrase matched, but the stored keys no longer open the vault: a password
 * change whose metadata write was lost. Nothing was changed; unlocking once with
 * the current password repairs it.
 */
export class PhraseResetStaleError extends Error {
    constructor() {
        super('The recovery phrase matched, but this device\'s reset data is out of date, so the password could not be reset.');
        this.name = 'PhraseResetStaleError';
    }
}

const DECODER = new TextDecoder();
const SEED_FORMATS = new Set(['bip39', 'counterwallet-legacy']);
export const MIN_RESET_PASSWORD_LENGTH = 8;

/**
 * Whether stored KDF params are within the load ceilings AND at or above the
 * KDF_MIN_* floors. `validateKdfParams` checks only the ceilings, since a weak
 * blob (the demo wallet) must still open. The recovery paths are stricter:
 * both param sets they read sit in plain meta, and a lowered cost there would
 * make the reset seal the vault, or a new entry, under a cheap key.
 *
 * @param {unknown} params
 */
function kdfParamsAtFloor(params) {
    try {
        validateKdfParams(/** @type {any} */ (params));
    } catch {
        return false;
    }
    const p = /** @type {any} */ (params);
    return p.iterations >= KDF_MIN_ITERATIONS && p.memory >= KDF_MIN_MEMORY_KIB;
}

/** Params for a new record, never below the floors. @param {import('../crypto/kdf.js').KdfParams} params */
function raisedToFloor(params) {
    return {
        ...params,
        iterations: Math.max(params.iterations, KDF_MIN_ITERATIONS),
        memory: Math.max(params.memory, KDF_MIN_MEMORY_KIB),
    };
}

// Meta-level write counter for the record and the wallet id list. Every writer
// stores withPhraseRecovery's bump, and a reconcile writes only if the counter
// it read is still the stored one, so a run computed from an older read can
// never put back a removed wallet's wrap or a pre-change recovery key.
const GENERATION_FIELD = 'phraseRecoveryGen';
// A stale reconcile re-runs from a fresh read; past this many races it leaves
// the record to the next unlock.
const RECONCILE_ATTEMPTS = 3;
const STALE = Symbol('phraseRecovery.stale');

/** @param {any} meta */
function recordGeneration(meta) {
    const g = meta?.[GENERATION_FIELD];
    return Number.isSafeInteger(g) && g >= 0 ? g : 0;
}

// One read-check-write at a time per meta backend in this context, so two
// writers cannot both pass the generation check against the same read.
/** @type {WeakMap<object, Promise<unknown>>} */
const metaWriteLocks = new WeakMap();

/**
 * @template T
 * @param {object} metaBackend
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withMetaWriteLock(metaBackend, fn) {
    const prior = metaWriteLocks.get(metaBackend) ?? Promise.resolve();
    const run = prior.then(() => fn());
    metaWriteLocks.set(metaBackend, run.catch(() => { /* the caller sees it */ }));
    return run;
}

/**
 * Whether `vaultKey` is still the key `vault` is sealed under. A run holding a
 * copy taken before a password change would otherwise seal a key seal and a
 * bundle under a dead key over the current record.
 *
 * @param {any} vault @param {Uint8Array} vaultKey
 */
function vaultKeyIsCurrent(vault, vaultKey) {
    if (!vault || vault.isOpen === false) return false;
    if (typeof vault.keyMatches !== 'function') return true;
    try {
        return vault.keyMatches(vaultKey) === true;
    } catch {
        return false;
    }
}

/**
 * @typedef {Object} PhraseRecoveryRecord
 * @property {1} version
 * @property {import('../crypto/kdf.js').KdfParams} kdfParams   one salt for every entry, so a typed phrase costs one derivation
 * @property {string} keySeal
 * @property {string} bundle
 * @property {Array<{ walletId: string, wrap: string }>} entries
 */

/**
 * The stored record when it is well formed, else null. Read from untrusted
 * metadata, so the KDF params pass the load ceilings AND the floors: a record
 * whose cost was lowered reads as absent and the next reconcile replaces it,
 * rather than sealing new entries under the lowered cost.
 *
 * @param {unknown} raw
 * @returns {PhraseRecoveryRecord | null}
 */
export function readPhraseRecovery(raw) {
    const r = /** @type {any} */ (raw);
    if (!r || typeof r !== 'object' || r.version !== PHRASE_RECOVERY_VERSION) return null;
    if (typeof r.keySeal !== 'string' || typeof r.bundle !== 'string' || !Array.isArray(r.entries)) return null;
    if (!kdfParamsAtFloor(r.kdfParams)) return null;
    const entries = r.entries.filter((e) => e && typeof e.walletId === 'string' && e.walletId
        && typeof e.wrap === 'string' && e.wrap);
    return { version: PHRASE_RECOVERY_VERSION, kdfParams: r.kdfParams, keySeal: r.keySeal, bundle: r.bundle, entries };
}

/**
 * Whether the lock screen can offer "Reset with recovery phrase": a record
 * with an entry, and vault params the reset will derive the new key under.
 * @param {unknown} meta
 */
export function phraseResetAvailable(meta) {
    const record = readPhraseRecovery(/** @type {any} */ (meta)?.phraseRecovery);
    return Boolean(record && record.entries.length > 0 && kdfParamsAtFloor(/** @type {any} */ (meta)?.kdfParams));
}

/**
 * Wallet ids that identify this vault while it is locked. Seed-wallet ids from
 * the recovery record support older metadata; `walletIds` also covers hardware
 * wallets, which deliberately have no phrase recovery entry.
 *
 * @param {unknown} meta
 * @returns {string[]}
 */
export function vaultWalletIds(meta) {
    const source = /** @type {any} */ (meta);
    const plain = Array.isArray(source?.walletIds) ? source.walletIds : [];
    const record = readPhraseRecovery(source?.phraseRecovery);
    return [...new Set([
        ...plain.filter((id) => typeof id === 'string' && id.length > 0),
        ...(record?.entries.map((entry) => entry.walletId) ?? []),
    ])];
}

/** @param {string[]} a @param {string[]} b */
function sameWalletIds(a, b) {
    return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * The meta record with `record` as its phrase recovery, everything else kept
 * exactly (kdfParams above all). A null record removes the field. The write
 * counter moves on by one, so a reconcile that read the meta before this
 * write knows it is stale.
 *
 * @param {object} meta
 * @param {PhraseRecoveryRecord | null} record
 */
export function withPhraseRecovery(meta, record) {
    const next = { ...meta };
    if (record) next.phraseRecovery = record;
    else delete next.phraseRecovery;
    next[GENERATION_FIELD] = recordGeneration(meta) + 1;
    return next;
}

/**
 * Drop one wallet's wrap: a removed wallet's phrase must not reset the vault.
 * This is the cheap half, and it fails closed. The wrap is still in any older
 * copy of the record and opens the same recovery key, so the caller follows it
 * with a rotating reconcile (`rotate: true`) that moves the bundle onto a new
 * recovery key that wrap never held. What rotation cannot reach: that older
 * copy also holds its own old bundle, and a remove leaves the vault key as it
 * was, so the removed phrase plus a saved old copy still opens the vault until
 * the vault key next moves (a password change or a reset).
 *
 * @param {object | null} meta
 * @param {string} walletId
 * @returns {object | null}  the next meta, or null when nothing changed
 */
export function dropPhraseRecoveryWallet(meta, walletId) {
    const record = readPhraseRecovery(/** @type {any} */ (meta)?.phraseRecovery);
    const entries = record?.entries.filter((e) => e.walletId !== walletId) ?? [];
    const walletIds = vaultWalletIds(meta).filter((id) => id !== walletId);
    const recordChanged = Boolean(record?.entries.some((e) => e.walletId === walletId));
    const idsChanged = !sameWalletIds(vaultWalletIds(meta), walletIds);
    if (!recordChanged && !idsChanged) return null;
    const next = withPhraseRecovery(
        /** @type {object} */ (meta),
        recordChanged ? (entries.length > 0 ? { ...record, entries } : null) : record,
    );
    next.walletIds = walletIds;
    return next;
}

/** Has key material sealed under a password. @param {any} w */
function hasSealedMaterial(w) {
    if (!w || !w.kdfParams || w.format === 'hardware') return false;
    if (typeof w.encryptedSeed === 'string' && w.encryptedSeed.length > 0) return true;
    if (Array.isArray(w.importedKeys) && w.importedKeys.some((k) => k && typeof k.encryptedWif === 'string' && k.encryptedWif)) return true;
    return typeof w.encryptedPassphrase === 'string' && w.encryptedPassphrase.length > 0;
}

/** A software wallet with a recovery phrase. @param {any} w */
function isSeedWallet(w) {
    return hasSealedMaterial(w) && SEED_FORMATS.has(w.format)
        && typeof w.encryptedSeed === 'string' && w.encryptedSeed.length > 0;
}

/**
 * Whether `key` opens one of the wallet's seals. One GCM open, no KDF.
 * @param {Uint8Array} key @param {any} w
 */
async function keyOpensWallet(key, w) {
    try {
        let plain;
        if (typeof w.encryptedSeed === 'string' && w.encryptedSeed.length > 0) {
            plain = await decryptWalletSeed({ encryptedSeed: w.encryptedSeed, kdfParams: w.kdfParams, masterKey: key });
        } else {
            const sealed = Array.isArray(w.importedKeys)
                ? w.importedKeys.find((k) => k && typeof k.encryptedWif === 'string' && k.encryptedWif)
                : null;
            plain = sealed
                ? await decrypt(key, base64ToBytes(sealed.encryptedWif))
                : await decrypt(key, base64ToBytes(w.encryptedPassphrase), PASSPHRASE_AAD);
        }
        plain.fill(0);
        return true;
    } catch {
        return false;
    }
}

/** @param {Uint8Array | undefined} a @param {Uint8Array | undefined} b */
function sameBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
    return diff === 0;
}

/**
 * Bring the phrase recovery record in step with an open vault.
 *
 * Reuses everything that still opens: the recovery key (under the current
 * vault key, or `previousVaultKey` right after a password change), the bundle's
 * wallet keys (checked against each wallet's seal), and each seed wallet's
 * entry. Only a missing or stale piece costs a derivation: a wallet key from
 * `password` (skipped for a wallet sealed under another password), and a
 * phrase key from the seed it decrypts, which is zeroed at once.
 *
 * @param {Object} opts
 * @param {Vault} opts.vault                          open
 * @param {Uint8Array} opts.vaultKey                  the key the vault is sealed under now
 * @param {import('../crypto/kdf.js').KdfParams} opts.vaultKdfParams
 * @param {string} [opts.password]                    the unlock password, for wallet keys not already known
 * @param {unknown} [opts.current]                    the stored record (meta.phraseRecovery)
 * @param {Uint8Array} [opts.previousVaultKey]        the key the record's keySeal may still be under
 * @param {Map<string, Uint8Array>} [opts.knownWalletKeys]   wallet seal keys the caller already holds
 * @param {import('../crypto/kdf.js').KdfParams} [opts.phraseKdfParams]   params for a NEW record (tests pass a cheap cost); default the password floor, and never below it
 * @param {boolean} [opts.rotate]   mint a fresh recovery key and re-wrap every seed wallet, keeping no entry:
 *   wallet remove, password change and reset pass it, so an older copy of the record (a removed
 *   wallet's wrap, the keySeal an old password opens) leads to a recovery key no current bundle is under.
 *   A seed wallet whose key is not at hand cannot be re-wrapped and loses its entry.
 * @param {Array<any>} [opts.wallets]   the vault's wallet records, when the caller has just listed them
 * @returns {Promise<{ record: PhraseRecoveryRecord | null, changed: boolean }>}
 */
export async function reconcilePhraseRecovery({
    vault,
    vaultKey,
    vaultKdfParams,
    password,
    current,
    previousVaultKey,
    knownWalletKeys,
    phraseKdfParams,
    rotate = false,
    wallets: listed,
}) {
    const prior = readPhraseRecovery(current);
    const hadRecord = current !== undefined && current !== null;
    const wallets = (listed ?? await vault.wallets.list()).filter(hasSealedMaterial);
    const seedWallets = wallets.filter(isSeedWallet);

    /** @type {Uint8Array | null} */
    let recoveryKey = null;
    /** @type {import('../crypto/phraseRecovery.js').RecoveryBundle | null} */
    let oldBundle = null;
    /** @type {Map<string, Uint8Array>} */
    const walletKeys = new Map();
    try {
        let keySealCurrent = false;
        if (prior) {
            recoveryKey = await openRecoveryKey(vaultKey, prior.keySeal);
            keySealCurrent = recoveryKey !== null;
            if (!recoveryKey && previousVaultKey) recoveryKey = await openRecoveryKey(previousVaultKey, prior.keySeal);
            if (recoveryKey) oldBundle = await openRecoveryBundle(recoveryKey, prior.bundle);
        }
        // A rotation still opens the old bundle above, for its wallet keys,
        // but keeps nothing sealed under the old recovery key.
        const reuse = recoveryKey !== null && !rotate;
        if (seedWallets.length === 0) return { record: null, changed: hadRecord };
        if (rotate && recoveryKey) {
            recoveryKey.fill(0);
            recoveryKey = null;
        }
        if (!recoveryKey) recoveryKey = makeRecoveryKey();
        let changed = !reuse || !keySealCurrent || !oldBundle || !sameBytes(oldBundle.vaultKey, vaultKey);

        for (const w of wallets) {
            const candidates = [
                knownWalletKeys?.get(w.id),
                oldBundle?.walletKeys.get(w.id),
                kdfParamsEqual(w.kdfParams, vaultKdfParams) ? vaultKey : undefined,
            ].filter((k) => k instanceof Uint8Array && k.length === 32);
            let found = null;
            for (const candidate of candidates) {
                if (await keyOpensWallet(candidate, w)) {
                    found = new Uint8Array(candidate);
                    break;
                }
            }
            if (!found && typeof password === 'string' && password.length > 0) {
                const derived = await deriveMasterKeyAsync(password, w.kdfParams);
                if (await keyOpensWallet(derived, w)) found = derived;
                else derived.fill(0);
            }
            if (!found) continue;
            walletKeys.set(w.id, found);
            if (!sameBytes(oldBundle?.walletKeys.get(w.id), found)) changed = true;
        }
        if (oldBundle && [...oldBundle.walletKeys.keys()].some((id) => !walletKeys.has(id))) changed = true;

        // `prior` passed the floors in readPhraseRecovery. A rotation keeps its
        // salt: the new recovery key, not the phrase key, is what an old copy lacks.
        const kdfParams = prior && (reuse || rotate)
            ? prior.kdfParams
            : raisedToFloor(phraseKdfParams ?? makePhraseKdfParams());
        /** @type {Array<{ walletId: string, wrap: string }>} */
        const entries = [];
        for (const w of seedWallets) {
            const kept = reuse ? prior.entries.find((e) => e.walletId === w.id) : undefined;
            if (kept) {
                entries.push({ walletId: w.id, wrap: kept.wrap });
                continue;
            }
            const key = walletKeys.get(w.id);
            // Sealed under another password: its phrase cannot be read here.
            if (!key) continue;
            const seed = await decryptWalletSeed({ encryptedSeed: w.encryptedSeed, kdfParams: w.kdfParams, masterKey: key });
            let phraseKey;
            try {
                phraseKey = await derivePhraseKey(DECODER.decode(seed), kdfParams);
            } finally {
                seed.fill(0);
            }
            try {
                entries.push({ walletId: w.id, wrap: await sealRecoveryEntry(phraseKey, recoveryKey, w.id) });
            } finally {
                phraseKey.fill(0);
            }
            changed = true;
        }
        if (prior && prior.entries.some((e) => !entries.some((n) => n.walletId === e.walletId))) changed = true;
        if (entries.length === 0) return { record: null, changed: hadRecord };
        if (!changed && prior) return { record: prior, changed: false };

        return {
            record: {
                version: PHRASE_RECOVERY_VERSION,
                kdfParams,
                keySeal: await sealRecoveryKey(vaultKey, recoveryKey),
                bundle: await sealRecoveryBundle(recoveryKey, { vaultKey, walletKeys }),
                entries,
            },
            changed: true,
        };
    } finally {
        if (recoveryKey) recoveryKey.fill(0);
        zeroRecoveryBundle(oldBundle);
        for (const key of walletKeys.values()) key.fill(0);
    }
}

/**
 * Reconcile and store the record in a meta backend. The meta is re-read just
 * before the write and left alone unless it still describes the same vault
 * (same kdfParams), so a wipe or a new vault that landed meanwhile is never
 * overwritten. Callers on the unlock path run this best effort.
 *
 * The write is a compare-and-swap on the meta's write counter: when another
 * writer (a wallet remove, a password change, a reset) stored the record after
 * this run read it, this run's result is dropped and the whole run starts over
 * from a fresh read of the meta and the vault. A run whose vault key is no
 * longer the vault's (a password change landed) writes nothing.
 *
 * @param {Object} opts
 * @param {{ load: () => Promise<any>, save: (meta: any) => Promise<void> }} opts.metaBackend
 * @param {Vault} opts.vault
 * @param {Uint8Array} opts.vaultKey
 * @param {string} [opts.password]
 * @param {Uint8Array} [opts.previousVaultKey]
 * @param {Map<string, Uint8Array>} [opts.knownWalletKeys]
 * @param {import('../crypto/kdf.js').KdfParams} [opts.phraseKdfParams]
 * @param {boolean} [opts.rotate]   see reconcilePhraseRecovery
 * @param {() => Promise<Vault>} [opts.reopenVault]   a fresh handle for a re-run, when `vault` is a private
 *   handle whose wallet list would not show another handle's writes
 * @returns {Promise<boolean>}  true when a new record was written
 */
export async function reconcilePhraseRecoveryInMeta(opts) {
    let vault = opts.vault;
    for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt += 1) {
        if (attempt > 0 && typeof opts.reopenVault === 'function') vault = await opts.reopenVault();
        const outcome = await reconcileInMetaOnce({ ...opts, vault });
        if (outcome !== STALE) return outcome;
    }
    return false;
}

/**
 * @param {Parameters<typeof reconcilePhraseRecoveryInMeta>[0]} opts
 * @returns {Promise<boolean | typeof STALE>}
 */
async function reconcileInMetaOnce({ metaBackend, vault, vaultKey, password, previousVaultKey, knownWalletKeys, phraseKdfParams, rotate }) {
    const meta = await metaBackend.load();
    if (!meta || !meta.kdfParams) return false;
    if (!vaultKeyIsCurrent(vault, vaultKey)) return false;
    const listed = await vault.wallets.list();
    const walletIds = listed
        .map((wallet) => wallet?.id)
        .filter((id) => typeof id === 'string' && id.length > 0);
    const { record, changed } = await reconcilePhraseRecovery({
        vault,
        wallets: listed,
        vaultKey,
        vaultKdfParams: meta.kdfParams,
        password,
        current: meta.phraseRecovery,
        previousVaultKey,
        knownWalletKeys,
        phraseKdfParams,
        rotate,
    });
    if (!changed && sameWalletIds(vaultWalletIds(meta), walletIds)) return false;
    return withMetaWriteLock(metaBackend, async () => {
        const latest = await metaBackend.load();
        if (!latest || !kdfParamsEqual(latest.kdfParams, meta.kdfParams)) return false;
        if (recordGeneration(latest) !== recordGeneration(meta)) return STALE;
        if (!vaultKeyIsCurrent(vault, vaultKey)) return false;
        const next = withPhraseRecovery(latest, record);
        next.walletIds = walletIds;
        await metaBackend.save(next);
        return true;
    });
}

/**
 * Run the reconcile on its own vault handle, off the caller's path, so an
 * unlock or a create answers first and the backfill (a phrase derivation per
 * wallet that has no wrap yet) never slows it or fails it. The key is copied
 * synchronously, so the caller may zero its own buffer as soon as this returns.
 * Nothing is written to the vault blob; only the meta slot changes.
 *
 * @param {Object} opts
 * @param {import('../storage/backend.js').StorageBackend} opts.storageBackend
 * @param {{ load: () => Promise<any>, save: (meta: any) => Promise<void> }} opts.metaBackend
 * @param {Uint8Array} opts.vaultKey
 * @param {string} [opts.password]
 * @param {object} [opts.settingsMigrationCtx]
 * @param {Map<string, Uint8Array>} [opts.knownWalletKeys]   copied synchronously, like the vault key
 * @param {(err: unknown) => void} [opts.onError]
 * @returns {Promise<boolean>}  settles true when a record was written; never rejects
 */
export function reconcilePhraseRecoveryDetached({ storageBackend, metaBackend, vaultKey, password, settingsMigrationCtx, knownWalletKeys, onError }) {
    if (!storageBackend || !metaBackend || typeof metaBackend.save !== 'function'
        || !(vaultKey instanceof Uint8Array) || vaultKey.length !== 32) {
        return Promise.resolve(false);
    }
    const key = new Uint8Array(vaultKey);
    const known = new Map([...(knownWalletKeys ?? new Map())]
        .filter(([, k]) => k instanceof Uint8Array && k.length === 32)
        .map(([id, k]) => [id, new Uint8Array(k)]));
    return (async () => {
        /** @type {Vault | null} */
        let vault = null;
        try {
            // Let the reply that started this paint first: a backfill derives
            // a phrase key per wallet, and on web that runs on the page thread.
            await new Promise((resolve) => { setTimeout(resolve, 0); });
            // A re-run after a lost race reopens, so it lists the wallets as
            // stored now rather than as this handle first read them.
            const reopen = async () => {
                if (vault) {
                    try { vault.close(); } catch { /* already closed */ }
                }
                vault = new Vault({ backend: storageBackend, masterKey: key, autoSave: false, settingsMigrationCtx });
                await vault.open();
                return vault;
            };
            return await reconcilePhraseRecoveryInMeta({
                metaBackend, vault: await reopen(), vaultKey: key, password, knownWalletKeys: known, reopenVault: reopen,
            });
        } catch (err) {
            try { onError?.(err); } catch { /* reporting only */ }
            return false;
        } finally {
            if (vault) {
                try { vault.close(); } catch { /* already closed */ }
            }
            key.fill(0);
            for (const k of known.values()) k.fill(0);
        }
    })();
}

/**
 * Remove a wallet's wrap from a meta backend. Best effort is the caller's call.
 *
 * @param {{ load: () => Promise<any>, save: (meta: any) => Promise<void> }} metaBackend
 * @param {string} walletId
 * @returns {Promise<boolean>}
 */
export function dropPhraseRecoveryWalletInMeta(metaBackend, walletId) {
    return withMetaWriteLock(metaBackend, async () => {
        const next = dropPhraseRecoveryWallet(await metaBackend.load(), walletId);
        if (!next) return false;
        await metaBackend.save(next);
        return true;
    });
}

function detachedWalletCopy(wallet) {
    return {
        ...wallet,
        kdfParams: wallet.kdfParams ? { ...wallet.kdfParams } : wallet.kdfParams,
        importedKeys: Array.isArray(wallet.importedKeys)
            ? wallet.importedKeys.map((key) => ({ ...key }))
            : wallet.importedKeys,
    };
}

/**
 * Reset the unlock password with a recovery phrase. Erases nothing.
 *
 * The phrase unwraps the recovery key, which opens the bundle; the bundle's
 * vault key opens the stored vault, and each wallet's key re-seals that wallet
 * under `newPassword` (salt kept, as a password change keeps it). The vault and
 * every re-sealed wallet are written in ONE `vault.rekey`, so a failure leaves
 * the device exactly as it was. A wrong phrase fails before any vault is read.
 *
 * The caller stores the returned meta (the refreshed record, the same
 * kdfParams) and then runs its normal unlock with `newPassword`. If that meta
 * write is lost the reset still stands (the vault opens with the new password)
 * and the next unlock rebuilds the record.
 *
 * @param {Object} opts
 * @param {import('../storage/backend.js').StorageBackend} opts.storageBackend
 * @param {any} opts.meta                     the meta slot as loaded
 * @param {string} opts.phrase                the typed words; never kept past this call
 * @param {string} opts.newPassword
 * @param {object} [opts.settingsMigrationCtx]
 * @returns {Promise<{ meta: object, resetWalletIds: string[], skippedWalletIds: string[] }>}
 * @throws {RecoveryPhraseMismatchError | PhraseResetUnavailableError | PhraseResetStaleError}
 */
export async function resetPasswordWithRecoveryPhrase({ storageBackend, meta, phrase, newPassword, settingsMigrationCtx }) {
    if (typeof newPassword !== 'string' || newPassword.length < MIN_RESET_PASSWORD_LENGTH) {
        throw new Error(`New password must be at least ${MIN_RESET_PASSWORD_LENGTH} characters.`);
    }
    const record = readPhraseRecovery(meta?.phraseRecovery);
    if (!record || record.entries.length === 0 || !meta?.kdfParams) throw new PhraseResetUnavailableError();
    // The new vault key is derived under the meta's params, which are plain
    // metadata. Lowered below the floors they would make the reset seal the
    // vault (and so the key seal) under a cheap key, so the reset refuses
    // before reading anything. Refused, not raised: raised params would have
    // to land in the meta too, and a lost meta write after the vault rekey
    // would then leave a vault no password opens.
    if (!kdfParamsAtFloor(meta.kdfParams)) throw new PhraseResetUnavailableError();
    if (!normalizeRecoveryPhrase(phrase)) throw new RecoveryPhraseMismatchError();

    /** @type {Uint8Array | null} */
    let recoveryKey = null;
    /** @type {import('../crypto/phraseRecovery.js').RecoveryBundle | null} */
    let bundle = null;
    /** @type {Uint8Array | null} */
    let newVaultKey = null;
    /** @type {Map<string, Uint8Array>} */
    const newKeys = new Map();
    /** @type {Vault | null} */
    let vault = null;
    try {
        const phraseKey = await derivePhraseKey(phrase, record.kdfParams);
        try {
            for (const entry of record.entries) {
                recoveryKey = await openRecoveryEntry(phraseKey, entry);
                if (recoveryKey) break;
            }
        } finally {
            phraseKey.fill(0);
        }
        if (!recoveryKey) throw new RecoveryPhraseMismatchError();
        bundle = await openRecoveryBundle(recoveryKey, record.bundle);
        if (!bundle) throw new PhraseResetStaleError();

        vault = new Vault({ backend: storageBackend, masterKey: bundle.vaultKey, settingsMigrationCtx });
        try {
            await vault.open();
        } catch (err) {
            if (/** @type {any} */ (err)?.name === 'AeadAuthError') throw new PhraseResetStaleError();
            throw err;
        }

        const stored = await vault.wallets.list();
        const candidates = [];
        const skippedWalletIds = [];
        for (const wallet of stored) {
            if (!hasSealedMaterial(wallet)) continue;
            const key = bundle.walletKeys.get(wallet.id);
            if (!key) {
                skippedWalletIds.push(wallet.id);
                continue;
            }
            const copy = detachedWalletCopy(wallet);
            try {
                const resealed = await rekeyWalletRecord(copy, {
                    walletKey: key,
                    devicePassword: newPassword,
                    kdfParams: copy.kdfParams,
                    onDeviceKey: (k) => { newKeys.set(wallet.id, new Uint8Array(k)); },
                });
                if (resealed) candidates.push(copy);
            } catch (err) {
                const name = /** @type {any} */ (err)?.name;
                if (name !== 'BackupSeedPasswordError' && name !== 'BackupSealDamagedError') throw err;
                // A stale key for this one wallet: it keeps its old seal.
                skippedWalletIds.push(wallet.id);
            }
        }

        newVaultKey = await deriveMasterKeyAsync(newPassword, meta.kdfParams);
        await vault.rekey({ masterKey: newVaultKey, wallets: candidates, readWallets: stored });

        let nextRecord = record;
        try {
            // A fresh recovery key: the one this phrase opened is in every
            // older copy of the record, and must open nothing from now on.
            nextRecord = (await reconcilePhraseRecovery({
                vault,
                vaultKey: newVaultKey,
                vaultKdfParams: meta.kdfParams,
                password: newPassword,
                current: record,
                previousVaultKey: bundle.vaultKey,
                knownWalletKeys: newKeys,
                rotate: true,
            })).record;
        } catch {
            // The reset is written. A record that could not be rebuilt now is
            // rebuilt at the next unlock; the stale one fails closed meanwhile.
        }
        return {
            meta: withPhraseRecovery(meta, nextRecord),
            resetWalletIds: candidates.map((c) => c.id),
            skippedWalletIds,
        };
    } finally {
        if (vault) {
            try { vault.close(); } catch { /* already closed */ }
        }
        if (recoveryKey) recoveryKey.fill(0);
        zeroRecoveryBundle(bundle);
        if (newVaultKey) newVaultKey.fill(0);
        for (const key of newKeys.values()) key.fill(0);
    }
}
