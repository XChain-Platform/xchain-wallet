import { Screen, Button } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import styles from './Home.module.css';

/**
 * Scaffold home view — balances + send/receive land in Batch 2 pieces
 * 6 and 7. For piece 4 this just confirms the unlocked-state route
 * renders and exposes a stub lock trigger so the state machine can be
 * exercised end-to-end.
 *
 * @param {object} props
 * @param {() => void} [props.onLocked]
 */
export function Home({ onLocked }) {
    return (
        <Screen
            variant="popup"
            header={
                <div className={styles.header}>
                    <span className={styles.title}>{branding.PRODUCT_NAME}</span>
                    <Button variant="ghost" size="sm" onClick={onLocked}>
                        Lock
                    </Button>
                </div>
            }
        >
            <p className={styles.note}>
                Home view (balances, send, receive) ships in pieces 6–7.
            </p>
        </Screen>
    );
}
