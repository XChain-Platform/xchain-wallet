import { ChainBadge, MultisigBadge } from '@xchain-wallet/core/ui';
import styles from './ChainBalanceCard.module.css';

/**
 * One chain's balance summary on the Home screen. Renders a badge +
 * per-address rows; each entry carries a `balances` value (or `null`
 * + an `error` string when the SDK read fails). Until real balances
 * land in a later piece, every entry is expected to carry an error
 * against the dev-SDK stub, and the card renders the "balance
 * unavailable" state gracefully.
 *
 * `multisig` is optional and surfaces the §22 N-of-M / scheme
 * indicator on chains where the wallet has a multisig configured —
 * BTC-only at launch (§10.3 / §22.4). Step 22 of Phase 4.
 *
 * @param {object} props
 * @param {import('../../registry/validate.js').ChainDescriptor} props.descriptor
 * @param {Array<{ address: string, label: string, balances: unknown | null, error: string | null }>} props.entries
 * @param {{ threshold: number, cosignerCount: number, scheme: 'p2sh-multisig' | 'p2wsh-multisig' | 'taproot-musig2' } | null} [props.multisig]
 */
export function ChainBalanceCard({ descriptor, entries, multisig }) {
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
                {multisig ? (
                    <MultisigBadge
                        threshold={multisig.threshold}
                        cosignerCount={multisig.cosignerCount}
                        scheme={multisig.scheme}
                        size="sm"
                    />
                ) : null}
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
