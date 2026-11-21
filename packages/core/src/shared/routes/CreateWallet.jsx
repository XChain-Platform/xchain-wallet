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
import { Button, Checkbox, FormPage, Icon, IconSelect, Input, Notice, PageHeader, Screen, Switch, useFormErrors } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { crypto as cryptoLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { MnemonicGrid } from '../components/MnemonicGrid.jsx';
import { AdsNotice } from '../components/AdsNotice.jsx';
import { FormSection } from '../components/formStandard/index.js';
import { pickQuizPositions } from '../utils/pickQuizPositions.js';
import { nextPaint } from '../utils/nextPaint.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { isWalletExistsError } from '../utils/walletExistsError.js';
import { writeActiveWallet } from '../utils/activeWalletMemory.js';
import { NAME_MAX_LENGTH, hasVisibleText, nameLength } from '../../util/display_name.js';
import { useBackHandler } from '../../ui/backStack.js';
import { useDocumentTitleSection } from '../hooks/useDocumentTitle.js';
import { useOwnWalletWriteHold } from '../hooks/useOwnWalletWriteHold.js';
import { DURESS_PASSWORD_COLLISION_MESSAGE, walletPasswordCollidesWithDuress } from '../../flows/duressPassphrase.js';
import styles from './CreateWallet.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/createWallet.js';
import '../../i18n/locales/en/importWallet.js';
import '../../i18n/locales/en/renameWallet.js';
import '../../i18n/locales/en/settings.js';

const MIN_PASSWORD_LENGTH = 8;
const CONFIRM_PASSWORD_MESSAGE = 'Confirm your password.';
// The "I have saved my recovery phrase" checkbox: its id keys its error entry.
const SAVED_CHECK_ID = 'create-saved-phrase';
const REVEAL_PHRASE_ID = 'create-reveal-phrase';

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
 *
 * `staleGuard` is passed by a shell whose windows share one vault (the
 * extension popup): `report(hold)` says whether this window holds a phrase
 * ('hold') or not ('idle'), and `elsewhere` turns true when another window
 * created the wallet. A window holding a phrase then stays on a lasting
 * notice instead of following the session to Home, because the phrase it
 * showed belongs to no wallet.
 *
 * `ownWriteGuard` is told while this window writes the first wallet and
 * until its donation notice hands back, so the unlock its own write
 * announces does not move the window to Home first.
 */
export function CreateWallet({ onBack, onCreated: handleCreated, mode = 'fresh', staleGuard, ownWriteGuard }) {
    // S4: The recovery phrase is displayed here. A screenshot of it, or the
    // recents snapshot Android persists, is a copy of the wallet.
    // No-op on every shell that installs no screen guard (web, extension,
    // desktop): a browser tab cannot stop a screenshot and must not pretend to.
    useProtectedScreen();

    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [stage, setStage] = useState(
        /** @type {'password'|'mnemonic'|'verify'|'persisting'|'ads-notice'|'stale'} */ ('password'),
    );
    // §19.2 / G033: verification quiz state. `quizPositions` is a sorted
    // list of 1-based word indices the user must type back; `quizAnswers`
    // is keyed by that index. Computed once when the user clicks
    // "Verify" so re-renders don't reshuffle.
    const [quizPositions, setQuizPositions] = useState(/** @type {number[]} */ ([]));
    const [quizAnswers, setQuizAnswers] = useState(/** @type {Record<number, string>} */ ({}));
    // The verify step follows the same form error standard: one entry per
    // empty or wrong word, each marked on its own field.
    const quizErrors = useFormErrors();
    const [name, setName] = useState(mode === 'add' ? 'Wallet 2' : 'Main Wallet');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    // §15.1: 12-word default, 24-word opt-in. 12 words = 128-bit entropy, 24 = 256-bit.
    const [wordCount, setWordCount] = useState(/** @type {12 | 24} */ (12));
    // §20: the new wallet's mode, chosen once here; Normal by default.
    // §15.6: optional 25th-word BIP39 passphrase. Empty string means "not used".
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [bip39Passphrase, setBip39Passphrase] = useState('');
    const [bip39PassphraseConfirm, setBip39PassphraseConfirm] = useState('');
    // The form error standard: Next lists every problem at the top and marks
    // each failing field; a field clears as soon as it changes.
    const passwordErrors = useFormErrors();
    const [mnemonic, setMnemonic] = useState(/** @type {string | null} */ (null));
    const [phraseRevealed, setPhraseRevealed] = useState(false);
    const [saved, setSaved] = useState(false);
    // G130: Verify Recovery Phrase is never disabled. A tap explains whether
    // the phrase must be revealed or the acknowledgement must be checked.
    const savedErrors = useFormErrors();
    const [persistError, setPersistError] = useState(
        /** @type {string | null} */ (null),
    );
    const headingRef = useRef(/** @type {HTMLHeadingElement | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const revealPhraseRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
    const savedCheckboxRef = useRef(/** @type {HTMLInputElement | null} */ (null));
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

    // This step intentionally has no error summary. Its one failing control
    // receives focus, and the inline error supplies the live announcement.
    useEffect(() => {
        if (stage !== 'mnemonic' || savedErrors.attempt === 0) return;
        if (savedErrors.errorFor(REVEAL_PHRASE_ID)) revealPhraseRef.current?.focus();
        else if (savedErrors.errorFor(SAVED_CHECK_ID)) savedCheckboxRef.current?.focus();
    }, [savedErrors.attempt, savedErrors.errors, stage]);

    // A flow step, not an overlay: backgrounding the app keeps the stage, so
    // the phrase being written down is never replaced on resume.
    useBackHandler(handleNativeBack, stage === 'persisting' || stage === 'ads-notice', 'screen');

    function clearEntrySecrets() {
        setPassword('');
        setConfirm('');
        setBip39Passphrase('');
        setBip39PassphraseConfirm('');
        passwordErrors.reset();
    }

    function clearWalletSecrets() {
        clearEntrySecrets();
        setMnemonic(null);
        setPhraseRevealed(false);
        setSaved(false);
        savedErrors.reset();
        setQuizPositions([]);
        setQuizAnswers({});
        quizErrors.reset();
        phraseGeneratedRef.current = false;
    }

    function goStale() {
        clearWalletSecrets();
        setPersistError(null);
        setStage('stale');
    }

    // Another window created the wallet while this one held a phrase.
    useEffect(() => {
        if (staleGuard?.elsewhere && (stage === 'mnemonic' || stage === 'verify')) goStale();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [staleGuard?.elsewhere, stage]);

    const holdState = (stage === 'mnemonic' || stage === 'verify' || stage === 'stale') ? 'hold' : 'idle';
    const reportHold = staleGuard?.report;
    useEffect(() => {
        reportHold?.(holdState);
    }, [holdState, reportHold]);
    useOwnWalletWriteHold(ownWriteGuard, mode === 'fresh' && (stage === 'persisting' || stage === 'ads-notice'));

    function onCreated() {
        handleCreated(createdWalletRef.current || undefined);
    }

    function handleBack() {
        if (stage === 'verify') {
            setQuizAnswers({});
            quizErrors.reset();
            setPhraseRevealed(false);
            setStage('mnemonic');
            return;
        }
        if (stage === 'mnemonic') {
            clearEntrySecrets();
            setPhraseRevealed(false);
            setSaved(false);
            savedErrors.reset();
            setQuizPositions([]);
            setQuizAnswers({});
            quizErrors.reset();
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
        // Every check runs on each press, so the notice lists every problem
        // at once and each failing field is marked; one message per field.
        // A blank name falls back to the default; a name that draws no mark or
        // runs past the cap would read as nothing in every list.
        const trimmedName = name.trim();
        let nameProblem = null;
        if (trimmedName.length > 0 && !hasVisibleText(trimmedName)) nameProblem = 'Wallet name must include a visible character.';
        else if (nameLength(trimmedName) > NAME_MAX_LENGTH) nameProblem = `Wallet name must be ${NAME_MAX_LENGTH} characters or fewer.`;
        let passwordProblem = null;
        if (password.length < MIN_PASSWORD_LENGTH) passwordProblem = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        else if (walletPasswordCollidesWithDuress(password)) passwordProblem = DURESS_PASSWORD_COLLISION_MESSAGE;
        let confirmProblem = null;
        if (confirm.length === 0) confirmProblem = CONFIRM_PASSWORD_MESSAGE;
        else if (password !== confirm) confirmProblem = 'Passwords do not match.';
        // Same rule as the import screen: a checked box with nothing typed
        // is a contradiction, not a wallet without a passphrase.
        let passphraseProblem = null;
        let passphraseConfirmProblem = null;
        if (showPassphrase && bip39Passphrase.length === 0) passphraseProblem = t('createWallet.enterTheExtraPassphraseOrUncheck');
        else if (showPassphrase && bip39Passphrase !== bip39PassphraseConfirm) passphraseConfirmProblem = t('createWallet.extraPassphrasesDoNotMatch');
        const valid = passwordErrors.validate({
            'create-name': nameProblem,
            'create-password': passwordProblem,
            'create-confirm': confirmProblem,
            'create-bip39-passphrase': passphraseProblem,
            'create-bip39-confirm': passphraseConfirmProblem,
        });
        if (!valid) return;
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
            passwordErrors.fail(userFacingMessage(err, 'Failed to generate a recovery phrase. Try again.'));
            return;
        }
        setStage('mnemonic');
    }

    function handleStartVerify() {
        if (stage !== 'mnemonic' || !mnemonic) return;
        if (!phraseRevealed) {
            savedErrors.validate({
                [REVEAL_PHRASE_ID]: t('createWallet.revealPhraseFirst'),
                [SAVED_CHECK_ID]: null,
            });
            return;
        }
        if (!saved) {
            savedErrors.validate({
                [REVEAL_PHRASE_ID]: null,
                [SAVED_CHECK_ID]: t('createWallet.tickSavedFirst'),
            });
            return;
        }
        savedErrors.reset();
        const totalWords = mnemonic.trim().split(/\s+/).length;
        const positions = pickQuizPositions(totalWords);
        setQuizPositions(positions);
        const blanks = {};
        for (const p of positions) blanks[p] = '';
        setQuizAnswers(blanks);
        quizErrors.reset();
        setStage('verify');
    }

    function handleSubmitVerify(event) {
        event.preventDefault();
        if (stage !== 'verify' || !mnemonic || !saved) return;
        if (quizPositions.length === 0) {
            quizErrors.validate({});
            quizErrors.fail('Recovery phrase verification could not start. Go back and try again.');
            return;
        }
        const words = mnemonic.trim().split(/\s+/);
        // Every word is checked on each press: one entry per empty or wrong word.
        const problems = {};
        for (const p of quizPositions) {
            const expected = (words[p - 1] || '').trim().toLowerCase();
            const got = (quizAnswers[p] || '').trim().toLowerCase();
            if (got.length === 0) problems[`create-quiz-word-${p}`] = 'Fill in every word.';
            else if (got !== expected) problems[`create-quiz-word-${p}`] = `Word ${p} does not match your written copy.`;
        }
        if (!quizErrors.validate(problems)) return;
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
                const r = await messaging.addImportedWallet({ password, mnemonic, name: walletName, bip39Passphrase: passphraseArg, origin: 'created', walletMode: 'full' });
                createdWalletId = r?.wallet?.id || r?.walletId || null;
                if (createdWalletId) {
                    createdWalletRef.current = {
                        id: createdWalletId,
                        name: r?.wallet?.name || r?.walletName || walletName,
                    };
                }
            } else {
                const r = await messaging.importMnemonic({ password, mnemonic, name: walletName, bip39Passphrase: passphraseArg, origin: 'created', walletMode: 'full' });
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
            if (staleGuard && isWalletExistsError(err)) {
                goStale();
                return;
            }
            setPersistError(userFacingMessage(err, 'Failed to create wallet. Try again.'));
            setStage('verify');
        } finally {
            creationInFlightRef.current = false;
        }
    }


    const headerTitle = stage === 'password'
        ? (isFull ? 'Create a New Wallet' : 'Create Wallet')
        : stage === 'mnemonic'
            ? (isFull ? 'Write Down Your Recovery Phrase' : 'Recovery Phrase')
            : stage === 'verify'
                ? (isFull ? 'Verify Your Recovery Phrase' : 'Verify Phrase')
                : stage === 'persisting'
                    ? 'Creating Your Wallet'
                    : stage === 'stale'
                        ? 'Wallet Already Created'
                        : 'Automatic Donations';
    // The window title names the step the heading shows.
    useDocumentTitleSection(headerTitle);
    // G01: the step count is the header subtitle under the title, never a
    // line above the form.
    const stepKey = stage === 'password'
        ? 'createWallet.step1Of3'
        : stage === 'mnemonic'
            ? 'createWallet.step2Of3'
            : stage === 'verify' || stage === 'persisting'
                ? 'createWallet.step3Of3'
                : null;
    const pageHeader = (
        <PageHeader
            // Every step sits inside Add wallet (or onboarding), so Back
            // always steps back within the flow.
            nested
            onBack={handleBack}
            backLabel={stage === 'password' ? t('importWallet.backToSetup') : t('createWallet.backToPreviousStep')}
            backDisabled={stage === 'persisting' || stage === 'ads-notice' || stage === 'stale'}
            title={headerTitle}
            titleRef={headingRef}
            subtitle={stepKey ? <span aria-current="step">{t(stepKey)}</span> : null}
        />
    );
    // Before a wallet exists, onboarding shows only this page header. In add
    // mode the unlocked shell supplies its app header above the same page header.
    const screenHeader = pageHeader;

    if (stage === 'stale') {
        return (
            <Screen variant={variant} header={screenHeader}>
                <FormPage
                    ref={stageFormRef}
                    label={t('createWallet.walletAlreadyCreated')}
                    status={(
                        <Notice
                            tone="danger"
                            role="alert"
                            keepsShellNotice
                            action={{ label: t('adsNotice.continue'), onAction: onCreated }}
                        >
                            {t('createWallet.staleWindowNotice')}
                        </Notice>
                    )}
                />
            </Screen>
        );
    }

    if (stage === 'ads-notice') {
        return (
            <Screen variant={variant} header={screenHeader}>
                <AdsNotice
                    ref={stageFormRef}
                    onContinue={onCreated}
                />
            </Screen>
        );
    }

    if (stage === 'persisting') {
        return (
            <Screen variant={variant} header={screenHeader}>
                <FormPage
                    ref={stageFormRef}
                    label={t('createWallet.walletCreationStatus')}
                    description={t('createWallet.xchainPlatformIsEncryptingYour')}
                    aria-live="polite"
                    actions={<Button variant="success" loading icon={<Icon.CheckIcon />}>{t('createWallet.createWallet')}</Button>}
                />
            </Screen>
        );
    }

    if (stage === 'verify') {
        const verifyBody = (
            <FormPage
                ref={stageFormRef}
                label={t('createWallet.verifyRecoveryPhrase')}
                onSubmit={handleSubmitVerify}
                errors={quizErrors}
                // The title and the Word N fields say what to do: no intro note.
                status={persistError ? [<Notice key="persist-error" tone="danger">{persistError}</Notice>] : undefined}
            >
                <div className={styles.quizActions}>
                    {/* The ordered quiz stays native because the kit has no semantic form-list primitive. */}
                    <ol className={styles.quizList}>
                        {/* Native list items preserve the quiz order within the form. */}
                        {quizPositions.map((p) => (
                            <li key={p} className={styles.quizRow}>
                                <Input
                                    id={`create-quiz-word-${p}`}
                                    ref={p === quizPositions[0] ? firstQuizInputRef : undefined}
                                    label={t('createWallet.word', { p })}
                                    help={t('createWallet.wordHelp', { p })}
                                    value={quizAnswers[p] || ''}
                                    onChange={(e) => {
                                        setQuizAnswers((prev) => ({ ...prev, [p]: e.target.value }));
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
                    <Button
                        type="submit"
                        variant="success"
                        loading={stage === 'persisting'}
                        icon={<Icon.CheckIcon />}
                    >
                        {t('createWallet.createWallet')}
                    </Button>
                </div>
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
                label={t('importWallet.recoveryPhrase')}
                cardless
                // One compact danger notice says what the words are (U71, the
                // Notice Standard); a second loose paragraph under it would
                // repeat it (U18). It is part of the step from the first
                // paint, so it is a static note, not a live region.
                status={[
                    <Notice key="recovery-warning" tone="danger" role="note">
                        {t('createWallet.recoveryPhraseNotice')}
                    </Notice>,
                    persistError ? <Notice key="persist-error" tone="danger">{persistError}</Notice> : null,
                ]}
            >
                {/* One stack so the hint, the checkbox and the button sit 8px apart. */}
                <div className={styles.phraseStack}>
                    <MnemonicGrid
                        mnemonic={mnemonic || ''}
                        variant={variant}
                        revealButtonId={REVEAL_PHRASE_ID}
                        revealButtonRef={revealPhraseRef}
                        revealError={savedErrors.errorFor(REVEAL_PHRASE_ID)}
                        onRevealedChange={(revealed) => {
                            setPhraseRevealed(revealed);
                            if (revealed) {
                                savedErrors.clear(REVEAL_PHRASE_ID);
                            }
                        }}
                    />
                    <p className={styles.copyHint}>
                        {t('createWallet.copyingIsDisabledToKeep')}
                    </p>
                    <Checkbox
                        id={SAVED_CHECK_ID}
                        ref={savedCheckboxRef}
                        className={styles.confirmRow}
                        label={t('createWallet.iHaveSavedMyRecovery')}
                        help={t('createWallet.savedPhraseHelp')}
                        checked={saved}
                        onChange={(e) => {
                            if (e.target.checked && !phraseRevealed) {
                                setSaved(false);
                                savedErrors.validate({
                                    [REVEAL_PHRASE_ID]: t('createWallet.revealPhraseFirst'),
                                    [SAVED_CHECK_ID]: null,
                                });
                                return;
                            }
                            setSaved(e.target.checked);
                            savedErrors.clear(SAVED_CHECK_ID);
                        }}
                        disabled={stage === 'persisting'}
                        error={savedErrors.errorFor(SAVED_CHECK_ID)}
                    />
                    <Button
                        variant="success"
                        onClick={handleStartVerify}
                        icon={<Icon.CheckIcon />}
                    >
                        {t('createWallet.verifyRecoveryPhrase')}
                    </Button>
                </div>
            </FormPage>
        );
        return (
            <Screen variant={variant} header={screenHeader}>
                {mnemonicBody}
            </Screen>
        );
    }

    // G22 and the form error standard: Next is always enabled; pressing it
    // lists every problem in the danger notice at the top of the form and
    // outlines each failing field in red, instead of a standing "to continue"
    // hint. The fields read their messages from `errors` by id and each one
    // clears as soon as that field changes.
    const passphraseErrorShown = Boolean(
        passwordErrors.errorFor('create-bip39-passphrase') || passwordErrors.errorFor('create-bip39-confirm'),
    );
    const formBody = (
        <FormPage
            ref={stageFormRef}
            label={t('createWallet.createWallet')}
            onSubmit={handlePasswordSubmit}
            errors={passwordErrors}
            visual={isFull ? (
                <img
                    src={branding.logoUrl()}
                    alt=""
                    aria-hidden="true"
                    className={styles.logo}
                />
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="success"
                    icon={<Icon.MigrateIcon />}
                >
                    {t('onboarding.carousel.next')}
                </Button>
            )}
        >
            <Input
                id="create-name"
                label={t('renameWallet.name')}
                help={t('createWallet.walletNameHelp')}
                value={name}
                maxLength={NAME_MAX_LENGTH}
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
                label={t('common.password')}
                help={t('createWallet.passwordAdvice', { MIN_PASSWORD_LENGTH })}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
            />
            <Input
                id="create-confirm"
                type="password"
                label={isFull ? t('importWallet.confirmPassword') : t('common.confirm')}
                help={t('createWallet.confirmPasswordHelp')}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
            />
            {/* G44: a choice among a few named options is the icon dropdown. */}
            <IconSelect
                label={t('createWallet.recoveryPhraseLength')}
                help={t('createWallet.recoveryPhraseLengthHelp')}
                value={String(wordCount)}
                onChange={(nextWordCount) => setWordCount(nextWordCount === '24' ? 24 : 12)}
                options={[
                    {
                        value: '12',
                        // The closed field shows only the label, so the default reads as a
                        // recommendation the user can change (xchain-wallet#127).
                        label: '12 words (recommended)',
                        sub: 'Secure and easier to back up',
                        icon: <Icon.ListIcon />,
                    },
                    {
                        value: '24',
                        label: '24 words',
                        sub: 'Extra entropy, twice as many words to store',
                        icon: <Icon.ListIcon />,
                    },
                ]}
            />
            {/* Collapsed by default; a passphrase error reopens it on each attempt. */}
            <FormSection
                id="extra-passphrase"
                title={t('createWallet.extraPassphraseTitle')}
                icon={Icon.LockIcon}
                optional
                summary={showPassphrase ? t('createWallet.extraPassphraseOn') : t('createWallet.extraPassphraseOff')}
                revealKey={passphraseErrorShown ? passwordErrors.attempt + 1 : 0}
            >
                {/* Always shown, first in the section, so flipping the switch never
                    moves the page. A static danger notice; the section body's gap
                    spaces it. */}
                <Notice tone="danger" role="note" flush>
                    {t('createWallet.saveThisPassphraseSeparatelyFrom')}
                </Notice>
                <Switch
                    label={t('createWallet.useABip39PassphraseAdvanced')}
                    help={t('createWallet.thisExtraSecretCombinesWith')}
                    checked={showPassphrase}
                    onChange={(e) => {
                        setShowPassphrase(e.target.checked);
                        if (!e.target.checked) {
                            setBip39Passphrase('');
                            setBip39PassphraseConfirm('');
                            // The passphrase fields are off, so their problems go too.
                            passwordErrors.clear('create-bip39-passphrase');
                            passwordErrors.clear('create-bip39-confirm');
                        }
                    }}
                />
                <Input
                    id="create-bip39-passphrase"
                    type="password"
                    label={t('importWallet.passphrase.label')}
                    help={t('createWallet.requiredWhenEnabled')}
                    value={bip39Passphrase}
                    disabled={!showPassphrase}
                    onChange={(e) => setBip39Passphrase(e.target.value)}
                    autoComplete="off"
                />
                <Input
                    id="create-bip39-confirm"
                    type="password"
                    label={t('settings.duress.confirmPassphrase')}
                    help={t('createWallet.confirmPassphraseHelp')}
                    value={bip39PassphraseConfirm}
                    disabled={!showPassphrase}
                    onChange={(e) => setBip39PassphraseConfirm(e.target.value)}
                    autoComplete="off"
                />
            </FormSection>
        </FormPage>
    );

    return (
        <Screen variant={variant} header={screenHeader}>
            {formBody}
        </Screen>
    );
}
