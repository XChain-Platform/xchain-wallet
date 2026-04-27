import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './Locked.module.css';

/**
 * Unlock screen. Reads the shell from context and picks the matching
 * Screen variant (360×600 popup vs flexible full-page). The web shell
 * wraps this route in a card for centering; the popup renders flush
 * inside its fixed-size window.
 *
 * `InvalidPasswordError` surfaces as a field-level error; any other
 * failure shows the raw message — those are bugs, not user-input
 * errors, and visible text helps diagnosis.
 *
 * @param {object} props
 * @param {() => void} [props.onUnlocked]
 */
export function Locked({ onUnlocked }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [password, setPassword] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    async function handleSubmit(event) {
        event.preventDefault();
        if (busy || password.length === 0) return;
        setBusy(true);
        setError(null);
        try {
            await messaging.unlockWallet(password);
            setPassword('');
            onUnlocked?.();
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setError(isBadPassword ? 'Incorrect password.' : err?.message || 'Unlock failed.');
            setBusy(false);
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }

    const hero = (
        <div className={isFull ? styles.heroFull : styles.heroPopup}>
            <img
                src={branding.logoUrl()}
                alt={branding.PRODUCT_NAME}
                className={isFull ? styles.logoFull : styles.logoPopup}
            />
        </div>
    );

    const form = (
        <form onSubmit={handleSubmit} noValidate>
            <Input
                ref={inputRef}
                type="password"
                label="Password"
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                }}
                autoComplete="current-password"
                disabled={busy}
                error={error || undefined}
            />
            <Button
                type="submit"
                variant="primary"
                block
                loading={busy}
                disabled={password.length === 0}
            >
                Unlock Wallet
            </Button>
        </form>
    );

    return (
        <Screen variant={variant}>
            {isFull ? (
                <div className={styles.card}>
                    {hero}
                    {form}
                </div>
            ) : (
                <>
                    {hero}
                    {form}
                </>
            )}
        </Screen>
    );
}
