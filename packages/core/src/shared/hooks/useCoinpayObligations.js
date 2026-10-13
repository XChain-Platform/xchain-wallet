// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §41.4 / PC-15: wallet-wide pending-COINPAY scan, shared by the
// Obligations queue route and the shells' nav badge.
//
// Scans every address on every chain of the active wallet via the
// existing `getCoinpayObligationsForAddress` messaging method (the
// same scan the Home resume card and CoinpayForm run one-shot) and
// keeps it fresh with a poll + tab-refocus refresh. Polling, not WS:
// event-grade delivery (onCoinpayRequired + missed-event reconcile)
// is PC-16 auto-pay's engine; a badge that reconciles within a poll
// interval is the right cost for a visibility layer.

import {
    createContext, createElement, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging } from '../useMessaging.js';
import { classifyObligation } from '../../market/obligationStatus.js';

const DEFAULT_POLL_MS = 60_000;
// Exported under its own name so the release profiler
// (tools/release/cold-open-profile.mjs) reads the badge's cadence from the
// hook rather than restating it.
export const COINPAY_BADGE_POLL_MS = DEFAULT_POLL_MS;

// Every hook using the same host transport joins the same wallet scan. The
// completed result also hydrates later mounts without another explorer sweep
// inside their documented poll interval.
const readsByMessaging = new WeakMap();

function sharedCoinpayRead({ messaging, walletId, accountId, pollMs, force = false }) {
    if ((typeof messaging !== 'object' || messaging === null) && typeof messaging !== 'function') {
        return scanCoinpayObligations({ messaging, walletId, accountId });
    }
    let reads = readsByMessaging.get(messaging);
    if (!reads) {
        reads = new Map();
        readsByMessaging.set(messaging, reads);
    }
    const identity = `${walletId}::${accountId || ''}`;
    let read = reads.get(identity);
    if (!read) {
        read = { lastStartedAt: null, inFlight: null, result: null };
        reads.set(identity, read);
    }
    if (read.inFlight) return read.inFlight;
    const now = Date.now();
    const age = read.lastStartedAt === null ? Infinity : now - read.lastStartedAt;
    if (!force && age >= 0 && age < pollMs) return Promise.resolve(read.result);

    read.lastStartedAt = now;
    const inFlight = scanCoinpayObligations({ messaging, walletId, accountId })
        .then((result) => {
            read.result = result;
            return result;
        })
        .catch((error) => {
            read.lastStartedAt = null;
            throw error;
        })
        .finally(() => {
            if (read.inFlight === inFlight) read.inFlight = null;
        });
    read.inFlight = inFlight;
    return inFlight;
}

/**
 * One normalized pending obligation. `chainId` + `address` +
 * `orderMatchActionIndex` is exactly the resume-ref shape the shells'
 * CoinpayForm wiring already accepts, so a row can be handed straight
 * to "Pay now".
 *
 * @typedef {{
 *   chainId: string,
 *   address: string,
 *   orderMatchActionIndex: string,
 *   payeeAddress: string,
 *   coinAmount: unknown,
 *   expiration: unknown,
 * }} PendingObligation
 */

/**
 * Pure scan, exported separately so the filter/normalization logic is
 * unit-testable with a mocked messaging layer (no React).
 *
 * Per-address failures are isolated (one dead explorer must not blank
 * the whole queue), matching the CoinpayForm scan it mirrors.
 *
 * @param {{ messaging: any, walletId: string, accountId?: string }} params
 * @returns {Promise<PendingObligation[]>}
 */
export async function scanCoinpayObligations({ messaging, walletId, accountId }) {
    if (typeof messaging?.getCoinpayObligationsForAddress !== 'function'
        || typeof messaging?.getAddressesByChain !== 'function') {
        return [];
    }
    const byChain = await messaging.getAddressesByChain(walletId, accountId);
    const pairs = [];
    for (const [chainId, addrs] of Object.entries(byChain || {})) {
        for (const a of addrs || []) pairs.push({ chainId, address: a.address });
    }
    const results = await Promise.all(pairs.map((p) =>
        messaging.getCoinpayObligationsForAddress({ chainId: p.chainId, address: p.address })
            .then((resp) => ({ ...p, rows: extractRows(resp), failed: false }))
            .catch((error) => ({ ...p, rows: [], failed: true, error }))));
    if (results.length > 0 && results.every((result) => result.failed)) {
        throw results[0].error || new Error('Failed to scan for payments due.');
    }
    const found = [];
    for (const r of results) {
        for (const row of r.rows) {
            if (!isPendingForPayer(row, r.address)) continue;
            found.push({
                chainId: r.chainId,
                address: r.address,
                orderMatchActionIndex: String(row.action_index ?? row.actionIndex),
                payeeAddress: row.payee_address || row.payeeAddress || '',
                coinAmount: row.coin_amount ?? row.coinAmount,
                expiration: row.expiration,
            });
        }
    }
    // Soonest deadline first; rows with no usable expiration sink to
    // the bottom (they have no countdown urgency to sort by).
    found.sort((a, b) => sortKey(a.expiration) - sortKey(b.expiration));
    return found;
}

function sortKey(expiration) {
    const n = Number(expiration);
    return Number.isFinite(n) && n > 0 && n < 10_000_000_000 ? n : Infinity;
}

