import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ImportWallet.module.css';

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
 */
export function ImportWallet({ onBack, onImported, variant: importVariant = 'default' }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const isFreeWallet = importVariant === 'freewallet';
    const acceptedWordCounts = isFreeWallet ? [12] : ACCEPTED_WORD_COUNTS;
    const [name, setName] = useState(isFreeWallet ? 'FreeWallet' : 'Imported Wallet');
    const [mnemonic, setMnemonic] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
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
            await messaging.importMnemonic({ password, mnemonic: trimmed, name });
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
                error={error || undefined}
            />
            <div className={actionsClass}>
                <Button
                    variant="ghost"
                    onClick={onBack}
                    type="button"
                    disabled={busy}
                    size={isFull ? undefined : 'sm'}
                >
                    Back
                </Button>
                <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    size={isFull ? undefined : 'sm'}
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

    return (
        <Screen variant={variant}>
            {isFull ? <div className={styles.card}>{form}</div> : form}
        </Screen>
    );
}
