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
    getDemoWalletId,
    clearDemoWalletId,
} from '@xchain-wallet/core/flows';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useHaptic } from '../hooks/useHaptic.js';
import { clearLastView } from '../utils/lastViewMemory.js';
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
    const [demoWipeBusy, setDemoWipeBusy] = useState(false);
    const [demoWipeError, setDemoWipeError] = useState(/** @type {string | null} */ (null));
    const [forgotOpen, setForgotOpen] = useState(false);
    const [wipeConfirmText, setWipeConfirmText] = useState('');
    const [wipeBusy, setWipeBusy] = useState(false);
    const [wipeError, setWipeError] = useState(/** @type {string | null} */ (null));
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const haptic = useHaptic();

    // Demo wallets use a randomly-generated 64-char hex password held in
    // the session cache. If the cache evaporates (auto-lock, tab close
    // followed by reopen, etc.) the user has no recoverable password.
    // Surface a one-tap "Exit demo & start over" affordance so they can
    // bail back to onboarding without being permanently stuck.
    const demoWalletId = getDemoWalletId();

    async function handleExitDemo() {
        if (demoWipeBusy || !demoWalletId) return;
        setDemoWipeBusy(true);
        setDemoWipeError(null);
        try {
            // Try the surgical messaging path first — works when the
            // wallet happens to still be unlocked, or on shells whose
            // host accepts wallet.remove without an unlocked vault.
            try {
                if (typeof messaging?.removeWallet === 'function') {
                    await messaging.removeWallet({ walletId: demoWalletId });
                } else if (typeof messaging?.sendMessage === 'function') {
                    await messaging.sendMessage('wallet.remove', { walletId: demoWalletId });
                } else {
                    throw new Error('messaging.removeWallet unavailable');
                }
                clearDemoWalletId();
                clearLastView(demoWalletId);
                onUnlocked?.();
                return;
            } catch (innerErr) {
                // Demo wallets are unrecoverable once the session
                // password cache is gone, and the vault blob is one
                // encrypted unit — there's no way to surgically remove
                // a single wallet record without the master key. Fall
                // back to deleting the whole IndexedDB database so the
                // App reboots into clean onboarding. The demo-exit
                // affordance only renders when a demo wallet exists,
                // so the destructive scope is acknowledged by the
                // user clicking through it.
                clearDemoWalletId();
                clearLastView(demoWalletId);
                await deleteWalletDatabase();
                if (typeof window !== 'undefined') window.location.reload();
            }
        } catch (err) {
            setDemoWipeError(err?.message || 'Could not exit demo mode.');
            setDemoWipeBusy(false);
        }
    }

    // §26.4 — last-resort escape for a real wallet whose owner has lost
    // the password. The vault blob is encrypted under the master key, so
    // there's no surgical "reset password" path; the only option is to
    // wipe the device-side wallet and re-import from seed or encrypted
    // backup elsewhere. Gated behind a type-WIPE confirmation so a
    // misclick can't destroy a real wallet.
    async function handleForgotPasswordWipe() {
        if (wipeBusy) return;
        if (wipeConfirmText.trim().toUpperCase() !== 'WIPE') return;
        setWipeBusy(true);
        setWipeError(null);
        try {
            await deleteWalletDatabase();
            if (typeof window !== 'undefined') window.location.reload();
        } catch (err) {
            setWipeError(err?.message || 'Could not wipe wallet data.');
            setWipeBusy(false);
        }
    }

    function handleForgotPasswordCancel() {
        if (wipeBusy) return;
        setForgotOpen(false);
        setWipeConfirmText('');
        setWipeError(null);
    }

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
            {demoWalletId ? (
                <div className={styles.demoExitBlock}>
                    <p className={styles.demoExitNote}>
                        This is a demo wallet — its password is randomly generated and not recoverable. Exiting will wipe all wallet data on this device and return you to onboarding.
                    </p>
                    <Button
                        type="button"
                        variant="danger"
                        block
                        onClick={handleExitDemo}
                        loading={demoWipeBusy}
                        disabled={demoWipeBusy}
                    >
                        Wipe wallet data &amp; start over
                    </Button>
                    {demoWipeError ? (
                        <p role="alert" className={styles.demoExitError}>{demoWipeError}</p>
                    ) : null}
                </div>
            ) : (
                <div className={styles.forgotBlock}>
                    {!forgotOpen ? (
                        <button
                            type="button"
                            className={styles.forgotLink}
                            onClick={() => setForgotOpen(true)}
                            aria-expanded="false"
                            aria-controls="locked-forgot-password-panel"
                        >
                            Forgot password?
                        </button>
                    ) : (
                        <div
                            id="locked-forgot-password-panel"
                            className={styles.wipeConfirm}
                            role="region"
                            aria-label="Wipe wallet data"
                        >
                            <p className={styles.wipeWarning}>
                                <strong>Without your recovery phrase or encrypted backup file, wiping this wallet will permanently lose access to any funds it holds.</strong>
                            </p>
                            <p className={styles.wipeNote}>
                                Wiping only removes the wallet from this device — the wallet on the blockchain itself is unaffected. Use this only if you have a backup, or if this wallet is empty.
                            </p>
                            <Input
                                type="text"
                                label="Type WIPE to confirm"
                                value={wipeConfirmText}
                                onChange={(e) => setWipeConfirmText(e.target.value)}
                                autoComplete="off"
                                autoCapitalize="characters"
                                disabled={wipeBusy}
                            />
                            <Button
                                type="button"
                                variant="danger"
                                block
                                onClick={handleForgotPasswordWipe}
                                loading={wipeBusy}
                                disabled={wipeBusy || wipeConfirmText.trim().toUpperCase() !== 'WIPE'}
                            >
                                Wipe wallet data
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                block
                                onClick={handleForgotPasswordCancel}
                                disabled={wipeBusy}
                            >
                                Cancel
                            </Button>
                            {wipeError ? (
                                <p role="alert" className={styles.wipeError}>{wipeError}</p>
                            ) : null}
                        </div>
                    )}
                </div>
            )}
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
 * Nuke the wallet's IndexedDB database AND localStorage meta entry.
 * Used as the last-resort escape from a locked demo wallet — the demo
 * password is unrecoverable, so surgical deletion of just the demo
 * record is impossible (the vault blob is one encrypted unit).
 *
 * Two stores to clear:
 *   - IndexedDB `xchain-wallet` (matches DEFAULT_DB_NAME in
 *     IndexedDBStorageBackend.js) — holds the encrypted vault blob.
 *   - localStorage `xchain-wallet:vault-meta` (matches DEFAULT_META_KEY
 *     in WebMetaBackend.js) — holds the kdfParams metadata that the
 *     bridge's "a wallet already exists" check reads. Without this
 *     clear, a fresh `wallet.import` call after the IDB wipe still
 *     trips the existence check and the demo flow can't restart.
 *
 * Best-effort: we resolve as soon as the delete completes (or errors)
 * because the caller is going to reload the page either way.
 *
 * @returns {Promise<void>}
 */
function deleteWalletDatabase() {
    // Clear the localStorage meta entry first — synchronous, can't fail.
    try {
        globalThis.localStorage?.removeItem('xchain-wallet:vault-meta');
    } catch { /* ignore */ }
    return new Promise((resolve) => {
        try {
            const idb = typeof globalThis !== 'undefined' ? globalThis.indexedDB : null;
            if (!idb || typeof idb.deleteDatabase !== 'function') {
                resolve();
                return;
            }
            const req = idb.deleteDatabase('xchain-wallet');
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
        } catch {
            resolve();
        }
    });
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
