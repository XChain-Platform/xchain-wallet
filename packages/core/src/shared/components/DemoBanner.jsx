import { useEffect, useState } from 'react';
import { flows as flowsLib } from '@xchain-wallet/core';
import { Button } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import { clearLastView } from '../utils/lastViewMemory.js';
import styles from './DemoBanner.module.css';

/**
 * §25.2 / G059 — persistent banner shown across the unlocked tree when
 * the active wallet is the throwaway demo wallet. Renders nothing for
 * normal wallets. Exposes a one-tap "Exit demo & wipe" affordance that
 * calls `wallet.remove`, clears the localStorage flag, and refreshes
 * the App state into the onboarding screen so the user lands back on
 * the Welcome view (next step: G060 animated explainers).
 *
 * @param {object} props
 * @param {string | null | undefined} props.activeWalletId
 * @param {() => void} [props.onExited]                   refresh callback after wipe
 */
export function DemoBanner({ activeWalletId, onExited }) {
    const { messaging } = useMessaging();
    const [isDemo, setIsDemo] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [expiry, setExpiry] = useState(/** @type {{ expiresAt: number } | null} */ (null));
    const [autoWiped, setAutoWiped] = useState(false);

    useEffect(() => {
        setIsDemo(flowsLib.isDemoWallet(activeWalletId));
        setExpiry(flowsLib.getDemoWalletExpiry());
    }, [activeWalletId]);

    async function handleExit() {
        if (busy || !activeWalletId) return;
        setBusy(true);
        setError(null);
        try {
            if (typeof messaging?.removeWallet === 'function') {
                await messaging.removeWallet({ walletId: activeWalletId });
            } else if (typeof messaging?.sendMessage === 'function') {
                await messaging.sendMessage('wallet.remove', { walletId: activeWalletId });
            }
            flowsLib.clearDemoWalletId();
            // Cluster U FOLLOWUP 5 — drop the resume-last-view memory
            // alongside the demo wallet itself.
            clearLastView(activeWalletId);
            if (typeof onExited === 'function') onExited();
        } catch (err) {
            setError(err?.message || 'Could not exit demo mode.');
        } finally {
            setBusy(false);
        }
    }

    // Cluster J FOLLOWUP 6 — auto-expire. When the demo wallet's TTL
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
        // handleExit is stable enough — re-running on busy flips would
        // double-fire the exit. Intentionally omit it from deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDemo, activeWalletId, autoWiped, busy]);

    if (!isDemo) return null;

    const expiryHint = formatExpiryHint(expiry);
    return (
        <div className={styles.banner} role="region" aria-label="Demo wallet">
            <div className={styles.body}>
                <strong className={styles.headline}>Demo wallet</strong>
                <span className={styles.copy}>
                    Throwaway wallet — explore freely, then exit to wipe and start a real one.
                    {expiryHint ? ` ${expiryHint}` : ''}
                </span>
            </div>
            <div className={styles.actions}>
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
