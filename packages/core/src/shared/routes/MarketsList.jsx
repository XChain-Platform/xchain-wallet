import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Markets list — §41.2. Landing view for the DEX surface.
 *
 * Two sections:
 *   - **Watchlist** — markets the user has starred (stored per-wallet
 *     in the `watchlistEntries` vault collection). Empty when the
 *     user hasn't pinned anything yet; a hint invites them to star
 *     markets from the Popular list.
 *   - **Popular markets** — the explorer's `getMarkets(tick?)` feed
 *     across whichever chains have addresses on this wallet. Filter
 *     + search narrow the list in-page (no second round-trip).
 *
 * Each row: chain badge, ticker pair, star toggle, and a click target
 * that fires `onOpenMarket(chainId, tick1, tick2)` upstream. The market
 * detail view is Step 2.
 *
 * Explorer-response shape varies chain-to-chain; the helpers near the
 * bottom normalise to `{ tick1, tick2, lastPrice?, change24h?, depth? }`
 * and leave missing fields as "—" on render rather than failing the
 * row.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(chainId: string, tick1: string, tick2: string) => void} props.onOpenMarket
 * @param {() => void} props.onBack
 */
export function MarketsList({ walletId, onOpenMarket, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const chains = useMemo(() => chainRegistry.supportedChains().map((d) => d.id), []);
    const [chainFilter, setChainFilter] = useState(/** @type {string} */ ('all'));
    const [search, setSearch] = useState('');
    const [popularByChain, setPopularByChain] = useState(
        /** @type {Record<string, { rows: any[], error: string | null }>} */ ({}),
    );
    const [watchlist, setWatchlist] = useState(/** @type {any[]} */ ([]));
    const [watchlistHydrated, setWatchlistHydrated] = useState(false);
    const [loading, setLoading] = useState(true);

    const loadWatchlist = useCallback(async () => {
        try {
            const rows = await messaging.listWatchlistForWallet({ walletId });
            setWatchlist(Array.isArray(rows) ? rows : []);
        } catch {
            setWatchlist([]);
        } finally {
            setWatchlistHydrated(true);
        }
    }, [walletId, messaging]);

    // Initial load — watchlist from vault, popular markets from every
    // supported chain in parallel. Failures are per-chain isolated so
    // a single broken explorer doesn't blank the whole view.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all([
            loadWatchlist(),
            Promise.all(chains.map((cid) =>
                messaging.getMarkets({ chainId: cid })
                    .then((resp) => ({ cid, rows: extractRows(resp) }))
                    .catch((err) => ({ cid, error: err?.message || String(err) }))
            )).then((results) => {
                if (cancelled) return;
                /** @type {Record<string, { rows: any[], error: string | null }>} */
                const next = {};
                for (const r of results) {
                    next[r.cid] = r.error
                        ? { rows: [], error: r.error }
                        : { rows: r.rows, error: null };
                }
                setPopularByChain(next);
            }),
        ]).then(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [chains, messaging, loadWatchlist]);

    const watchlistKeySet = useMemo(() => {
        const s = new Set();
        for (const e of watchlist) s.add(`${e.chainId}::${e.tick1}::${e.tick2}`);
        return s;
    }, [watchlist]);

    const toggleStar = useCallback(async (chainId, tick1, tick2) => {
        const key = `${chainId}::${tick1}::${tick2}`;
        const existing = watchlist.find(
            (e) => `${e.chainId}::${e.tick1}::${e.tick2}` === key,
        );
        try {
            if (existing) {
                await messaging.clearWatchlistEntry({ id: existing.id });
            } else {
                await messaging.saveWatchlistEntry({ walletId, chainId, tick1, tick2 });
            }
            await loadWatchlist();
        } catch {
            /* surface via the hint below if persistent */
        }
    }, [watchlist, walletId, messaging, loadWatchlist]);

    const filteredPopular = useMemo(() => {
        const q = search.trim().toUpperCase();
        const targetChains = chainFilter === 'all' ? chains : [chainFilter];
        /** @type {Array<{ chainId: string, market: { tick1: string, tick2: string, lastPrice?: string, change24h?: string, depth?: number } }>} */
        const acc = [];
        for (const cid of targetChains) {
            const entry = popularByChain[cid];
            if (!entry) continue;
            for (const row of entry.rows) {
                const norm = normalizeMarket(row);
                if (!norm) continue;
                if (q && !`${norm.tick1}/${norm.tick2}`.toUpperCase().includes(q)) continue;
                acc.push({ chainId: cid, market: norm });
            }
        }
        return acc;
    }, [popularByChain, chainFilter, chains, search]);

    const filteredWatchlist = useMemo(() => {
        const q = search.trim().toUpperCase();
        const rows = chainFilter === 'all'
            ? watchlist
            : watchlist.filter((e) => e.chainId === chainFilter);
        if (!q) return rows;
        return rows.filter((e) => `${e.tick1}/${e.tick2}`.toUpperCase().includes(q));
    }, [watchlist, chainFilter, search]);

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
            <span className={styles.title}>Markets</span>
            <span className={styles.spacer} />
        </div>
    );

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loading && !watchlistHydrated) {
        return wrap(<p className={styles.hint}>Loading markets…</p>);
    }

    return wrap(
        <>
            <label className={styles.pickerLabel}>
                Chain
                <select
                    className={styles.picker}
                    value={chainFilter}
                    onChange={(e) => setChainFilter(e.target.value)}
                    aria-label="Chain filter"
                >
                    <option value="all">All chains</option>
                    {chains.map((cid) => {
                        const d = chainRegistry.get(cid);
                        return (
                            <option key={cid} value={cid}>
                                {d ? `${d.displayName} (${d.networkKind})` : cid}
                            </option>
                        );
                    })}
                </select>
            </label>
            <Input
                label="Search"
                placeholder="TICK or TICK/TICK"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />

            <section>
                <p className={styles.successLabel}>Watchlist</p>
                {filteredWatchlist.length === 0 ? (
                    <p className={styles.hint}>
                        {watchlist.length === 0
                            ? 'No pinned markets yet. Tap ☆ on any market below to watch it.'
                            : 'No matches in your watchlist for this filter.'}
                    </p>
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {filteredWatchlist.map((entry) => (
                            <MarketRow
                                key={entry.id}
                                chainId={entry.chainId}
                                tick1={entry.tick1}
                                tick2={entry.tick2}
                                starred
                                onOpen={() => onOpenMarket(entry.chainId, entry.tick1, entry.tick2)}
                                onToggleStar={() => toggleStar(entry.chainId, entry.tick1, entry.tick2)}
                            />
                        ))}
                    </ul>
                )}
            </section>

            <section style={{ marginTop: '1rem' }}>
                <p className={styles.successLabel}>Popular markets</p>
                {filteredPopular.length === 0 ? (
                    <p className={styles.hint}>
                        {search.trim()
                            ? 'No markets match your search.'
                            : 'No markets on the selected chain.'}
                    </p>
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {filteredPopular.map(({ chainId, market }) => (
                            <MarketRow
                                key={`${chainId}::${market.tick1}::${market.tick2}`}
                                chainId={chainId}
                                tick1={market.tick1}
                                tick2={market.tick2}
                                lastPrice={market.lastPrice}
                                change24h={market.change24h}
                                depth={market.depth}
                                starred={watchlistKeySet.has(`${chainId}::${market.tick1}::${market.tick2}`)}
                                onOpen={() => onOpenMarket(chainId, market.tick1, market.tick2)}
                                onToggleStar={() => toggleStar(chainId, market.tick1, market.tick2)}
                            />
                        ))}
                    </ul>
                )}
            </section>

            {Object.values(popularByChain).some((e) => e.error) ? (
                <p className={styles.hint}>
                    Some chains could not load market data right now — they're
                    hidden until the explorer comes back.
                </p>
            ) : null}

            <div className={styles.actions}>
                <Button variant="ghost" onClick={onBack}>Back</Button>
            </div>
        </>,
    );
}

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {string} [props.lastPrice]
 * @param {string} [props.change24h]
 * @param {number} [props.depth]
 * @param {boolean} [props.starred]
 * @param {() => void} props.onOpen
 * @param {() => void} props.onToggleStar
 */
