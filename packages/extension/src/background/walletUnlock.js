// wallet.unlock handler — runs BEFORE the MessageHost attaches.
//
// The vault is encrypted with a master key derived from the user's
// password via Argon2id. KDF params (salt, memory, iterations, parallelism)
// live in the plaintext ChromeMetaBackend slot — they're not secret, and
// storing them outside the ciphertext is the only way unlock can derive
// the master key before touching the blob.
//
// Unlock sequence:
//   1. Read kdfParams from the meta slot. Missing ⇒ no wallet to unlock.
//   2. Derive a 32-byte master key via Argon2id.
//   3. Open a Vault against the encrypted blob with that key. A bad
//      password auth-fails inside AES-GCM; `Vault.open()` throws. We
//      translate that into `InvalidPasswordError` for the popup.
//   4. Persist the master key to the session backend (not the password).
//   5. Fire `onUnlocked()` so background.js can call `ensureHost()` and
//      attach the full MessageHost to chrome.runtime.onMessage.
//
// Never returns the master key to the popup — the session backend is the
// only place it lives outside the service worker.

import { crypto as cryptoLib, storage as storageLib } from '@xchain-wallet/core';

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
 * @typedef {Object} WalletUnlockDeps
 * @property {import('../storage/ChromeStorageBackend.js').ChromeStorageBackend} storageBackend
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} sessionBackend
 * @property {import('../storage/ChromeMetaBackend.js').ChromeMetaBackend} metaBackend
 * @property {() => Promise<void> | void} [onUnlocked]
 */

/**
 * @param {unknown} request  Expected shape: `{ password: string }`
 * @param {WalletUnlockDeps} deps
 * @returns {Promise<{ unlocked: true }>}
 */
export async function handleWalletUnlock(request, deps) {
    const password = /** @type {any} */ (request)?.password;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.unlock: password is required');
    }
    const meta = /** @type {any} */ (await deps.metaBackend.load());
    if (!meta || !meta.kdfParams) {
        throw new NoVaultError();
    }

    const masterKey = cryptoLib.deriveMasterKey(password, meta.kdfParams);
    try {
        // Authenticate the password by actually opening the vault. AES-GCM
        // throws on tag-mismatch, which is what a wrong password produces.
        const vault = new storageLib.Vault({
            backend: deps.storageBackend,
            masterKey,
        });
        try {
            await vault.open();
        } catch (err) {
            if (isAeadAuthFailure(err)) {
                throw new InvalidPasswordError();
            }
            throw err;
        } finally {
            // Vault kept its own copy of the key; close zeros that copy.
            vault.close();
        }

        // Password was correct. Persist the master key to the session
        // backend — that's what `ensureHost()` reads to build the host.
        await deps.sessionBackend.save(masterKey);
    } finally {
        masterKey.fill(0);
    }

    if (typeof deps.onUnlocked === 'function') {
        await deps.onUnlocked();
    }
    return { unlocked: true };
}

function isAeadAuthFailure(err) {
    if (!err) return false;
    const name = err.name || '';
    const msg = err.message || String(err);
    // Web Crypto surfaces AES-GCM auth failures as DOMException
    // "OperationError". Node's Web Crypto matches. Also accept generic
    // wrappers that mention "auth" just in case.
    return (
        name === 'OperationError' ||
        name === 'InvalidAccessError' ||
        /operation[- ]?error|auth|tag/i.test(msg)
    );
}
