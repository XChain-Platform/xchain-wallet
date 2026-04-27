import { useEffect, useState } from 'react';
import { flows as flowsLib } from '@xchain-wallet/core';
import { Button } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
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

    useEffect(() => {
        setIsDemo(flowsLib.isDemoWallet(activeWalletId));
    }, [activeWalletId]);

    if (!isDemo) return null;

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
            if (typeof onExited === 'function') onExited();
        } catch (err) {
            setError(err?.message || 'Could not exit demo mode.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className={styles.banner} role="region" aria-label="Demo wallet">
            <div className={styles.body}>
                <strong className={styles.headline}>Demo wallet</strong>
                <span className={styles.copy}>
                    Throwaway wallet — explore freely, then exit to wipe and start a real one.
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
