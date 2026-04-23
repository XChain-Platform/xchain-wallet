import { Screen, Button } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { ExtensionBanner } from '../components/ExtensionBanner.jsx';
import styles from './Onboarding.module.css';

/**
 * Welcome screen — the entry point for users with no wallet yet.
 * Dispatches to `CreateWallet` or `ImportWallet` via the parent App's
 * onboarding sub-route state (see packages/web/src/App.jsx).
 *
 * The extension-detection banner at the top is real — it fires
 * whenever `window.xchain` is injected, offering the user a pointer
 * to their extension wallet.
 *
 * @param {object} props
 * @param {() => void} [props.onCreate]  navigate to create sub-route
 * @param {() => void} [props.onImport]  navigate to import sub-route
 */
export function Onboarding({ onCreate, onImport }) {
    return (
        <>
            <ExtensionBanner />
            <Screen variant="full">
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
        </>
    );
}
