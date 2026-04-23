import { Screen, Button } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import styles from './Onboarding.module.css';

/**
 * Stub onboarding — real create / import / demo flows ship in Batch 4
 * (web SPA parity, shared across shells). For Phase 1 the popup gives
 * the user entry points that will wire up when those flows exist.
 *
 * @param {object} props
 * @param {() => void} [props.onCreated]
 */
export function Onboarding({ onCreated: _onCreated }) {
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
                <Button variant="primary" block disabled>
                    Create a new wallet
                </Button>
                <Button variant="secondary" block disabled>
                    I already have a wallet
                </Button>
                <p className={styles.note}>
                    Onboarding flows ship in a later piece.
                </p>
            </div>
        </Screen>
    );
}
