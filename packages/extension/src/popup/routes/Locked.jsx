import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { unlockWallet } from '../messaging.js';
import styles from './Locked.module.css';

/**
 * Unlock screen — prompts for the vault password, routes it through the
 * `wallet.unlock` pre-host handler, and on success fires `onUnlocked()`
 * so the parent state machine re-queries session status and transitions
 * to `Home`.
 *
 * `InvalidPasswordError` surfaces as a field-level error; any other
 * failure (missing wallet, unexpected crypto error) shows the raw
 * message — those are bugs, not user input errors, and visible text
 * helps us diagnose rather than silently no-op.
 *
 * @param {object} props
 * @param {() => void} [props.onUnlocked]
 */
export function Locked({ onUnlocked }) {
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
            await unlockWallet(password);
            // Clear the password out of component state before we hand
            // back to the parent — no need to keep it around.
            setPassword('');
            onUnlocked?.();
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setError(isBadPassword ? 'Incorrect password.' : err?.message || 'Unlock failed.');
            setBusy(false);
            // Re-focus on failure so the user can retype immediately.
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }

    return (
        <Screen variant="popup">
            <div className={styles.hero}>
                <img
                    src={branding.logoUrl()}
                    alt=""
                    aria-hidden="true"
                    className={styles.logo}
                />
                <h1 className={styles.name}>{branding.PRODUCT_NAME}</h1>
                <p className={styles.hint}>Wallet locked.</p>
            </div>
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
                    Unlock
                </Button>
            </form>
        </Screen>
    );
}
