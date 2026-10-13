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
import { DemoExitConfirm } from './DemoExitConfirm.jsx';
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
 * The disclosure reconciles fixture-fed read surfaces with chain-fed
 * action forms: sample balances can be large while forms correctly read
 * "0 available" because the wallet holds no spendable funds.
 *
 * Each shell mounts this once above its unlocked route tree and passes
 * `demoBannerInHeader` to Home so Home skips its fallback copy.
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
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [expiry, setExpiry] = useState(/** @type {{ expiresAt: number } | null} */ (null));
    const [now, setNow] = useState(() => Date.now());
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
        setNow(Date.now());
    }, [activeWalletId]);

    async function handleExit() {
        if (busy || !activeWalletId) return;
        setBusy(true);
        setError(null);
        try {
            // Every exit uses the shared teardown because removing only the
            // wallet record leaves vault metadata that routes the next boot
            // to an unlock screen for an empty vault.
            const { reloaded } = await exitDemoWallet({
                messaging,
                walletId: activeWalletId,
            });
            if (reloaded) return;
            setConfirmOpen(false);
            if (typeof onExited === 'function') onExited();
        } catch {
            setError('Could not exit demo mode. Please try again.');
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
            const tickNow = Date.now();
            setNow(tickNow);
            if (flowsLib.isDemoWalletExpired({ now: tickNow })) {
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

    const expiryHint = formatExpiryHint(expiry, now);
    return (
        <div className={styles.banner} role="status" aria-label="Demo wallet">
            <div className={styles.body}>
                <div className={styles.summary}>
                    <strong className={styles.headline}>
                        Demo wallet: read-only; cannot move funds
                    </strong>
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
                    variant="danger"
                    onClick={() => { setError(null); setConfirmOpen(true); }}
                    disabled={busy}
                >
                    Exit demo &amp; wipe
                </Button>
            </div>
            {error && !confirmOpen ? (
                <p role="alert" className={styles.error}>{error}</p>
            ) : null}
            {confirmOpen ? (
                <DemoExitConfirm
                    busy={busy}
                    error={error}
                    onConfirm={handleExit}
                    onCancel={() => { setConfirmOpen(false); setError(null); }}
                />
            ) : null}
        </div>
    );
}

function viewportStartsExpanded() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return !window.matchMedia(NARROW_VIEWPORT).matches;
}

function formatExpiryHint(expiry, now = Date.now()) {
    if (!expiry || typeof expiry.expiresAt !== 'number') return null;
    const remaining = expiry.expiresAt - now;
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
