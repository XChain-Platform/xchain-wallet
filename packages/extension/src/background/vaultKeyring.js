// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vault keyring: what the host needs from the shell to change the password
// the VAULT is sealed under.
//
// The host holds an open Vault and nothing about how its key was made. The
// key is derived from the unlock password under the kdfParams in the meta
// slot, and after unlock the shell caches two more things the password
// governs: the derived key in the session slot (so a restarted worker or a
// relaunched desktop app can reopen the vault) and the password itself in the
// signing slot (so the signer pool can be refilled). A password change that
// re-seals the vault but leaves either cache on the old password reopens to a
// key that no longer decrypts anything, so the change hands both to the shell
// once the new blob is written.
//
// The kdfParams are read, never written: a change keeps the vault's cost and
// salt, so the meta slot already describes the new seal.

import { saveSigningSecret } from './signingSecretSession.js';

/**
 * @typedef {Object} VaultKeyring
 * @property {() => Promise<object | null>} kdfParams   the params the vault key is derived under
 * @property {(next: { masterKey: Uint8Array, password: string, previousKey: Uint8Array }) => Promise<boolean>} commit
 *   called once the vault blob is sealed under the new key; caches it and the new password,
 *   but only while the session slot still holds `previousKey`. A lock clears that slot, so
 *   a change that finishes after a lock re-arms nothing. Resolves true when it wrote.
 *   The caller zeroes both keys afterwards, so a backend must keep its own copy.
 */

/** @param {unknown} a @param {unknown} b */
function sameKeyBytes(a, b) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
    return diff === 0;
}

/**
 * @param {Object} backends
 * @param {{ load: () => Promise<any> }} backends.metaBackend
 * @param {{ save: (key: Uint8Array) => Promise<void> } | null} [backends.sessionBackend]
 * @param {{ save: (blob: Uint8Array) => Promise<void> } | null} [backends.signingSecretBackend]
 * @returns {VaultKeyring}
 */
export function createVaultKeyring({ metaBackend, sessionBackend = null, signingSecretBackend = null }) {
    if (!metaBackend || typeof metaBackend.load !== 'function') {
        throw new Error('createVaultKeyring: metaBackend is required');
    }
    return {
        async kdfParams() {
            const meta = /** @type {any} */ (await metaBackend.load());
            return meta?.kdfParams ?? null;
        },
        async commit({ masterKey, password, previousKey }) {
            // Session slot empty or on another key: the session was locked (or
            // never cached) while the change ran, and writing now would leave
            // an unlocked-looking session behind the lock.
            if (sessionBackend) {
                if (!sameKeyBytes(await sessionBackend.load(), previousKey)) return false;
                await sessionBackend.save(masterKey);
            }
            await saveSigningSecret(signingSecretBackend, password);
            return true;
        },
    };
}
