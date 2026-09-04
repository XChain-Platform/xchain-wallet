// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// wallet.unlock handler; runs BEFORE the MessageHost attaches.
//
// The vault is encrypted with a master key derived from the user's
// password via Argon2id. KDF params (salt, memory, iterations, parallelism)
// live in the plaintext ChromeMetaBackend slot; they're not secret, and
// storing them outside the ciphertext is the only way unlock can derive
// the master key before touching the blob.
//
// Unlock sequence:
//   1. Read kdfParams from the meta slot. Missing ⇒ no wallet to unlock.
//   2. Derive a 32-byte master key via Argon2id.
//   3. Open a Vault against the encrypted blob with that key. A bad
//      password auth-fails inside AES-GCM; `Vault.open()` throws. We
//      translate that into `InvalidPasswordError` for the popup.
//   4. Persist the master key to the session backend.
//   5. Cache the password in the signing-secret session slot (when a
//      `signingSecretBackend` is supplied) so `ensureHost()` can rebuild
//      the SignerPool after an MV3 service-worker restart; the master key
//      alone can't (the seed is password-encrypted). See
//      `signingSecretSession.js` for the security rationale.
//   6. Fire `onUnlocked()` so background.js can call `ensureHost()` and
//      attach the full MessageHost to chrome.runtime.onMessage.
//
// Never returns the master key or password to the popup; the session
// backends are the only place they live outside the service worker.

import { crypto as cryptoLib, storage as storageLib, flows as flowsLib } from '@xchain-wallet/core';
import { saveSigningSecret } from './signingSecretSession.js';
import { checkUnlockAllowed, recordFailure } from './unlockThrottle.js';

export class InvalidPasswordError extends Error {
    constructor() {
        super('Incorrect password.');
        this.name = 'InvalidPasswordError';
    }
}

export class UnlockThrottledError extends Error {
    /** @param {number} retryAfterMs */
    constructor(retryAfterMs) {
        const secs = Math.ceil((retryAfterMs || 0) / 1000);
        super(`Too many incorrect attempts. Try again in ${secs}s.`);
        this.name = 'UnlockThrottledError';
        this.retryAfterMs = retryAfterMs;
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
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} [signingSecretBackend]   session slot for the cached password; when supplied, lets ensureHost re-populate the SignerPool after a service-worker restart
 * @property {import('../storage/ChromeMetaBackend.js').ChromeMetaBackend} metaBackend
 * @property {{ load: () => Promise<any>, save: (s: any) => Promise<void>, clear: () => Promise<void> }} [unlockThrottleStore]   background-persisted attempt throttle; when absent, unlock is not throttled here (the shell gates it elsewhere)
 * @property {import('@xchain-wallet/core').signers.SignerPool} [signerPool]   when supplied, every Wallet record's signer is unlocked into the pool while the password is in scope; lets account.create / receive.getAddress (etc.) skip the per-op password prompt
 * @property {import('@xchain-wallet/core').registry.ChainRegistry} [chainRegistry]   required iff `signerPool` is supplied
 * @property {import('@xchain-wallet/core').sdk.SDKRegistry} [sdkRegistry]            required iff `signerPool` is supplied
 * @property {() => Promise<void> | void} [onUnlocked]
 */

/**
 * Turn the populate summary's two parallel arrays into the `{ id, name }` rows
 * the unlock screen renders. Parallel arrays are the pool's internal shape;
 * a caller that has to keep two lists in step is one edit away from pairing
 * the wrong name with the wrong wallet.
 *
 * @param {{ passphraseCaptureNeeded?: string[], passphraseCaptureNames?: string[] } | null} summary
 * @returns {Array<{ id: string, name: string }>}
 */
function captureRows(summary) {
    const ids = summary?.passphraseCaptureNeeded;
    if (!Array.isArray(ids)) return [];
    const names = Array.isArray(summary.passphraseCaptureNames) ? summary.passphraseCaptureNames : [];
    return ids.map((id, i) => ({ id, name: names[i] || '' }));
}

/**
 * @param {unknown} request  Expected shape: `{ password: string, bip39Passphrase?: string }`;
 *   the optional §15.6 25th word unlocks passphrase-enabled wallets into the pool and is
 *   verified against their stored addresses
 * @param {WalletUnlockDeps} deps
 * @returns {Promise<{ unlocked: true, passphraseCaptureNeeded: Array<{ id: string, name: string }>, poolUnavailable?: true }>}
 *   `passphraseCaptureNeeded` lists the legacy wallets the password opened but that hold no
 *   stored passphrase yet; the unlock screen asks for each one's 25th word once and sends it
 *   to `wallet.passphrase.capture`. `poolUnavailable` marks the populate-failed path, where
 *   the list is empty because nothing was inspected rather than because nothing needs capture.
 */
export async function handleWalletUnlock(request, deps) {
    const password = /** @type {any} */ (request)?.password;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.unlock: password is required');
    }
    const rawPassphrase = /** @type {any} */ (request)?.bip39Passphrase;
    const bip39Passphrase = typeof rawPassphrase === 'string' ? rawPassphrase : '';
    const meta = /** @type {any} */ (await deps.metaBackend.load());
    if (!meta || !meta.kdfParams) {
        throw new NoVaultError();
    }

