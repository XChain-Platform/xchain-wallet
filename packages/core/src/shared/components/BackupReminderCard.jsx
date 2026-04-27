import { useEffect, useState } from 'react';
import { flows as flowsLib } from '@xchain-wallet/core';
import { Button, Icon } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import styles from './BackupReminderCard.module.css';

/**
 * §19.7 / G034 + G062 — progressive backup reminder card on Home.
 *
 * Loads settings via messaging on mount, then evaluates
 * `flowsLib.computeBackupReminderState({ walletId, walletCreatedAt,
 * settings })`. Renders nothing for the 'hidden' state. 'gentle' renders a
 * quiet card with a Dismiss button; 'firm' renders a more prominent card
 * without a dismiss.
 *
 * The card itself does not navigate — callers wire `onAction` to take the
 * user to a backup ceremony (Settings → Backup, or a verify lane for
 * never-verified wallets).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string | null | undefined} [props.walletCreatedAt]
 * @param {() => void} [props.onAction]      "Back up now" CTA
 */
export function BackupReminderCard({ walletId, walletCreatedAt, onAction }) {
    const { messaging } = useMessaging();
    const [state, setState] = useState({ kind: 'hidden' });

    useEffect(() => {
        let cancelled = false;
        if (!walletId) {
            setState({ kind: 'hidden' });
            return () => { cancelled = true; };
        }
        const settingsPromise = typeof messaging?.getSettings === 'function'
            ? messaging.getSettings().catch(() => null)
            : Promise.resolve(null);
        settingsPromise.then((settings) => {
            if (cancelled) return;
            setState(flowsLib.computeBackupReminderState({
                walletId,
                walletCreatedAt: walletCreatedAt || null,
                settings: settings || null,
            }));
        });
        return () => { cancelled = true; };
    }, [walletId, walletCreatedAt, messaging]);

    if (state.kind === 'hidden') return null;

    const variantClass = state.kind === 'firm' ? styles.firm : styles.gentle;

    return (
        <div className={`${styles.card} ${variantClass}`} role="region" aria-label={state.headline}>
            <div className={styles.body}>
                <h3 className={styles.headline}>{state.headline}</h3>
                <p className={styles.copy}>{state.body}</p>
            </div>
            <div className={styles.actions}>
                <Button
                    size="sm"
                    variant="primary"
                    onClick={onAction}
                    disabled={!onAction}
                    icon={<Icon.CheckIcon />}
                >
                    Back up now
                </Button>
                {state.dismissable ? (
                    <button
                        type="button"
                        className={styles.dismissBtn}
                        onClick={() => {
                            flowsLib.dismissBackupReminder(walletId);
                            setState({ kind: 'hidden' });
                        }}
                    >
                        Not now
                    </button>
                ) : null}
            </div>
        </div>
    );
}
