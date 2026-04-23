import { useEffect, useRef, useState } from 'react';
import { Screen, Button, Input } from '@xchain-wallet/core/ui';
import { createWallet } from '../messaging.js';
import { MnemonicGrid } from '../components/MnemonicGrid.jsx';
import styles from './CreateWallet.module.css';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Popup-sized create flow. Two stages:
 *   password  — name + password + confirm
 *   mnemonic  — display the generated phrase + "I saved it" check
 *               (persistence happens via wallet.create, which also
 *               returns the mnemonic — the popup keeps the password
 *               in memory only long enough to submit)
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {() => void} props.onCreated
 */
export function CreateWallet({ onBack, onCreated }) {
    const [stage, setStage] = useState(/** @type {'password'|'mnemonic'|'persisting'} */ ('password'));
    const [name, setName] = useState('Main Wallet');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [passwordError, setPasswordError] = useState(/** @type {string|null} */ (null));
    const [mnemonic, setMnemonic] = useState(/** @type {string|null} */ (null));
    const [saved, setSaved] = useState(false);
    const [persistError, setPersistError] = useState(/** @type {string|null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        if (stage === 'password') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    async function handlePasswordSubmit(event) {
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
        setStage('persisting');
        setPersistError(null);
        try {
            const result = await createWallet({
                password,
                name,
                strengthBits: 128,
            });
            setMnemonic(result.mnemonic);
            setStage('mnemonic');
        } catch (err) {
            setPersistError(err?.message || 'Failed to create wallet.');
            setStage('password');
        }
    }

    function handleDone() {
        if (!saved) return;
        onCreated();
    }

    if (stage === 'mnemonic') {
        return (
            <Screen variant="popup">
                <div className={styles.head}>
                    <h1 className={styles.title}>Recovery phrase</h1>
                    <p className={styles.subtitle}>
                        Write these 12 words down and store them somewhere
                        safe. They're the only way to recover your wallet.
                    </p>
                </div>
                <MnemonicGrid mnemonic={mnemonic || ''} />
                <label className={styles.confirmRow}>
                    <input
                        type="checkbox"
                        checked={saved}
                        onChange={(e) => setSaved(e.target.checked)}
                    />
                    <span>I've saved my recovery phrase.</span>
                </label>
                <Button
                    variant="primary"
                    block
                    onClick={handleDone}
                    disabled={!saved}
                >
                    Done
                </Button>
            </Screen>
        );
    }

    return (
        <Screen variant="popup">
            <form onSubmit={handlePasswordSubmit} noValidate>
                <div className={styles.head}>
                    <h1 className={styles.title}>Create wallet</h1>
                    <p className={styles.subtitle}>
                        Your password encrypts the wallet on this device.
                    </p>
                </div>
                <Input
                    label="Wallet name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="off"
                    disabled={stage === 'persisting'}
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
                    disabled={stage === 'persisting'}
                />
                <Input
                    type="password"
                    label="Confirm"
                    value={confirm}
                    onChange={(e) => {
                        setConfirm(e.target.value);
                        if (passwordError) setPasswordError(null);
                    }}
                    autoComplete="new-password"
                    disabled={stage === 'persisting'}
                    error={passwordError || persistError || undefined}
                />
                <div className={styles.actions}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onBack}
                        disabled={stage === 'persisting'}
                    >
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        loading={stage === 'persisting'}
                        disabled={password.length === 0 || confirm.length === 0}
                    >
                        Next
                    </Button>
                </div>
            </form>
        </Screen>
    );
}
