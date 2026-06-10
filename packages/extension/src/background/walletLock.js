// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// wallet.lock handler — clears the session backend and signals the
// background to tear down its host + vault references. Pairs with the
// `wallet.unlock` handler: unlock builds the host, lock tears it down.
//
// Runs via the pre-host dispatcher so lock works even if the host is
// already in a bad state (e.g. a handler threw and left things partial).
// No vault access needed — clearing the session key on its own is
// enough to gate future reads. The host-teardown callback is the
// belt-and-braces step that releases the closed-over vault reference
// so a later re-unlock doesn't race against stale state.

import { clearSigningSecret } from './signingSecretSession.js';

/**
 * @typedef {Object} WalletLockDeps
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} sessionBackend
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} [signingSecretBackend]   cleared alongside the session key so no signing secret outlives the lock
 * @property {() => Promise<void> | void} [onLocked]
 */

/**
 * @param {unknown} _request
 * @param {WalletLockDeps} deps
 * @returns {Promise<{ locked: true }>}
 */
export async function handleWalletLock(_request, deps) {
    await deps.sessionBackend.clear();
    await clearSigningSecret(deps.signingSecretBackend);
    if (typeof deps.onLocked === 'function') {
        await deps.onLocked();
    }
    return { locked: true };
}
