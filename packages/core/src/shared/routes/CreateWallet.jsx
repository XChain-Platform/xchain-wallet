import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { crypto as cryptoLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { MnemonicGrid } from '../components/MnemonicGrid.jsx';
import styles from './CreateWallet.module.css';

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
 */
export function CreateWallet({ onBack, onCreated }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [stage, setStage] = useState(
        /** @type {'password'|'mnemonic'|'persisting'} */ ('password'),
    );
    const [name, setName] = useState('Main Wallet');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [passwordError, setPasswordError] = useState(
        /** @type {string | null} */ (null),
    );
    const [mnemonic, setMnemonic] = useState(/** @type {string | null} */ (null));
    const [saved, setSaved] = useState(false);
    const [persistError, setPersistError] = useState(
        /** @type {string | null} */ (null),
    );
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

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
        setMnemonic(cryptoLib.generateBip39Mnemonic(128));
        setStage('mnemonic');
    }

    async function handlePersist() {
        if (!mnemonic || !saved || stage === 'persisting') return;
        setStage('persisting');
        setPersistError(null);
        try {
            await messaging.importMnemonic({ password, mnemonic, name });
            onCreated();
        } catch (err) {
            setPersistError(err?.message || 'Failed to create wallet.');
            setStage('mnemonic');
        }
    }

    const headClass = isFull ? styles.headFull : styles.headPopup;
    const titleClass = isFull ? styles.titleFull : styles.titlePopup;
    const subtitleClass = isFull ? styles.subtitleFull : styles.subtitlePopup;
    const actionsClass = isFull ? styles.actionsFull : styles.actionsPopup;

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
                            ? 'These twelve words are the ONLY way to recover your wallet if you lose access to this device. Write them down on paper and store them somewhere safe — never type them into a website, email, or photo.'
                            : "Write these 12 words down and store them somewhere safe. They're the only way to recover your wallet."}
                    </p>
                </header>
                <MnemonicGrid mnemonic={mnemonic || ''} variant={variant} />
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
                        variant="ghost"
                        onClick={onBack}
                        disabled={stage === 'persisting'}
                        size={isFull ? undefined : 'sm'}
                    >
                        Back
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handlePersist}
                        disabled={!saved}
                        loading={stage === 'persisting'}
                        block={!isFull}
                        size={isFull ? undefined : 'sm'}
                    >
                        Create wallet
                    </Button>
                </div>
            </>
        );
        return (
            <Screen variant={variant}>
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
            <div className={actionsClass}>
                <Button
                    variant="ghost"
                    onClick={onBack}
                    type="button"
                    size={isFull ? undefined : 'sm'}
                >
                    Back
                </Button>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={password.length === 0 || confirm.length === 0}
                    size={isFull ? undefined : 'sm'}
                >
                    Next
                </Button>
            </div>
        </form>
    );

    return (
        <Screen variant={variant}>
            {isFull ? <div className={styles.card}>{formBody}</div> : formBody}
        </Screen>
    );
}
