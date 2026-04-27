import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input, Icon } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ImportWallet.module.css';
import pickerStyles from './WalletPicker.module.css';

const MIN_PASSWORD_LENGTH = 8;
const ACCEPTED_WORD_COUNTS = [12, 15, 18, 21, 24];

/**
 * Import an existing wallet via mnemonic. Accepts BIP39 (12/15/18/21/24
 * words) and Counterwallet-legacy (12 words) — the core
 * `importMnemonic` flow auto-detects format.
 *
 * When `variant="freewallet"` (§40.13), the form rebrands for users
 * migrating from FreeWallet: title + copy call out FreeWallet
 * explicitly, the default wallet name is "FreeWallet", and the
 * word-count validator tightens to 12 (FreeWallet only ever used a
 * 12-word Counterwallet mnemonic). The import path is otherwise
 * identical — the format detector still dispatches to the
 * Counterwallet-legacy or BIP39 code path as appropriate.
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {() => void} props.onImported             refreshes App.jsx state
 * @param {'default' | 'freewallet'} [props.variant]
 * @param {'fresh' | 'add'} [props.mode]   'fresh' → first wallet (pre-host `wallet.import`); 'add' → adds to an open vault (`wallet.add.import`). Defaults to 'fresh'.
 */
export function ImportWallet({ onBack, onImported, variant: importVariant = 'default', mode = 'fresh' }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const isFreeWallet = importVariant === 'freewallet';
    const acceptedWordCounts = isFreeWallet ? [12] : ACCEPTED_WORD_COUNTS;
    const [name, setName] = useState(isFreeWallet ? 'FreeWallet' : 'Imported Wallet');
    const [mnemonic, setMnemonic] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    // §15.6 — optional 25th-word BIP39 passphrase. Hidden behind a toggle so
    // users who never set one don't have to read the warning copy.
    // FreeWallet imports follow the Counterwallet legacy code path, which
    // rejects a passphrase, so we don't expose the toggle there.
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [bip39Passphrase, setBip39Passphrase] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    const textareaRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));

    useEffect(() => {
        setTimeout(() => textareaRef.current?.focus(), 0);
    }, []);

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
            setError(`Expected ${expected} word${acceptedWordCounts.length === 1 ? '' : 's'} — got ${wordCount}.`);
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

    // Errors that originate from the field-level validators (mismatched
    // confirm, too-short password) AND errors that come back from the
    // import flow (KDF failure, malformed mnemonic, missing crypto.subtle
    // on insecure-context HTTP, etc.) all funnel through `error`. Show
    // them in a single top-of-form alert box so a runtime failure is
    // never visually attached to whichever input the user typed last.
    const form = (
        <form onSubmit={handleSubmit} noValidate>
            <header className={headClass}>
                <h1 className={titleClass}>
                    {isFreeWallet
                        ? (isFull ? 'Import from FreeWallet' : 'FreeWallet import')
                        : (isFull ? 'Import an existing wallet' : 'Import wallet')}
                </h1>
                <p className={subtitleClass}>
                    {isFreeWallet
                        ? (isFull
                            ? 'Paste your 12-word FreeWallet recovery phrase. We\'ll import it as a Counterwallet-legacy wallet — the same derivation FreeWallet used — so every address matches the one you already know.'
                            : 'Paste your 12-word FreeWallet recovery phrase.')
                        : (isFull
                            ? 'Enter a BIP39 recovery phrase (12, 15, 18, 21, or 24 words) or a Counterwallet 12-word mnemonic. The format is detected automatically.'
                            : 'Paste a 12-, 15-, 18-, 21-, or 24-word recovery phrase.')}
                </p>
            </header>
            {error ? (
                <div role="alert" className={styles.error}>{error}</div>
            ) : null}
            <label className={styles.mnemonicLabel} htmlFor="xc-mnemonic">
                Recovery phrase
            </label>
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
