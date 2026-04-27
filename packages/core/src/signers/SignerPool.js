// SignerPool — keeps unlocked SoftwareSigners in memory for the
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
     * @param {string} [opts.bip39Passphrase]
     * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
     * @param {import('../sdk/SDKRegistry.js').SDKRegistry} opts.sdkRegistry
     */
    async populate({ vault, password, bip39Passphrase = '', chainRegistry, sdkRegistry }) {
        const wallets = await vault.wallets.list();
        for (const w of wallets) {
            // §15.6 25th-word passphrase wallets need the right secret
            // here; for now we only auto-unlock wallets whose seed was
            // encrypted *without* a 25th word. Wallets that need one
            // fall back to the per-op password prompt.
            if (w.passphraseEnabled && !bip39Passphrase) continue;
            try {
                const signer = await unlockWalletRecord({
                    wallet: w,
                    password,
                    bip39Passphrase,
                    chainRegistry,
                    sdkRegistry,
                });
                const existing = this._signers.get(w.id);
                if (existing) {
                    try { existing.lock(); } catch { /* best-effort */ }
                }
                this._signers.set(w.id, signer);
            } catch {
                // Bad password for this wallet, or other unlock
                // failure — skip it. The op-level fallback (password
                // prompt) will surface the real error if the user
                // tries to use that wallet.
            }
        }
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
