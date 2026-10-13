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
import {
    Screen,
    Button,
    FormPage,
    Input,
    Select,
    Icon,
    ListPage,
    QrScanner,
    StatusMessage,
    InfoTip,
    FormErrorSummary,
} from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useToast } from '../components/ToastHost.jsx';
import { AdsNotice } from '../components/AdsNotice.jsx';
import { useDropZone } from '../hooks/useDropZone.js';
import { useSupportedChains } from '../hooks/useSupportedChains.js';
import { detectQrContent } from '../../uri/detectQrContent.js';
import { englishWordlist, isValidBip39Mnemonic } from '../../crypto/mnemonic.js';
import {
    COUNTERWALLET_WORDLIST,
    isValidCounterwalletMnemonic,
} from '../../crypto/counterwallet.js';
// The flows this screen calls throw function-prefixed preconditions
// ("importMnemonic: mnemonic is required"), and `|| fallback` only fires on an
// EMPTY message, so those reached the recovery screen verbatim.
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { takeForgotPasswordRestoreLane } from '../utils/forgotPasswordRecovery.js';
import { ClipboardPasteButton } from '../../ui/ClipboardPasteButton.jsx';
import { useBackHandler } from '../../ui/backStack.js';
// The three password fields, their hints, and the copy for every way
// a restore can fail, all from one place so a message can never name a field
// this screen does not show.
import {
    RESTORE_PASSWORD_INTRO,
    RESTORE_PASSWORD_LABELS,
    RESTORE_PASSWORD_HINTS,
    restoreDeviceHint,
    restoreDeviceLabel,
    restoreFailureMessage,
    restorePasswordRequiredMessage,
} from '../../flows/restorePasswordCopy.js';
import styles from './ImportWallet.module.css';
import pickerStyles from './WalletPicker.module.css';
import { t } from '../../i18n/index.js';

const MIN_PASSWORD_LENGTH = 8;
const ACCEPTED_WORD_COUNTS = [12, 15, 18, 21, 24];
const BIP39_WORDS = new Set(englishWordlist);
const COUNTERWALLET_WORDS = new Set(COUNTERWALLET_WORDLIST);
const MAX_WORD_SUGGESTIONS = 5;

function normalizePhraseEntry(value) {
    return typeof value === 'string'
        ? value.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ')
        : '';
}

function phraseFormat(value) {
    if (isValidBip39Mnemonic(value)) return 'bip39';
    if (isValidCounterwalletMnemonic(value)) return 'counterwallet';
    return null;
}

function phraseValidationMessage(value) {
    const words = value.split(' ');
    const unknownWord = words.find((word) => !BIP39_WORDS.has(word) && !COUNTERWALLET_WORDS.has(word));
    if (unknownWord) {
        return `Unknown recovery phrase word "${unknownWord}". Check its spelling.`;
    }
    if (words.every((word) => BIP39_WORDS.has(word))) {
        return 'Every word is in the BIP39 list, but the checksum does not match. Check the word order and spelling.';
    }
    const nonBip39Word = words.find((word) => !BIP39_WORDS.has(word));
    return `This is not a valid BIP39 or Counterwallet/FreeWallet recovery phrase. Check "${nonBip39Word}" and the other words.`;
}

function wordRangeAt(value, cursor) {
    const safeCursor = Math.min(Math.max(cursor, 0), value.length);
    let start = safeCursor;
    let end = safeCursor;
    while (start > 0 && !/\s/.test(value[start - 1])) start -= 1;
    while (end < value.length && !/\s/.test(value[end])) end += 1;
    return { start, end, prefix: value.slice(start, safeCursor).toLowerCase() };
}

// The one restore error that IS about the file rather than a password, and so
// the only one the Browse affordance belongs on.
const NO_BACKUP_CONTENT_MESSAGE = 'Pick a backup file, paste its contents, or scan a backup pointer.';

/**
 * One line for the toast after an import, or null when there is nothing to
 * say. Only a restore that actually wrote something earns a message: a seed
 * that never published, a chain that was unreachable, and a payload whose
 * every record already matched all read as "nothing restored" to the user.
 *
 * @param {{ restored?: boolean, contactsAdded?: number, contactsUpdated?: number, addressesUpdated?: number } | null | undefined} labelSync
 * @returns {string | null}
 */
function labelSyncRestoredMessage(labelSync) {
    if (!labelSync || labelSync.restored !== true) return null;
    const contacts = Number(labelSync.contactsAdded || 0) + Number(labelSync.contactsUpdated || 0);
    const labels = Number(labelSync.addressesUpdated || 0);
    if (contacts === 0 && labels === 0) return null;
    const parts = [];
    if (contacts > 0) parts.push(contacts === 1 ? '1 contact' : `${contacts} contacts`);
    if (labels > 0) parts.push(labels === 1 ? '1 address label' : `${labels} address labels`);
    return `Restored ${parts.join(' and ')} from your published labels.`;
}

/**
 * Import an existing wallet via mnemonic. Accepts BIP39 (12/15/18/21/24
 * words) and Counterwallet-legacy (12 words). The core
 * `importMnemonic` flow auto-detects format.
 *
 * When `variant="freewallet"` (§40.13), the form rebrands for users
 * migrating from FreeWallet: title + copy call out FreeWallet
 * explicitly, the default wallet name is "FreeWallet", and the
 * word-count validator tightens to 12 (FreeWallet only ever used a
 * 12-word Counterwallet mnemonic). The import path is otherwise
 * identical. The format detector still dispatches to the
 * Counterwallet-legacy or BIP39 code path as appropriate.
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {() => void} props.onImported             refreshes App.jsx state
 * @param {'default' | 'freewallet'} [props.variant]
 * @param {'fresh' | 'add'} [props.mode]   'fresh' → first wallet (pre-host `wallet.import`); 'add' → adds to an open vault (`wallet.add.import`). Defaults to 'fresh'.
 * @param {'mnemonic' | 'backup'} [props.initialLane]
 * @param {(state: { lane: 'mnemonic' | 'backup' }) => void} [props.onOpenInTab]
 */
