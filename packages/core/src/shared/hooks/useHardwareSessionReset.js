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
//
// A reset closes the transports, so it also tells the reconnect layer to
// forget every opened device; and `useHardwareReconnect` registers each
// paired device of the active wallet again once the wallet is unlocked, so a
// lock, a switch or a reload never leaves a hardware wallet unable to sign.

import { useEffect, useRef } from 'react';
import {
    invalidateLiveSigners, isHardwareVendorRecord, setHardwareFactories, setHardwareRecordSource,
} from '../../signers/hardwareReconnect.js';

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
            // The transports close below, so every device opened on them is stale.
            invalidateLiveSigners();
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

/**
 * Register every paired Trezor or Ledger of the active wallet with the
 * shell's signer bridge once the wallet is unlocked. No device opens here:
 * each registration opens its device on the first sign. One signer list read
 * per unlocked wallet (re-run when `refreshKey` changes, for a wallet the
 * user just connected). It also hands the reconnect layer the shell's pair
 * factories (keep the object stable), which reopen each device on its first
 * sign.
 *
 * @param {{
 *   unlocked: boolean,
 *   walletId: string | null | undefined,
 *   listSigners?: (walletId: string) => Promise<any>,
 *   registerRecord: (record: object) => void,
 *   factories?: Record<string, Function | null | undefined>,
 *   refreshKey?: unknown,
 * }} opts
 */
export function useHardwareReconnect({ unlocked, walletId, listSigners, registerRecord, factories, refreshKey }) {
    useEffect(() => {
        if (factories) setHardwareFactories(factories);
    }, [factories]);
    // A sign on a network the bridge's copy of a record has no Ledger
    // identity for re-reads that record through the same signer list.
    useEffect(() => {
        if (!unlocked || !walletId || typeof listSigners !== 'function') return undefined;
        setHardwareRecordSource(async (signerId) => (
            signerRecords(await listSigners(walletId)).find((record) => record?.id === signerId) || null
        ));
        return () => {
            setHardwareRecordSource(null);
        };
    }, [unlocked, walletId, listSigners]);
    useEffect(() => {
        if (!unlocked || !walletId || typeof listSigners !== 'function') return undefined;
        let cancelled = false;
        Promise.resolve()
            .then(() => listSigners(walletId))
            .then((result) => {
                if (cancelled) return;
                const records = signerRecords(result);
                for (const record of records) {
                    if (!record?.id || !isHardwareVendorRecord(record)) continue;
                    try {
                        registerRecord(record);
                    } catch {
                        // A bridge that cannot open (no preload, no runtime) leaves this device to the sign page.
                    }
                }
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [unlocked, walletId, listSigners, registerRecord, refreshKey]);
}

/** The records a signer list answered, bare or wrapped in `{ signers }`. */
function signerRecords(result) {
    if (Array.isArray(result)) return result;
    return Array.isArray(result?.signers) ? result.signers : [];
}