    // Authoritative unlock throttle (checked BEFORE the KDF so a locked-out
    // attempt costs no CPU). Optional: shells that don't supply a store (e.g.
    // desktop) keep their own gating. See unlockThrottle.js.
    const throttle = deps.unlockThrottleStore;
    if (throttle) {
        const state = await throttle.load().catch(() => null);
        const gate = checkUnlockAllowed(state, Date.now());
        if (!gate.allowed) {
            throw new UnlockThrottledError(gate.retryAfterMs);
        }
    }

    /** @type {Array<{ id: string, name: string }>} */
    let passphraseCaptureNeeded = [];
    let poolUnavailable = false;

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

            // Populate the SignerPool while the vault is open AND the
            // password is in scope. Pool entries outlive this block;
            // they live in background memory until `wallet.lock`.
            if (deps.signerPool && deps.chainRegistry && deps.sdkRegistry) {
                let pooled = null;
                try {
                    pooled = await deps.signerPool.populate({
                        vault,
                        password,
                        bip39Passphrase,
                        chainRegistry: deps.chainRegistry,
                        sdkRegistry: deps.sdkRegistry,
                    });
                } catch {
                    // Best-effort: a pool populate failure shouldn't
                    // block unlock. The per-op password prompt remains
                    // as a fallback for any wallet not in the pool.
                }
                // An empty capture list means two different things, and the
                // unlock screen must not read them the same way: either no
                // wallet needs its passphrase, or populate never got far
                // enough to say. Mark the second case so a legacy wallet is
                // not silently dropped from the queue by a failed populate.
                if (pooled) {
                    passphraseCaptureNeeded = captureRows(pooled);
                } else {
                    poolUnavailable = true;
                }
                // A typed 25th word that reproduced none of the passphrase
                // wallets' addresses is a mistype. Refuse the unlock (the
                // password was right, so the throttle is untouched) rather
                // than open a session whose signer owns different coins.
                // One match among several passphrase wallets lets the
                // unlock stand; the rest sit out until the next unlock.
                if (bip39Passphrase && pooled
                    && pooled.passphraseMismatch.length > 0 && pooled.passphraseMatched.length === 0) {
                    try { deps.signerPool.lockAll(); } catch { /* best-effort */ }
                    throw new flowsLib.PassphraseMismatchError(pooled.passphraseMismatchNames);
                }
            }
        } catch (err) {
            if (isAeadAuthFailure(err)) {
                // Wrong password: count it against the throttle so repeated
                // attempts escalate into a backoff.
                if (throttle) {
                    const prev = await throttle.load().catch(() => null);
                    await throttle.save(recordFailure(prev, Date.now())).catch(() => { /* best-effort */ });
                }
                throw new InvalidPasswordError();
            }
            throw err;
        } finally {
            // Vault kept its own copy of the key; close zeros that copy.
            vault.close();
        }

        // Password was correct. Clear the throttle so the next lock/unlock
        // cycle starts fresh, then persist the master key to the session
        // backend (that's what `ensureHost()` reads to build the host).
        if (throttle) await throttle.clear().catch(() => { /* best-effort */ });
        await deps.sessionBackend.save(masterKey);
        // Cache the password so the SignerPool can be rebuilt after a
        // service-worker restart; the master key can't decrypt seeds. The
        // password is now the whole secret: a passphrase wallet carries its
        // own encrypted 25th word on the record, so a typed one has nothing
        // left to unlock and is deliberately NOT written to the slot.
        await saveSigningSecret(deps.signingSecretBackend, password);
    } finally {
        masterKey.fill(0);
    }

    if (typeof deps.onUnlocked === 'function') {
        await deps.onUnlocked();
    }
    return poolUnavailable
        ? { unlocked: true, passphraseCaptureNeeded, poolUnavailable: true }
        : { unlocked: true, passphraseCaptureNeeded };
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
