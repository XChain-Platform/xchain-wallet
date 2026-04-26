import { Screen } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './Loading.module.css';

/**
 * @param {object} props
 * @param {string} [props.error]
 */
export function Loading({ error }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const centerClass = variant === 'small' ? styles.centerPopup : styles.centerFull;
    return (
        <Screen variant={variant}>
            <div className={centerClass}>
                {error ? (
                    <div role="alert" className={styles.error}>{error}</div>
                ) : (
                    <div aria-live="polite" className={styles.dots}>
                        <span /> <span /> <span />
                    </div>
                )}
            </div>
        </Screen>
    );
}