export function ImportWallet({
    onBack,
    onImported,
    variant: importVariant = 'default',
    mode = 'fresh',
    initialLane = 'mnemonic',
    onOpenInTab,
}) {
    // S4: The phrase is TYPED here, and a keyboard-visible screen recording is
    // as good as a screenshot of it.
    // No-op on every shell that installs no screen guard (web, extension,
    // desktop): a browser tab cannot stop a screenshot and must not pretend to.
    useProtectedScreen();

    const { messaging, shell } = useMessaging();
    const { showToast } = useToast();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const isFreeWallet = importVariant === 'freewallet';
    const acceptedWordCounts = isFreeWallet ? [12] : ACCEPTED_WORD_COUNTS;
    // Recovery phrase, private-key, and encrypted-backup imports share this
    // route. The FreeWallet variant stays pinned to its recovery phrase.
    const [lane, setLane] = useState(() =>
        /** @type {'mnemonic' | 'wif' | 'backup'} */ (
            !isFreeWallet && takeForgotPasswordRestoreLane(initialLane) === 'backup'
                ? 'backup'
                : 'mnemonic'
        ),
    );
    const [name, setName] = useState(isFreeWallet ? 'FreeWallet' : 'Imported Wallet');
    const [mnemonic, setMnemonic] = useState('');
    const [mnemonicCursor, setMnemonicCursor] = useState(0);
    const [wif, setWif] = useState('');
    const [wifChainId, setWifChainId] = useState('bitcoin-mainnet');
    const [wifWarningAck, setWifWarningAck] = useState(false);
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [backupContent, setBackupContent] = useState('');
    const [backupPassword, setBackupPassword] = useState('');
    // Three different secrets reach the restore, and conflating any
    // two of them produces a wallet that restores looking complete and then
    // cannot sign. `backupPassword` opens the FILE. `backupWalletPassword`
    // opens the WALLET's own seal, which travelled inside the file sealed
    // under whatever password it had on its old device. `backupDevicePassword`
    // is what this device unlocks with, and the seal is moved onto it.
    const [backupWalletPassword, setBackupWalletPassword] = useState('');
    const [backupDevicePassword, setBackupDevicePassword] = useState('');
    const [backupOverwrite, setBackupOverwrite] = useState(false);
    const [backupFileName, setBackupFileName] = useState(/** @type {string | null} */ (null));
    // §15.4 QR-from-backup-pointer restore. When a scanned QR classifies
    // as a `backup-pointer`, we stash the parsed pointer here and the
    // backup lane switches from "decode this file content" to "resolve
    // this pointer, then decode". The backup password field is shared:
    // the envelope stays password-encrypted either way.
    const [backupScanning, setBackupScanning] = useState(false);
    const [backupPointer, setBackupPointer] = useState(/** @type {import('../../uri/backupPointer.js').BackupPointer | null} */ (null));
    // §15.6: optional 25th-word BIP39 passphrase. Hidden behind a toggle so
    // users who never set one don't have to read the warning copy.
    // FreeWallet imports follow the Counterwallet legacy code path, which
    // rejects a passphrase, so we don't expose the toggle there.
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [bip39Passphrase, setBip39Passphrase] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [validationAttempt, setValidationAttempt] = useState(0);
    const [busy, setBusy] = useState(false);
    // §36.1: an import ends on the same ADS notice a created wallet does,
    // and only its Continue hands control back to App.
    const [adsNotice, setAdsNotice] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const textareaRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
    const headingRef = useRef(/** @type {HTMLHeadingElement | null} */ (null));
    const adsContinuedRef = useRef(false);
    const wifChains = useSupportedChains().filter(
        (descriptor) => Number.isInteger(descriptor.wifVersionByte),
    );

    useEffect(() => {
        headingRef.current?.focus();
    }, [lane]);

    useBackHandler(handleBack, busy);

    function handleBack() {
        setMnemonic('');
        setMnemonicCursor(0);
        setPassword('');
        setConfirm('');
        setBip39Passphrase('');
        setBackupContent('');
        setBackupPassword('');
        setBackupWalletPassword('');
        setBackupDevicePassword('');
        setBackupFileName(null);
        setBackupPointer(null);
        setBackupScanning(false);
        setScanning(false);
        setError(null);
        onBack();
    }

    function handleQrFrame(text) {
        if (typeof text !== 'string' || text.length === 0) return;
        // Strip an optional `bip39:` prefix that some QR generators emit.
        const cleaned = normalizePhraseEntry(text.replace(/^\s*bip39:\s*/i, ''));
        setMnemonic(cleaned);
        setMnemonicCursor(cleaned.length);
        setScanning(false);
        if (error) setError(null);
    }

    function handleMnemonicPaste(event) {
        const pasted = event.clipboardData?.getData('text');
        const normalized = normalizePhraseEntry(pasted);
        if (normalized.split(' ').length < 2) return;
        event.preventDefault();
        const textarea = event.currentTarget;
        const start = textarea.selectionStart ?? mnemonic.length;
        const end = textarea.selectionEnd ?? start;
        const combined = normalizePhraseEntry(
            `${mnemonic.slice(0, start)} ${normalized} ${mnemonic.slice(end)}`,
        );
        setMnemonic(combined);
        setMnemonicCursor(combined.length);
        if (error) setError(null);
    }

    // Encrypted-backup drop zone (same .xchain-wallet / JSON / text MIME
    // set the file picker accepts; reads the content as text and seeds
    // the existing backupContent state so the rest of the lane behaves
    // identically to a click-to-pick.
    const backupDrop = useDropZone({
        accept: ['.xchain-wallet', 'application/json', '.json', 'text/plain', '.txt'],
        readAs: 'text',
        disabled: busy,
        onError: setError,
        onFile: ({ file, content }) => {
            setBackupPointer(null);
            setBackupScanning(false);
            setBackupFileName(file.name);
            setBackupContent(typeof content === 'string' ? content : '');
            if (error) setError(null);
        },
    });

    // Classify a QR frame scanned in the backup lane. Only a backup
    // pointer is actionable here; a scanned mnemonic / WIF / address is
    // rejected with a hint (those belong to the recovery-phrase lane and
    // we never silently import secret material from a stray scan).
    function handleBackupQrFrame(text) {
        if (typeof text !== 'string' || text.trim().length === 0) return;
        const detected = detectQrContent(text.trim());
        if (detected.type === 'backup-pointer') {
            setBackupContent('');
            setBackupFileName(null);
            setBackupPointer(detected.pointer);
            setBackupScanning(false);
            if (error) setError(null);
            return;
        }
        setBackupScanning(false);
        setError('That QR code is not a backup pointer. Use Recovery phrase for a recovery phrase or private-key QR code.');
    }

    function clearBackupPointer() {
        setBackupPointer(null);
        if (error) setError(null);
    }

    async function handleBackupSubmit(event) {
        event.preventDefault();
        setValidationAttempt((attempt) => attempt + 1);
        if (busy) return;
        const usingPointer = backupPointer !== null;
        if (!usingPointer && backupContent.trim().length === 0) {
            setError(NO_BACKUP_CONTENT_MESSAGE);
            return;
        }
        //Checked here rather than only in core so the user
        // is told which field is empty, BY THE NAME ON THAT FIELD, instead of
        // reading a flow-level throw about a parameter they cannot see.
        if (backupPassword.length === 0) {
            setError(restorePasswordRequiredMessage('file', mode));
            return;
        }
        if (backupWalletPassword.length === 0) {
            setError(restorePasswordRequiredMessage('wallet', mode));
            return;
        }
        if (backupDevicePassword.length === 0) {
            setError(restorePasswordRequiredMessage('device', mode));
            return;
        }
        const conflictArg = backupOverwrite ? 'overwrite' : 'error';
        setError(null);
        setBusy(true);
        try {
            // A fresh install has no vault, so it has no host, so the
            // host-registered restore has nothing to answer it. `fresh` goes to
            // the pre-host lane, which creates the vault under the new device
            // password and then merges. Same core flow underneath either way;
            // the mnemonic lane above splits on exactly the same seam.
            if (mode === 'fresh') {
                if (typeof messaging.importBackupFresh !== 'function') {
                    setError('Restoring a backup onto a fresh install is not available in this shell.');
                    setBusy(false);
                    return;
                }
                await messaging.importBackupFresh({
                    password: backupDevicePassword,
                    backupPassword,
                    walletPassword: backupWalletPassword,
                    ...(usingPointer ? { pointer: backupPointer } : { fileContent: backupContent }),
                });
                setAdsNotice(true);
                return;
            }
            if (usingPointer) {
                if (typeof messaging.importBackupPointerRequest !== 'function') {
                    setError('Backup-pointer restore is not available in this shell.');
                    setBusy(false);
                    return;
                }
                await messaging.importBackupPointerRequest({
                    pointer: backupPointer,
                    password: backupPassword,
                    walletPassword: backupWalletPassword,
                    devicePassword: backupDevicePassword,
                    onConflict: conflictArg,
                    mode,
                });
            } else {
                if (typeof messaging.importBackupRequest !== 'function') {
                    setError('Backup restore is not available in this shell.');
                    setBusy(false);
                    return;
                }
                await messaging.importBackupRequest({
                    fileContent: backupContent,
                    password: backupPassword,
                    // The seal travels with the record, so it has to
                    // be opened with the wallet's old password and moved onto
                    // this device's before anything is written.
                    walletPassword: backupWalletPassword,
                    devicePassword: backupDevicePassword,
                    onConflict: conflictArg,
                    // §19.4 / Cluster H FOLLOWUP 3: 'add' mode tells the
                    // host to re-mint wallet / account / address ids so
                    // the restored wallet coexists with what's in the
                    // vault already (vs the default 'fresh' import that
                    // keeps the original ids).
                    mode,
                });
            }
            setAdsNotice(true);
        } catch (err) {
            // A restore has three passwords in play, so "wrong
            // password" is never an answer. Whatever came back, the screen
            // says which of the three boxes it is talking about.
            setError(userFacingMessage(
                restoreFailureMessage(err, { mode }),
                'That backup could not be restored. Check the backup file and try again.',
            ));
            setBusy(false);
        }
    }

    // Cluster H FOLLOWUP 2: image-QR drop branch. The mnemonic
    // dropzone keeps its plain-text fast path for `.txt` / `.asc` /
    // `text/*` MIME types, but now also accepts a printed-paper-wallet
    // photo: PNG / JPEG renders into a canvas, the global
    // `BarcodeDetector` (Chrome / Edge / Android Chrome) extracts a
    // `qr_code` rawValue, and the result feeds `handleQrFrame` so the
    // mnemonic textarea fills exactly the way a live `<QrScanner>`
    // capture would. Browsers without `BarcodeDetector` (Safari /
    // Firefox today) surface a friendly hint instead of silently
    // failing. PDFs are still out of scope (they need a third-party
    // PDF render layer.
    function handleFileDrop(event) {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;

        const isImage = (file.type && file.type.startsWith('image/'))
            || /\.(png|jpe?g)$/i.test(file.name);
        if (isImage) {
            if (typeof globalThis.BarcodeDetector !== 'function') {
                setError('Image-QR decoding requires a browser with BarcodeDetector support. Try Chrome or Edge, or use the Scan QR button instead.');
                return;
            }
            decodeImageQrFile(file)
                .then((text) => {
                    if (typeof text === 'string' && text.length > 0) {
                        handleQrFrame(text);
                    } else {
                        setError('No QR code found in the dropped image.');
                    }
                })
                .catch((err) => {
                    setError(userFacingMessage(err, 'Could not decode QR from the dropped image.'));
                });
            return;
        }

        // Plain-text path. PDFs and unknown MIME types fall through here
        // and surface an explicit rejection rather than a silent miss.
        if (file.type && !file.type.startsWith('text/') && !/\.(txt|asc)$/i.test(file.name)) {
            setError('Only plain-text files (.txt / .asc) or QR images (.png / .jpg) can be dropped here.');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const raw = typeof reader.result === 'string' ? reader.result : '';
            // Strip common surrounding text; many users paste a paragraph
            // they wrote around the seed. We pick the longest line whose
            // tokens look like wordlist words.
            const candidate = raw
                .split(/\r?\n/)
                .map((line) => line.trim().replace(/\s+/g, ' '))
                .filter((line) => /^[a-zA-Z\s]+$/.test(line) && line.split(' ').length >= 12)
                .sort((a, b) => b.length - a.length)[0];
            setMnemonic((candidate || raw).trim());
            if (error) setError(null);
        };
        reader.onerror = () => {
            setError('Could not read the dropped file.');
        };
        reader.readAsText(file);
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setValidationAttempt((attempt) => attempt + 1);
        if (busy) return;
        const trimmed = normalizePhraseEntry(mnemonic);
        if (trimmed.length === 0) {
            setError('Enter a recovery phrase.');
            return;
        }
        const wordCount = trimmed.split(' ').length;
        if (!acceptedWordCounts.includes(wordCount)) {
            const expected = acceptedWordCounts.join(', ');
            setError(`Expected ${expected} word${acceptedWordCounts.length === 1 ? '' : 's'}, got ${wordCount}.`);
            return;
        }
        if (!phraseFormat(trimmed)) {
            setError(phraseValidationMessage(trimmed));
            return;
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
        }
        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }
        // A checked box with an empty field used to collapse to "no
        // passphrase" and silently derive the passphrase-less wallet, the
        // same wrong addresses the user was ticking the box to avoid. The
        // box is a claim that a passphrase exists, so an empty one is a
        // contradiction to refuse, not a default to fill in.
        if (!isFreeWallet && showPassphrase && bip39Passphrase.length === 0) {
            setError('Enter the BIP39 passphrase, or uncheck the box if this wallet does not use one.');
            return;
        }
        setError(null);
        setBusy(true);
        try {
            const passphraseArg = !isFreeWallet && showPassphrase
                ? bip39Passphrase
                : '';
            let result;
            if (mode === 'add') {
                if (typeof messaging.addImportedWallet !== 'function') {
                    throw new Error('messaging.addImportedWallet is not available in this shell.');
                }
                result = await messaging.addImportedWallet({ password, mnemonic: trimmed, name, bip39Passphrase: passphraseArg });
            } else {
                result = await messaging.importMnemonic({ password, mnemonic: trimmed, name, bip39Passphrase: passphraseArg });
            }
            finishWalletImport();
            const showRestoredLabels = (labelSync) => {
                const restoredMessage = labelSyncRestoredMessage(labelSync);
                if (restoredMessage) showToast({ message: restoredMessage });
                // Home reads labels when it mounts. If the user has already
                // continued past the notice, refresh it after the vault write.
                if (labelSync?.restored && adsContinuedRef.current) onImported();
            };
            if (result?.labelSyncToken && typeof messaging.labelSyncRestoreResult === 'function') {
                void messaging.labelSyncRestoreResult({ token: result.labelSyncToken })
                    .then(showRestoredLabels)
                    .catch(() => { /* the import already succeeded */ });
            } else {
                showRestoredLabels(result?.labelSync);
            }
        } catch (err) {
            setError(userFacingMessage(err, 'Could not import the wallet.'));
            setBusy(false);
        }
    }

    function finishWalletImport() {
        setAdsNotice(true);
    }

    async function handleWifSubmit(event) {
        event.preventDefault();
        if (busy) return;
        const trimmedWif = wif.trim();
        if (trimmedWif.length === 0) {
            setError('WIF private key is required.');
            return;
        }
        if (!wifChainId) {
            setError('Pick the chain this private key belongs to.');
            return;
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
        }
        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }
        if (!wifWarningAck) {
            setError('Acknowledge the backup warning before importing this private key.');
            return;
        }
        if (typeof messaging.importMnemonic !== 'function') {
            setError('Private-key import is not available in this shell.');
            return;
        }
        setError(null);
        setBusy(true);
        try {
            await messaging.importMnemonic({
                password,
                wif: trimmedWif,
                chainId: wifChainId,
                name,
            });
            finishWalletImport();
        } catch (err) {
            setError(userFacingMessage(
                err,
                'Could not import that private key. Check the key and the chain, then try again.',
            ));
            setBusy(false);
        }
    }

    const headClass = isFull ? styles.headFull : styles.headPopup;
    const titleClass = isFull ? styles.titleFull : styles.titlePopup;
    const subtitleClass = isFull ? styles.subtitleFull : styles.subtitlePopup;
    const mnemonicClass = isFull ? styles.mnemonicFull : styles.mnemonicPopup;
    const actionsClass = isFull ? styles.actionsFull : styles.actionsPopup;
    const backupSourceMessage = backupDrop.isDragOver
        ? 'Drop the backup file here.'
        : backupFileName
            ? `Loaded ${backupFileName} (${backupContent.length.toLocaleString()} bytes).`
            : backupContent.trim().length > 0
                ? `Backup contents pasted (${backupContent.length.toLocaleString()} bytes).`
                : 'Choose or drop a backup file onto the box below, paste its contents, or scan a backup pointer.';
    const normalizedMnemonic = normalizePhraseEntry(mnemonic);
    const mnemonicWordCount = normalizedMnemonic.length === 0
        ? 0
        : normalizedMnemonic.split(' ').length;
    const detectedPhraseFormat = phraseFormat(normalizedMnemonic);
    const activeWord = wordRangeAt(mnemonic, mnemonicCursor);
    const wordSuggestions = activeWord.prefix.length < 2 || BIP39_WORDS.has(activeWord.prefix)
        ? []
        : englishWordlist
            .filter((word) => word.startsWith(activeWord.prefix))
            .slice(0, MAX_WORD_SUGGESTIONS);

    function useWordSuggestion(word) {
        const before = mnemonic.slice(0, activeWord.start);
        const after = mnemonic.slice(activeWord.end);
        const separator = after.length === 0 ? ' ' : '';
        const next = `${before}${word}${separator}${after}`;
        const nextCursor = activeWord.start + word.length + separator.length;
        setMnemonic(next);
        setMnemonicCursor(nextCursor);
        if (error) setError(null);
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
        });
    }

    const laneSwitcher = !isFreeWallet ? (
        <div className={styles.laneSwitcher} role="tablist" aria-label={t('importWallet.lane')}>
            <button
                type="button"
                role="tab"
                aria-selected={lane === 'mnemonic'}
                className={`${styles.laneTab} ${lane === 'mnemonic' ? styles.laneTabActive : ''}`}
                onClick={() => { setLane('mnemonic'); setError(null); }}
                disabled={busy}
            >
                {t('importWallet.recoveryPhrase')}
            </button>
            {mode === 'fresh' ? (
                <button
                    type="button"
                    role="tab"
                    aria-selected={lane === 'wif'}
                    className={`${styles.laneTab} ${lane === 'wif' ? styles.laneTabActive : ''}`}
                    onClick={() => { setLane('wif'); setError(null); }}
                    disabled={busy}
                >
                    {t('importWallet.wif.tab')}
                </button>
            ) : null}
            <button
                type="button"
                role="tab"
                aria-selected={lane === 'backup'}
                className={`${styles.laneTab} ${lane === 'backup' ? styles.laneTabActive : ''}`}
                onClick={() => { setLane('backup'); setError(null); }}
                disabled={busy}
            >
                {t('importWallet.encryptedBackup')}
            </button>
        </div>
    ) : null;

    const formDisabledReason = lane === 'backup'
        ? backupPointer === null && backupContent.trim().length === 0
            ? 'Choose a backup file, paste its contents, or scan a backup pointer to continue.'
            : backupPassword.length === 0
                ? `Enter the ${RESTORE_PASSWORD_LABELS.file.toLowerCase()} to continue.`
                : backupWalletPassword.length === 0
                    ? `Enter the ${RESTORE_PASSWORD_LABELS.wallet.toLowerCase()} to continue.`
                    : backupDevicePassword.length === 0
                        ? `Enter the ${restoreDeviceLabel(mode).toLowerCase()} to continue.`
                        : null
        : lane === 'wif'
        ? wif.trim().length === 0
            ? 'Enter a private key to continue.'
            : password.length === 0
                ? 'Enter a password to continue.'
                : confirm.length === 0
                    ? 'Confirm your password to continue.'
                    : null
        : mnemonic.trim().length === 0
            ? 'Enter a recovery phrase to continue.'
            : password.length === 0
                ? 'Enter a password to continue.'
                : confirm.length === 0
                    ? 'Confirm your password to continue.'
                    : null;
    const lowerError = String(error || '').toLowerCase();
    let importErrorTarget;
    if (lane === 'backup') {
        if (error === NO_BACKUP_CONTENT_MESSAGE) {
            importErrorTarget = { id: 'xc-backup-content', label: 'Backup file contents' };
        } else if (lowerError.includes(RESTORE_PASSWORD_LABELS.file.toLowerCase())) {
            importErrorTarget = { id: 'import-backup-file-password', label: RESTORE_PASSWORD_LABELS.file };
        } else if (lowerError.includes(RESTORE_PASSWORD_LABELS.wallet.toLowerCase())) {
            importErrorTarget = { id: 'import-backup-wallet-password', label: RESTORE_PASSWORD_LABELS.wallet };
        } else if (lowerError.includes(restoreDeviceLabel(mode).toLowerCase())) {
            importErrorTarget = { id: 'import-backup-device-password', label: restoreDeviceLabel(mode) };
        }
    } else if (/recovery phrase|expected .*word|mnemonic/i.test(error || '')) {
        importErrorTarget = { id: 'xc-mnemonic', label: 'Recovery phrase' };
    } else if (/at least .* characters/i.test(error || '')) {
        importErrorTarget = { id: 'import-password', label: 'Password' };
    } else if (/Passwords do not match/i.test(error || '')) {
        importErrorTarget = { id: 'import-confirm', label: 'Confirm password' };
    } else if (/BIP39 passphrase/i.test(error || '')) {
        importErrorTarget = { id: 'import-bip39-passphrase', label: 'BIP39 passphrase' };
    }
    const importErrors = error ? [{ ...importErrorTarget, message: error }] : [];
    const formStatus = error ? (
        <FormErrorSummary
            errors={importErrors}
            focusKey={validationAttempt}
            recovery={
                // Anchored on the "no file yet" message
                // itself. It used to fire on any error mentioning
                // "backup file", which now includes the wrong-password
                // copy - offering Browse to a user whose file is fine
                // sends them to fix the wrong thing.
                lane === 'backup' && error === NO_BACKUP_CONTENT_MESSAGE
                    ? { label: t('importWallet.browse'), onAction: backupDrop.openFilePicker }
                    : undefined
            }
        />
    ) : formDisabledReason ? (
        <StatusMessage id="import-wallet-disabled-reason">
            {formDisabledReason}
        </StatusMessage>
    ) : null;

    const formActions = lane === 'backup' ? (
        <Button
            type="submit"
            variant="primary"
            loading={busy}
            icon={<Icon.KeyIcon />}
            disabled={Boolean(formDisabledReason)}
            aria-describedby={formDisabledReason ? 'import-wallet-disabled-reason' : undefined}
        >
            {busy ? t('importWallet.restoring') : t('send.draft.restore')}
        </Button>
    ) : lane === 'wif' ? (
        <Button
            type="submit"
            variant="primary"
            loading={busy}
            icon={<Icon.KeyIcon />}
            disabled={Boolean(formDisabledReason)}
            aria-describedby={formDisabledReason ? 'import-wallet-disabled-reason' : undefined}
        >
            {busy ? t('importWallet.importing') : t('importWallet.import')}
        </Button>
    ) : (
        <Button
            type="submit"
            variant="primary"
            loading={busy}
            icon={<Icon.KeyIcon />}
            disabled={Boolean(formDisabledReason)}
            aria-describedby={formDisabledReason ? 'import-wallet-disabled-reason' : undefined}
        >
            {busy ? t('importWallet.importing') : t('importWallet.import')}
        </Button>
    );

    const form = (
        <FormPage
            label={t('importWallet.title')}
            onSubmit={lane === 'backup'
                ? handleBackupSubmit
                : lane === 'wif'
                    ? handleWifSubmit
                    : handleSubmit}
            status={formStatus}
            actions={formActions}
        >
            <header className={headClass}>
                <h1 ref={headingRef} tabIndex={-1} className={titleClass}>
                    {isFreeWallet
                        ? (isFull ? t('importWallet.freeWallet.fullTitle') : t('importWallet.freeWallet.title'))
                        : lane === 'backup'
                            ? (isFull ? t('importWallet.backup.fullTitle') : t('importWallet.backup.title'))
                            : lane === 'wif'
                                ? (isFull ? t('importWallet.wif.fullTitle') : t('importWallet.wif.title'))
                            : (isFull ? t('importWallet.existing.fullTitle') : t('importWallet.title'))}
                </h1>
                <p className={subtitleClass}>
                    {isFreeWallet
                        ? (isFull
                            ? t('importWallet.freeWallet.fullSubtitle')
                            : t('importWallet.freeWallet.subtitle'))
                        : lane === 'backup'
                            ? (isFull
                                ? (mode === 'add'
                                    ? t('importWallet.backup.addFullSubtitle')
                                    // It used to say "the password",
                                    // singular, one line above three password
                                    // boxes.
                                    : t('importWallet.backup.replaceFullSubtitle'))
                                : (mode === 'add'
                                    ? t('importWallet.backup.addSubtitle')
                                    : t('importWallet.backup.replaceSubtitle')))
                            : lane === 'wif'
                                ? t('importWallet.wif.subtitle')
                            : (isFull
                                ? t('importWallet.phrase.fullSubtitle')
                                : t('importWallet.phrase.subtitle'))}
                </p>
            </header>
            {laneSwitcher}
            {lane === 'backup' ? (
                <>
                    <div className={styles.mnemonicHeader}>
                        <label className={styles.mnemonicLabel} htmlFor="xc-backup-file">
                            {t('importWallet.backup.file')}
                        </label>
                        <button
                            type="button"
                            className={styles.scanButton}
                            onClick={() => {
                                setBackupScanning((s) => !s);
                                if (error) setError(null);
                            }}
                            disabled={busy}
                            aria-pressed={backupScanning}
                            aria-expanded={backupScanning}
                            aria-controls="xc-backup-scanner"
                        >
                            {backupScanning ? t('importWallet.cancelScan') : t('importWallet.scanPointerQr')}
                        </button>
                    </div>
                    {backupScanning ? (
                        <div id="xc-backup-scanner" className={styles.scannerBox}>
                            <QrScanner onFrame={handleBackupQrFrame} alt={t('importWallet.backup.scannerAlt')} />
                        </div>
                    ) : null}
                    {backupPointer ? (
                        <div className={styles.backupPointerCard} role="status">
                            <p className={styles.backupHint}>
                                {t('importWallet.backup.pointerLoaded', {
                                    name: backupPointer.name ? `: ${backupPointer.name}` : '',
                                })}
                                {' '}{t('importWallet.backup.location', { location: backupPointer.location })}
                            </p>
                            <button
                                type="button"
                                className={styles.scanButton}
                                onClick={clearBackupPointer}
                                disabled={busy}
                            >
                                {t('importWallet.backup.useFile')}
                            </button>
                        </div>
                    ) : (
                        <>
                    <input
                        {...backupDrop.pickerProps}
                        id="xc-backup-file"
                        aria-label={t('importWallet.backup.file')}
                        aria-describedby="xc-backup-source-status"
                        disabled={busy}
                    />
                    <button
                        type="button"
                        className={styles.backupFileButton}
                        onClick={backupDrop.openFilePicker}
                        disabled={busy}
                    >
                        {t('importWallet.backup.chooseFile')}
                    </button>
                    <p id="xc-backup-source-status" className={styles.backupHint} aria-live="polite">
                        {backupSourceMessage}
                    </p>
                    <label className={styles.mnemonicLabel} htmlFor="xc-backup-content">
                        {t('importWallet.backup.contents')}
                    </label>
                    <textarea
                        id="xc-backup-content"
                        {...backupDrop.rootProps}
                        className={`${mnemonicClass}${backupDrop.isDragOver ? ` ${styles.dropZoneActive}` : ''}`}
                        value={backupContent}
                        onChange={(e) => {
                            setBackupContent(e.target.value);
                            if (e.target.value !== backupContent) setBackupFileName(null);
                            if (error) setError(null);
                        }}
                        placeholder={`{${t('importWallet.backup.placeholder.version')}{${t('importWallet.backup.placeholder.kdf')}`}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        autoComplete="off"
                        rows={4}
                        disabled={busy}
                        aria-describedby="xc-backup-source-status"
                    />
                        </>
                    )}
                    {/*. The copy has to earn each of these:
                        three password fields on one screen is exactly where
                        users give up, and the reason they are all here is that
                        the backup carries a sealed wallet, not a plain one. So
                        the screen says that out loud BEFORE the three boxes: a
                        user who does not know there are three roles reads the
                        second and third fields as the app asking twice. */}
                    <p className={styles.backupHint}>
                        {RESTORE_PASSWORD_INTRO}
                    </p>
                    <Input
                        id="import-backup-file-password"
                        type="password"
                        label={RESTORE_PASSWORD_LABELS.file}
                        hint={RESTORE_PASSWORD_HINTS.file}
                        value={backupPassword}
                        onChange={(e) => {
                            setBackupPassword(e.target.value);
                            if (error) setError(null);
                        }}
                        autoComplete="off"
                        disabled={busy}
                    />
                    <Input
                        id="import-backup-wallet-password"
                        type="password"
                        label={RESTORE_PASSWORD_LABELS.wallet}
                        hint={RESTORE_PASSWORD_HINTS.wallet}
                        value={backupWalletPassword}
                        onChange={(e) => {
                            setBackupWalletPassword(e.target.value);
                            if (error) setError(null);
                        }}
                        autoComplete="off"
                        disabled={busy}
                    />
                    <Input
                        id="import-backup-device-password"
                        type="password"
                        label={restoreDeviceLabel(mode)}
                        hint={restoreDeviceHint(mode)}
                        value={backupDevicePassword}
                        onChange={(e) => {
                            setBackupDevicePassword(e.target.value);
                            if (error) setError(null);
                        }}
                        autoComplete="off"
                        disabled={busy}
                    />
                    <label className={styles.advancedToggle}>
                        <input
                            type="checkbox"
                            checked={backupOverwrite}
                            onChange={(e) => setBackupOverwrite(e.target.checked)}
                            disabled={busy}
                        />
                        <span>{t('importWallet.backup.overwrite')}</span>
                    </label>
                </>
            ) : null}
            {lane === 'mnemonic' ? (
            <>
            <div className={styles.mnemonicHeader}>
                <label className={styles.mnemonicLabel} htmlFor="xc-mnemonic">
                    {t('importWallet.recoveryPhrase')}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <ClipboardPasteButton
                        disabled={busy}
                        label={t('importWallet.pastePhrase')}
                        onPaste={(text) => {
                            const normalized = normalizePhraseEntry(text);
                            setMnemonic(normalized);
                            setMnemonicCursor(normalized.length);
                            if (error) setError(null);
                        }}
                    />
                    <button
                        type="button"
                        className={styles.scanButton}
                        onClick={() => {
                            setScanning((s) => !s);
                            if (error) setError(null);
                        }}
                        disabled={busy}
                        aria-pressed={scanning}
                    >
                        {scanning ? t('importWallet.cancelScan') : t('importWallet.scanQr')}
                    </button>
                </div>
            </div>
            {scanning ? (
                <div className={styles.scannerBox}>
                    <QrScanner onFrame={handleQrFrame} alt={t('importWallet.phrase.scannerAlt')} />
                </div>
            ) : null}
            <div
                className={`${styles.dropZone}${dragOver ? ` ${styles.dropZoneActive}` : ''}`}
                onDragOver={(e) => {
                    e.preventDefault();
                    if (!dragOver) setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
            >
                <textarea
                    id="xc-mnemonic"
                    ref={textareaRef}
                    className={mnemonicClass}
                    value={mnemonic}
                    onChange={(e) => {
                        setMnemonic(e.target.value);
                        setMnemonicCursor(e.target.selectionStart ?? e.target.value.length);
                        if (error) setError(null);
                    }}
                    onPaste={handleMnemonicPaste}
                    onSelect={(e) => setMnemonicCursor(e.currentTarget.selectionStart ?? 0)}
                    onKeyUp={(e) => setMnemonicCursor(e.currentTarget.selectionStart ?? 0)}
                    placeholder={
                        isFull
                            ? t('importWallet.phrase.fullPlaceholder')
                            : t('importWallet.phrase.placeholder')
                    }
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    rows={3}
                    disabled={busy}
                    aria-describedby="xc-mnemonic-status"
                />
                <div id="xc-mnemonic-status" className={styles.phraseMeta} aria-live="polite">
                    <span>
                        {isFreeWallet
                            ? t('importWallet.phrase.freeWalletCount', { count: mnemonicWordCount })
                            : t('importWallet.phrase.wordCount', { count: mnemonicWordCount })}
                    </span>
                    {detectedPhraseFormat === 'bip39' ? <span>{t('importWallet.phrase.bip39Detected')}</span> : null}
                    {detectedPhraseFormat === 'counterwallet' ? <span>{t('importWallet.phrase.counterwalletDetected')}</span> : null}
                </div>
                {wordSuggestions.length > 0 ? (
                    <div className={styles.wordSuggestions} aria-label={t('importWallet.phrase.suggestions')}>
                        {wordSuggestions.map((word) => (
                            <button
                                key={word}
                                type="button"
                                className={styles.wordSuggestion}
                                onClick={() => useWordSuggestion(word)}
                                disabled={busy}
                                aria-label={t('importWallet.phrase.useWord', { word })}
                            >
                                {word}
                            </button>
                        ))}
                    </div>
                ) : null}
                <p className={styles.dropHint}>
                    {dragOver ? t('importWallet.phrase.releaseToLoad') : t('importWallet.phrase.dropHint')}
                </p>
            </div>
            <Input
                label={t('renameWallet.name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                disabled={busy}
            />
            <Input
                id="import-password"
                type="password"
                label={t('common.password')}
                hint={
                    isFull
                        ? t('importWallet.password.fullHint', { count: MIN_PASSWORD_LENGTH })
                        : t('importWallet.password.hint', { count: MIN_PASSWORD_LENGTH })
                }
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                }}
                autoComplete="new-password"
                disabled={busy}
            />
            <Input
                id="import-confirm"
                type="password"
                label={isFull ? t('importWallet.confirmPassword') : t('common.confirm')}
                value={confirm}
                onChange={(e) => {
                    setConfirm(e.target.value);
                    if (error) setError(null);
                }}
                autoComplete="new-password"
                disabled={busy}
            />
            {!isFreeWallet ? (
                <div className={styles.advancedRow}>
                    <label className={styles.advancedToggle}>
                        <input
                            type="checkbox"
                            checked={showPassphrase}
                            onChange={(e) => {
                                setShowPassphrase(e.target.checked);
                                if (!e.target.checked) setBip39Passphrase('');
                            }}
                            disabled={busy}
                        />
                        <span>{t('importWallet.passphrase.toggle')}</span>
                        <InfoTip
                            aria={t('importWallet.passphrase.help')}
                            label={t('importWallet.passphrase.helpBody')}
                        />
                    </label>
                    {showPassphrase ? (
                        <Input
                            id="import-bip39-passphrase"
                            type="password"
                            label={t('importWallet.passphrase.label')}
                            hint={t('importWallet.passphrase.hint')}
                            value={bip39Passphrase}
                            onChange={(e) => {
                                setBip39Passphrase(e.target.value);
                                if (error) setError(null);
                            }}
                            autoComplete="off"
                            disabled={busy}
                        />
                    ) : null}
                </div>
            ) : null}
            </>
            ) : null}
            {lane === 'wif' ? (
                <>
                    <Input
                        type="password"
                        label={t('importWallet.wif.key')}
                        value={wif}
                        onChange={(e) => {
                            setWif(e.target.value);
                            if (error) setError(null);
                        }}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy}
                    />
                    <Select
                        label={t('importWallet.wif.chain')}
                        value={wifChainId}
                        onChange={(e) => {
                            setWifChainId(e.target.value);
                            if (error) setError(null);
                        }}
                        disabled={busy}
                    >
                        {wifChains.map((descriptor) => (
                            <option key={descriptor.id} value={descriptor.id}>
                                {descriptor.displayName} ({descriptor.networkKind})
                            </option>
                        ))}
                    </Select>
                    <Input
                        label={t('renameWallet.name')}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="off"
                        disabled={busy}
                    />
                    <Input
                        type="password"
                        label={t('common.password')}
                        hint={isFull
                            ? t('importWallet.password.fullHint', { count: MIN_PASSWORD_LENGTH })
                            : t('importWallet.password.hint', { count: MIN_PASSWORD_LENGTH })}
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (error) setError(null);
                        }}
                        autoComplete="new-password"
                        disabled={busy}
                    />
                    <Input
                        type="password"
                        label={isFull ? t('importWallet.confirmPassword') : t('common.confirm')}
                        value={confirm}
                        onChange={(e) => {
                            setConfirm(e.target.value);
                            if (error) setError(null);
                        }}
                        autoComplete="new-password"
                        disabled={busy}
                    />
                    <label className={styles.advancedToggle}>
                        <input
                            type="checkbox"
                            checked={wifWarningAck}
                            onChange={(e) => {
                                setWifWarningAck(e.target.checked);
                                if (error) setError(null);
                            }}
                            disabled={busy}
                        />
                        <span>{t('importWallet.wif.ack')}</span>
                    </label>
                </>
            ) : null}
        </FormPage>
    );

    const screenHeader = (
        <div className={pickerStyles.header}>
            <button
                type="button"
                onClick={handleBack}
                className={pickerStyles.iconBtn}
                aria-label={t('importWallet.backToSetup')}
                title={t('importWallet.backToSetup')}
                disabled={busy}
            >
                <Icon.BackIcon />
            </button>
            <span />
            {onOpenInTab ? (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenInTab({ lane })}
                    disabled={busy}
                >
                    {t('importWallet.openInTab')}
                </Button>
            ) : <span />}
        </div>
    );

    const continueAfterNotice = () => {
        adsContinuedRef.current = true;
        onImported();
    };

    if (adsNotice) {
        const noticeBody = (
            <AdsNotice
                onContinue={continueAfterNotice}
                isFull={isFull}
                headClass={headClass}
                titleClass={titleClass}
                subtitleClass={subtitleClass}
                actionsClass={actionsClass}
            />
        );
        return (
            <Screen variant={variant}>
                <ListPage>{noticeBody}</ListPage>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={screenHeader}>
            {form}
        </Screen>
    );
}

