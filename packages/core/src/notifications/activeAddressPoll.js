// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const MAX_BACKOFF_MULTIPLIER = 8;

/** A closed vault is an expected watcher state, including across IPC wrappers. */
export function isVaultLockedError(error) {
    if (!error || typeof error !== 'object') return false;
    if (error.name === 'VaultStateError') return true;
    return typeof error.message === 'string'
        && /(?:VaultStateError.*(?:closed|not open)|Vault is (?:closed|not open))/i.test(error.message);
}

/**
 * Read active addresses with bounded exponential backoff and one diagnostic
 * per uninterrupted failure streak. Locked and empty wallets are normal
 * quiet states.
 */
export class ActiveAddressPoll {
    constructor({ getActiveAddresses, intervalMs, logger, owner }) {
        this._getActiveAddresses = getActiveAddresses;
        this._intervalMs = intervalMs;
        this._log = logger;
        this._owner = owner;
        this.reset();
    }

    reset() {
        this._failures = 0;
        this._retryAt = 0;
    }

    async read() {
        const now = Date.now();
        if (now < this._retryAt) return null;

        try {
            const addresses = await this._getActiveAddresses();
            this.reset();
            return Array.isArray(addresses) ? addresses : [];
        } catch (error) {
            if (isVaultLockedError(error)) {
                this.reset();
                return null;
            }

            this._failures += 1;
            if (this._failures === 1) {
                this._log.error(`${this._owner}: getActiveAddresses failed`, error);
            }
            const multiplier = Math.min(2 ** (this._failures - 1), MAX_BACKOFF_MULTIPLIER);
            this._retryAt = now + this._intervalMs * multiplier;
            return null;
        }
    }
}
