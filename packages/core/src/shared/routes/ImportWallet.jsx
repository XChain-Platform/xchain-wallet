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
import { Screen, Button, Input, Icon, QrScanner, StatusMessage, InfoTip } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDropZone } from '../hooks/useDropZone.js';
import { detectQrContent } from '../../uri/detectQrContent.js';
import styles from './ImportWallet.module.css';
import pickerStyles from './WalletPicker.module.css';

const MIN_PASSWORD_LENGTH = 8;
const ACCEPTED_WORD_COUNTS = [12, 15, 18, 21, 24];

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
 */
export function ImportWallet({ onBack, onImported, variant: importVariant = 'default', mode = 'fresh' }) {
    //  S4: The phrase is TYPED here, and a keyboard-visible screen recording is
    // as good as a screenshot of it.
    // No-op on every shell that installs no screen guard (web, extension,
    // desktop): a browser tab cannot stop a screenshot and must not pretend to.
    useProtectedScreen();

    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const isFreeWallet = importVariant === 'freewallet';
    const acceptedWordCounts = isFreeWallet ? [12] : ACCEPTED_WORD_COUNTS;
    // §19.4 / G036: two import lanes: recovery phrase (default) and
    // encrypted-backup restore. FreeWallet variant pins to 'mnemonic'.
    const [lane, setLane] = useState(/** @type {'mnemonic' | 'backup'} */ ('mnemonic'));
    const [name, setName] = useState(isFreeWallet ? 'FreeWallet' : 'Imported Wallet');
    const [mnemonic, setMnemonic] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [backupContent, setBackupContent] = useState('');
    const [backupPassword, setBackupPassword] = useState('');
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
    const [busy, setBusy] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const textareaRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));

    useEffect(() => {
        setTimeout(() => textareaRef.current?.focus(), 0);
    }, []);

    function handleQrFrame(text) {
        if (typeof text !== 'string' || text.length === 0) return;
        // Strip an optional `bip39:` prefix that some QR generators emit.
        const cleaned = text.replace(/^\s*bip39:\s*/i, '').trim();
        setMnemonic(cleaned);
        setScanning(false);
        if (error) setError(null);
    }

    function handleBackupFile(event) {
        const file = event.target?.files?.[0];
        if (!file) return;
        setBackupFileName(file.name);
        const reader = new FileReader();
        reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            setBackupContent(text);
            if (error) setError(null);
        };
        reader.onerror = () => {
            setError('Could not read the selected file.');
        };
        reader.readAsText(file);
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
            setBackupPointer(detected.pointer);
            setBackupScanning(false);
            if (error) setError(null);
            return;
        }
        setBackupScanning(false);
        setError('That QR is not a backup pointer. Use the recovery-phrase lane for a seed or key QR.');
    }

    function clearBackupPointer() {
        setBackupPointer(null);
        if (error) setError(null);
    }

    async function handleBackupSubmit(event) {
        event.preventDefault();
        if (busy) return;
        const usingPointer = backupPointer !== null;
        if (!usingPointer && backupContent.trim().length === 0) {
            setError('Pick a backup file, paste its contents, or scan a backup pointer.');
            return;
        }
        if (backupPassword.length === 0) {
            setError('Backup password is required.');
            return;
        }
        const conflictArg = backupOverwrite ? 'overwrite' : 'error';
        setError(null);
        setBusy(true);
        try {
            if (usingPointer) {
                if (typeof messaging.importBackupPointerRequest !== 'function') {
                    setError('Backup-pointer restore is not available in this shell.');
                    setBusy(false);
                    return;
                }
                await messaging.importBackupPointerRequest({
                    pointer: backupPointer,
                    password: backupPassword,
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
                    onConflict: conflictArg,
                    // §19.4 / Cluster H FOLLOWUP 3: 'add' mode tells the
                    // host to re-mint wallet / account / address ids so
                    // the restored wallet coexists with what's in the
                    // vault already (vs the default 'fresh' import that
                    // keeps the original ids).
                    mode,
                });
            }
            onImported();
        } catch (err) {
            setError(err?.message || 'Failed to restore backup.');
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
                    setError(err?.message || 'Could not decode QR from the dropped image.');
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
        if (busy) return;
        const trimmed = mnemonic.trim().replace(/\s+/g, ' ');
        if (trimmed.length === 0) {
            setError('Recovery phrase is required.');
            return;
        }
        const wordCount = trimmed.split(' ').length;
        if (!acceptedWordCounts.includes(wordCount)) {
            const expected = acceptedWordCounts.join(', ');
            setError(`Expected ${expected} word${acceptedWordCounts.length === 1 ? '' : 's'}, got ${wordCount}.`);
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
        setError(null);
        setBusy(true);
        try {
            const passphraseArg = !isFreeWallet && showPassphrase && bip39Passphrase.length > 0
                ? bip39Passphrase
                : '';
            if (mode === 'add') {
                if (typeof messaging.addImportedWallet !== 'function') {
                    throw new Error('messaging.addImportedWallet is not available in this shell.');
                }
                await messaging.addImportedWallet({ password, mnemonic: trimmed, name, bip39Passphrase: passphraseArg });
            } else {
                await messaging.importMnemonic({ password, mnemonic: trimmed, name, bip39Passphrase: passphraseArg });
            }
            onImported();
        } catch (err) {
            setError(err?.message || 'Failed to import wallet.');
            setBusy(false);
        }
    }

    const headClass = isFull ? styles.headFull : styles.headPopup;
    const titleClass = isFull ? styles.titleFull : styles.titlePopup;
    const subtitleClass = isFull ? styles.subtitleFull : styles.subtitlePopup;
    const mnemonicClass = isFull ? styles.mnemonicFull : styles.mnemonicPopup;
    const actionsClass = isFull ? styles.actionsFull : styles.actionsPopup;

    const laneSwitcher = !isFreeWallet ? (
        <div className={styles.laneSwitcher} role="tablist" aria-label="Import lane">
            <button
                type="button"
                role="tab"
                aria-selected={lane === 'mnemonic'}
                className={`${styles.laneTab} ${lane === 'mnemonic' ? styles.laneTabActive : ''}`}
                onClick={() => { setLane('mnemonic'); setError(null); }}
                disabled={busy}
            >
                Recovery phrase
            </button>
            <button
                type="button"
                role="tab"
                aria-selected={lane === 'backup'}
                className={`${styles.laneTab} ${lane === 'backup' ? styles.laneTabActive : ''}`}
                onClick={() => { setLane('backup'); setError(null); }}
                disabled={busy}
            >
                Encrypted backup
            </button>
        </div>
    ) : null;

    const form = (
        <form onSubmit={lane === 'backup' ? handleBackupSubmit : handleSubmit} noValidate>
            <header className={headClass}>
                <h1 className={titleClass}>
                    {isFreeWallet
                        ? (isFull ? 'Import from FreeWallet' : 'FreeWallet import')
                        : lane === 'backup'
                            ? (isFull ? 'Restore from encrypted backup' : 'Restore backup')
                            : (isFull ? 'Import an existing wallet' : 'Import wallet')}
                </h1>
                <p className={subtitleClass}>
                    {isFreeWallet
                        ? (isFull
                            ? 'Paste your 12-word FreeWallet recovery phrase. We\'ll import it as a Counterwallet-legacy wallet using the same derivation FreeWallet used, so every address matches the one you already know.'
                            : 'Paste your 12-word FreeWallet recovery phrase.')
                        : lane === 'backup'
                            ? (isFull
                                ? (mode === 'add'
                                    ? 'Restore an encrypted backup as a new wallet alongside your existing one(s). The wallet record gets a fresh id at decode time so the two wallets don\'t collide.'
                                    : 'Pick a `.xchain-wallet` file you exported from this app and enter the password you set when you created the backup.')
                                : (mode === 'add'
                                    ? 'Restore as a new wallet (won\'t replace your existing one).'
                                    : 'Pick a backup file and enter its password.'))
                            : (isFull
                                ? 'Enter a BIP39 recovery phrase (12, 15, 18, 21, or 24 words) or a Counterwallet 12-word mnemonic. The format is detected automatically.'
                                : 'Paste a 12-, 15-, 18-, 21-, or 24-word recovery phrase.')}
                </p>
            </header>
            {laneSwitcher}
            {error ? (
                <StatusMessage
                    variant="error"
                    recovery={
                        lane === 'backup' && /backup file|paste/i.test(error)
                            ? { label: 'Browse', onAction: backupDrop.openFilePicker }
                            : undefined
                    }
                >
                    {error}
                </StatusMessage>
            ) : null}
            {lane === 'backup' ? (
                <>
                    <div className={styles.mnemonicHeader}>
                        <label className={styles.mnemonicLabel} htmlFor="xc-backup-file">
                            Backup file
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
                        >
                            {backupScanning ? 'Cancel scan' : 'Scan pointer QR'}
                        </button>
                    </div>
                    {backupScanning ? (
                        <div className={styles.scannerBox}>
                            <QrScanner onFrame={handleBackupQrFrame} alt="Backup-pointer QR scanner" />
                        </div>
                    ) : null}
                    {backupPointer ? (
                        <div className={styles.backupPointerCard} role="status">
                            <p className={styles.backupHint}>
                                Backup pointer loaded{backupPointer.name ? `: ${backupPointer.name}` : ''}.
                                {' '}Location: {backupPointer.location}
                            </p>
                            <button
                                type="button"
                                className={styles.scanButton}
                                onClick={clearBackupPointer}
                                disabled={busy}
                            >
                                Use a file instead
                            </button>
                        </div>
                    ) : (
                        <>
                    <input
                        id="xc-backup-file"
                        type="file"
                        accept=".xchain-wallet,application/json,text/plain"
                        onChange={handleBackupFile}
                        disabled={busy}
                        className={styles.backupFileInput}
                    />
                    {backupFileName ? (
                        <p className={styles.backupHint}>Loaded {backupFileName} ({backupContent.length.toLocaleString()} bytes).</p>
                    ) : (
                        <p className={styles.backupHint}>Or drop a backup file onto the box below, paste its contents, or scan a backup pointer.</p>
                    )}
                    <textarea
                        {...backupDrop.rootProps}
                        className={mnemonicClass}
                        value={backupContent}
                        onChange={(e) => {
                            setBackupContent(e.target.value);
                            if (e.target.value !== backupContent) setBackupFileName(null);
                            if (error) setError(null);
                        }}
                        placeholder='{"version":1,"kdf":{"name":"argon2id"…'
                        spellCheck={false}
                        autoCapitalize="none"
                        autoCorrect="off"
                        autoComplete="off"
                        rows={4}
                        disabled={busy}
                        style={{
                            outline: backupDrop.isDragOver ? '2px dashed var(--xc-accent)' : undefined,
                            outlineOffset: backupDrop.isDragOver ? 2 : undefined,
                        }}
                    />
                        </>
                    )}
                    <Input
                        type="password"
                        label="Backup password"
                        hint="The password you chose when you exported this backup (not your wallet-unlock password)."
                        value={backupPassword}
                        onChange={(e) => {
                            setBackupPassword(e.target.value);
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
                        <span>Overwrite if any record collides (advanced)</span>
                    </label>
                    <div className={actionsClass}>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={busy}
                            size={isFull ? undefined : 'sm'}
                            icon={<Icon.KeyIcon />}
                            disabled={
                                (backupPointer === null && backupContent.trim().length === 0) ||
                                backupPassword.length === 0
                            }
                        >
                            Restore
                        </Button>
                    </div>
                </>
            ) : null}
            {lane === 'mnemonic' ? (
            <>
            <div className={styles.mnemonicHeader}>
                <label className={styles.mnemonicLabel} htmlFor="xc-mnemonic">
                    Recovery phrase
                </label>
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
                    {scanning ? 'Cancel scan' : 'Scan QR'}
                </button>
            </div>
            {scanning ? (
                <div className={styles.scannerBox}>
                    <QrScanner onFrame={handleQrFrame} alt="Recovery-phrase QR scanner" />
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
                        if (error) setError(null);
                    }}
                    placeholder={
                        isFull
                            ? 'word word word word word word word word word word word word'
                            : 'word word word…'
                    }
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="off"
                    rows={3}
                    disabled={busy}
                />
                <p className={styles.dropHint}>
                    {dragOver ? 'Release to load' : 'Drop a .txt file with your seed phrase to load it here.'}
                </p>
            </div>
            <Input
                label="Wallet name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                disabled={busy}
            />
            <Input
                type="password"
                label="Password"
                hint={
                    isFull
                        ? `At least ${MIN_PASSWORD_LENGTH} characters. Encrypts the wallet on this device.`
                        : `At least ${MIN_PASSWORD_LENGTH} characters.`
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
                type="password"
                label={isFull ? 'Confirm password' : 'Confirm'}
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
                        <span>This wallet uses a BIP39 passphrase</span>
                        <InfoTip
                            aria="BIP39 passphrase help"
                            label="The optional 25th word that derives a different wallet from the same recovery phrase. Required to land on the same addresses as the original software wallet. Hardware wallets (Trezor / Ledger) handle passphrases on the device itself. This lane is for software-wallet imports only; pair a hardware wallet via Add Account → Hardware Signer instead."
                        />
                    </label>
                    {showPassphrase ? (
                        <Input
                            type="password"
                            label="BIP39 passphrase"
                            hint="Required to derive the same addresses as the original wallet."
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
            <div className={actionsClass}>
                <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    size={isFull ? undefined : 'sm'}
                    icon={<Icon.KeyIcon />}
                    disabled={
                        mnemonic.trim().length === 0 ||
                        password.length === 0 ||
                        confirm.length === 0
                    }
                >
                    Import
                </Button>
            </div>
            </>
            ) : null}
        </form>
    );

    const screenHeader = (
        <div className={pickerStyles.header}>
            <button
                type="button"
                onClick={onBack}
                className={pickerStyles.iconBtn}
                aria-label="Back"
                title="Back"
                disabled={busy}
            >
                <Icon.BackIcon />
            </button>
            <span />
            <span />
        </div>
    );

    return (
        <Screen variant={variant} header={screenHeader}>
            {isFull ? <div className={styles.card}>{form}</div> : form}
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
