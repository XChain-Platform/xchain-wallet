// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * Leave the unlocked UI before waiting for the host to destroy its secrets.
 * Persisted form drafts remain governed by useFormDraft; the shell callback
 * clears only transient route and prefill state.
 *
 * @param {object} options
 * @param {() => Promise<any>} options.lockWallet
 * @param {() => void} options.showLocked
 * @param {() => void} options.clearTransientState
 * @param {() => void | Promise<void>} options.recover
 * @returns {Promise<any>}
 */
export function lockImmediately({
    lockWallet,
    showLocked,
    clearTransientState,
    recover,
}) {
    clearTransientState();
    showLocked();

    try {
        return Promise.resolve(lockWallet()).catch(recover);
    } catch (_err) {
        return Promise.resolve(recover());
    }
}
