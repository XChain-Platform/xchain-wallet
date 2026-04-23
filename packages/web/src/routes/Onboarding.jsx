import { Screen, Button } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { ExtensionBanner } from '../components/ExtensionBanner.jsx';
import styles from './Onboarding.module.css';

/**
 * Stub onboarding screen — the real create / import flows ship in
 * Batch 4 piece 12. This view exists so piece 11's state machine has
 * something to render when IndexedDB has no vault.
 *
 * The extension-detection banner at the top is real — it fires
 * whenever `window.xchain` is injected, offering the user a pointer
 * to their extension wallet.
 */
export function Onboarding() {
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
                    <Button variant="primary" block disabled>
                        Create a new wallet
                    </Button>
                    <Button variant="secondary" block disabled>
                        I already have a wallet
                    </Button>
                    <p className={styles.note}>
                        Create / import flows ship in piece 12.
                    </p>
                </div>
            </Screen>
        </>
    );
}
