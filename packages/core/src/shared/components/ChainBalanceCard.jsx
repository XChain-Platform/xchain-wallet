import { ChainBadge } from '@xchain-wallet/core/ui';
import styles from './ChainBalanceCard.module.css';

/**
 * One chain's balance summary on the Home screen. Renders a badge +
 * per-address rows; each entry carries a `balances` value (or `null`
 * + an `error` string when the SDK read fails). Until real balances
 * land in a later piece, every entry is expected to carry an error
 * against the dev-SDK stub, and the card renders the "balance
 * unavailable" state gracefully.
 *
 * @param {object} props
 * @param {import('../../registry/validate.js').ChainDescriptor} props.descriptor
 * @param {Array<{ address: string, label: string, balances: unknown | null, error: string | null }>} props.entries
 */
export function ChainBalanceCard({ descriptor, entries }) {
    const hasError = entries.some((e) => e.error);
    const allError = hasError && entries.every((e) => e.error);
    return (
        <section
            className={styles.card}
            aria-label={`${descriptor.displayName} balances`}
        >
            <header className={styles.header}>
                <ChainBadge descriptor={descriptor} size="md" />
                <span className={styles.count}>
                    {entries.length === 1
                        ? '1 address'
                        : `${entries.length} addresses`}
                </span>
            </header>
            {allError ? (
                <p className={styles.fallback}>
                    Balance unavailable — {entries[0].error}
                </p>
            ) : (
                <p className={styles.fallback}>
                    Balance details ship in a later piece.
                </p>
            )}
        </section>
    );
}