// Cluster H FOLLOWUP 2: image-QR decode helper. Loads a dropped
// image into an <img>, paints it onto a same-sized off-screen
// canvas, runs the global BarcodeDetector for `qr_code` formats,
// and returns the first match's rawValue (or null when no match
// exists). All resources are released in a finally so a failure
// midway doesn't leak object URLs. The caller has already verified
// `globalThis.BarcodeDetector` is present.
//
// @param {File} file
// @returns {Promise<string | null>}
async function decodeImageQrFile(file) {
    const url = URL.createObjectURL(file);
    let img = null;
    try {
        img = await loadImageFromUrl(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        if (canvas.width === 0 || canvas.height === 0) {
            throw new Error('Dropped image has no decodable dimensions.');
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not allocate a 2D drawing context.');
        ctx.drawImage(img, 0, 0);
        const detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
        const codes = await detector.detect(canvas);
        if (Array.isArray(codes) && codes.length > 0) {
            const raw = codes[0]?.rawValue;
            return typeof raw === 'string' ? raw : null;
        }
        return null;
    } finally {
        URL.revokeObjectURL(url);
        if (img) img.src = '';
    }
}

// Promise wrapper for HTMLImageElement.onload. Rejects on the next
// tick if the image fails to decode (corrupt PNG / unsupported
// format / etc).
function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load the dropped image.'));
        img.src = url;
    });
}
