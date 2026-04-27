import { useState } from 'react';
import { Screen, Button, Icon } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { crypto as cryptoLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './Onboarding.module.css';
import pickerStyles from './WalletPicker.module.css';

/**
 * Welcome screen — the entry point for users with no wallet yet.
 * Dispatches to `CreateWallet`, `ImportWallet`, or (§40.13) the
 * FreeWallet-branded `ImportWallet` variant via the parent App's
 * onboarding sub-route state.
 *
 * §25.2 / G058 — also exposes a "Try in demo mode" button that creates a
 * throwaway BIP39 wallet with a random password (cached in session) and
 * routes the user straight into the unlocked Home view via `onDemoEntered`.
 *
 * @param {object} props
 * @param {() => void} [props.onCreate]
 * @param {() => void} [props.onImport]
 * @param {() => void} [props.onImportFromFreeWallet]
 * @param {() => void} [props.onDemoEntered]          fires after the demo wallet persists; caller refreshes App state into the unlocked tree
 * @param {() => void} [props.onBack]                 rendered as a Cancel button when present (used by the unlocked-state "Add Wallet" entry point)
 */
export function Onboarding({ onCreate, onImport, onImportFromFreeWallet, onDemoEntered, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const [demoBusy, setDemoBusy] = useState(false);
    const [demoError, setDemoError] = useState(/** @type {string | null} */ (null));

    async function handleEnterDemo() {
        if (demoBusy) return;
        if (typeof messaging?.importMnemonic !== 'function') {
            setDemoError('Demo mode is not available in this shell.');
            return;
        }
        setDemoBusy(true);
        setDemoError(null);
        try {
            // 32-byte hex auto-password kept in the session cache; the
            // user never sees it. Mnemonic generated locally per the
            // standard CreateWallet path.
            const passwordBytes = new Uint8Array(32);
            globalThis.crypto.getRandomValues(passwordBytes);
            const password = Array.from(passwordBytes, (b) =>
                b.toString(16).padStart(2, '0'),
            ).join('');
            passwordBytes.fill(0);
            const mnemonic = cryptoLib.generateBip39Mnemonic(128);
            const r = await messaging.importMnemonic({
                password,
                mnemonic,
                name: 'Demo Wallet',
            });
            const walletId = r?.wallet?.id || r?.walletId;
            if (walletId) flowsLib.markDemoWallet(walletId);
            if (typeof onDemoEntered === 'function') onDemoEntered();
        } catch (err) {
            setDemoError(err?.message || 'Could not start demo mode.');
        } finally {
            setDemoBusy(false);
        }
    }

    const header = onBack ? (
        <div className={pickerStyles.header}>
            <button
                type="button"
                onClick={onBack}
                className={pickerStyles.iconBtn}
                aria-label="Back"
                title="Back"
            >
                <Icon.BackIcon />
            </button>
            <span />
            <span />
        </div>
    ) : null;
    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.heroFull : styles.heroPopup}>
                <img
                    src={branding.logoUrl()}
                    alt={branding.PRODUCT_NAME}
                    className={isFull ? styles.logoFull : styles.logoPopup}
                />
                <h1 className={isFull ? styles.nameFull : styles.namePopup}>
                    {branding.PRODUCT_NAME}
                </h1>
                <p className={isFull ? styles.taglineFull : styles.taglinePopup}>
                    {branding.TAGLINE}
                </p>
            </div>
            <div className={isFull ? styles.actionsFull : styles.actionsPopup}>
                <Button
                    variant="primary"
                    block
                    onClick={onCreate}
                    disabled={!onCreate}
                    icon={<Icon.PlusIcon />}
                >
                    Create new wallet
                </Button>
                <Button
                    variant="secondary"
                    block
                    onClick={onImport}
                    disabled={!onImport}
                    icon={<Icon.KeyIcon />}
                >
                    Import wallet
                </Button>
                <Button
                    variant="ghost"
                    block
                    onClick={onImportFromFreeWallet}
                    disabled={!onImportFromFreeWallet}
                    icon={<Icon.MigrateIcon />}
                >
                    From FreeWallet
                </Button>
                {onDemoEntered ? (
                    <Button
                        variant="ghost"
                        block
                        onClick={handleEnterDemo}
                        loading={demoBusy}
                        disabled={demoBusy}
                    >
                        {demoBusy ? 'Setting up demo…' : 'Try in demo mode'}
                    </Button>
                ) : null}
                {demoError ? (
                    <p role="alert" className={styles.demoError}>{demoError}</p>
                ) : null}
            </div>
        </Screen>
    );
}
