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
import { RECOVERY_PHRASE_WARNING } from '../utils/securityMomentCopy.js';
import { Button, Checkbox, FormErrorSummary, FormPage, Icon, InfoTip, Input, PageHeader, RadioGroup, Screen, StatusMessage, Switch } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { crypto as cryptoLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { MnemonicGrid } from '../components/MnemonicGrid.jsx';
import { AdsNotice } from '../components/AdsNotice.jsx';
import { pickQuizPositions } from '../utils/pickQuizPositions.js';
import { nextPaint } from '../utils/nextPaint.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { writeActiveWallet } from '../utils/activeWalletMemory.js';
import { useBackHandler } from '../../ui/backStack.js';
import styles from './CreateWallet.module.css';

const MIN_PASSWORD_LENGTH = 8;

function numberedWalletName(wallets) {
    const names = new Set(
        wallets.map((wallet) => String(wallet?.name || '').trim().toLowerCase()),
    );
    let number = Math.max(2, wallets.length + 1);
    while (names.has(`wallet ${number}`)) number += 1;
    return `Wallet ${number}`;
}

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
 * @param {(wallet?: { id: string, name: string }) => void} props.onCreated
 * @param {'fresh' | 'add'} [props.mode]   'fresh' = first wallet (pre-host `wallet.import`); 'add' = adds to an open vault (`wallet.add.import`). Defaults to 'fresh'.
 */
export function CreateWallet({ onBack, onCreated: handleCreated, mode = 'fresh' }) {
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
    const [name, setName] = useState(mode === 'add' ? 'Wallet 2' : 'Main Wallet');
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
    const headingRef = useRef(/** @type {HTMLHeadingElement | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const firstQuizInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const stageFormRef = useRef(/** @type {HTMLFormElement | null} */ (null));
    const keepKeyboardDismissedRef = useRef(false);
    const phraseGeneratedRef = useRef(false);
    const creationInFlightRef = useRef(false);
    const createdWalletRef = useRef(/** @type {{ id: string, name: string } | null} */ (null));
    const nameEditedRef = useRef(false);
    const defaultNameRef = useRef(name);

    useEffect(() => {
        if (mode !== 'add' || typeof messaging.listWallets !== 'function') return undefined;
        let cancelled = false;
        Promise.resolve()
            .then(() => messaging.listWallets())
            .then((wallets) => {
                if (cancelled) return;
                const suggestedName = numberedWalletName(Array.isArray(wallets) ? wallets : []);
                defaultNameRef.current = suggestedName;
                if (!nameEditedRef.current) setName(suggestedName);
            })
            .catch(() => { /* Wallet 2 remains a safe fallback when the list is unavailable. */ });
        return () => { cancelled = true; };
    }, [messaging, mode]);

    // The clipboard auto-clear that used to live here is gone with the copy
    // button it existed for (, decided 2026-08-01): the phrase cannot
    // be copied, so there is nothing to clear.

    useEffect(() => {
        const id = setTimeout(() => {
            if (keepKeyboardDismissedRef.current) {
                keepKeyboardDismissedRef.current = false;
                const heading = stageFormRef.current?.querySelector('h1');
                if (heading instanceof HTMLElement) {
                    heading.tabIndex = -1;
                    heading.focus();
                }
            } else if (stage === 'password') passwordRef.current?.focus();
            else if (stage === 'verify') firstQuizInputRef.current?.focus();
            else headingRef.current?.focus();
        }, 0);
        return () => clearTimeout(id);
    }, [stage]);

    useBackHandler(handleNativeBack, stage === 'persisting' || stage === 'ads-notice');

    function clearEntrySecrets() {
        setPassword('');
        setConfirm('');
        setBip39Passphrase('');
        setBip39PassphraseConfirm('');
        setPasswordError(null);
    }

    function clearWalletSecrets() {
        clearEntrySecrets();
        setMnemonic(null);
        setSaved(false);
        setQuizPositions([]);
        setQuizAnswers({});
        setQuizError(null);
        setQuizErrorPosition(null);
        phraseGeneratedRef.current = false;
    }

    function onCreated() {
        handleCreated(createdWalletRef.current || undefined);
    }

    function handleBack() {
        if (stage === 'verify') {
            setQuizAnswers({});
            setQuizError(null);
            setStage('mnemonic');
            return;
        }
        if (stage === 'mnemonic') {
            clearEntrySecrets();
            setSaved(false);
            setQuizPositions([]);
            setQuizAnswers({});
            setQuizError(null);
            setQuizErrorPosition(null);
            setPersistError(null);
            setStage('password');
            return;
        }
        clearEntrySecrets();
        onBack();
    }

    function handleNativeBack() {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        // Returning from the phrase to the password form must not reopen the
        // software keyboard that the edge gesture just dismissed.
        keepKeyboardDismissedRef.current = stage === 'mnemonic';
        handleBack();
    }

    function handlePasswordSubmit(event) {
        event.preventDefault();
        if (stage !== 'password' || (phraseGeneratedRef.current && !mnemonic)) return;
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
        const requestedWordCount = wordCount === 24 ? 24 : 12;
        if (mnemonic?.trim().split(/\s+/).length === requestedWordCount) {
            setStage('mnemonic');
            return;
        }
        phraseGeneratedRef.current = true;
        try {
            setMnemonic(cryptoLib.generateBip39Mnemonic(requestedWordCount === 24 ? 256 : 128));
        } catch (err) {
            phraseGeneratedRef.current = false;
            setPasswordError(userFacingMessage(err, 'Failed to generate a recovery phrase. Try again.'));
            return;
        }
        setStage('mnemonic');
    }

    function handleStartVerify() {
        if (stage !== 'mnemonic' || !mnemonic || !saved) return;
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
        if (stage !== 'verify' || !mnemonic || !saved) return;
        if (quizPositions.length === 0) {
            setQuizErrorPosition(null);
            setQuizError('Recovery phrase verification could not start. Go back and try again.');
            return;
        }
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
                setQuizError(`Word ${p} does not match your written copy.`);
                return;
            }
        }
        setQuizErrorPosition(null);
        setQuizError(null);
        void handlePersist();
    }

    async function handlePersist() {
        if (stage !== 'verify' || !mnemonic || !saved || creationInFlightRef.current) return;
        creationInFlightRef.current = true;
        createdWalletRef.current = null;
        setStage('persisting');
        setPersistError(null);
        try {
            // Paint "Creating your wallet" before key stretching holds the
            // UI thread so the progress state reaches the screen.
            await nextPaint();
            const passphraseArg = showPassphrase && bip39Passphrase.length > 0
                ? bip39Passphrase
                : '';
            const walletName = name.trim() || defaultNameRef.current;
            let createdWalletId = null;
            if (mode === 'add') {
                if (typeof messaging.addImportedWallet !== 'function') {
                    throw new Error('messaging.addImportedWallet is not available in this shell.');
                }
                const r = await messaging.addImportedWallet({ password, mnemonic, name: walletName, bip39Passphrase: passphraseArg, origin: 'created' });
                createdWalletId = r?.wallet?.id || r?.walletId || null;
                if (createdWalletId) {
                    createdWalletRef.current = {
                        id: createdWalletId,
                        name: r?.wallet?.name || r?.walletName || walletName,
                    };
                }
            } else {
                const r = await messaging.importMnemonic({ password, mnemonic, name: walletName, bip39Passphrase: passphraseArg, origin: 'created' });
                createdWalletId = r?.wallet?.id || r?.walletId || null;
            }
            // §19.7 / G034: record that the user just verified the seed
            // via the §19.2 word-quiz, so Home's BackupReminderCard knows
            // not to nag them.
            if (createdWalletId) {
                try { flowsLib.markBackupVerified(createdWalletId); } catch { /* best-effort */ }
                writeActiveWallet(createdWalletId, name);
            }
            // §36.1: end onboarding on the ADS notice (AdsNotice.jsx).
            clearWalletSecrets();
            setStage('ads-notice');
        } catch (err) {
            setPersistError(userFacingMessage(err, 'Failed to create wallet. Try again.'));
            setStage('verify');
        } finally {
            creationInFlightRef.current = false;
        }
    }

    const headClass = isFull ? styles.headFull : styles.headPopup;
    const subtitleClass = isFull ? styles.subtitleFull : styles.subtitlePopup;
    const actionsClass = isFull ? styles.actionsFull : styles.actionsPopup;

    const headerTitle = stage === 'password'
        ? (isFull ? 'Create a new wallet' : 'Create wallet')
        : stage === 'mnemonic'
            ? (isFull ? 'Write down your recovery phrase' : 'Recovery phrase')
            : stage === 'verify'
                ? (isFull ? 'Verify your recovery phrase' : 'Verify phrase')
                : stage === 'persisting'
                    ? 'Creating your wallet'
                    : 'Automatic Donation System';
    const screenHeader = (
        <PageHeader
            onBack={stage === 'verify' ? undefined : handleBack}
            backLabel={stage === 'password' ? 'Back to wallet setup' : 'Back to previous step'}
            backDisabled={stage === 'persisting' || stage === 'ads-notice'}
            title={headerTitle}
            titleRef={headingRef}
        />
    );

    if (stage === 'ads-notice') {
        const noticeBody = (
            <AdsNotice
                onContinue={onCreated}
                isFull={isFull}
                headClass={headClass}
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
        return (
            <Screen variant={variant} header={screenHeader}>
                <FormPage
                    ref={stageFormRef}
                    label="Wallet creation status"
                    description="XChain Platform is encrypting your wallet with your password. This can take a minute on some devices. Keep the app open."
                    progress={<span aria-current="step">Step 3 of 3</span>}
                    aria-live="polite"
                    actions={<Button loading icon={<Icon.CheckIcon />}>Create wallet</Button>}
                />
            </Screen>
        );
    }

    if (stage === 'verify') {
        const verifyBody = (
            <FormPage
                ref={stageFormRef}
                label="Verify recovery phrase"
                onSubmit={handleSubmitVerify}
                description={isFull
                    ? 'Enter the requested words from the recovery phrase you wrote down.'
                    : 'Enter the requested words to confirm your recovery phrase.'}
                progress={<span aria-current="step">Step 3 of 3</span>}
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
                        {/* Keep verification's step-back beside submit while the shared header leaves its leading lane empty. */}
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
                {/* The ordered quiz stays native because the kit has no semantic form-list primitive. */}
                <ol className={styles.quizList}>
                    {/* Native list items preserve the quiz order within the form. */}
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
                description={isFull
                    ? `These ${wordCount === 24 ? 'twenty-four' : 'twelve'} words are your recovery phrase. Write them on paper and store them in a safe place. ${RECOVERY_PHRASE_WARNING} You can use it to restore your wallet on a new device.`
                    : `Write these ${wordCount} words on paper and store your recovery phrase safely. ${RECOVERY_PHRASE_WARNING}`}
                progress={<span aria-current="step">Step 2 of 3</span>}
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
                    Copying is disabled to keep your recovery phrase out of
                    shared clipboards.
                </p>
                <Checkbox
                    className={styles.confirmRow}
                    label="I have saved my recovery phrase safely."
                    checked={saved}
                    onChange={(e) => setSaved(e.target.checked)}
                    disabled={stage === 'persisting'}
                />
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
            description={isFull
                ? 'Your password encrypts this wallet on this device. If you forget it, you can restore the wallet with the recovery phrase shown next.'
                : 'Your password encrypts this wallet on this device.'}
            visual={isFull ? (
                <img
                    src={branding.logoUrl()}
                    alt=""
                    aria-hidden="true"
                    className={styles.logo}
                />
            ) : null}
            progress={<span aria-current="step">Step 1 of 3</span>}
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
            <Input
                label="Wallet name"
                value={name}
                onChange={(e) => {
                    nameEditedRef.current = true;
                    setName(e.target.value);
                }}
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
            <RadioGroup
                className={styles.wordCountRow}
                legend="Recovery phrase length"
                name="word-count"
                value={String(wordCount)}
                onChange={(nextWordCount) => setWordCount(Number(nextWordCount))}
                options={[
                    {
                        value: '12',
                        label: '12 words',
                        description: 'Recommended: secure and easier to back up',
                    },
                    {
                        value: '24',
                        label: '24 words',
                        description: 'Extra entropy, twice as many words to store',
                    },
                ]}
            />
            <div className={styles.advancedRow}>
                <div className={styles.advancedToggle}>
                    <Switch
                        label="Use a BIP39 passphrase (advanced)"
                        checked={showPassphrase}
                        onChange={(e) => {
                            setShowPassphrase(e.target.checked);
                            if (!e.target.checked) {
                                setBip39Passphrase('');
                                setBip39PassphraseConfirm('');
                            }
                        }}
                    />
                    <InfoTip
                        aria="BIP39 passphrase help"
                        label="This extra secret combines with your recovery phrase to create a different wallet and must match exactly when you restore. Hardware wallets handle it on the device."
                    />
                </div>
                {showPassphrase ? (
                    <>
                        <StatusMessage variant="warning" role={null}>
                            Save this passphrase separately from your recovery phrase.
                            You need both to restore this wallet. It cannot be reset or
                            recovered, and a missing or mistyped passphrase opens a
                            different wallet without warning. Capitalization and spaces
                            matter.
                        </StatusMessage>
                        <Input
                            id="create-bip39-passphrase"
                            type="password"
                            label="BIP39 passphrase"
                            hint="Required when enabled."
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
