import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import {
    getLockoutState,
    getRemainingMs,
    recordLockoutFailure,
    recordLockoutSuccess,
    isBiometricSupported,
    isBiometricRegistered,
    unlockWithBiometric,
    tripDuressIfMatch,
} from '@xchain-wallet/core/flows';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useHaptic } from '../hooks/useHaptic.js';
import styles from './Locked.module.css';

/**
 * Unlock screen. Reads the shell from context and picks the matching
 * Screen variant (360×600 popup vs flexible full-page). The web shell
 * wraps this route in a card for centering; the popup renders flush
 * inside its fixed-size window.
 *
 * `InvalidPasswordError` surfaces as a field-level error and increments
 * the §26 / G066 lockout counter; any other failure shows the raw
 * message and does NOT count against the user — those are bugs, not
 * bad guesses.
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
    const [lockout, setLockout] = useState(getLockoutState);
    const [remainingMs, setRemainingMs] = useState(() =>
        getRemainingMs(getLockoutState()),
    );
    const [biometricAvailable, setBiometricAvailable] = useState(false);
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const haptic = useHaptic();

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Probe for biometric availability + a registered credential. The
    // button only renders when both are true; otherwise the user sees
    // the password form unchanged.
    useEffect(() => {
        let cancelled = false;
        if (!isBiometricRegistered()) {
            setBiometricAvailable(false);
            return undefined;
        }
        isBiometricSupported().then((ok) => {
            if (!cancelled) setBiometricAvailable(Boolean(ok));
        });
        return () => { cancelled = true; };
    }, []);

    // Countdown ticker — runs only while a lockout is active.
    useEffect(() => {
        if (remainingMs <= 0) return undefined;
        const handle = window.setInterval(() => {
            const ms = getRemainingMs(lockout);
            setRemainingMs(ms);
            if (ms <= 0) window.clearInterval(handle);
        }, 1000);
        return () => window.clearInterval(handle);
    }, [lockout, remainingMs]);

    const isLockedOut = remainingMs > 0;

    async function handleSubmit(event) {
        event.preventDefault();
        if (busy || password.length === 0 || isLockedOut) return;
        setBusy(true);
        setError(null);
        try {
            await messaging.unlockWallet(password);
            recordLockoutSuccess();
            setLockout({ failedAttempts: 0, lockedUntilMs: 0 });
            setRemainingMs(0);
            setPassword('');
            haptic.success();
            onUnlocked?.();
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            if (isBadPassword) {
                // §26.5 / G068 — silently arm panic mode if the entered
                // password is the configured duress passphrase. The user
                // sees the SAME wrong-password UX an actual mistype
                // produces, so an observer can't tell the duress flag
                // fired. Lockout still increments — both branches must
                // look identical from the outside.
                tripDuressIfMatch(password);
                const next = recordLockoutFailure();
                setLockout(next);
                const nextRemaining = getRemainingMs(next);
                setRemainingMs(nextRemaining);
                setError(
                    nextRemaining > 0
                        ? `Incorrect password. Try again in ${formatCountdown(nextRemaining)}.`
                        : 'Incorrect password.',
                );
                haptic.error();
            } else {
                setError(err?.message || 'Unlock failed.');
                haptic.error();
            }
            setBusy(false);
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }

    async function handleBiometric() {
        if (busy || isLockedOut) return;
        setBusy(true);
        setError(null);
        try {
            const unwrapped = await unlockWithBiometric();
            await messaging.unlockWallet(unwrapped);
            recordLockoutSuccess();
            setLockout({ failedAttempts: 0, lockedUntilMs: 0 });
            setRemainingMs(0);
            haptic.success();
            onUnlocked?.();
        } catch (err) {
            // Biometric failures (cancelled prompt, missing credential,
            // PRF failure) are surfaced raw — they are not bad-password
            // guesses and must NOT increment the lockout counter.
            setError(err?.message || 'Biometric unlock failed.');
            haptic.error();
            setBusy(false);
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

    const lockoutBanner = isLockedOut ? (
        <div
            className={styles.lockoutBanner}
            role="status"
            aria-live="polite"
        >
            <span>
                Too many failed attempts. Try again in{' '}
                <span className={styles.lockoutCountdown}>
                    {formatCountdown(remainingMs)}
                </span>
                .
            </span>
        </div>
    ) : null;

    const form = (
        <form onSubmit={handleSubmit} noValidate>
            {lockoutBanner}
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
                disabled={busy || isLockedOut}
                error={error || undefined}
            />
            <Button
                type="submit"
                variant="primary"
                block
                loading={busy}
                disabled={password.length === 0 || isLockedOut}
            >
                {isLockedOut ? `Locked (${formatCountdown(remainingMs)})` : 'Unlock Wallet'}
            </Button>
            {biometricAvailable ? (
                <Button
                    type="button"
                    variant="secondary"
                    block
                    onClick={handleBiometric}
                    disabled={busy || isLockedOut}
                >
                    Use biometrics
                </Button>
            ) : null}
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

/**
 * Format a remaining-ms value as a short, screen-reader-friendly string.
 * Always rounds UP so "1s left" doesn't tick to "0s left" before the
 * lockout actually clears.
 *
 * @param {number} ms
 * @returns {string}
 */
function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    if (totalSec < 60) return `${totalSec}s`;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins < 60) {
        return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins === 0 ? `${hours}h` : `${hours}h ${remMins}m`;
}
