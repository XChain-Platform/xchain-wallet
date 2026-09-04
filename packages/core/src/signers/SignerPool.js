// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SignerPool: keeps unlocked SoftwareSigners in memory for the
// lifetime of an unlocked session. Populated once at `wallet.unlock`
// using the password the user just typed; subsequent HD-derive ops
// (account.create, receive.getAddress, action.send for software
// signers) reuse the pre-unlocked signer without prompting.
//
// Why this exists: the user's mental model is "enter the wallet
// password once, then everything inside that wallet is reachable".
// The data-at-rest model already meets that for vault contents (the
// vault master key sits in session backend after unlock), but each
// Wallet record's seed is encrypted with a *separate* per-wallet KDF
// so it needs its own decrypt step. Doing that decrypt up-front and
// holding the unlocked Signer eliminates the per-account password
// prompt without introducing any new password storage.
//
// Lifecycle:
//   - Created once per host construction
//   - `populate(vault, password, ...)` unlocks every Wallet's signer
//     and stashes it by walletId; called once after `wallet.unlock`
//   - `unlockOne(walletId, ...)` adds a single signer (used after
//     adding a new wallet mid-session)
//   - `captureOne(...)` stores a legacy wallet's passphrase after
//     verifying it, then pools that wallet's signer
//   - `get(walletId)` returns the cached signer, or null if absent
//   - `lockAll()` zeros every signer's key material; called on
//     `wallet.lock` and on tear-down

import { PassphraseMismatchError, unlockWalletRecord } from '../flows/unlockWallet.js';
import { encryptWalletPassphrase } from '../crypto/walletBlob.js';

/**
 * @typedef {Object} PopulateSummary
 * @property {string[]} pooled               wallet ids now holding a signer
 * @property {string[]} skipped              wallet ids left out (bad password for that record, or any
 *                                           other unlock failure)
 * @property {string[]} passphraseMatched    legacy passphrase wallets whose stored addresses the typed 25th word reproduced
 * @property {string[]} passphraseMismatch   legacy passphrase wallets it did NOT reproduce (signer locked, not pooled)
 * @property {string[]} passphraseMismatchNames  display names for the mismatch list, for the unlock screen's sentence
 * @property {string[]} passphraseCaptureNeeded  legacy passphrase wallets the password opened but that hold no
 *                                           stored passphrase yet, and none was supplied: the capture step's queue
 * @property {string[]} passphraseCaptureNames   display names for the capture list, in the same order
 */

/**
 * Whether the seed the signer just unlocked owns this wallet's stored
 * addresses.
 *
 * A BIP39 passphrase is never wrong to the derivation: every string yields
 * a valid seed, only a different one, so a mistyped 25th word unlocks
 * cleanly and then derives keys that own none of the wallet's coins. The
 * stored HD address records carry the path and public key the RIGHT seed
 * produced, so one derivation settles it.
 *
 * Returns null when there is nothing to compare against: a vault without
 * account/address collections (unit fixtures), a wallet with no HD address
 * yet, or a signer that cannot derive. Nothing to compare means nothing to
 * refuse; the caller treats null as "accepted".
 *
 * @param {any} vault
 * @param {{ id: string }} wallet
 * @param {any} signer
 * @returns {Promise<boolean | null>}
 */
async function seedOwnsStoredAddresses(vault, wallet, signer) {
    if (!vault?.accounts?.findBy || !vault?.addresses?.findBy) return null;
    if (typeof signer?.getPublicKey !== 'function') return null;
    const accounts = await vault.accounts.findBy('walletId', wallet.id);
    for (const acct of accounts) {
        const addrs = await vault.addresses.findBy('accountId', acct.id);
        const rec = addrs.find((a) => typeof a.derivationPath === 'string'
            && a.derivationPath.startsWith('m/')
            && typeof a.publicKey === 'string'
            && a.publicKey.length > 0);
        if (!rec) continue;
        try {
            const { publicKey } = await signer.getPublicKey({ path: rec.derivationPath });
            return String(publicKey).toLowerCase() === rec.publicKey.toLowerCase();
        } catch {
            return null;
        }
    }
    return null;
}

