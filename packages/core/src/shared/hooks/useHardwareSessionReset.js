// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A hardware device session belongs to the wallet that opened it.
//
// Each shell loads its Trezor and Ledger factories on first pairing and keeps
// the Connect instance and the WebHID transport for the renderer's lifetime.
// Without a reset, locking the wallet or switching to another one leaves both
// open and the next wallet inherits the previous wallet's device session. The
// shells clear
// `activeWalletId` to null on lock and set it to the new id on a switch, so a
// change away from a non-null id is the one signal for both, and on it every
// factory module already loaded runs its reset. A module never loaded is not
// imported just to reset it.

import { useEffect, useRef } from 'react';

const RESET_EXPORTS = ['resetTrezorConnect', 'resetLedgerTransport'];

/**
 * Wrap a shell's lazy factory imports so the loaded ones can be reset.
 *
 * @template {Record<string, () => Promise<any>>} L
 * @param {L} loaders   vendor name -> dynamic import of that shell's factory module
 * @returns {{ load: (name: keyof L) => Promise<any>, reset: () => Promise<void> }}
 */
export function trackHardwareFactories(loaders) {
    /** @type {Map<string, Promise<any>>} */
    const loaded = new Map();
    return {
        load(name) {
            const key = String(name);
            if (!loaded.has(key)) {
                // A failed import is forgotten so the next pairing retries it.
                loaded.set(key, loaders[key]().catch((err) => {
                    loaded.delete(key);
                    throw err;
                }));
            }
            return /** @type {Promise<any>} */ (loaded.get(key));
        },
        async reset() {
            const modules = await Promise.allSettled(Array.from(loaded.values()));
            for (const settled of modules) {
                if (settled.status !== 'fulfilled') continue;
                for (const exportName of RESET_EXPORTS) {
                    const fn = settled.value?.[exportName];
                    if (typeof fn !== 'function') continue;
                    try {
                        await fn();
                    } catch {
                        // A transport that fails to close is already unusable.
                    }
                }
            }
        },
    };
}

/**
 * Run `reset` when the active wallet changes away from a wallet, which is
 * both a lock (the shells set it to null) and a switch.
 *
 * @param {string | null | undefined} activeWalletId
 * @param {() => unknown} reset
 */
export function useHardwareSessionReset(activeWalletId, reset) {
    const previousRef = useRef(activeWalletId);
    useEffect(() => {
        const previous = previousRef.current;
        previousRef.current = activeWalletId;
        if (previous && previous !== activeWalletId) {
            Promise.resolve().then(reset).catch(() => {});
        }
    }, [activeWalletId, reset]);
}
