// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// wallet.lock handler: clears the session backend and signals the
// background to tear down its host + vault references. Pairs with the
// `wallet.unlock` handler: unlock builds the host, lock tears it down.
//
// Runs via the pre-host dispatcher so lock works even if the host is
// already in a bad state (e.g. a handler threw and left things partial).
// No vault access needed; clearing the session key on its own is
// enough to gate future reads. The host-teardown callback is the
// belt-and-braces step that releases the closed-over vault reference
// so a later re-unlock doesn't race against stale state.

import { clearSigningSecret } from './signingSecretSession.js';

/**
 * Raised when any step of the lock sequence failed. Every other step still
 * ran, so a caller that sees this knows teardown happened and that at least
 * one secret may have survived. `steps` names the failed stages and `causes`
 * carries the underlying errors for logging; neither holds a secret value.
 */
export class WalletLockIncompleteError extends Error {
    /**
     * @param {string[]} steps
     * @param {unknown[]} causes
     */
    constructor(steps, causes) {
        super(`Wallet lock incomplete: ${steps.join(', ')} failed.`);
        this.name = 'WalletLockIncompleteError';
        this.code = 'LOCK_INCOMPLETE';
        this.steps = steps;
        this.causes = causes;
    }
}

/**
 * @typedef {Object} WalletLockDeps
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} sessionBackend
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} [signingSecretBackend]   cleared alongside the session key so no signing secret outlives the lock
 * @property {(result: { secretsCleared: boolean }) => Promise<void> | void} [onLocked]   told whether BOTH secret clears succeeded, so a shell can keep its auto-lock retry record when they did not
 */

/**
 * Lock the wallet. Each step is attempted independently and teardown always
 * runs: a bare await chain abandons the rest of the sequence on the first
 * rejection, so a failed session-key clear would leave the cached signing
 * secret in place AND skip `onLocked`, holding the vault open and the
 * SignerPool on seed material while the UI renders "locked".
 *
 * Throws `WalletLockIncompleteError` when anything failed, and only after
 * teardown has run, so no caller reads a partial lock as a clean one.
 *
 * @param {unknown} _request
 * @param {WalletLockDeps} deps
 * @returns {Promise<{ locked: true }>}
 * @throws {WalletLockIncompleteError} when a clear or the teardown failed
 */
export async function handleWalletLock(_request, deps) {
    /** @type {string[]} */
    const failedSteps = [];
    /** @type {unknown[]} */
    const causes = [];

    // Record a step's failure rather than abandoning the sequence.
    const attempt = async (step, run) => {
        try {
            await run();
            return true;
        } catch (err) {
            failedSteps.push(step);
            causes.push(err);
            console.error(`[xchain] wallet.lock: ${step} failed:`, err);
            return false;
        }
    };

    const sessionCleared = await attempt('sessionBackend.clear', () => deps.sessionBackend.clear());
    const signingCleared = await attempt(
        'clearSigningSecret',
        () => clearSigningSecret(deps.signingSecretBackend),
    );

    // Teardown must never be skipped: closing the vault and zeroing the
    // SignerPool is the one cleanup a surviving session key cannot undo.
    if (typeof deps.onLocked === 'function') {
        await attempt('onLocked', () => deps.onLocked({
            secretsCleared: sessionCleared && signingCleared,
        }));
    }

    if (failedSteps.length > 0) {
        throw new WalletLockIncompleteError(failedSteps, causes);
    }
    return { locked: true };
}