/**
 * Live pending-obligation state for a wallet.
 *
 * `payableCount` is the nav-badge figure: pending rows whose
 * wall-clock deadline has not passed (an expired-but-unsettled row is
 * not actionable, so it must not summon the user). Recomputed against
 * the clock on every render; between renders its staleness is bounded
 * by the poll interval, which is fine for a badge.
 *
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} [accountId]
 * @param {{ pollMs?: number }} [opts]
 * @returns {{ obligations: PendingObligation[], scanning: boolean, error: string | null, refresh: () => void, payableCount: number }}
 */
export function useCoinpayObligations(walletId, accountId, opts = {}) {
    const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    const { messaging } = useMessaging();
    const [obligations, setObligations] = useState(/** @type {PendingObligation[]} */ ([]));
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const runRef = useRef(/** @type {null | ((force?: boolean) => Promise<void>)} */ (null));
    // Identity of the wallet+account the current rows belong to. On a
    // switch the stale rows (and the badge they feed) must flush
    // immediately, not linger until the new scan lands; on a mere
    // poll/refresh of the SAME identity they must NOT flush, or the
    // badge would flicker to zero on every sweep.
    const identityRef = useRef(/** @type {string | null} */ (null));
    const refresh = useCallback(() => { runRef.current?.(true); }, []);

    useEffect(() => {
        const identity = `${walletId || ''}::${accountId || ''}`;
        if (identityRef.current !== identity) {
            identityRef.current = identity;
            setObligations([]);
            setError(null);
        }
        // No wallet, or the demo wallet: nothing to owe, and the demo
        // wallet's fabricated addresses must not spam the explorer.
        if (!walletId || flowsLib.isDemoWallet(walletId)) {
            setObligations([]);
            setScanning(false);
            runRef.current = null;
            return undefined;
        }
        let cancelled = false;
        const run = (force = false) => {
            setScanning(true);
            const request = sharedCoinpayRead({
                messaging,
                walletId,
                accountId: accountId || undefined,
                pollMs,
                force,
            })
                .then((found) => {
                    if (!cancelled && found) {
                        setObligations(found);
                        setError(null);
                    }
                })
                .catch((scanError) => {
                    // Keep the previous rows on a failed sweep; a transient
                    // outage should not flicker the badge to zero.
                    if (!cancelled) setError(scanError?.message || "Failed to scan for payments due.");
                })
                .finally(() => {
                    if (!cancelled) setScanning(false);
                });
            return request;
        };
        runRef.current = run;
        const hidden = () => typeof document !== 'undefined'
            && document.visibilityState === 'hidden';
        const beat = () => {
            if (!hidden()) run();
        };
        beat();
        const timer = setInterval(beat, pollMs);
        const onVisible = () => {
            if (!hidden()) run();
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisible);
        }
        return () => {
            cancelled = true;
            if (runRef.current === run) runRef.current = null;
            clearInterval(timer);
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisible);
            }
        };
    }, [walletId, accountId, messaging, pollMs]);

    const payableCount = obligations.filter(
        (o) => classifyObligation(o.expiration).state !== 'expired',
    ).length;

    return { obligations, scanning, error, refresh, payableCount };
}

// One state owner per tree.
//
// Home's resume card and the shells' nav badge want the same wallet-wide
// pending-COINPAY rows, and every `useCoinpayObligations` instance costs one
// explorer read per address per sweep. A shell that mounts this provider uses
// one state owner and hands its rows to every consumer below it. Independent
// mounts outside that tree still join the module-shared transport read above.
//
// Not every tree has a provider, so the shared hook falls back to an instance
// of its own: the extension popup mounts Home but no nav badge, so nothing
// there would run the scan otherwise. ObligationsView keeps its own instance
// on purpose (a transient view with a manual refresh button).
const CoinpayObligationsContext = createContext(
    /** @type {ReturnType<typeof useCoinpayObligations> | null} */ (null));

/**
 * Runs the tree's single pending-COINPAY scan and provides it.
 *
 * @param {{
 *   walletId?: string | null,
 *   accountId?: string | null,
 *   pollMs?: number,
 *   children?: any,
 * }} props
 */
export function CoinpayObligationsProvider({ walletId, accountId, pollMs, children }) {
    const value = useCoinpayObligations(walletId, accountId, { pollMs });
    return createElement(CoinpayObligationsContext.Provider, { value }, children);
}

/**
 * The provider's state when one is mounted above, otherwise this caller's
 * own instance.
 *
 * A hook call cannot be conditional, so the fallback instance is ALWAYS
 * created; under a provider it is handed a null walletId, and
 * `useCoinpayObligations`' own early return means it never scans. So the
 * fallback costs a state slot and no explorer reads.
 *
 * @param {string | null | undefined} [walletId]
 * @param {string | null | undefined} [accountId]
 * @param {{ pollMs?: number }} [opts]
 * @returns {ReturnType<typeof useCoinpayObligations>}
 */
export function useSharedCoinpayObligations(walletId, accountId, opts = {}) {
    const provided = useContext(CoinpayObligationsContext);
    const own = useCoinpayObligations(provided ? null : walletId, accountId, opts);
    return provided || own;
}

// Row filters, shared shape-tolerant readers. Same semantics as the
// copies in Home.jsx / CoinpayForm.jsx (which predate this hook):
// pending status + this address on the payer side.
export function isPendingForPayer(row, address) {
    if (!row || typeof row !== 'object') return false;
    const status = String(row.coinpay_status || row.status || '').toLowerCase();
    if (status !== 'pending_coinpay') return false;
    const payer = row.payer_address || row.payerAddress;
    return typeof payer === 'string' && payer === address;
}

export function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    for (const key of ['data', 'rows', 'obligations', 'coinpay_obligations']) {
        if (Array.isArray(resp[key])) return resp[key];
    }
    return [];
}
