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

import { useCallback, useEffect, useRef, useState } from 'react';
import { flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging } from '../useMessaging.js';
import { classifyObligation } from '../../market/obligationStatus.js';

const DEFAULT_POLL_MS = 60_000;

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
            .then((resp) => ({ ...p, rows: extractRows(resp) }))
            .catch(() => ({ ...p, rows: [] }))));
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
    return Number.isFinite(n) && n > 0 && n <= 1e13 ? n : Infinity;
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
 * @returns {{ obligations: PendingObligation[], scanning: boolean, refresh: () => void, payableCount: number }}
 */
export function useCoinpayObligations(walletId, accountId, opts = {}) {
    const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    const { messaging } = useMessaging();
    const [obligations, setObligations] = useState(/** @type {PendingObligation[]} */ ([]));
    const [scanning, setScanning] = useState(false);
    // Bumping forces the effect to re-run for a manual refresh.
    const [scanSeq, setScanSeq] = useState(0);
    const aliveRef = useRef(true);
    // Identity of the wallet+account the current rows belong to. On a
    // switch the stale rows (and the badge they feed) must flush
    // immediately, not linger until the new scan lands; on a mere
    // poll/refresh of the SAME identity they must NOT flush, or the
    // badge would flicker to zero on every sweep.
    const identityRef = useRef(/** @type {string | null} */ (null));

    const refresh = useCallback(() => setScanSeq((n) => n + 1), []);

    useEffect(() => {
        aliveRef.current = true;
        const identity = `${walletId || ''}::${accountId || ''}`;
        if (identityRef.current !== identity) {
            identityRef.current = identity;
            setObligations([]);
        }
        // No wallet, or the demo wallet: nothing to owe, and the demo
        // wallet's fabricated addresses must not spam the explorer.
        if (!walletId || flowsLib.isDemoWallet(walletId)) {
            setObligations([]);
            setScanning(false);
            return undefined;
        }
        let cancelled = false;
        const run = async () => {
            setScanning(true);
            try {
                const found = await scanCoinpayObligations({
                    messaging, walletId, accountId: accountId || undefined,
                });
                if (!cancelled && aliveRef.current) setObligations(found);
            } catch {
                // Keep the previous rows on a failed sweep; a transient
                // outage should not flicker the badge to zero.
            } finally {
                if (!cancelled && aliveRef.current) setScanning(false);
            }
        };
        run();
        const timer = setInterval(run, pollMs);
        const onVisible = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') run();
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisible);
        }
        return () => {
            cancelled = true;
            aliveRef.current = false;
            clearInterval(timer);
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisible);
            }
        };
    }, [walletId, accountId, messaging, pollMs, scanSeq]);

    const payableCount = obligations.filter(
        (o) => classifyObligation(o.expiration).state !== 'expired',
    ).length;

    return { obligations, scanning, refresh, payableCount };
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
