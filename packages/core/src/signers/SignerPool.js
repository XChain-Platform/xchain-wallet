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
//   - `get(walletId)` returns the cached signer, or null if absent
//   - `lockAll()` zeros every signer's key material; called on
//     `wallet.lock` and on tear-down

import { unlockWalletRecord } from '../flows/unlockWallet.js';

/**
 * @typedef {Object} PopulateSummary
 * @property {string[]} pooled               wallet ids now holding a signer
 * @property {string[]} skipped              wallet ids left out (bad password for that record, or a
 *                                           passphrase wallet unlocked without its passphrase)
 * @property {string[]} passphraseMatched    passphrase wallets whose stored addresses the typed 25th word reproduced
 * @property {string[]} passphraseMismatch   passphrase wallets it did NOT reproduce (signer locked, not pooled)
 * @property {string[]} passphraseMismatchNames  display names for the mismatch list, for the unlock screen's sentence
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
     * @param {string} [opts.bip39Passphrase]   the §15.6 25th word, applied to every
     *   passphrase-enabled wallet and checked against each one's stored addresses
     * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
     * @param {import('../sdk/SDKRegistry.js').SDKRegistry} opts.sdkRegistry
     * @returns {Promise<PopulateSummary>}
     */
    async populate({ vault, password, bip39Passphrase = '', chainRegistry, sdkRegistry }) {
        /** @type {PopulateSummary} */
        const summary = {
            pooled: [], skipped: [], passphraseMatched: [], passphraseMismatch: [], passphraseMismatchNames: [],
        };
        const wallets = await vault.wallets.list();
        for (const w of wallets) {
            // §15.6 25th-word passphrase wallets need the right secret
            // here. Unlocked without it they stay out of the pool, and the
            // per-op prompt then explains (PassphraseRequiredError) that
            // the remedy is an unlock with the passphrase filled in.
            if (w.passphraseEnabled && !bip39Passphrase) { summary.skipped.push(w.id); continue; }
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
            if (w.passphraseEnabled) {
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
