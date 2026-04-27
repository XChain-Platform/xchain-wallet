import { Screen, Button, Icon } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './Onboarding.module.css';
import pickerStyles from './WalletPicker.module.css';

/**
 * Welcome screen — the entry point for users with no wallet yet.
 * Dispatches to `CreateWallet`, `ImportWallet`, or (§40.13) the
 * FreeWallet-branded `ImportWallet` variant via the parent App's
 * onboarding sub-route state.
 *
 * @param {object} props
 * @param {() => void} [props.onCreate]
 * @param {() => void} [props.onImport]
 * @param {() => void} [props.onImportFromFreeWallet]
 * @param {() => void} [props.onBack]                rendered as a Cancel button when present (used by the unlocked-state "Add Wallet" entry point)
 */
export function Onboarding({ onCreate, onImport, onImportFromFreeWallet, onBack }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
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
            </div>
        </Screen>
    );
}
