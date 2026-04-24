// OrderbookPanel — §41.3.2 depth-visualized orderbook.
//
// Two columns (bids / asks). Each row renders price, size, cumulative
// total, and a depth bar proportional to cumulative / maxCumulative.
// Clicking a row fires `onPickPrice(price)` so the Place Order form
// can prefill it (standard trader shortcut).
//
// Polling cadence:
//   - 5s on active market view (matches the AirdropForm polling
//     pattern elsewhere in the wallet).
//   - Pauses when `document.visibilityState === 'hidden'` to avoid
//     burning explorer bandwidth for off-screen tabs. WS push is
//     Phase 4+ work once the explorer exposes a stream.

import { useEffect, useRef, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
import { normalizeOrderbook } from '../../market/orderbook.js';

const POLL_INTERVAL_MS = 5000;

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {(price: string) => void} [props.onPickPrice]
 */
export function OrderbookPanel({ chainId, tick1, tick2, onPickPrice }) {
    const { messaging } = useMessaging();
    const [book, setBook] = useState(/** @type {any} */ ({ bids: [], asks: [], maxCumulative: 0 }));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [lastRefreshed, setLastRefreshed] = useState(0);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const tick = async () => {
            if (cancelled) return;
            if (typeof document !== 'undefined'
                && document.visibilityState === 'hidden') return;
            try {
                const resp = await messaging.getOrderbook({ chainId, tick1, tick2 });
                if (cancelled) return;
                setBook(normalizeOrderbook(resp));
                setLoadError(null);
                setLastRefreshed(Date.now());
            } catch (err) {
                if (cancelled) return;
                setLoadError(err?.message || String(err));
            }
        };
        tick();
        const handle = setInterval(tick, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(handle);
        };
    }, [messaging, chainId, tick1, tick2]);

    return (
        <div
            style={{
                border: '1px solid var(--xc-border)',
                borderRadius: '4px',
                padding: '0.5rem',
            }}
        >
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Orderbook</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <LevelsColumn
                    title="Bids"
                    side="bid"
                    levels={book.bids}
                    maxCumulative={book.maxCumulative}
                    onPickPrice={onPickPrice}
                    tick2={tick2}
                    tick1={tick1}
                />
                <LevelsColumn
                    title="Asks"
                    side="ask"
                    levels={book.asks}
                    maxCumulative={book.maxCumulative}
                    onPickPrice={onPickPrice}
                    tick2={tick2}
                    tick1={tick1}
                />
            </div>
            {loadError ? (
                <p style={{ margin: '0.25rem 0 0', color: 'var(--xc-fg-muted)', fontSize: '0.75rem' }}>
                    {loadError}
                </p>
            ) : null}
            {!loadError && book.bids.length === 0 && book.asks.length === 0 ? (
                <p style={{ margin: '0.25rem 0 0', color: 'var(--xc-fg-muted)', fontSize: '0.75rem' }}>
                    No open orders on this market.
                </p>
            ) : null}
        </div>
    );
}

function LevelsColumn({ title, side, levels, maxCumulative, onPickPrice, tick1, tick2 }) {
    return (
        <div>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '0.25rem',
                    fontSize: '0.75rem',
                    color: 'var(--xc-fg-muted)',
                    padding: '0 0.25rem 0.25rem',
                }}
            >
                <span>{title} ({tick2})</span>
                <span>Size ({tick1})</span>
                <span>Total</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {levels.map((level) => (
                    <LevelRow
                        key={`${side}-${level.displayPrice}`}
                        level={level}
                        maxCumulative={maxCumulative}
                        side={side}
                        onPick={onPickPrice ? () => onPickPrice(level.displayPrice) : null}
                    />
                ))}
            </ul>
        </div>
    );
}

function LevelRow({ level, maxCumulative, side, onPick }) {
    const depthPct = maxCumulative > 0
        ? Math.min(100, Math.max(0, (level.cumulative / maxCumulative) * 100))
        : 0;
    const depthColor = side === 'bid'
        ? 'rgba(38, 166, 154, 0.18)'
        : 'rgba(239, 83, 80, 0.18)';
    const content = (
        <div
            style={{
                position: 'relative',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '0.25rem',
                padding: '0.15rem 0.25rem',
                fontSize: '0.8rem',
            }}
        >
            <span
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    top: 0, bottom: 0,
                    [side === 'bid' ? 'right' : 'left']: 0,
                    width: `${depthPct}%`,
                    background: depthColor,
                    pointerEvents: 'none',
                }}
            />
            <span style={{ position: 'relative', color: side === 'bid' ? '#26a69a' : '#ef5350' }}>
                {level.displayPrice}
            </span>
            <span style={{ position: 'relative' }}>{level.displaySize}</span>
            <span style={{ position: 'relative', color: 'var(--xc-fg-muted)' }}>
                {level.cumulative.toString()}
            </span>
        </div>
    );
    if (!onPick) {
        return <li>{content}</li>;
    }
    return (
        <li>
            <button
                type="button"
                onClick={onPick}
                aria-label={`Pick price ${level.displayPrice}`}
                style={{
                    display: 'block',
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    textAlign: 'left',
                }}
            >
                {content}
            </button>
        </li>
    );
}
