import { Screen } from '@xchain-wallet/core/ui';
import styles from './Loading.module.css';

/**
 * @param {object} props
 * @param {string} [props.error]
 */
export function Loading({ error }) {
    return (
        <Screen variant="full">
            <div className={styles.center}>
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
