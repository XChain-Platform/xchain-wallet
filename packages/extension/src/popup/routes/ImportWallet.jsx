import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input } from '@xchain-wallet/core/ui';
import { importMnemonic } from '../messaging.js';
import styles from './ImportWallet.module.css';

const MIN_PASSWORD_LENGTH = 8;
const ACCEPTED_WORD_COUNTS = [12, 15, 18, 21, 24];

/**
 * Popup import flow — accepts BIP39 (12/15/18/21/24 words) and
 * Counterwallet legacy (12 words; format auto-detected by the core
 * flow).
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {() => void} props.onImported
 */
export function ImportWallet({ onBack, onImported }) {
    const [name, setName] = useState('Imported Wallet');
    const [mnemonic, setMnemonic] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState(/** @type {string|null} */ (null));
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
        if (!ACCEPTED_WORD_COUNTS.includes(wordCount)) {
            setError(`Expected 12, 15, 18, 21, or 24 words — got ${wordCount}.`);
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
            await importMnemonic({ password, mnemonic: trimmed, name });
            onImported();
        } catch (err) {
            setError(err?.message || 'Failed to import wallet.');
            setBusy(false);
        }
    }

    return (
        <Screen variant="popup">
            <form onSubmit={handleSubmit} noValidate>
                <div className={styles.head}>
                    <h1 className={styles.title}>Import wallet</h1>
                    <p className={styles.subtitle}>
                        Paste a 12-, 15-, 18-, 21-, or 24-word recovery phrase.
                    </p>
                </div>
                <label className={styles.mnemonicLabel} htmlFor="xc-mnemonic">
                    Recovery phrase
                </label>
                <textarea
                    id="xc-mnemonic"
                    ref={textareaRef}
                    className={styles.mnemonic}
                    value={mnemonic}
                    onChange={(e) => {
                        setMnemonic(e.target.value);
                        if (error) setError(null);
                    }}
                    placeholder="word word word…"
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
                    hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
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
                    label="Confirm"
                    value={confirm}
                    onChange={(e) => {
                        setConfirm(e.target.value);
                        if (error) setError(null);
                    }}
                    autoComplete="new-password"
                    disabled={busy}
                    error={error || undefined}
                />
                <div className={styles.actions}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onBack}
                        disabled={busy}
                    >
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        loading={busy}
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
        </Screen>
    );
}
