import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { crypto as cryptoLib } from '@xchain-wallet/core';
import { importMnemonic } from '../messaging.js';
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
 * Routing the persist through `importMnemonic` (rather than the separate
 * `createWallet` flow) means the generated mnemonic is only committed
 * AFTER the user confirms they've saved it — so a user who closes the
 * tab during the display stage leaves no vault behind.
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {() => void} props.onCreated  refreshes App.jsx state
 */
export function CreateWallet({ onBack, onCreated }) {
    const [stage, setStage] = useState(/** @type {'password'|'mnemonic'|'persisting'} */ ('password'));
    const [name, setName] = useState('Main Wallet');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [passwordError, setPasswordError] = useState(/** @type {string | null} */ (null));
    const [mnemonic, setMnemonic] = useState(/** @type {string | null} */ (null));
    const [saved, setSaved] = useState(false);
    const [persistError, setPersistError] = useState(/** @type {string | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        if (stage === 'password') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    function handlePasswordSubmit(event) {
        event.preventDefault();
        if (password.length < MIN_PASSWORD_LENGTH) {
            setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
        }
        if (password !== confirm) {
            setPasswordError('Passwords do not match.');
            return;
        }
        setPasswordError(null);
        // Generate the mnemonic in-memory — NOT persisted until user
        // confirms on the next screen. The generator uses WebCrypto's
        // RNG directly so the word list never round-trips through the
        // host bridge.
        setMnemonic(cryptoLib.generateBip39Mnemonic(128));
        setStage('mnemonic');
    }

    async function handlePersist() {
        if (!mnemonic || !saved || stage === 'persisting') return;
        setStage('persisting');
        setPersistError(null);
        try {
            await importMnemonic({ password, mnemonic, name });
            onCreated();
        } catch (err) {
            setPersistError(err?.message || 'Failed to create wallet.');
            setStage('mnemonic');
        }
    }

    if (stage === 'mnemonic' || stage === 'persisting') {
        return (
            <Screen variant="full">
                <div className={styles.card}>
                    <header className={styles.head}>
                        <h1 className={styles.title}>Write down your recovery phrase</h1>
                        <p className={styles.subtitle}>
                            These twelve words are the ONLY way to recover
                            your wallet if you lose access to this device.
                            Write them down on paper and store them somewhere
                            safe — never type them into a website, email, or
                            photo.
                        </p>
                    </header>
                    <MnemonicGrid mnemonic={mnemonic || ''} />
                    <label className={styles.confirmRow}>
                        <input
                            type="checkbox"
                            checked={saved}
                            onChange={(e) => setSaved(e.target.checked)}
                            disabled={stage === 'persisting'}
                        />
                        <span>
                            I have written down my recovery phrase and
                            stored it safely.
                        </span>
                    </label>
                    {persistError ? (
                        <div role="alert" className={styles.error}>{persistError}</div>
                    ) : null}
                    <div className={styles.actions}>
                        <Button
                            variant="ghost"
                            onClick={onBack}
                            disabled={stage === 'persisting'}
                        >
                            Back
                        </Button>
                        <Button
                            variant="primary"
                            onClick={handlePersist}
                            disabled={!saved}
                            loading={stage === 'persisting'}
                        >
                            Create wallet
                        </Button>
                    </div>
                </div>
            </Screen>
        );
    }

    return (
        <Screen variant="full">
            <form className={styles.card} onSubmit={handlePasswordSubmit} noValidate>
                <header className={styles.head}>
                    <img
                        src={branding.logoUrl()}
                        alt=""
                        aria-hidden="true"
                        className={styles.logo}
                    />
                    <h1 className={styles.title}>Create a new wallet</h1>
                    <p className={styles.subtitle}>
                        Your password encrypts the wallet on this device.
                        It can't be recovered — if you forget it, use the
                        recovery phrase on the next screen to restore access.
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
                    label="Confirm password"
                    value={confirm}
                    onChange={(e) => {
                        setConfirm(e.target.value);
                        if (passwordError) setPasswordError(null);
                    }}
                    autoComplete="new-password"
                    error={passwordError || undefined}
                />
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack} type="button">
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        disabled={password.length === 0 || confirm.length === 0}
                    >
                        Next
                    </Button>
                </div>
            </form>
        </Screen>
    );
}
