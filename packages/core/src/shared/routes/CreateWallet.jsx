import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input, CopyButton, Icon } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { crypto as cryptoLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { MnemonicGrid } from '../components/MnemonicGrid.jsx';
import styles from './CreateWallet.module.css';
import pickerStyles from './WalletPicker.module.css';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Multi-stage create-wallet flow (§15.3 + §19.2).
 *
 *   stage = 'password'  — name + password + confirm
 *           ↓ (generate mnemonic in-memory)
 *   stage = 'mnemonic'  — display + "I've saved it" checkbox
 *           ↓ (persist via importMnemonic — same code path as real import)
 *   stage = 'persisting'— show a spinner while Argon2id KDF runs
 *           ↓ (onCreated refreshes App → state becomes unlocked → Home)
 *
 * Routing the persist through `importMnemonic` (rather than a separate
 * `createWallet` flow) means the generated mnemonic is only committed
 * AFTER the user confirms they've saved it — a user who closes the tab
 * / popup during the display stage leaves no vault behind.
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {() => void} props.onCreated
 * @param {'fresh' | 'add'} [props.mode]   'fresh' → first wallet (pre-host `wallet.import`); 'add' → adds to an open vault (`wallet.add.import`). Defaults to 'fresh'.
 */
export function CreateWallet({ onBack, onCreated, mode = 'fresh' }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [stage, setStage] = useState(
        /** @type {'password'|'mnemonic'|'persisting'|'ads-consent'} */ ('password'),
    );
    const [adsBusy, setAdsBusy] = useState(false);
    const [adsError, setAdsError] = useState(/** @type {string | null} */ (null));
    const [name, setName] = useState('Main Wallet');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    // §15.1 — 12-word default, 24-word opt-in. 12 → 128-bit entropy, 24 → 256-bit.
    const [wordCount, setWordCount] = useState(/** @type {12 | 24} */ (12));
    const [passwordError, setPasswordError] = useState(
        /** @type {string | null} */ (null),
    );
    const [mnemonic, setMnemonic] = useState(/** @type {string | null} */ (null));
    const [saved, setSaved] = useState(false);
    const [persistError, setPersistError] = useState(
        /** @type {string | null} */ (null),
    );
    const [clipboardCopied, setClipboardCopied] = useState(false);
    const clipboardClearRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => () => {
        // Cleanup on unmount: if the user navigated away while the
        // 60-second clipboard auto-clear was pending, fire it now so
        // the seed doesn't outlive the screen in their clipboard.
        if (clipboardClearRef.current) {
            clearTimeout(clipboardClearRef.current);
            clipboardClearRef.current = null;
            navigator.clipboard?.writeText?.(' ').catch(() => {});
        }
    }, []);

    function handleMnemonicCopied() {
        setClipboardCopied(true);
        if (clipboardClearRef.current) clearTimeout(clipboardClearRef.current);
        clipboardClearRef.current = setTimeout(() => {
            navigator.clipboard?.writeText?.(' ').catch(() => {});
            setClipboardCopied(false);
            clipboardClearRef.current = null;
        }, 60_000);
    }

    useEffect(() => {
        if (stage === 'password') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    function handlePasswordSubmit(event) {
        event.preventDefault();
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
        setPasswordError(null);
        setMnemonic(cryptoLib.generateBip39Mnemonic(wordCount === 24 ? 256 : 128));
        setStage('mnemonic');
    }

    async function handlePersist() {
        if (!mnemonic || !saved || stage === 'persisting') return;
        setStage('persisting');
        setPersistError(null);
        try {
            if (mode === 'add') {
                if (typeof messaging.addImportedWallet !== 'function') {
                    throw new Error('messaging.addImportedWallet is not available in this shell.');
                }
                await messaging.addImportedWallet({ password, mnemonic, name });
            } else {
                await messaging.importMnemonic({ password, mnemonic, name });
            }
            // §36.1 ADS consent — one-time screen during wallet
            // creation. ADS_DEFAULT_ENABLED is true so "Enable" is a
            // no-op write; "Decline" persists ads.enabled = false. The
            // user can flip in Settings → ADS afterwards either way.
            setStage('ads-consent');
        } catch (err) {
            setPersistError(err?.message || 'Failed to create wallet.');
            setStage('mnemonic');
        }
    }

    async function handleAdsChoice(enable) {
        setAdsBusy(true);
        setAdsError(null);
        try {
            if (typeof messaging?.updateSettings === 'function') {
                await messaging.updateSettings({ ads: { enabled: Boolean(enable) } });
            }
            onCreated();
        } catch (err) {
            setAdsError(err?.message || 'Could not save your preference. Try again.');
        } finally {
            setAdsBusy(false);
        }
    }

    const headClass = isFull ? styles.headFull : styles.headPopup;
    const titleClass = isFull ? styles.titleFull : styles.titlePopup;
    const subtitleClass = isFull ? styles.subtitleFull : styles.subtitlePopup;
    const actionsClass = isFull ? styles.actionsFull : styles.actionsPopup;

    const screenHeader = (
        <div className={pickerStyles.header}>
            <button
                type="button"
                onClick={onBack}
                className={pickerStyles.iconBtn}
                aria-label="Back"
                title="Back"
                disabled={stage === 'persisting'}
            >
                <Icon.BackIcon />
            </button>
            <span />
            <span />
        </div>
    );

    if (stage === 'ads-consent') {
        const consentBody = (
            <>
                <header className={headClass}>
                    <h1 className={titleClass}>
                        {isFull ? 'Support XChain development' : 'Support XChain'}
                    </h1>
                    <p className={subtitleClass}>
                        The wallet can add a small donation to each transaction you send,
                        helping fund XChain Platform development. This is entirely optional —
                        you can change it any time in Settings → Automatic Donation System.
                    </p>
                </header>
                <ul style={{
                    margin: 0,
                    padding: 'var(--xc-space-2) var(--xc-space-3)',
                    background: 'var(--xc-surface-raised)',
                    border: '1px solid var(--xc-border)',
                    borderRadius: 'var(--xc-radius-md)',
                    listStyle: 'none',
                    fontSize: 'var(--xc-text-sm)',
                    color: 'var(--xc-text-muted)',
                }}>
                    <li>Default: 1 sat per transaction (sent when accumulated &gt; 1,000 sats)</li>
                    <li>Configurable per chain (Bitcoin / Litecoin / Dogecoin)</li>
                    <li>No donation line on sign screens — runs invisibly after setup</li>
                </ul>
                {adsError ? (
                    <div role="alert" className={styles.error}>{adsError}</div>
                ) : null}
                <div className={actionsClass}>
                    <Button
                        variant="primary"
                        onClick={() => handleAdsChoice(true)}
                        disabled={adsBusy}
                        loading={adsBusy}
                        block={!isFull}
                        size={isFull ? undefined : 'sm'}
                        icon={<Icon.CheckIcon />}
                    >
                        Enable and continue
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => handleAdsChoice(false)}
                        disabled={adsBusy}
                        block={!isFull}
                        size={isFull ? undefined : 'sm'}
                    >
                        Decline (I'll consider it later)
                    </Button>
                </div>
            </>
        );
        return (
            <Screen variant={variant} header={screenHeader}>
                {isFull ? <div className={styles.card}>{consentBody}</div> : consentBody}
            </Screen>
        );
    }

    if (stage === 'mnemonic' || stage === 'persisting') {
        const mnemonicBody = (
            <>
                <header className={headClass}>
                    <h1 className={titleClass}>
                        {isFull
                            ? 'Write down your recovery phrase'
                            : 'Recovery phrase'}
                    </h1>
                    <p className={subtitleClass}>
                        {isFull
                            ? `These ${wordCount === 24 ? 'twenty-four' : 'twelve'} words are the ONLY way to recover your wallet if you lose access to this device. Write them down on paper and store them somewhere safe — never type them into a website, email, or photo.`
                            : `Write these ${wordCount} words down and store them somewhere safe. They're the only way to recover your wallet.`}
                    </p>
                </header>
                <MnemonicGrid mnemonic={mnemonic || ''} variant={variant} />
                <div className={styles.copyRow}>
                    <CopyButton
                        value={mnemonic || ''}
                        label="Copy recovery phrase"
                        ariaLabel="Copy recovery phrase to clipboard"
                        onCopied={handleMnemonicCopied}
                    />
                    <span className={styles.copyHint} aria-live="polite">
                        {clipboardCopied
                            ? 'Copied — clipboard auto-clears in 60 s. Paste it into a password manager, then write it on paper.'
                            : 'Paper is safest. If you copy, paste into a password manager — clipboard auto-clears after 60 s.'}
                    </span>
                </div>
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
                {persistError ? (
                    <div role="alert" className={styles.error}>{persistError}</div>
                ) : null}
                <div className={actionsClass}>
                    <Button
                        variant="primary"
                        onClick={handlePersist}
                        disabled={!saved}
                        loading={stage === 'persisting'}
                        block={!isFull}
                        size={isFull ? undefined : 'sm'}
                        icon={<Icon.CheckIcon />}
                    >
                        Create wallet
                    </Button>
                </div>
            </>
        );
        return (
            <Screen variant={variant} header={screenHeader}>
                {isFull ? <div className={styles.card}>{mnemonicBody}</div> : mnemonicBody}
            </Screen>
        );
    }

    const formBody = (
        <form onSubmit={handlePasswordSubmit} noValidate>
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
                        ? "Your password encrypts the wallet on this device. It can't be recovered — if you forget it, use the recovery phrase on the next screen to restore access."
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
                ref={passwordRef}
                type="password"
                label="Password"
                hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError(null);
                }}
                autoComplete="new-password"
            />
            <Input
                type="password"
                label={isFull ? 'Confirm password' : 'Confirm'}
                value={confirm}
                onChange={(e) => {
                    setConfirm(e.target.value);
                    if (passwordError) setPasswordError(null);
                }}
                autoComplete="new-password"
                error={passwordError || undefined}
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
                    <span className={styles.wordCountHint}>Default — 128-bit entropy</span>
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
                    <span className={styles.wordCountHint}>256-bit entropy</span>
                </label>
            </fieldset>
            <div className={actionsClass}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={password.length === 0 || confirm.length === 0}
                    size={isFull ? undefined : 'sm'}
                    icon={<Icon.MigrateIcon />}
                >
                    Next
                </Button>
            </div>
        </form>
    );

    return (
        <Screen variant={variant} header={screenHeader}>
            {isFull ? <div className={styles.card}>{formBody}</div> : formBody}
        </Screen>
    );
}