export class SignerPool {
    constructor() {
        /** @type {Map<string, import('./SoftwareSigner.js').SoftwareSigner>} */
        this._signers = new Map();
    }

    /**
     * Unlock every Wallet record in the vault and cache its signer.
     * Idempotent: re-running replaces existing entries (so a fresh
     * unlock cycle gets fresh signers).
     *
     * @param {object} opts
     * @param {import('../storage/Vault.js').Vault} opts.vault
     * @param {string} opts.password
     * @param {string} [opts.bip39Passphrase]   the §15.6 25th word, applied only to wallets that
     *   have none stored yet, and checked against each one's stored addresses
     * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
     * @param {import('../sdk/SDKRegistry.js').SDKRegistry} opts.sdkRegistry
     * @returns {Promise<PopulateSummary>}
     */
    async populate({ vault, password, bip39Passphrase = '', chainRegistry, sdkRegistry }) {
        /** @type {PopulateSummary} */
        const summary = {
            pooled: [], skipped: [], passphraseMatched: [], passphraseMismatch: [], passphraseMismatchNames: [],
            passphraseCaptureNeeded: [], passphraseCaptureNames: [],
        };
        const wallets = await vault.wallets.list();
        for (const w of wallets) {
            // A stored passphrase (§15.6) makes the password the only secret this
            // needs, so the wallets left out here are the legacy records that
            // hold none yet. A passphrase supplied by the caller still pools one:
            // that is the extension's marker-slot re-pool after a worker restart,
            // and the only path that still hands a 25th word to an unlock.
            const awaitingCapture = w.passphraseEnabled && w.encryptedPassphrase === null;
            // A legacy §15.6 25th-word passphrase wallet (nothing captured
            // yet) needs the right secret here. Left out of the pool without
            // it, the per-op prompt then explains (PassphraseRequiredError)
            // that the remedy is locking the wallet and letting the unlock
            // screen capture it once.
            if (awaitingCapture && !bip39Passphrase) {
                summary.passphraseCaptureNeeded.push(w.id);
                summary.passphraseCaptureNames.push(w.name || '');
                continue;
            }
            let signer;
            try {
                signer = await unlockWalletRecord({
                    wallet: w,
                    password,
                    bip39Passphrase,
                    chainRegistry,
                    sdkRegistry,
                });
            } catch {
                // Bad password for this wallet, or other unlock
                // failure; skip it. The op-level fallback (password
                // prompt) will surface the real error if the user
                // tries to use that wallet.
                summary.skipped.push(w.id);
                continue;
            }
            // Only a TYPED passphrase is worth verifying. The ownership check
            // exists to catch a typo the user just made, and a stored blob was
            // already checked when it was captured; re-deriving here would cost
            // an HD derivation on every unlock and could unpool a working
            // wallet on a spurious miss.
            if (awaitingCapture) {
                const owns = await seedOwnsStoredAddresses(vault, w, signer);
                if (owns === false) {
                    try { signer.lock(); } catch { /* best-effort */ }
                    summary.passphraseMismatch.push(w.id);
                    summary.passphraseMismatchNames.push(w.name || '');
                    continue;
                }
                summary.passphraseMatched.push(w.id);
            }
            const existing = this._signers.get(w.id);
            if (existing) {
                try { existing.lock(); } catch { /* best-effort */ }
            }
            this._signers.set(w.id, signer);
            summary.pooled.push(w.id);
        }
        return summary;
    }

