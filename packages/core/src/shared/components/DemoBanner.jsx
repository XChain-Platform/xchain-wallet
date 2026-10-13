// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useState } from 'react';
import { flows as flowsLib } from '@xchain-wallet/core';
import { Button } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import { exitDemoWallet } from '../utils/demoGraduation.js';
import styles from './DemoBanner.module.css';

const NARROW_VIEWPORT = '(max-width: 599px)';

/**
 * §25.2 / G059: persistent banner shown across the unlocked tree when
 * the active wallet is the throwaway demo wallet. Renders nothing for
 * normal wallets. Exposes a one-tap "Exit demo & wipe" affordance that
 * calls `wallet.remove`, clears the localStorage flag, and refreshes
 * the App state into the onboarding screen so the user lands back on
 * the Welcome view (next step: G060 animated explainers).
 *
 * the visible banner was suppressed for a while, leaving
 * WalletDetails as the only surface that named the demo. A first-time
 * visitor never opens that page, so the funnel showed a seven-figure
 * portfolio above action forms reading "0 BTC available" and no text
 * anywhere reconciling the two: read surfaces are fixture-fed, action
 * forms are chain-fed. The copy below has to close exactly that gap,
 * so it names the demo AND says why the forms read zero. Operator
 * decision 2026-08-11 put the disclosure back on Home.
 *
 * Mounted once per view: the web and desktop shells mount this in
 * their layout header (it then persists across every unlocked view,
 * Home included) and pass `demoBannerInHeader` to Home so Home skips
 * its own copy. The extension popup has no header slot, so Home mounts
 * it there.
 *
 * @param {object} props
 * @param {string | null | undefined} props.activeWalletId
 * @param {() => void} [props.onExited]                   refresh callback after wipe
 */
export function DemoBanner({ activeWalletId, onExited }) {
    const { messaging } = useMessaging();
    const detailsId = useId();
    const [isDemo, setIsDemo] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [expiry, setExpiry] = useState(/** @type {{ expiresAt: number } | null} */ (null));
    const [autoWiped, setAutoWiped] = useState(false);
    const [expanded, setExpanded] = useState(viewportStartsExpanded);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined;
        const query = window.matchMedia(NARROW_VIEWPORT);
        const syncToViewport = (event) => setExpanded(!event.matches);
        syncToViewport(query);
        query.addEventListener('change', syncToViewport);
        return () => query.removeEventListener('change', syncToViewport);
    }, []);

    useEffect(() => {
        setIsDemo(flowsLib.isDemoWallet(activeWalletId));
        setExpiry(flowsLib.getDemoWalletExpiry());
    }, [activeWalletId]);

    async function handleExit() {
        if (busy || !activeWalletId) return;
        setBusy(true);
        setError(null);
        try {
            // Same teardown as the Wallet-details exit. Dropping the
            // record alone leaves the vault meta behind, so the 24h
            // auto-expire below used to hand the user an unlock screen
            // for an empty vault whose throwaway password it had just
            // deleted (wallet E2E session 16, D-61).
            const { reloaded } = await exitDemoWallet({
                messaging,
                walletId: activeWalletId,
            });
            if (reloaded) return;
            if (typeof onExited === 'function') onExited();
        } catch (err) {
            setError(err?.message || 'Could not exit demo mode.');
        } finally {
            setBusy(false);
        }
    }

    // Cluster J FOLLOWUP 6: auto-expire. When the demo wallet's TTL
    // has elapsed, fire a one-shot wipe + onExited so the user lands
    // back on Welcome rather than seeing a stale "throwaway wallet"
    // banner indefinitely. The check runs on mount + on a 60s
    // interval so a long session also catches the expiry.
    useEffect(() => {
        if (!isDemo || autoWiped || busy) return undefined;
        const tick = () => {
            if (flowsLib.isDemoWalletExpired()) {
                setAutoWiped(true);
                handleExit();
            }
        };
        tick();
        const id = setInterval(tick, 60_000);
        return () => clearInterval(id);
        // handleExit is stable enough; re-running on busy flips would
        // double-fire the exit. Intentionally omit it from deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDemo, activeWalletId, autoWiped, busy]);

    if (!isDemo) return null;

    const expiryHint = formatExpiryHint(expiry);
    return (
        <div className={styles.banner} role="status" aria-label="Demo wallet">
            <div className={styles.body}>
                <div className={styles.summary}>
                    <strong className={styles.headline}>Demo wallet: read-only</strong>
                    <button
                        type="button"
                        className={styles.detailsToggle}
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        onClick={() => setExpanded((value) => !value)}
                    >
                        Details
                    </button>
                </div>
                <div id={detailsId} className={styles.disclosure} hidden={!expanded}>
                    <span className={styles.copy}>
                        The balances, prices and history on this screen are sample
                        data, not real coins. That is why Send and the other action
                        forms read 0 available: this demo holds nothing to spend, so
                        it cannot move funds.
                        {expiryHint ? ` ${expiryHint}` : ''}
                    </span>
                    <span className={styles.copy}>
                        Exit to wipe the demo and set up a real wallet.
                    </span>
                </div>
            </div>
            <div className={styles.actions} hidden={!expanded}>
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleExit}
                    loading={busy}
                    disabled={busy}
                >
                    Exit demo &amp; wipe
                </Button>
            </div>
            {error ? (
                <p role="alert" className={styles.error}>{error}</p>
            ) : null}
        </div>
    );
}

function viewportStartsExpanded() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return !window.matchMedia(NARROW_VIEWPORT).matches;
}

function formatExpiryHint(expiry) {
    if (!expiry || typeof expiry.expiresAt !== 'number') return null;
    const remaining = expiry.expiresAt - Date.now();
    if (remaining <= 0) return 'Auto-wipe imminent.';
    const minutes = Math.floor(remaining / 60_000);
    const hours = Math.floor(minutes / 60);
    if (hours >= 1) {
        const remMin = minutes % 60;
        return remMin > 0
            ? `Auto-wipes in ${hours}h ${remMin}m.`
            : `Auto-wipes in ${hours}h.`;
    }
    if (minutes >= 1) return `Auto-wipes in ${minutes}m.`;
    return 'Auto-wipes in under a minute.';
}