function MarketRow({ chainId, tick1, tick2, lastPrice, change24h, depth, starred, onOpen, onToggleStar }) {
    const descriptor = chainRegistry.get(chainId);
    return (
        <li style={{ padding: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
                type="button"
                onClick={onToggleStar}
                aria-label={starred ? 'Remove from watchlist' : 'Add to watchlist'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}
            >
                {starred ? '★' : '☆'}
            </button>
            {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
            <button
                type="button"
                onClick={onOpen}
                style={{
                    flex: 1,
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                }}
            >
                <strong>{tick1}/{tick2}</strong>
                {lastPrice ? <span>last {lastPrice}</span> : null}
                {change24h ? <span>{change24h}</span> : null}
                {typeof depth === 'number' && Number.isFinite(depth) ? (
                    <span>depth {depth}</span>
                ) : null}
            </button>
        </li>
    );
}

// --- Explorer-response normalisation ------------------------------

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.markets)) return resp.markets;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

/**
 * Normalize a market row. The explorer returns one of several shapes
 * depending on version; pick out the fields we render and fail closed
 * (return null) if the row can't even yield a ticker pair.
 */
function normalizeMarket(row) {
    if (!row || typeof row !== 'object') return null;
    const tick1 = row.tick1 || row.tickA || row.give_tick || row.base || null;
    const tick2 = row.tick2 || row.tickB || row.get_tick || row.quote || null;
    if (!tick1 || !tick2) return null;
    const lastPrice = row.last_price || row.lastPrice || row.last || null;
    const change24h = row.change_24h || row.change24h || null;
    const depthRaw = row.depth ?? row.open_orders ?? row.orderCount;
    const depth = typeof depthRaw === 'number' ? depthRaw : Number(depthRaw);
    return {
        tick1: String(tick1),
        tick2: String(tick2),
        lastPrice: lastPrice ? String(lastPrice) : undefined,
        change24h: change24h ? String(change24h) : undefined,
        depth: Number.isFinite(depth) ? depth : undefined,
    };
}
