import { Screen, Button } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import styles from './Onboarding.module.css';

/**
 * Welcome screen inside the popup — dispatches to CreateWallet or
 * ImportWallet via the parent App's onboardingStep state.
 *
 * @param {object} props
 * @param {() => void} [props.onCreate]
 * @param {() => void} [props.onImport]
 */
export function Onboarding({ onCreate, onImport }) {
    return (
        <Screen variant="popup">
            <div className={styles.hero}>
                <img
                    src={branding.logoUrl()}
                    alt={branding.PRODUCT_NAME}
                    className={styles.logo}
                />
                <h1 className={styles.name}>{branding.PRODUCT_NAME}</h1>
                <p className={styles.tagline}>{branding.TAGLINE}</p>
            </div>
            <div className={styles.actions}>
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
