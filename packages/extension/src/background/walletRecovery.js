// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pre-host Forgot Password lanes (operator ruling 2026-11-16), shared by the
// extension worker and the desktop main process through dispatchPreHost. They
// run with the vault closed, from the lock screen:
//
//   wallet.recovery.status          which ways back this device offers
//   wallet.recovery.resetWithPhrase reset the password with a recovery phrase,
//                                   then unlock through the normal unlock
//   wallet.recovery.verifyBackup    prove a backup file restores before the
//                                   page erases anything
//
// The erase-everything hold lives in the renderer with the other lock-screen
// guards (core flows/eraseSchedule.js), so it has no lane here.

import { crypto as cryptoLib, flows } from '@xchain-wallet/core';
import { handleWalletUnlock } from './walletUnlock.js';

/**
 * @param {{ metaBackend: { load: () => Promise<any> } }} deps
 * @returns {Promise<{ hasWallet: boolean, phraseReset: boolean }>}
 */
export async function handleRecoveryStatus(deps) {
    const meta = await deps.metaBackend.load();
    return { hasWallet: Boolean(meta?.kdfParams), phraseReset: flows.phraseResetAvailable(meta) };
}

/**
 * Reset the unlock password with one wallet's recovery phrase, keeping every
 * wallet, key and record, then unlock with the new password through the same
 * handler a typed unlock uses (session key, signing secret, signer pool,
 * throttle clear, onUnlocked). A wrong phrase writes nothing.
 *
 * @param {unknown} request   `{ phrase: string, newPassword: string }`
 * @param {Parameters<typeof handleWalletUnlock>[1]} deps
 */
export async function handlePhraseReset(request, deps) {
    const phrase = /** @type {any} */ (request)?.phrase;
    const newPassword = /** @type {any} */ (request)?.newPassword;
    if (typeof phrase !== 'string' || phrase.trim().length === 0) {
        throw new flows.RecoveryPhraseMismatchError();
    }
    // The reset rewrites a CLOSED vault. A live session holds the vault open
    // under the current key, and its next write would then fail to land.
    let sessionKey = null;
    try {
        sessionKey = await deps.sessionBackend?.load?.();
    } finally {
        if (sessionKey instanceof Uint8Array) sessionKey.fill(0);
    }
    if (sessionKey) throw new Error('wallet.recovery.resetWithPhrase: the wallet is already unlocked');
    const meta = await deps.metaBackend.load();
    const result = await flows.resetPasswordWithRecoveryPhrase({
        storageBackend: deps.storageBackend,
        meta,
        phrase,
        newPassword,
    });
    // The blob is already sealed under the new password. A lost meta write
    // leaves a stale record that fails closed until the unlock below rebuilds it.
    try {
        const latest = await deps.metaBackend.load();
        if (latest && cryptoLib.kdfParamsEqual(latest.kdfParams, meta.kdfParams)) {
            await deps.metaBackend.save(flows.withPhraseRecovery(latest, result.meta.phraseRecovery ?? null));
        }
    } catch (err) {
        console.warn('[xchain] phrase reset: recovery record not refreshed:', /** @type {any} */ (err)?.name || err);
    }
    // The person proved ownership of the wallet; the guessing throttle starts over.
    if (deps.unlockThrottleStore) await deps.unlockThrottleStore.clear().catch(() => { /* best-effort */ });
    const reply = await handleWalletUnlock({ password: newPassword }, deps);
    return { ...reply, passwordReset: true, skippedWalletIds: result.skippedWalletIds };
}

/**
 * @param {unknown} request   `{ fileContent: string, password: string, walletPassword?: string }`
 * @param {{ resolveBackupContent?: (req: any) => Promise<string>, metaBackend?: { load: () => Promise<any> } }} [deps]
 */
export async function handleVerifyBackup(request, deps = {}) {
    const req = /** @type {any} */ (request) ?? {};
    const fileContent = typeof req.fileContent === 'string'
        ? req.fileContent
        : (typeof deps.resolveBackupContent === 'function' ? await deps.resolveBackupContent(req) : '');
    const meta = await deps.metaBackend?.load?.();
    return flows.verifyBackupFileForRestore({
        fileContent,
        password: req.password,
        walletPassword: req.walletPassword,
        currentWalletIds: flows.vaultWalletIds(meta),
    });
}
