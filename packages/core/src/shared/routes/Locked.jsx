// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useProtectedScreen } from '../utils/screenGuard.js';
import { Button, FormPage, Input, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
// Direct module imports, not the flows barrel: the barrel keeps every flow
// module in the startup bundle, and this screen is part of first paint.
import {
    getLockoutState,
    getRemainingMs,
    LOCKOUT_STORAGE_KEY,
    recordFailure as recordLockoutFailure,
    recordSuccess as recordLockoutSuccess,
} from '../../flows/lockoutTracking.js';
import {
    isBiometricSupported,
    isBiometricRegistered,
    unlockWithBiometric,
} from '../../flows/biometricUnlock.js';
import { tripDuressIfMatch } from '../../flows/duressPassphrase.js';
import {
    getDemoWalletId,
    getDemoWalletPassword,
    isDemoWalletExpired,
    isDemoLockHeld,
    clearDemoWalletId,
} from '../../flows/demoMode.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useHaptic } from '../hooks/useHaptic.js';
import { clearLastView } from '../utils/lastViewMemory.js';
import { sweepMsgMemoryForWallet } from '../utils/msgReadMemory.js';
import { wipeWalletStorage } from '../utils/wipeWalletStorage.js';
import { setForgotPasswordRestoreIntent } from '../utils/forgotPasswordRecovery.js';
import { nextPaint } from '../utils/nextPaint.js';
import {
    readActiveWallet,
    readActiveWalletName,
    subscribeActiveWallet,
    writeActiveWallet,
} from '../utils/activeWalletMemory.js';
// The demo-exit confirm opens only on a tap, so it and its styles load on demand.
import { DemoExitConfirmOnDemand as DemoExitConfirm } from '../components/onDemandOverlays.js';
import { useIdlePreload } from '../utils/onDemandComponent.js';
import { useFocusTrap } from '../utils/focusTrap.js';
import { useBackHandler } from '../../ui/backStack.js';
import { useNativeExitRoot } from '../hooks/useNativeExitRoot.js';
import styles from './Locked.module.css';
import { t } from '../../i18n/index.js';

const BIOMETRIC_PASSWORD_FALLBACK = 'Biometric unlock is unavailable. Use your wallet password.';

/**
 * Unlock screen. Reads the shell from context and picks the matching
 * Screen variant (360×600 popup vs flexible full-page). The web shell
 * wraps this route in a card for centering; the popup renders flush
 * inside its fixed-size window.
 *
 * `InvalidPasswordError` surfaces as a field-level error and increments
 * the §26 / G066 lockout counter; any other failure shows a recovery step
 * and does not count against the user (those are not bad guesses).
 *
 * §15.6 step 2: the unlock reply names the legacy passphrase wallets the
 * password just opened that hold no stored passphrase yet. While that
 * queue is non-empty this screen withholds `onUnlocked` (which unmounts
 * it in every shell) and asks for each wallet's passphrase once, so it
 * can be stored under the wallet's own key and never asked for again.
 *
 * @param {object} props
 * @param {() => void} [props.onUnlocked]
 * @param {'auto-lock-unsaved' | null} [props.lockReason] why the shell locked
 *   the wallet, when the reason is one the user should be told
 */
export function Locked({ onUnlocked, lockReason = null }) {
    // S4: The unlock screen: a recording of it is a recording of the password
    // being typed.
    // No-op on every shell that installs no screen guard (web, extension,
    // desktop): a browser tab cannot stop a screenshot and must not pretend to.
    useProtectedScreen();

    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [password, setPassword] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // §15.6 step 2. The unlock reply, not this screen, decides whether a
    // passphrase is ever asked for: the vault is sealed until the password
    // lands, so only the host can tell which wallets are still awaiting the
    // one-time capture. Non-empty queue means the unmount is withheld and
    // the wallets are worked through one at a time.
    const [captureQueue, setCaptureQueue] = useState(
        /** @type {Array<{ id: string, name: string }>} */ ([]),
    );
    const [captureIndex, setCaptureIndex] = useState(0);
    const [captureValue, setCaptureValue] = useState('');
    const [captureError, setCaptureError] = useState(/** @type {string | null} */ (null));
    // The password that opened the vault, kept for the capture request. On
    // the biometric path this is the unwrapped password, which is why it
    // lives in state rather than in that handler's local scope.
    const [capturePassword, setCapturePassword] = useState('');
    const captureRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const [busy, setBusy] = useState(false);
    const [showUnlockingNote, setShowUnlockingNote] = useState(false);
    const unlockInFlightRef = useRef(false);
    const unlockingNoteTimerRef = useRef(/** @type {number | null} */ (null));
    const restorePasswordFocusRef = useRef(false);
    const [lockout, setLockout] = useState(getLockoutState);
    const [remainingMs, setRemainingMs] = useState(() =>
        getRemainingMs(getLockoutState()),
    );
    const [biometricAvailable, setBiometricAvailable] = useState(false);
    const [demoWipeBusy, setDemoWipeBusy] = useState(false);
    const [demoWipeError, setDemoWipeError] = useState(/** @type {string | null} */ (null));
    const [demoConfirmOpen, setDemoConfirmOpen] = useState(false);
    const [forgotOpen, setForgotOpen] = useState(false);
    const [restoreLane, setRestoreLane] = useState(
        /** @type {'mnemonic' | 'backup' | null} */ (null),
    );
    const [wipeConfirmText, setWipeConfirmText] = useState('');
    const [wipeBusy, setWipeBusy] = useState(false);
    const [wipeError, setWipeError] = useState(/** @type {string | null} */ (null));
    const [activeWalletName, setActiveWalletName] = useState(readActiveWalletName);
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const forgotTriggerRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
    const forgotDialogRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const haptic = useHaptic();

    const clearUnlockingNoteTimer = useCallback(() => {
        if (unlockingNoteTimerRef.current !== null) {
            window.clearTimeout(unlockingNoteTimerRef.current);
            unlockingNoteTimerRef.current = null;
        }
    }, []);

    // Demo wallets use a randomly-generated 64-char hex password held in
    // the session cache. If the cache evaporates (auto-lock, tab close
    // followed by reopen, etc.) the user has no recoverable password.
    // Surface an explicit exit-and-wipe confirmation so they can return
    // to onboarding without being permanently stuck.
    const demoWalletId = getDemoWalletId();

    async function handleExitDemo() {
        if (demoWipeBusy || !demoWalletId) return;
        setDemoWipeBusy(true);
        setDemoWipeError(null);
        try {
            await wipeWalletStorage();
            clearDemoWalletId();
            clearLastView(demoWalletId);
            sweepMsgMemoryForWallet(demoWalletId);
            if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
                window.location.reload();
                return;
            }
            onUnlocked?.();
        } catch {
            setDemoWipeError('Could not exit demo mode. Close and reopen the app, then try again.');
            setDemoWipeBusy(false);
        }
    }

    // §26.4: last-resort escape for a real wallet whose owner has lost
    // the password. The vault blob is encrypted under the master key, so
    // there's no surgical "reset password" path; the only option is to
    // wipe the device-side wallet and re-import from seed or encrypted
    // backup elsewhere. Gated behind a type-WIPE confirmation so a
    // misclick can't destroy a real wallet.
    async function handleForgotPasswordWipe() {
        if (wipeBusy) return;
        if (!restoreLane) return;
        if (wipeConfirmText.trim().toUpperCase() !== 'WIPE') return;
        setWipeBusy(true);
        setWipeError(null);
        try {
            await wipeWalletStorage();
            setForgotPasswordRestoreIntent(restoreLane);
            if (typeof window !== 'undefined') window.location.reload();
        } catch {
            setWipeError('Could not erase wallet data. Close and reopen the app, then try again.');
            setWipeBusy(false);
        }
    }

    function handleForgotPasswordCancel() {
        if (wipeBusy) return;
        setForgotOpen(false);
        setRestoreLane(null);
        setWipeConfirmText('');
        setWipeError(null);
    }

    useFocusTrap(forgotDialogRef, {
        active: forgotOpen,
        restoreFocusRef: forgotTriggerRef,
    });
    useBackHandler(forgotOpen ? handleForgotPasswordCancel : undefined, wipeBusy, 'screen');
    // The unlock screen is the bottom of the app, so Android Back leaves it
    // the way Home does.
    useNativeExitRoot(true, true);
    useIdlePreload(DemoExitConfirm);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // A native shell dispatches `pause` on the document when the app goes to
    // the background. Without this, typed text waits in the field until the
    // app comes back, so whoever picks the device up next finds the password
    // ready to submit. The web, extension and desktop shells never fire it.
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const onPause = () => {
            setPassword('');
            setCaptureValue('');
        };
        document.addEventListener('pause', onPause);
        return () => document.removeEventListener('pause', onPause);
    }, []);

    // The wallet list is safe metadata, so it can restore the heading before
    // unlock when an older active-wallet entry contains only the wallet id.
    useEffect(() => {
        const activeWalletId = readActiveWallet();
        if (!activeWalletId || typeof messaging?.listWallets !== 'function') return undefined;
        let cancelled = false;
        Promise.resolve()
            .then(() => messaging.listWallets())
            .then((value) => {
                if (cancelled) return;
                const wallets = Array.isArray(value) ? value : value?.wallets;
                const activeWallet = Array.isArray(wallets)
                    ? wallets.find((wallet) => wallet?.id === activeWalletId)
                    : null;
                const name = typeof activeWallet?.name === 'string'
                    ? activeWallet.name.trim()
                    : '';
                setActiveWalletName(name || null);
                if (name) writeActiveWallet(activeWalletId, name);
            })
            .catch(() => { /* Keep the last known name when metadata is unavailable. */ });
        return () => { cancelled = true; };
    }, [messaging]);

    useEffect(() => subscribeActiveWallet(({ name }) => {
        setActiveWalletName(name);
    }), []);

    // Probe for biometric availability plus a registered credential. A
    // previously enrolled but unavailable device returns to the password
    // field instead of leaving a biometric action that cannot succeed.
    useEffect(() => {
        let cancelled = false;
        if (!isBiometricRegistered()) {
            setBiometricAvailable(false);
            return undefined;
        }
        isBiometricSupported().then((ok) => {
            // The native support probe also refreshes its enrollment cache.
            // Re-read it after the asynchronous boundary so an out-of-band
            // fingerprint change cannot leave a stale unlock button visible.
            if (!cancelled) {
                const available = Boolean(ok) && isBiometricRegistered();
                setBiometricAvailable(available);
                if (!available) {
                    setError(BIOMETRIC_PASSWORD_FALLBACK);
                    inputRef.current?.focus();
                }
            }
        });
        return () => { cancelled = true; };
    }, []);

    // Countdown ticker: runs only while a lockout is active.
    useEffect(() => {
        if (remainingMs <= 0) return undefined;
        const handle = window.setInterval(() => {
            const ms = getRemainingMs(lockout);
            setRemainingMs(ms);
            if (ms <= 0) window.clearInterval(handle);
        }, 1000);
        return () => window.clearInterval(handle);
    }, [lockout, remainingMs]);

    // Demo wallets persist their auto-generated password (a throwaway
    // wallet holding only synthetic data), so a reload can silently
    // re-unlock instead of stranding the user on a password screen for a
    // key they never typed. Try it once on mount, unless the user locked it; on any failure fall
    // through to the normal unlock UI.
    const demoAutoUnlockTriedRef = useRef(false);
    useEffect(() => {
        if (demoAutoUnlockTriedRef.current) return undefined;
        if (!demoWalletId || isDemoWalletExpired()) return undefined;
        // The user pressed Lock: stay on this screen instead of undoing it.
        if (isDemoLockHeld()) return undefined;
        if (typeof messaging?.unlockWallet !== 'function') return undefined;
        const pw = getDemoWalletPassword();
        if (!pw) return undefined;
        demoAutoUnlockTriedRef.current = true;
        let cancelled = false;
        setBusy(true);
        (async () => {
            try {
                await messaging.unlockWallet(pw);
                if (cancelled) return;
                recordLockoutSuccess();
                setLockout({ failedAttempts: 0, lockedUntilMs: 0 });
                setRemainingMs(0);
                clearUnlockingNoteTimer();
                setShowUnlockingNote(false);
                setBusy(false);
                setError(null);
                onUnlocked?.();
            } catch {
                if (!cancelled) setBusy(false);
            }
        })();
        return () => { cancelled = true; };
    }, [clearUnlockingNoteTimer, demoWalletId, messaging, onUnlocked]);

    const isLockedOut = remainingMs > 0;

    // The counter lives in storage the whole origin shares, so another tab can
    // start a wait this screen never saw. Every attempt re-reads it first, and
    // a storage event brings the banner in without a failed guess of its own.
    const refreshLockout = useCallback(() => {
        const state = getLockoutState();
        const ms = getRemainingMs(state);
        setLockout(state);
        setRemainingMs(ms);
        return ms;
    }, []);

    useEffect(() => {
        const onStorage = (event) => {
            if (event.key !== null && event.key !== LOCKOUT_STORAGE_KEY) return;
            refreshLockout();
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [refreshLockout]);

    const captureWallet = captureQueue[captureIndex] || null;
    const inCaptureStep = captureWallet !== null;

    useEffect(() => {
        if (!busy || inCaptureStep) {
            clearUnlockingNoteTimer();
            setShowUnlockingNote(false);
            return undefined;
        }
        unlockingNoteTimerRef.current = window.setTimeout(() => {
            unlockingNoteTimerRef.current = null;
            setShowUnlockingNote(true);
        }, 2000);
        return clearUnlockingNoteTimer;
    }, [busy, clearUnlockingNoteTimer, inCaptureStep]);

    useEffect(() => {
        if (busy || isLockedOut || !restorePasswordFocusRef.current) return;
        restorePasswordFocusRef.current = false;
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [busy, isLockedOut]);

    function finishFailedUnlock({ clearPassword = false } = {}) {
        if (clearPassword) setPassword('');
        restorePasswordFocusRef.current = true;
        setBusy(false);
    }

    // The one place `onUnlocked` is called from the password paths. It
    // unmounts this screen in every shell, so the password is dropped here
    // and nowhere earlier: step 2 needs it to encrypt the passphrase.
    function finishUnlock() {
        clearUnlockingNoteTimer();
        setShowUnlockingNote(false);
        setBusy(false);
        setError(null);
        setPassword('');
        setCapturePassword('');
        setCaptureQueue([]);
        setCaptureIndex(0);
        setCaptureValue('');
        setCaptureError(null);
        onUnlocked?.();
    }

    /**
     * Shared tail of both password paths. A capture queue holds the screen
     * open on step 2; an empty one finishes the unlock as before.
     *
     * @param {any} reply       the host's unlock reply
     * @param {string} opened   the password that opened the vault
     */
    function afterUnlock(reply, opened) {
        clearUnlockingNoteTimer();
        setShowUnlockingNote(false);
        setError(null);
        recordLockoutSuccess();
        setLockout({ failedAttempts: 0, lockedUntilMs: 0 });
        setRemainingMs(0);
        haptic.success();
        const queue = Array.isArray(reply?.passphraseCaptureNeeded)
            ? reply.passphraseCaptureNeeded.filter((w) => w && typeof w.id === 'string')
            : [];
        // A shell whose messaging module predates the capture message has
        // no way to answer step 2, so it proceeds as if the user had
        // pressed "Not now" rather than showing a button that cannot work.
        if (queue.length > 0 && typeof messaging?.capturePassphrase === 'function') {
            setCapturePassword(opened);
            setCaptureQueue(queue);
            setCaptureIndex(0);
            setCaptureValue('');
            setCaptureError(null);
            setBusy(false);
            return;
        }
        finishUnlock();
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (unlockInFlightRef.current || busy || password.length === 0 || isLockedOut) return;
        if (refreshLockout() > 0) return;
        unlockInFlightRef.current = true;
        setBusy(true);
        setError(null);
        try {
            await nextPaint();
            const reply = await messaging.unlockWallet(password);
            afterUnlock(reply, password);
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            if (isBadPassword) {
                // §26.5 / G068: silently arm panic mode if the entered
                // password is the configured duress passphrase. The user
                // sees the SAME wrong-password UX an actual mistype
                // produces, so an observer can't tell the duress flag
                // fired. Lockout still increments; both branches must
                // look identical from the outside.
                tripDuressIfMatch(password);
                const next = recordLockoutFailure();
                setLockout(next);
                const nextRemaining = getRemainingMs(next);
                setRemainingMs(nextRemaining);
                setError(
                    nextRemaining > 0
                        ? null
                        : 'Incorrect password.',
                );
                haptic.error();
            } else {
                // Refused before any password check (another tab holds the
                // vault, a worker throttle): the duress passphrase still arms
                // the freeze, which every open context's signer reads, and the
                // message below is the one any password gets here.
                tripDuressIfMatch(password);
                // Two failures carry a sentence that says what to do: another
                // tab holding the vault, and a browser that cannot coordinate
                // tabs. "Close and reopen the app" would send the user the wrong way.
                setError(err?.message === 'Could not prepare unlock'
                    || err?.name === 'VaultInUseError'
                    || err?.name === 'VaultCoordinationUnavailableError'
                    ? err.message
                    : 'Could not unlock the wallet. Close and reopen the app, then try again.');
                haptic.error();
            }
            finishFailedUnlock({ clearPassword: true });
        } finally {
            unlockInFlightRef.current = false;
        }
    }

    async function handleBiometric() {
        if (unlockInFlightRef.current || busy || isLockedOut) return;
        if (refreshLockout() > 0) return;
        unlockInFlightRef.current = true;
        setBusy(true);
        setError(null);
        try {
            const unwrapped = await unlockWithBiometric();
            await nextPaint();
            // Biometrics unwrap the password, never the passphrase, so this
            // path reaches step 2 exactly like a typed unlock does.
            const reply = await messaging.unlockWallet(unwrapped);
            afterUnlock(reply, unwrapped);
        } catch (err) {
            // End the biometric path after any refusal so cancellations,
            // lockouts, and changed enrollment cannot reopen prompt loops.
            setBiometricAvailable(false);
            setError(BIOMETRIC_PASSWORD_FALLBACK);
            if (err?.name !== 'BiometricCancelledError') haptic.error();
            finishFailedUnlock();
        } finally {
            unlockInFlightRef.current = false;
        }
    }

    /**
     * Step 2's `Continue`. Stores this wallet's passphrase, then either
     * moves the queue on or, on the last wallet, releases the unmount.
     */
    async function handleCapture(event) {
        event.preventDefault();
        if (busy || captureValue.length === 0 || !captureWallet) return;
        setBusy(true);
        setCaptureError(null);
        try {
            await messaging.capturePassphrase({
                walletId: captureWallet.id,
                password: capturePassword,
                bip39Passphrase: captureValue,
            });
            const next = captureIndex + 1;
            if (next < captureQueue.length) {
                setCaptureIndex(next);
                setCaptureValue('');
                setBusy(false);
                return;
            }
            haptic.success();
            finishUnlock();
        } catch (err) {
            // The password was right: the vault opened at step 1. Only the
            // passphrase missed, so this marks the field and touches
            // nothing on the lockout counter.
            setCaptureError(
                err?.name === 'PassphraseMismatchError'
                    ? 'That passphrase does not match this wallet. Check it and try again.'
                    : 'Could not save the wallet passphrase. Check it and try again.',
            );
            haptic.error();
            setBusy(false);
            captureRef.current?.focus();
            captureRef.current?.select();
        }
    }

    // Step 2's `Not now`, and the same state a closed popup or a reload
    // lands in: nothing is persisted, so the remaining wallets are offered
    // again at the next unlock.
    function handleCaptureSkip() {
        if (busy) return;
        finishUnlock();
    }

    // Put the cursor in the passphrase field as each queued wallet comes up.
    useEffect(() => {
        if (inCaptureStep) captureRef.current?.focus();
    }, [inCaptureStep, captureIndex]);

    const hero = (
        <div className={styles.hero}>
            <img
                src={branding.logoUrl()}
                alt=""
                className={styles.logo}
            />
            <h1
                title={!inCaptureStep && activeWalletName ? activeWalletName : undefined}
                style={{
                    maxWidth: '100%',
                    margin: 0,
                    color: 'var(--xc-text)',
                    fontSize: 'var(--xc-text-xl)',
                    fontWeight: 700,
                    overflowWrap: 'anywhere',
                }}
            >
                {inCaptureStep ? t('locked.saveWalletPassphrase') : (activeWalletName || t('locked.unlockWallet'))}
            </h1>
        </div>
    );

    // The shared warning notice, not a box of its own inside the form card.
    // The notice reads whole when it appears; the countdown ticks silently
    // inside it so a screen reader does not repeat the sentence every second.
    const lockoutBanner = isLockedOut ? (
        <StatusMessage variant="warning" className={styles.lockoutBanner}>
            {/* "On this device" marks the counter as local. The lock screen
                has no network control, so the banner names none. */}
            {t('locked.tooManyIncorrectPasswordsOn')}{' '}
            <span className={styles.lockoutCountdown} aria-live="off">
                {formatCountdown(remainingMs)}
            </span>
            {' '}{t('locked.beforeTryingAgain')}
        </StatusMessage>
    ) : null;

    const lockReasonNotice = lockReason === 'auto-lock-unsaved' ? (
        <StatusMessage key="lock-reason" variant="warning" className={styles.lockoutBanner}>
            {t('locked.autoLockUnsaved')}
        </StatusMessage>
    ) : null;

    const form = (
        <FormPage
            label={t('locked.unlockWallet')}
            className={styles.unlockForm}
            onSubmit={handleSubmit}
            status={[
                lockReasonNotice,
                busy && !inCaptureStep && showUnlockingNote ? (
                    <p key="unlocking" className={styles.unlockingNote} aria-live="polite">
                        {t('locked.unlockingYourWalletSecurelyThis')}
                    </p>
                ) : null,
                lockoutBanner,
            ]}
            actions={(
                <div className={styles.unlockActions}>
                    {/* During a lockout the banner says how long to wait and the
                        button only goes disabled, so the countdown is said once. */}
                    <Button
                        type="submit"
                        variant="primary"
                        block
                        loading={busy}
                        disabled={password.length === 0 || isLockedOut}
                    >
                        {t('locked.unlockWallet2')}
                    </Button>
                    {biometricAvailable ? (
                        <Button
                            type="button"
                            variant="secondary"
                            block
                            onClick={handleBiometric}
                            disabled={busy || isLockedOut}
                        >
                            {t('locked.useBiometrics')}
                        </Button>
                    ) : null}
                    {demoWalletId ? (
                        <div className={styles.demoExitBlock}>
                            <p className={styles.demoExitNote}>
                                {t('locked.thisIsADemoWallet')}
                            </p>
                            <Button
                                type="button"
                                variant="danger"
                                onClick={() => { setDemoWipeError(null); setDemoConfirmOpen(true); }}
                            >
                                {t('walletDetails.exitDemo')}
                            </Button>
                            {demoWipeError && !demoConfirmOpen ? (
                                <StatusMessage variant="error" className={styles.demoExitError}>{demoWipeError}</StatusMessage>
                            ) : null}
                            {demoConfirmOpen ? (
                                <DemoExitConfirm
                                    busy={demoWipeBusy}
                                    error={demoWipeError}
                                    message={t('locked.thisPermanentlyDeletesEveryWallet2')}
                                    onConfirm={handleExitDemo}
                                    onCancel={() => { setDemoConfirmOpen(false); setDemoWipeError(null); }}
                                />
                            ) : null}
                        </div>
                    ) : (
                        <div className={styles.forgotBlock}>
                            <Button
                                ref={forgotTriggerRef}
                                type="button"
                                variant="link"
                                size="sm"
                                icon={null}
                                onClick={() => setForgotOpen(true)}
                                aria-expanded={forgotOpen}
                                aria-controls="locked-forgot-password-panel"
                                hidden={forgotOpen}
                                style={{ alignSelf: 'center' }}
                            >
                                {t('locked.forgotPassword')}
                            </Button>
                            {forgotOpen ? (
                                <div
                                    ref={forgotDialogRef}
                                    id="locked-forgot-password-panel"
                                    className={styles.wipeConfirm}
                                    role="alertdialog"
                                    aria-modal="false"
                                    aria-label={t('locked.restoreWalletAccess')}
                                >
                                    {!restoreLane ? (
                                        <>
                                            <p className={styles.wipeNote}>
                                                <strong>{t('locked.yourPasswordCannotBeRecovered')}</strong>{' '}
                                                {t('locked.youCanRestoreTheWallet')}
                                            </p>
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                onClick={() => setRestoreLane('mnemonic')}
                                            >
                                                {t('locked.useRecoveryPhrase')}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                onClick={() => setRestoreLane('backup')}
                                            >
                                                {t('locked.useBackupFile')}
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <StatusMessage variant="warning" role={null} className={styles.wipeWarning}>
                                                <strong>{t('locked.thisPermanentlyDeletesEveryWallet')}</strong>
                                            </StatusMessage>
                                            <p className={styles.wipeNote}>
                                                {t('locked.fundsOnTheBlockchainAre')} {restoreLane === 'backup' ? t('locked.encryptedBackupFile') : t('locked.recoveryPhrase')} {t('locked.forEveryWalletYouNeed')} {restoreLane === 'backup' ? t('locked.backupFileRestore') : t('locked.recoveryPhraseRestore')} {t('locked.form')}
                                            </p>
                                            <Input
                                                type="text"
                                                label={t('vaultUnavailable.wipeConfirm')}
                                                value={wipeConfirmText}
                                                onChange={(e) => setWipeConfirmText(e.target.value)}
                                                autoComplete="off"
                                                autoCapitalize="characters"
                                                disabled={wipeBusy}
                                            />
                                            <Button
                                                type="button"
                                                variant="danger"
                                                onClick={handleForgotPasswordWipe}
                                                loading={wipeBusy}
                                                disabled={wipeBusy || wipeConfirmText.trim().toUpperCase() !== 'WIPE'}
                                            >
                                                {t('locked.eraseVaultAndRestore')}
                                            </Button>
                                        </>
                                    )}
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={handleForgotPasswordCancel}
                                        disabled={wipeBusy}
                                        autoFocus
                                    >
                                        {t('common.cancel')}
                                    </Button>
                                    {wipeError ? (
                                        <StatusMessage variant="error" className={styles.wipeError}>{wipeError}</StatusMessage>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            )}
        >
            {hero}
            <input
                type="text"
                name="username"
                value="xchain-wallet"
                autoComplete="username"
                readOnly
                aria-label={t('locked.walletUsername')}
                hidden
            />
            {/* The wrong-password message appears under the field in a space kept free
                while it is hidden, so the centred form does not jump when it shows. */}
            <div className={error ? styles.passwordField : `${styles.passwordField} ${styles.passwordFieldIdle}`}>
                <Input
                    ref={inputRef}
                    type="password"
                    revealable
                    name="password"
                    label={t('common.password')}
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                    }}
                    autoComplete="current-password"
                    disabled={busy || isLockedOut}
                    error={error || undefined}
                />
            </div>
        </FormPage>
    );

    // §15.6 step 2, one wallet at a time. `Not now` on any of them
    // abandons the rest of the queue: the next unlock offers them again.
    const captureForm = captureWallet ? (
        <FormPage
            label={t('locked.saveWalletPassphrase')}
            onSubmit={handleCapture}
            actions={(
                <>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={handleCaptureSkip}
                        disabled={busy}
                    >
                        {t('extensionBanner.notNow')}
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={busy}
                        disabled={captureValue.length === 0}
                    >
                        {t('adsNotice.continue')}
                    </Button>
                </>
            )}
        >
            {hero}
            <p className={styles.captureCopy}>
                <strong>{captureWallet.name} {t('locked.usesAPassphrase')}</strong>{' '}
                {t('locked.enterItOnceToFinish')}
            </p>
            <Input
                id="locked-capture-passphrase"
                ref={captureRef}
                type="password"
                revealable
                label={t('locked.passphrase')}
                value={captureValue}
                onChange={(e) => {
                    setCaptureValue(e.target.value);
                    if (captureError) setCaptureError(null);
                }}
                autoComplete="off"
                disabled={busy}
                error={captureError || undefined}
            />
        </FormPage>
    ) : null;

    const body = captureForm || form;

    return (
        <Screen variant={variant}>
            <div className={styles.centre}>{body}</div>
        </Screen>
    );
}


/**
 * Format a remaining-ms value with screen-reader-friendly time units.
 * Always rounds UP so "1s left" doesn't tick to "0s left" before the
 * lockout actually clears.
 *
 * @param {number} ms
 * @returns {string}
 */
function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    if (totalSec < 60) return t('locked.countdown.seconds', { count: totalSec });
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins < 60) {
        const minuteText = t('locked.countdown.minutes', { count: mins });
        if (secs === 0) return minuteText;
        return t('locked.countdown.pair', { first: minuteText, second: t('locked.countdown.seconds', { count: secs }) });
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    const hourText = t('locked.countdown.hours', { count: hours });
    if (remMins === 0) return hourText;
    return t('locked.countdown.pair', { first: hourText, second: t('locked.countdown.minutes', { count: remMins }) });
}
