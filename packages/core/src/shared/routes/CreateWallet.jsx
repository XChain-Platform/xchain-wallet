// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import { useProtectedScreen } from '../utils/screenGuard.js';
import { Button, FormErrorSummary, FormPage, Icon, InfoTip, Input, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { crypto as cryptoLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { MnemonicGrid } from '../components/MnemonicGrid.jsx';
import { AdsNotice } from '../components/AdsNotice.jsx';
import { pickQuizPositions } from '../utils/pickQuizPositions.js';
import { nextPaint } from '../utils/nextPaint.js';
import { RECOVERY_PHRASE_WARNING } from '../utils/securityMomentCopy.js';
import styles from './CreateWallet.module.css';
import pickerStyles from './WalletPicker.module.css';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Multi-stage create-wallet flow (§15.3 + §19.2).
 *
 *   stage = 'password'  - name + password + confirm
 *           ↓ (generate mnemonic in-memory)
 *   stage = 'mnemonic'  - display + "I've saved it" checkbox
 *           ↓ (persist via importMnemonic, same code path as real import)
 *   stage = 'persisting'- show a spinner while Argon2id KDF runs
 *           ↓ (onCreated refreshes App -> state becomes unlocked -> Home)
 *
 * Routing the persist through `importMnemonic` (rather than a separate
 * `createWallet` flow) means the generated mnemonic is only committed
 * AFTER the user confirms they've saved it. A user who closes the tab
 * / popup during the display stage leaves no vault behind.
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {() => void} props.onCreated
 * @param {'fresh' | 'add'} [props.mode]   'fresh' = first wallet (pre-host `wallet.import`); 'add' = adds to an open vault (`wallet.add.import`). Defaults to 'fresh'.
 */
export function CreateWallet({ onBack, onCreated, mode = 'fresh' }) {
    // S4: The recovery phrase is displayed here. A screenshot of it, or the
    // recents snapshot Android persists, is a copy of the wallet.
    // No-op on every shell that installs no screen guard (web, extension,
    // desktop): a browser tab cannot stop a screenshot and must not pretend to.
    useProtectedScreen();

    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [stage, setStage] = useState(
        /** @type {'password'|'mnemonic'|'verify'|'persisting'|'ads-notice'} */ ('password'),
    );
    // §19.2 / G033: verification quiz state. `quizPositions` is a sorted
    // list of 1-based word indices the user must type back; `quizAnswers`
    // is keyed by that index. Computed once when the user clicks
    // "Verify" so re-renders don't reshuffle.
    const [quizPositions, setQuizPositions] = useState(/** @type {number[]} */ ([]));
    const [quizAnswers, setQuizAnswers] = useState(/** @type {Record<number, string>} */ ({}));
    const [quizError, setQuizError] = useState(/** @type {string | null} */ (null));
    const [quizErrorPosition, setQuizErrorPosition] = useState(/** @type {number | null} */ (null));
    const [validationAttempt, setValidationAttempt] = useState(0);
    const [name, setName] = useState('Main Wallet');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    // §15.1: 12-word default, 24-word opt-in. 12 words = 128-bit entropy, 24 = 256-bit.
    const [wordCount, setWordCount] = useState(/** @type {12 | 24} */ (12));
    // §15.6: optional 25th-word BIP39 passphrase. Empty string means "not used".
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [bip39Passphrase, setBip39Passphrase] = useState('');
    const [bip39PassphraseConfirm, setBip39PassphraseConfirm] = useState('');
    const [passwordError, setPasswordError] = useState(
        /** @type {string | null} */ (null),
    );
    const [mnemonic, setMnemonic] = useState(/** @type {string | null} */ (null));
    const [saved, setSaved] = useState(false);
    const [persistError, setPersistError] = useState(
        /** @type {string | null} */ (null),
    );
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const firstQuizInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const stageFormRef = useRef(/** @type {HTMLFormElement | null} */ (null));

    // The clipboard auto-clear that used to live here is gone with the copy
    // button it existed for (, decided 2026-08-01): the phrase cannot
    // be copied, so there is nothing to clear.

    useEffect(() => {
        const id = setTimeout(() => {
            if (stage === 'password') passwordRef.current?.focus();
            else if (stage === 'verify') firstQuizInputRef.current?.focus();
            else {
                const heading = stageFormRef.current?.querySelector('h1');
                if (heading instanceof HTMLElement) {
                    heading.tabIndex = -1;
                    heading.focus();
                }
            }
        }, 0);
        return () => clearTimeout(id);
    }, [stage]);

    function handlePasswordSubmit(event) {
        event.preventDefault();
        setValidationAttempt((attempt) => attempt + 1);
        if (password.length < MIN_PASSWORD_LENGTH) {
            setPasswordError(
                `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
            );
            return;
        }
        if (password !== confirm) {
            setPasswordError('Passwords do not match.');
            return;
        }
        // Same rule as the import screen: a checked box with nothing typed
        // is a contradiction, not a wallet without a passphrase.
        if (showPassphrase && bip39Passphrase.length === 0) {
            setPasswordError('Enter the BIP39 passphrase, or uncheck the box to create a wallet without one.');
            return;
        }
        if (showPassphrase && bip39Passphrase !== bip39PassphraseConfirm) {
            setPasswordError('BIP39 passphrases do not match.');
            return;
        }
        setPasswordError(null);
        setMnemonic(cryptoLib.generateBip39Mnemonic(wordCount === 24 ? 256 : 128));
        setStage('mnemonic');
    }

    function handleStartVerify() {
        if (!mnemonic || !saved) return;
        const totalWords = mnemonic.trim().split(/\s+/).length;
        const positions = pickQuizPositions(totalWords);
        setQuizPositions(positions);
        const blanks = {};
        for (const p of positions) blanks[p] = '';
        setQuizAnswers(blanks);
        setQuizError(null);
        setStage('verify');
    }

    function handleSubmitVerify(event) {
        event.preventDefault();
        setValidationAttempt((attempt) => attempt + 1);
        if (!mnemonic) return;
        const words = mnemonic.trim().split(/\s+/);
        for (const p of quizPositions) {
            const expected = (words[p - 1] || '').trim().toLowerCase();
            const got = (quizAnswers[p] || '').trim().toLowerCase();
            if (got.length === 0) {
                setQuizErrorPosition(p);
                setQuizError('Fill in every word.');
                return;
            }
            if (got !== expected) {
                setQuizErrorPosition(p);
                setQuizError(`Word #${p} doesn't match. Double-check your written copy.`);
                return;
            }
        }
        setQuizErrorPosition(null);
        setQuizError(null);
        handlePersist();
    }

    async function handlePersist() {
        if (!mnemonic || !saved || stage === 'persisting') return;
        setStage('persisting');
        setPersistError(null);
        // Paint "Creating your wallet" before the key stretching holds the
        // UI thread, or the old verify form sits there frozen.
        await nextPaint();
        try {
            const passphraseArg = showPassphrase && bip39Passphrase.length > 0
                ? bip39Passphrase
                : '';
            let createdWalletId = null;
            if (mode === 'add') {
                if (typeof messaging.addImportedWallet !== 'function') {
                    throw new Error('messaging.addImportedWallet is not available in this shell.');
                }
                const r = await messaging.addImportedWallet({ password, mnemonic, name, bip39Passphrase: passphraseArg, origin: 'created' });
                createdWalletId = r?.wallet?.id || r?.walletId || null;
            } else {
                const r = await messaging.importMnemonic({ password, mnemonic, name, bip39Passphrase: passphraseArg, origin: 'created' });
                createdWalletId = r?.wallet?.id || r?.walletId || null;
            }
            // §19.7 / G034: record that the user just verified the seed
            // via the §19.2 word-quiz, so Home's BackupReminderCard knows
            // not to nag them.
            if (createdWalletId) {
                try { flowsLib.markBackupVerified(createdWalletId); } catch { /* best-effort */ }
            }
            // §36.1: end onboarding on the ADS notice (AdsNotice.jsx).
            setStage('ads-notice');
        } catch (err) {
            setPersistError(err?.message || 'Failed to create wallet.');
            setStage('verify');
        }
    }

    const headClass = isFull ? styles.headFull : styles.headPopup;
    const titleClass = isFull ? styles.titleFull : styles.titlePopup;
    const subtitleClass = isFull ? styles.subtitleFull : styles.subtitlePopup;
    const actionsClass = isFull ? styles.actionsFull : styles.actionsPopup;

    const screenHeader = (
        <div className={pickerStyles.header}>
            <Button
                type="button"
                onClick={onBack}
                className={pickerStyles.iconBtn}
                aria-label="Back to wallet setup"
                title="Back to wallet setup"
                disabled={stage === 'persisting'}
            >
                <Icon.BackIcon />
            </Button>
            <span />
            <span />
        </div>
    );

    if (stage === 'ads-notice') {
        const noticeBody = (
            <AdsNotice
                onContinue={onCreated}
                isFull={isFull}
                headClass={headClass}
                titleClass={titleClass}
                subtitleClass={subtitleClass}
                actionsClass={actionsClass}
            />
        );
        return (
            <Screen variant={variant} header={screenHeader}>
                <FormPage ref={stageFormRef} label="Automatic Donation System">
                    {noticeBody}
                </FormPage>
            </Screen>
        );
    }

    if (stage === 'persisting') {
        const persistingBody = (
            <div className={styles.persisting} role="status" aria-live="polite">
                <span className={styles.persistingSpinner} aria-hidden="true" />
                <h1 className={titleClass}>Creating your wallet</h1>
                <p className={subtitleClass}>
                    Encrypting your wallet with your password. On some phones this
                    takes a minute or two. Keep the app open until it finishes.
                </p>
            </div>
        );
        return (
            <Screen variant={variant} header={screenHeader}>
                <FormPage ref={stageFormRef} label="Wallet creation status">
                    {persistingBody}
                </FormPage>
            </Screen>
        );
    }

    if (stage === 'verify') {
        const verifyBody = (
            <FormPage
                ref={stageFormRef}
                label="Verify recovery phrase"
                onSubmit={handleSubmitVerify}
                status={<FormErrorSummary
                    errors={[
                        ...(quizError ? [{
                            id: quizErrorPosition ? `create-quiz-word-${quizErrorPosition}` : undefined,
                            label: quizErrorPosition ? `Word ${quizErrorPosition}` : undefined,
                            message: quizError,
                        }] : []),
                        ...(persistError ? [{ message: persistError }] : []),
                    ]}
                    focusKey={validationAttempt}
                />}
                actions={(
                    <>
                        <Button
                            variant="secondary"
                            type="button"
                            onClick={() => { setQuizError(null); setStage('mnemonic'); }}
                            disabled={stage === 'persisting'}
                        >
                            Back
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={stage === 'persisting'}
                            icon={<Icon.CheckIcon />}
                        >
                            Create wallet
                        </Button>
                    </>
                )}
            >
                <header className={headClass}>
                    <h1 className={titleClass}>
                        {isFull ? 'Verify your recovery phrase' : 'Verify phrase'}
                    </h1>
                    <p className={subtitleClass}>
                        {isFull
                            ? "Type the words at the positions below. We'll check them against the phrase you just wrote down. There's no second chance to copy it after this step."
                            : 'Type the words at these positions to confirm.'}
                    </p>
                </header>
                <ol className={styles.quizList}>
                    {quizPositions.map((p) => (
                        <li key={p} className={styles.quizRow}>
                            <Input
                                id={`create-quiz-word-${p}`}
                                ref={p === quizPositions[0] ? firstQuizInputRef : undefined}
                                label={`Word ${p}`}
                                value={quizAnswers[p] || ''}
                                onChange={(e) => {
                                    setQuizAnswers((prev) => ({ ...prev, [p]: e.target.value }));
                                    if (quizError) {
                                        setQuizError(null);
                                        setQuizErrorPosition(null);
                                    }
                                }}
                                autoComplete="off"
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                                disabled={stage === 'persisting'}
                            />
                        </li>
                    ))}
                </ol>
            </FormPage>
        );
        return (
            <Screen variant={variant} header={screenHeader}>
                {verifyBody}
            </Screen>
        );
    }

    if (stage === 'mnemonic') {
        const mnemonicBody = (
            <FormPage
                ref={stageFormRef}
                label="Recovery phrase"
                status={persistError ? (
                    <StatusMessage variant="error" className={styles.error}>{persistError}</StatusMessage>
                ) : null}
                actions={(
                    <Button
                        variant="primary"
                        onClick={handleStartVerify}
                        disabled={!saved}
                        icon={<Icon.CheckIcon />}
                    >
                        Verify recovery phrase
                    </Button>
                )}
            >
                <header className={headClass}>
                    <h1 className={titleClass}>
                        {isFull
                            ? 'Write down your recovery phrase'
                            : 'Recovery phrase'}
                    </h1>
                    <p className={subtitleClass}>
                        {isFull
                            ? `Write these ${wordCount === 24 ? 'twenty-four' : 'twelve'} words down on paper and store them somewhere safe. ${RECOVERY_PHRASE_WARNING}`
                            : `Write these ${wordCount} words down and store them somewhere safe. ${RECOVERY_PHRASE_WARNING}`}
                    </p>
                </header>
                <MnemonicGrid mnemonic={mnemonic || ''} variant={variant} />
                {/* SSC-4 /, decided 2026-08-01: the recovery phrase
                    is NOT copyable, on any shell. A clipboard is readable by
                    any foreground app, kept in history by clipboard managers,
                    and on iOS synced to every nearby signed-in device by
                    default; hygiene can narrow each of those but not remove
                    the class. The phrase is on screen to be written down,
                    which is what the wallet has always told users to do, and
                    what MnemonicGrid already said this UI did. */}
                <p className={styles.copyHint}>
                    Write these words on paper. They cannot be copied: a
                    clipboard is readable by other apps and, on a phone, is
                    often synced to your other devices.
                </p>
                <label className={styles.confirmRow}>
                    <input
                        type="checkbox"
                        checked={saved}
                        onChange={(e) => setSaved(e.target.checked)}
                        disabled={stage === 'persisting'}
                    />
                    <span>
                        {isFull
                            ? 'I have written down my recovery phrase and stored it safely.'
                            : "I've saved my recovery phrase."}
                    </span>
                </label>
            </FormPage>
        );
        return (
            <Screen variant={variant} header={screenHeader}>
                {mnemonicBody}
            </Screen>
        );
    }

    const passwordStepDisabledReason = password.length === 0
        ? 'Enter a password to continue.'
        : confirm.length === 0
            ? 'Confirm your password to continue.'
            : null;
    let passwordErrorTarget;
    if (/at least/i.test(passwordError || '')) passwordErrorTarget = { id: 'create-password', label: 'Password' };
    else if (passwordError === 'Passwords do not match.') passwordErrorTarget = { id: 'create-confirm', label: 'Confirm password' };
    else if (/^Enter the BIP39/i.test(passwordError || '')) passwordErrorTarget = { id: 'create-bip39-passphrase', label: 'BIP39 passphrase' };
    else if (/BIP39 passphrases do not match/i.test(passwordError || '')) passwordErrorTarget = { id: 'create-bip39-confirm', label: 'Confirm passphrase' };
    const passwordErrors = passwordError
        ? [{ ...passwordErrorTarget, message: passwordError }]
        : [];
    const formBody = (
        <FormPage
            ref={stageFormRef}
            label="Create wallet"
            onSubmit={handlePasswordSubmit}
            status={passwordError ? (
                <FormErrorSummary errors={passwordErrors} focusKey={validationAttempt} />
            ) : passwordStepDisabledReason ? (
                <StatusMessage id="create-wallet-disabled-reason">
                    {passwordStepDisabledReason}
                </StatusMessage>
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    disabled={Boolean(passwordStepDisabledReason)}
                    aria-describedby={passwordStepDisabledReason ? 'create-wallet-disabled-reason' : undefined}
                    icon={<Icon.MigrateIcon />}
                >
                    Next
                </Button>
            )}
        >
            <header className={headClass}>
                {isFull ? (
                    <img
                        src={branding.logoUrl()}
                        alt=""
                        aria-hidden="true"
                        className={styles.logo}
                    />
                ) : null}
                <h1 className={titleClass}>
                    {isFull ? 'Create a new wallet' : 'Create wallet'}
                </h1>
                <p className={subtitleClass}>
                    {isFull
                        ? "Your password encrypts the wallet on this device. It can't be recovered. If you forget it, use the recovery phrase on the next screen to restore access."
                        : 'Your password encrypts the wallet on this device.'}
                </p>
            </header>
            <Input
                label="Wallet name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
            />
            <Input
                id="create-password"
                ref={passwordRef}
                type="password"
                label="Password"
                hint={`At least ${MIN_PASSWORD_LENGTH} characters. Use a unique password; longer is stronger.`}
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError(null);
                }}
                autoComplete="new-password"
            />
            <Input
                id="create-confirm"
                type="password"
                label={isFull ? 'Confirm password' : 'Confirm'}
                value={confirm}
                onChange={(e) => {
                    setConfirm(e.target.value);
                    if (passwordError) setPasswordError(null);
                }}
                autoComplete="new-password"
            />
            <fieldset className={styles.wordCountRow}>
                <legend className={styles.wordCountLegend}>Recovery phrase length</legend>
                <label className={styles.wordCountOption}>
                    <input
                        type="radio"
                        name="word-count"
                        value="12"
                        checked={wordCount === 12}
                        onChange={() => setWordCount(12)}
                    />
                    <span className={styles.wordCountLabel}>12 words</span>
                    <span className={styles.wordCountHint}>Recommended: secure and easier to back up</span>
                </label>
                <label className={styles.wordCountOption}>
                    <input
                        type="radio"
                        name="word-count"
                        value="24"
                        checked={wordCount === 24}
                        onChange={() => setWordCount(24)}
                    />
                    <span className={styles.wordCountLabel}>24 words</span>
                    <span className={styles.wordCountHint}>Extra entropy, twice as many words to store</span>
                </label>
            </fieldset>
            <div className={styles.advancedRow}>
                <label className={styles.advancedToggle}>
                    <input
                        type="checkbox"
                        checked={showPassphrase}
                        onChange={(e) => {
                            setShowPassphrase(e.target.checked);
                            if (!e.target.checked) {
                                setBip39Passphrase('');
                                setBip39PassphraseConfirm('');
                            }
                        }}
                    />
                    <span>Use a BIP39 passphrase (advanced)</span>
                    <InfoTip
                        aria="BIP39 passphrase help"
                        label="This extra secret combines with your recovery phrase to create a different wallet and must match exactly when you restore. Hardware wallets handle it on the device."
                    />
                </label>
                {showPassphrase ? (
                    <>
                        <p className={styles.advancedWarning}>
                            Save this passphrase separately from your recovery phrase.
                            You need both to restore this wallet. It cannot be reset or
                            recovered, and a missing or mistyped passphrase opens a
                            different wallet without warning. Capitalization and spaces
                            matter.
                        </p>
                        <Input
                            id="create-bip39-passphrase"
                            type="password"
                            label="BIP39 passphrase"
                            hint="Required when enabled. Capitalization and spaces matter."
                            value={bip39Passphrase}
                            onChange={(e) => {
                                setBip39Passphrase(e.target.value);
                                if (passwordError) setPasswordError(null);
                            }}
                            autoComplete="off"
                        />
                        <Input
                            id="create-bip39-confirm"
                            type="password"
                            label="Confirm passphrase"
                            value={bip39PassphraseConfirm}
                            onChange={(e) => {
                                setBip39PassphraseConfirm(e.target.value);
                                if (passwordError) setPasswordError(null);
                            }}
                            autoComplete="off"
                        />
                    </>
                ) : null}
            </div>
        </FormPage>
    );

    return (
        <Screen variant={variant} header={screenHeader}>
            {formBody}
        </Screen>
    );
}
