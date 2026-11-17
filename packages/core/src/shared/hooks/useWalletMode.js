// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useWalletMode (§20): the mode of the active wallet, or of a named one, read
// from the safe wallet list, never settings. Each shell publishes the list and
// the active id into a module store; an unknown wallet reads as `full`.
//
// Shape:
//   { walletMode: 'full' | 'watcher' | 'signer',
//     isFullMode: boolean,
//     isWatcherMode: boolean,
//     isSignerMode: boolean }

import { useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { WALLET_MODE_DEFAULT, walletModeOf } from '../../schemas/wallet.js';
import { MessagingContext } from '../MessagingContext.js';
import { useMessaging } from '../useMessaging.js';

/** Window event a writer fires after it changes a wallet's mode (pairing). */
export const WALLET_MODES_CHANGED_EVENT = 'xc:wallet-modes-changed';

/**
 * @typedef {{ activeWalletId: string | null, modes: ReadonlyMap<string, 'full' | 'watcher' | 'signer'> }} WalletModeSnapshot
 */

/** @type {WalletModeSnapshot} */
const EMPTY = Object.freeze({ activeWalletId: null, modes: new Map() });
/** @type {WalletModeSnapshot} */
let snapshot = EMPTY;
const listeners = new Set();

function emit() {
    for (const listener of listeners) listener();
}

function subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

const getSnapshot = () => snapshot;

/**
 * Publish the wallets' modes (from the safe wallet list) and which one is
 * active. Wallets absent from `wallets` keep no entry.
 *
 * @param {{ wallets?: Array<{ id: string, walletMode?: unknown }> | null, activeWalletId?: string | null }} next
 */
export function publishWalletModes({ wallets, activeWalletId } = {}) {
    const modes = new Map();
    if (Array.isArray(wallets)) {
        for (const w of wallets) {
            if (w && typeof w.id === 'string' && w.id) modes.set(w.id, walletModeOf(w));
        }
    } else {
        for (const [id, mode] of snapshot.modes) modes.set(id, mode);
    }
    snapshot = {
        activeWalletId: activeWalletId === undefined ? snapshot.activeWalletId : (activeWalletId || null),
        modes,
    };
    emit();
}

/** Forget every published mode (lock, wipe, and between unit tests). */
export function resetWalletModes() {
    snapshot = EMPTY;
    emit();
}

/** Tell every mounted source to re-read the wallet list. */
export function notifyWalletModesChanged() {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event(WALLET_MODES_CHANGED_EVENT));
    }
}

/**
 * Shell-side source: keeps the store in step with the active wallet. Re-reads
 * the wallet list when the active wallet changes and when a writer fires
 * WALLET_MODES_CHANGED_EVENT; a failed read keeps what was published.
 *
 * @param {string | null | undefined} activeWalletId
 */
export function useActiveWalletModeSource(activeWalletId) {
    const { messaging } = useMessaging();
    useEffect(() => {
        let cancelled = false;
        const id = activeWalletId || null;
        publishWalletModes({ activeWalletId: id });
        const read = () => {
            if (typeof messaging?.listWallets !== 'function') return;
            Promise.resolve()
                .then(() => messaging.listWallets())
                .then((list) => {
                    if (!cancelled && Array.isArray(list)) publishWalletModes({ wallets: list, activeWalletId: id });
                })
                .catch(() => {});
        };
        read();
        if (typeof window === 'undefined') return () => { cancelled = true; };
        window.addEventListener(WALLET_MODES_CHANGED_EVENT, read);
        return () => {
            cancelled = true;
            window.removeEventListener(WALLET_MODES_CHANGED_EVENT, read);
        };
    }, [messaging, activeWalletId]);
}

/**
 * @typedef {Object} WalletModeState
 * @property {'full' | 'watcher' | 'signer'} walletMode
 * @property {boolean} isFullMode
 * @property {boolean} isWatcherMode
 * @property {boolean} isSignerMode
 * @property {boolean} walletModeKnown   false until the wallet's record has been read; `walletMode` is then the default
 */

/**
 * @param {'full' | 'watcher' | 'signer'} walletMode
 * @param {boolean} [walletModeKnown]
 * @returns {WalletModeState}
 */
export function walletModeState(walletMode, walletModeKnown = true) {
    return {
        walletMode,
        isFullMode: walletMode === 'full',
        isWatcherMode: walletMode === 'watcher',
        isSignerMode: walletMode === 'signer',
        walletModeKnown,
    };
}

// One wallet-list read in flight per messaging object, shared by every reader
// that finds its wallet missing from the store.
const pendingReads = new WeakMap();

/**
 * Read the safe wallet list once and merge its modes into the store, keeping
 * the active id. Resolves (never rejects) when the read settles; null when
 * the shell has no wallet list to read.
 *
 * @param {any} messaging
 * @returns {Promise<void> | null}
 */
function readWalletModes(messaging) {
    if (!messaging || typeof messaging.listWallets !== 'function') return null;
    let pending = pendingReads.get(messaging);
    if (!pending) {
        pending = Promise.resolve()
            .then(() => messaging.listWallets())
            .then((list) => {
                if (!Array.isArray(list)) return;
                const merged = [...snapshot.modes].map(([id, walletMode]) => ({ id, walletMode }));
                publishWalletModes({ wallets: [...merged, ...list] });
            })
            .catch(() => {})
            .finally(() => { pendingReads.delete(messaging); });
        pendingReads.set(messaging, pending);
    }
    return pending;
}

/**
 * @param {string | null} [walletId]   a specific wallet; omitted means the active one
 * @returns {WalletModeState}   `walletModeKnown` is true once the wallet's record was read, or the read could not say (then `full`)
 */
export function useWalletMode(walletId) {
    const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    // Null-tolerant: a reader outside a messaging provider keeps the store
    // value and never reads.
    const messagingValue = useContext(MessagingContext);
    const messaging = messagingValue?.messaging || null;
    const id = walletId || current.activeWalletId;
    const known = Boolean(id && current.modes.has(id));
    // The wallet id whose read settled without naming it (no list, a failed
    // read, or a list that does not carry it); that wallet reads as `full`.
    const [settledId, setSettledId] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        if (!id || known) return undefined;
        let cancelled = false;
        const pending = readWalletModes(messaging);
        if (!pending) {
            setSettledId(id);
            return undefined;
        }
        pending.then(() => { if (!cancelled) setSettledId(id); });
        return () => { cancelled = true; };
    }, [id, known, messaging]);
    const walletMode = (known && current.modes.get(id)) || WALLET_MODE_DEFAULT;
    return walletModeState(walletMode, !id || known || settledId === id);
}
