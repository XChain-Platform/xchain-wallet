import { useMemo, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { sumFiatValue } from './BalanceList.jsx';
import { StalenessLabel } from './StalenessLabel.jsx';
import styles from './TotalBalanceHero.module.css';

/**
 * Hero block at the top of Home — total fiat value across every
 * priced row (coins + tokens + NFTs). Honours the active network
 * filter so flipping to BTC shows only BTC-side wealth.
 *
 * The eye toggle hides the number for shoulder-surfing scenarios
 * (public coffee-shop unlocks, etc.). State is component-local so
 * it resets on reload, not persisted.
 *
 * @param {object} props
 * @param {Array<any>} props.rows                rows from `buildBalanceRows`, already filtered
 * @param {'all' | string} props.networkFilter
 * @param {number | null} [props.lastSyncedAt]   Unix ms of the last successful balance fetch — drives the staleness label rendered on the right of the note row.
 */
export function TotalBalanceHero({ rows, networkFilter, lastSyncedAt }) {
    const { total, unpriced } = useMemo(() => sumFiatValue(rows), [rows]);
    const [hidden, setHidden] = useState(false);

    const filterLabel = networkFilter === 'all' ? 'All networks' : networkFilter.toUpperCase();
    const hasUnpriced = unpriced > 0;
    const hasSync = typeof lastSyncedAt === 'number' && lastSyncedAt > 0;

    return (
        <section className={styles.hero} aria-label="Total balance">
            <div className={styles.row}>
                <span className={styles.label}>
                    Total balance
                    <span className={styles.scope}>· {filterLabel}</span>
                </span>
                <button
                    type="button"
                    className={styles.eye}
                    onClick={() => setHidden((v) => !v)}
                    aria-label={hidden ? 'Show balance' : 'Hide balance'}
                    title={hidden ? 'Show balance' : 'Hide balance'}
                >
                    {hidden ? <Icon.EyeOffIcon /> : <Icon.EyeIcon />}
                </button>
            </div>
            <div className={styles.amount}>
                {hidden ? <span className={styles.hidden}>•••••</span> : formatBigFiat(total)}
            </div>
            {hasUnpriced || hasSync ? (
                <div className={styles.note}>
                    <span className={styles.noteLeft}>
                        {hasUnpriced
                            ? `${unpriced} ${unpriced === 1 ? 'asset' : 'assets'} not priced`
                            : ''}
                    </span>
                    {hasSync ? (
                        <StalenessLabel
                            lastSyncedAt={lastSyncedAt}
                            warnAfterMs={5 * 60_000}
                            className={styles.noteRight}
                        />
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

/**
 * Larger numbers split into a styled "USD" tail so the eye lands on
 * the digit count, not the symbol. Mirrors the convention every
 * mainstream wallet uses.
 */
function formatBigFiat(usd) {
    if (usd === 0) return '$0.00';
    if (usd > 0 && usd < 0.01) return '<$0.01';
    return '$' + usd.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}
