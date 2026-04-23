import { Screen, Button } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './Onboarding.module.css';

/**
 * Welcome screen — the entry point for users with no wallet yet.
 * Dispatches to `CreateWallet` or `ImportWallet` via the parent App's
 * onboarding sub-route state.
 *
 * @param {object} props
 * @param {() => void} [props.onCreate]
 * @param {() => void} [props.onImport]
 */
export function Onboarding({ onCreate, onImport }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    return (
        <Screen variant={variant}>
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
                >
                    Create a new wallet
                </Button>
                <Button
                    variant="secondary"
                    block
                    onClick={onImport}
                    disabled={!onImport}
                >
                    I already have a wallet
                </Button>
            </div>
        </Screen>
    );
}