    /**
     * The one-time capture step for a legacy passphrase wallet (§3.4): take the
     * passphrase the user just typed, prove it derives THIS wallet, store it on
     * the record encrypted under the wallet's own master key, and pool the
     * signer so the session continues without a second unlock.
     *
     * Refuses on `false` (a typo) and equally on `null` (nothing to compare
     * against). Unlike a fresh create, the user is not choosing the string
     * here, so an unverified capture would seal the WRONG passphrase onto the
     * record forever, and the wallet would then be unopenable by any password.
     * A shipped wallet always has an HD address to check against, so null costs
     * nothing to refuse.
     *
     * @param {object} opts
     * @param {import('../storage/Vault.js').Vault} opts.vault
     * @param {import('../schemas/wallet.js').Wallet} opts.wallet   the legacy record, as read from the vault
     * @param {string} opts.password
     * @param {string} opts.bip39Passphrase   the typed 25th word; required here
     * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
     * @param {import('../sdk/SDKRegistry.js').SDKRegistry} opts.sdkRegistry
     * @returns {Promise<import('../schemas/wallet.js').Wallet>} the stored record
     * @throws {PassphraseMismatchError} when the passphrase does not own the wallet's addresses
     */
    async captureOne({ vault, wallet, password, bip39Passphrase, chainRegistry, sdkRegistry }) {
        if (!vault) throw new Error('SignerPool.captureOne: vault is required');
        if (!wallet) throw new Error('SignerPool.captureOne: wallet is required');
        if (typeof bip39Passphrase !== 'string' || bip39Passphrase.length === 0) {
            throw new Error('SignerPool.captureOne: bip39Passphrase is required');
        }
        const signer = await unlockWalletRecord({
            wallet,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
        let record;
        try {
            const owns = await seedOwnsStoredAddresses(vault, wallet, signer);
            if (owns !== true) throw new PassphraseMismatchError([wallet.name]);
            // The signer owns this key and zeroes it at lock(); never clear it here.
            const encryptedPassphrase = await encryptWalletPassphrase({
                masterKey: signer.getMasterKey(),
                passphrase: bip39Passphrase,
            });
            record = { ...wallet, encryptedPassphrase };
            await vault.wallets.put(record);
        } catch (e) {
            // Nothing half-done leaves this method: a failed capture leaves no
            // pooled signer and no live master key, whatever the reason.
            try { signer.lock(); } catch { /* best-effort */ }
            throw e;
        }
        const existing = this._signers.get(wallet.id);
        if (existing) {
            try { existing.lock(); } catch { /* best-effort */ }
        }
        this._signers.set(wallet.id, signer);
        return record;
    }

    /**
     * Add or refresh a single wallet's signer. Used right after
     * `wallet.add.import` so the new wallet's accounts can be added
     * without re-entering its password.
     *
     * @param {object} opts
     * @param {import('../schemas/wallet.js').Wallet} opts.wallet
     * @param {string} opts.password
     * @param {string} [opts.bip39Passphrase]
     * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
     * @param {import('../sdk/SDKRegistry.js').SDKRegistry} opts.sdkRegistry
     */
    async unlockOne({ wallet, password, bip39Passphrase = '', chainRegistry, sdkRegistry }) {
        const signer = await unlockWalletRecord({
            wallet,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
        const existing = this._signers.get(wallet.id);
        if (existing) {
            try { existing.lock(); } catch { /* best-effort */ }
        }
        this._signers.set(wallet.id, signer);
    }

    /**
     * @param {string} walletId
     * @returns {import('./SoftwareSigner.js').SoftwareSigner | null}
     */
    get(walletId) {
        return this._signers.get(walletId) || null;
    }

    has(walletId) {
        return this._signers.has(walletId);
    }

    /**
     * Lock + drop a single wallet's signer. Used when a wallet is
     * removed via `removeWallet` so the unlocked seed material is
     * cleared synchronously rather than waiting for `lockAll`.
     *
     * @param {string} walletId
     */
    evict(walletId) {
        const signer = this._signers.get(walletId);
        if (!signer) return;
        try { signer.lock(); } catch { /* best-effort */ }
        this._signers.delete(walletId);
    }

    /**
     * Lock every signer + clear the pool. Callers MUST invoke this on
     * `wallet.lock` so seed material doesn't outlive the unlocked
     * session.
     */
    lockAll() {
        for (const signer of this._signers.values()) {
            try { signer.lock(); } catch { /* best-effort */ }
        }
        this._signers.clear();
    }

    size() {
        return this._signers.size;
    }
}
