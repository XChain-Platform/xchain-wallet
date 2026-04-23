import { ChainBadge } from '@xchain-wallet/core/ui';
import styles from './ChainBalanceCard.module.css';

/**
 * One chain's balance summary on the Home screen. Renders a badge +
 * per-address rows. Each entry either shows its balance (once the SDK
 * is wired) or an error string. Phase 1 ships with a stub SDK so
 * every entry will carry an error; that's expected and the card
 * renders the "balance unavailable" state gracefully.
 *
 * @param {object} props
 * @param {import('@xchain-wallet/core/src/registry/validate.js').ChainDescriptor} props.descriptor
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
                    Balance details ship in piece 7 (balances + address detail).
                </p>
            )}
        </section>
    );
}
