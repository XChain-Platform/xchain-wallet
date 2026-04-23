import { Screen, Button } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import styles from './Locked.module.css';

/**
 * Scaffold unlock screen — the real password form + `unlockWallet`
 * wiring lands in Batch 2 piece 5. This stub exists so piece 4's
 * state machine has something to render when the background reports
 * `state: 'locked'`.
 *
 * @param {object} props
 * @param {() => void} [props.onUnlocked]
 */
export function Locked({ onUnlocked: _onUnlocked }) {
    return (
        <Screen variant="popup">
            <div className={styles.hero}>
                <img
                    src={branding.logoUrl()}
                    alt=""
                    aria-hidden="true"
                    className={styles.logo}
                />
                <h1 className={styles.name}>{branding.PRODUCT_NAME}</h1>
                <p className={styles.hint}>Wallet locked.</p>
            </div>
            <Button variant="primary" block disabled>
                Unlock
            </Button>
            <p className={styles.note}>Unlock flow ships in piece 5.</p>
        </Screen>
    );
}
