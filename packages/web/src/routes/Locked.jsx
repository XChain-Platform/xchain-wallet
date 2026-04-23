import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { unlockWallet } from '../messaging.js';
import { ExtensionBanner } from '../components/ExtensionBanner.jsx';
import styles from './Locked.module.css';

/**
 * Web unlock screen — mirrors the extension's Locked.jsx but renders
 * full-screen and routes the unlock call through the in-page host
 * bridge rather than chrome.runtime.
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

    return (
        <>
            <ExtensionBanner />
            <Screen variant="full">
                <div className={styles.card}>
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
                </div>
            </Screen>
        </>
    );
}
