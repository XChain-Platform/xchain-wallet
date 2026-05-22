import { useMemo } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { sumFiatValue } from './BalanceList.jsx';
import { StalenessLabel } from './StalenessLabel.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
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
    const { settings } = useSettings();
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const [hidden, toggleHidden] = useBalancesHidden();

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
                    onClick={toggleHidden}
                    aria-label={hidden ? 'Show balance' : 'Hide balance'}
                    title={hidden ? 'Show balance' : 'Hide balance'}
                >
                    {hidden ? <Icon.EyeOffIcon /> : <Icon.EyeIcon />}
                </button>
            </div>
            <div className={styles.amount}>
                {hidden ? (
                    <span className={styles.hidden}>•••••</span>
                ) : (
                    <>
                        {formatFiatAmount(total, fiatCurrency)}
                        <span className={styles.amountCode}>{fiatCurrency}</span>
                    </>
                )}
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

// Format the numeric portion of the total balance in the wallet's
// preferred fiat. Uses Intl so symbols + decimal conventions are
// correct per currency (¥ for JPY with no decimals, € for EUR, etc.);
// the ISO code is rendered separately as a styled suffix span so it
// can be sized down to ~half the amount text.
function formatFiatAmount(value, currency) {
    if (value === null || value === undefined) return '—';
    const code = String(currency || 'USD').toUpperCase();
    try {
        const fmt = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: code,
            currencyDisplay: 'symbol',
        });
        const minorUnit = fmt.resolvedOptions().maximumFractionDigits === 0 ? 1 : 0.01;
        if (value > 0 && value < minorUnit) return `<${fmt.format(minorUnit)}`;
        return fmt.format(value);
    } catch {
        return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
}
