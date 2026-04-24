import { useEffect, useState } from 'react';
import {
    Screen,
    Button,
    ChainBadge,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { MarketChart } from '../components/MarketChart.jsx';
import { OrderbookPanel } from '../components/OrderbookPanel.jsx';
import { RecentTradesPanel } from '../components/RecentTradesPanel.jsx';
import { PlaceOrderPanel } from '../components/PlaceOrderPanel.jsx';
import { OpenOrdersPanel } from '../components/OpenOrdersPanel.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Market view — §41.3. Trading surface for a single market.
 *
 * Four panels laid out in the spec's ASCII mock:
 *
 *   ┌──────────────────┬──────────────────────────┬──────────────────┐
 *   │   Chart (§41.3.1)│   Orderbook (§41.3.2)    │  Trades (§41.3.3)│
 *   ├──────────────────┴──────────────────────────┴──────────────────┤
 *   │   Place order + My open orders (§41.3.4 + §41.3.5)             │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Each panel lands as its own component in subsequent steps (this is
 * the Step 2 shell). Live data comes in per-step; for now the header
 * renders the market-summary line (last price / 24h change / depth)
 * pulled from `messaging.getMarket` so the scaffold demonstrates the
 * end-to-end passthrough without waiting for the charting libs.
 *
 * Popup vs full variant:
 *   - `full` (extension full-screen, web, desktop) — four-panel grid.
 *   - `popup` — stacks panels vertically; the popup form-factor is
 *     too narrow for a trading grid, but all panels remain reachable.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {() => void} props.onBack
 */
export function MarketView({ walletId, chainId, tick1, tick2, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [summary, setSummary] = useState(/** @type {any | null} */ (null));
    const [summaryError, setSummaryError] = useState(/** @type {string | null} */ (null));
    const [prefillPrice, setPrefillPrice] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        setSummary(null);
        setSummaryError(null);
        messaging.getMarket({ chainId, tick1, tick2 })
            .then((resp) => { if (!cancelled) setSummary(resp); })
            .catch((err) => {
                if (!cancelled) setSummaryError(err?.message || String(err));
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2]);

    const descriptor = chainRegistry.get(chainId);

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back"
            >
                ← Back
            </button>
            <span className={styles.title}>{tick1}/{tick2}</span>
            <span className={styles.spacer} />
        </div>
    );

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    const summaryRow = (
        <dl className={styles.detailsList}>
            <dt className={styles.detailsLabel}>Chain</dt>
            <dd className={styles.detailsValue}>
                {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
            </dd>
            <dt className={styles.detailsLabel}>Pair</dt>
            <dd className={styles.detailsValue}>
                <code>{tick1}/{tick2}</code>
            </dd>
            {summary ? (
                <>
                    {summary.last_price || summary.lastPrice ? (
                        <>
                            <dt className={styles.detailsLabel}>Last price</dt>
                            <dd className={styles.detailsValue}>
                                {summary.last_price || summary.lastPrice}
                            </dd>
                        </>
                    ) : null}
                    {summary.change_24h || summary.change24h ? (
                        <>
                            <dt className={styles.detailsLabel}>24h change</dt>
                            <dd className={styles.detailsValue}>
                                {summary.change_24h || summary.change24h}
                            </dd>
                        </>
                    ) : null}
                </>
            ) : null}
        </dl>
    );

    return wrap(
        <>
            {summaryError ? (
                <div role="alert" className={styles.error}>{summaryError}</div>
            ) : null}
            {summaryRow}

            <div
                className={isFull ? undefined : undefined}
                style={isFull ? {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: '0.75rem',
                    marginTop: '1rem',
                } : {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    marginTop: '1rem',
                }}
            >
                <MarketChart chainId={chainId} tick1={tick1} tick2={tick2} />
                <OrderbookPanel
                    chainId={chainId}
                    tick1={tick1}
                    tick2={tick2}
                    onPickPrice={(price) => setPrefillPrice(price)}
                />
                <RecentTradesPanel chainId={chainId} tick1={tick1} tick2={tick2} />
            </div>

            <div
                style={isFull ? {
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.75rem',
                    marginTop: '0.75rem',
                } : {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    marginTop: '0.75rem',
                }}
            >
                <PlaceOrderPanel
                    walletId={walletId}
                    chainId={chainId}
                    tick1={tick1}
                    tick2={tick2}
                    prefillPrice={prefillPrice}
                />
                <OpenOrdersPanel
                    walletId={walletId}
                    chainId={chainId}
                    tick1={tick1}
                    tick2={tick2}
                />
            </div>

            <div className={styles.actions}>
                <Button variant="ghost" onClick={onBack}>Back</Button>
            </div>
        </>,
    );
}

