// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Icon, ListPage, NetworkField, PageHeader, Screen, Select, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useChainIdsWithAction } from '../hooks/useSupportedChains.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { outcomeLabelsOf } from '../utils/betOutcomeLabels.js';
// The standard title-line filter, the gauge card and the wallet's bets loader.
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { BetMarketCard, betPoolTotal } from '../components/BetMarketCard.jsx';
import { useWalletBets, yourPositionText } from '../components/BetMyBetsPanel.jsx';
import {
    LIST_DETAIL_MIN_WIDTH,
    ListDetailSplit,
    listDetailStyles,
    useWideContent,
} from '../components/PanelSplit.jsx';
import local from './BetFeedsList.module.css';

/** The tab ids a caller may open the list on. */
export const BET_LIST_VIEWS = ['all', 'bets', 'markets'];

const marketKey = (chainId, m) => `${chainId}:${m?.action_index}`;
const sameMarket = (a, b) => Boolean(a && b
    && a.chainId === b.chainId
    && String(a.feedIndex) === String(b.feedIndex));

/**
 * The markets one tab lists, before the search and sort. All three tabs are
 * the same list (operator ruling 2026-11-13): My bets and My markets only
 * narrow the markets listed, so they share its network, status, search,
 * sort and cards. My bets keeps the markets this wallet has a bet in; My
 * markets keeps the markets one of this network's wallet addresses created
 * (the explorer's `source`; its rows come from the per-address creator
 * read, so the filter only guards a stale render).
 *
 * @param {'all' | 'bets' | 'markets'} view
 * @param {any[]} rows                 the network's markets, as All lists them
 * @param {object} ctx
 * @param {string} ctx.chainId
 * @param {Map<string, any[]>} ctx.betsByMarket   the wallet's bets, keyed chain:market
 * @param {Set<string>} ctx.ownAddresses          the wallet's addresses on chainId
 * @returns {any[]}
 */
export function marketsForView(view, rows, { chainId, betsByMarket, ownAddresses }) {
    if (view === 'bets') return rows.filter((m) => betsByMarket.has(marketKey(chainId, m)));
    if (view === 'markets') return rows.filter((m) => ownAddresses.has(String(m?.source || '')));
    return rows;
}

// What a tab says when none of the listed markets is the tab's. Status
// defaults to Taking bets, so a settled bet or market sits behind that
// filter rather than being missing; a wallet that has bets, just not on
// the markets listed here, is told so instead of "No bets yet".
function emptyViewState(view, openOnly, hasBets) {
    const behindFilter = openOnly ? ' Set Status to All markets to see settled ones.' : '';
    if (view === 'bets') {
        if (hasBets) {
            return { title: 'No positions in these markets', body: `Your positions are in markets outside this network or filter.${behindFilter}` };
        }
        return { title: 'No predictions yet', body: `Markets where this wallet buys a position appear here.${behindFilter}` };
    }
    return { title: 'No markets yet', body: `Prediction markets created by this wallet appear here.${behindFilter}` };
}

const chainRegistry = registryLib.defaultRegistry();

// Chains whose descriptor advertises BET, asked of the LIVE registry (the
// same way governance derives its own list), so a chain gaining or losing the
// action needs no edit here and a synced descriptor lands without a restart.
export function useBetChainIds() {
    return useChainIdsWithAction('BET');
}

// How often the market list re-reads the chain while it is on screen. Matches
// the OracleConsole tick, which is the same problem on the other side of the
// role boundary (its gating is re-derived every 30s for the same reason).
const REFRESH_MS = 30_000;

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

// Search matches the question, the outcomes, the token and the
// market number.
function matchesSearch(m, needle) {
    if (!needle) return true;
    return [m.label, m.tick, String(m.action_index ?? ''), `#${m.action_index ?? ''}`, ...outcomeLabelsOf(m)]
        .some((v) => String(v || '').toLowerCase().includes(needle));
}

// The Sort choices in the filter. Newest keeps the explorer's own
// order (newest first).
function sortMarkets(rows, sortBy) {
    if (sortBy === 'closing') {
        const at = (m) => {
            const d = Number(m.deadline);
            return Number.isFinite(d) && d > 0 ? d : Number.POSITIVE_INFINITY;
        };
        return [...rows].sort((a, b) => at(a) - at(b));
    }
    if (sortBy === 'pool') {
        const size = (m) => Number(betPoolTotal(m) ?? 0) || 0;
        return [...rows].sort((a, b) => size(b) - size(a));
    }
    return rows;
}

/**
 * Betting market browser. Resolves the wallet's BET-capable chains, lists that
 * chain's markets (newest first), and is the entry point into a market's detail
 * page. Read-only itself (calls messaging.betFeeds, an explorer read).
 *
 * The All, My bets and My markets tabs draw one list. The page's reads are
 * the wallet's addresses, the network's markets (All and My bets) or the
 * markets each address created (My markets), and the wallet's bets, one per
 * address: none grows with the markets on screen.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(chainId: string, feedIndex: string | number) => void} props.onOpenMarket
 * @param {(chainId: string) => void} [props.onCreate]
 * @param {'all' | 'bets' | 'markets'} [props.view]   The tab to show (the shell keeps it, so
 *   the My bets and My markets palette entries open the list on their tab)
 * @param {(view: string) => void} [props.onViewChange]  Told when the user picks a tab
 * @param {() => void} props.onBack
 * @param {{ chainId: string, feedIndex: string | number } | null} [props.selectedMarket]
 * @param {(market: { chainId: string, feedIndex: string | number }) => void} [props.onSelectMarket]
 * @param {(market: { chainId: string, feedIndex: string | number }) => import('react').ReactNode} [props.renderMarket]
 * @param {(market: { chainId: string, feedIndex: string | number }, page: { measureRef: (el: HTMLElement | null) => void }) => import('react').ReactNode} [props.renderMarketPage]
 */
export function BetFeedsList({
    walletId,
    onOpenMarket,
    onCreate,
    view: viewProp,
    onViewChange,
    onBack,
    selectedMarket = null,
    onSelectMarket,
    renderMarket,
    renderMarketPage,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const betChainIds = useBetChainIds();
    const canSplit = typeof renderMarket === 'function';
    const [layoutRef, wideContent, measured] = useWideContent(LIST_DETAIL_MIN_WIDTH, canSplit);
    const twoPanel = canSplit && wideContent;
    const detailRoute = typeof renderMarketPage === 'function' && Boolean(selectedMarket);
    const listShown = !detailRoute || (measured && twoPanel);
    const [localSelection, setLocalSelection] = useState(null);

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [noChain, setNoChain] = useState(false);
    const [betChains, setBetChains] = useState(/** @type {string[]} */ ([]));
    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [addressesReload, setAddressesReload] = useState(0);
    const [feedsReload, setFeedsReload] = useState(0);
    // The title-line filter (search, Network, Status, Sort) and the
    // All | My bets | My markets tabs above the list.
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('open');
    const [sortBy, setSortBy] = useState('newest');
    // The shell may hold the tab (a `view` prop); otherwise the list does.
    const [ownView, setOwnView] = useState(BET_LIST_VIEWS.includes(viewProp) ? viewProp : 'all');
    const view = BET_LIST_VIEWS.includes(viewProp) ? viewProp : ownView;
    const setView = (next) => {
        setOwnView(next);
        onViewChange?.(next);
    };
    const openOnly = statusFilter === 'open';

    // The wallet's addresses from the one read below, shared with the
    // bets loader and the My markets filter so neither asks again.
    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    // The wallet's bets, read once for the cards' "You bet" chips and the My bets tab.
    const walletBets = useWalletBets({ byChain: addressesByChain, messaging });

    useEffect(() => {
        if (!listShown) return undefined;
        let cancelled = false;
        setChainId(null);
        setNoChain(false);
        setBetChains([]);
        setRows(null);
        setError(null);
        setAddressesByChain(null);
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const avail = betChainIds.filter((cid) => Array.isArray(byChain?.[cid]) && byChain[cid].length > 0);
                setBetChains(avail);
                if (avail.length > 0) {
                    const requestedChain = selectedMarket?.chainId;
                    setChainId(requestedChain && avail.includes(requestedChain) ? requestedChain : avail[0]);
                }
                else setNoChain(true);
            })
            .catch((err) => {
                if (!cancelled) setError(userFacingMessage(err, 'Could not load prediction market addresses. Try again.'));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, betChainIds, addressesReload, listShown]);

    // The wallet's addresses on the shown network: a market one of them
    // created is this wallet's market.
    const ownAddresses = useMemo(() => new Set(
        (addressesByChain?.[chainId] || []).map((a) => String(a?.address || '')).filter(Boolean),
    ), [addressesByChain, chainId]);

    // Which read fills the list. My markets asks for the markets each of
    // the wallet's addresses created (one read per address, never per
    // market), so a market older than the network's newest 50 is still
    // listed; All and My bets share the network's own list.
    const readMode = view === 'markets' ? 'own' : 'network';
    const [rowsMode, setRowsMode] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        if (!chainId) return undefined;
        let cancelled = false;
        let latestRequestId = 0;

        // The markets this network's wallet addresses created, newest first,
        // with the Status filter applied here since a creator read carries
        // every status. Fails only when no address answered.
        const readOwn = () => Promise.all([...ownAddresses].map((address) => Promise.resolve()
            .then(() => messaging.betFeeds({ chainId, query: address, type: 'source', opts: { limit: 100 } }))
            .then(extractRows)
            .catch(() => null)))
            .then((answers) => {
                if (answers.length > 0 && answers.every((a) => a === null)) {
                    throw new Error('No market source answered.');
                }
                const seen = new Set();
                const all = [];
                for (const m of answers.flat()) {
                    if (!m || seen.has(String(m.action_index))) continue;
                    seen.add(String(m.action_index));
                    if (!openOnly || m.feed_status === 'open') all.push(m);
                }
                return all.sort((a, b) => Number(b.action_index || 0) - Number(a.action_index || 0));
            });

        // `clear` separates the FIRST read of a chain/filter from the refreshes
        // that follow it: blanking the rows is what shows "Loading markets…",
        // and doing that every 30 seconds would flash the whole list.
        const load = (clear) => {
            const requestId = ++latestRequestId;
            if (clear) { setRows(null); setError(null); }
            // Filter on the stored feed status rather than fetching everything and
            // deciding client-side, so paging stays meaningful on a busy chain.
            const req = openOnly
                ? { chainId, query: 'open', type: 'status', opts: { limit: 50 } }
                : { chainId, opts: { limit: 50 } };
            const read = readMode === 'own'
                ? readOwn()
                : messaging.betFeeds(req).then(extractRows);
            return read
                .then((list) => {
                    if (!cancelled && requestId === latestRequestId) {
                        setRows(list);
                        setRowsMode(readMode);
                        setError(null);
                    }
                })
                .catch((err) => {
                    // A failed REFRESH keeps the markets already on screen: they
                    // are still the best thing known about the chain, and
                    // replacing them with an error would punish a momentary blip.
                    if (cancelled || requestId !== latestRequestId) return;
                    if (clear) setError(userFacingMessage(err, 'Could not load prediction markets. Try again.'));
                });
        };

        load(true);
        // A market's status is a property of the CHAIN and changes without the
        // user doing anything: a deadline passes, an oracle resolves, someone
        // opens a new market. Nothing here used to re-read, so a hub left open
        // kept saying "Taking bets" about a market that had closed, and
        // re-selecting Betting from the palette did not help - the route is
        // already mounted, so nothing re-runs. Measured in a live run: six list
        // requests, all in the first thirty seconds, and none after the market
        // closed several minutes later.
        // No visibility gate on purpose. The wallet's background-poll routes
        // gate on `document.visibilityState`, which is right for a poll that
        // drives a submit; this one only replaces a read-only list, and a gate
        // would leave a returning user looking at whatever was true when they
        // last had the tab in front of them.
        const timer = setInterval(() => load(false), REFRESH_MS);
        return () => { cancelled = true; clearInterval(timer); };
    }, [chainId, openOnly, messaging, feedsReload, readMode, ownAddresses]);

    const betsByMarket = useMemo(() => {
        const map = new Map();
        for (const b of walletBets.rows || []) {
            const key = `${b.chainId}:${b.feed_action_index}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(b);
        }
        return map;
    }, [walletBets.rows]);

    // The right panel follows a shell-held pick, then a pick made in this list.
    // All's first row seeds the initial selection. After that, tabs and filters
    // affect only the left list: even an empty or loading view keeps the detail
    // the user was already reading.
    const betsPending = view === 'bets' && walletBets.rows === null && !walletBets.error;
    const liveRows = rowsMode === readMode ? rows : null;
    const inView = liveRows && !betsPending
        ? marketsForView(view, liveRows, { chainId, betsByMarket, ownAddresses })
        : null;
    const orderedRows = inView ? sortMarkets(inView, sortBy) : null;
    const needle = query.trim().toLowerCase();
    const shown = orderedRows ? orderedRows.filter((m) => matchesSearch(m, needle)) : null;
    const requested = selectedMarket || localSelection;
    const firstAllRef = view === 'all' && orderedRows?.[0]
        ? { chainId, feedIndex: orderedRows[0].action_index }
        : null;
    const shownRef = twoPanel
        ? (requested || firstAllRef)
        : null;
    const shownMarket = shownRef && liveRows
        ? liveRows.find((m) => String(m.action_index) === String(shownRef.feedIndex)) || null
        : null;

    useEffect(() => {
        if (shownRef && !requested) setLocalSelection(shownRef);
        if (shownRef && !sameMarket(shownRef, selectedMarket)) onSelectMarket?.(shownRef);
    }, [shownRef?.chainId, shownRef?.feedIndex, requested, selectedMarket?.chainId, selectedMarket?.feedIndex, onSelectMarket]);

    // The title bar holds the filter (search, Network, Status, Sort)
    // and a plus for Create market at the far right; the icon is lit when any
    // filter is off its default.
    const defaultChain = betChains[0] || null;
    const filterOn = statusFilter !== 'open' || sortBy !== 'newest' || Boolean(defaultChain && chainId && chainId !== defaultChain);
    const offeredChains = betChains.length ? betChains : (chainId ? [chainId] : []);
    const header = (
        <PageHeader
            onBack={onBack}
            title="Prediction Markets"
            trailing={chainId ? (
                <>
                    <ListFilterMenu
                        query={query}
                        onQueryChange={setQuery}
                        active={filterOn}
                        label="Filter prediction markets"
                        searchPlaceholder="Search"
                        searchLabel="Search prediction markets"
                    >
                        {/* The standard Network field opens the full-screen
                            network list (operator ruling 2026-11-13). */}
                        <NetworkField
                            label="Network"
                            help="Shows the prediction markets on the network you pick."
                            size="md"
                            value={chainId}
                            onChange={setChainId}
                            chainIds={offeredChains}
                            chainRegistry={chainRegistry}
                            notSource
                        />
                        <Select
                            label="Status"
                            help="Shows only markets where positions are available, or every market."
                            size="md"
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value)}
                        >
                            <Select.Option value="open" icon={<Icon.PlayIcon />}>Positions available</Select.Option>
                            <Select.Option value="all" icon={<Icon.ListIcon />}>All markets</Select.Option>
                        </Select>
                        <Select
                            label="Sort"
                            help="The order the markets are listed in: newest, closing soonest, or biggest pool."
                            size="md"
                            value={sortBy}
                            onChange={(event) => setSortBy(event.target.value)}
                        >
                            <Select.Option value="newest" icon={<Icon.HistoryIcon />}>Newest first</Select.Option>
                            <Select.Option value="closing" icon={<Icon.ClockIcon />}>Closing soonest</Select.Option>
                            <Select.Option value="pool" icon={<Icon.CoinsIcon />}>Biggest pool</Select.Option>
                        </Select>
                    </ListFilterMenu>
                    {onCreate ? (
                        <Button variant="secondary" icon={<Icon.PlusIcon />} aria-label="Create market" title="Create market" onClick={() => onCreate(chainId)}>
                            {null}
                        </Button>
                    ) : null}
                </>
            ) : null}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="list">
                {children}
            </div>
        </Screen>
    );

    // A deep-linked market keeps its standalone page below the breakpoint and
    // rejoins the list at wide widths. The detail page keeps the measuring ref
    // while it is standalone so resizing can switch layouts in either direction.
    if (detailRoute && !(measured && twoPanel)) {
        if (!measured) return wrap(null);
        return renderMarketPage(selectedMarket, { measureRef: layoutRef });
    }

    if (noChain) {
        return wrap(
            <ListPage>
                <EmptyState
                    title="No prediction market address"
                    body="Prediction markets require an address on a supported network."
                />
            </ListPage>,
        );
    }
    if (!chainId && !error) {
        return wrap(
            <ListPage>
                <div role="status" aria-label="Loading prediction market addresses" aria-busy="true">
                    Loading prediction market addresses…
                </div>
            </ListPage>,
        );
    }
    if (!chainId) {
        return wrap(
            <ListPage>
                <StatusMessage
                    variant="error"
                    recovery={{ label: 'Try Again', onAction: () => setAddressesReload((value) => value + 1) }}
                >
                    {error}
                </StatusMessage>
            </ListPage>,
        );
    }

    // One card for every tab. The wallet's own stake and the "Your market"
    // chip ride on it wherever the market is listed, so a market looks the
    // same on All as on My bets or My markets.
    const card = (m) => {
        const ref = { chainId, feedIndex: m.action_index };
        const selected = twoPanel && sameMarket(ref, shownRef);
        return (
        <li key={marketKey(chainId, m)} data-selected={selected ? 'true' : undefined}>
            <BetMarketCard
                market={m}
                onOpen={() => {
                    if (!twoPanel) {
                        onOpenMarket(chainId, m.action_index);
                        return;
                    }
                    setLocalSelection(ref);
                    onSelectMarket?.(ref);
                }}
                selected={selected}
                className={twoPanel ? local.splitRow : undefined}
                yourPosition={yourPositionText(betsByMarket.get(marketKey(chainId, m)), m)}
                yours={ownAddresses.has(String(m?.source || ''))}
            />
        </li>
        );
    };
    let emptyState = null;
    if (readMode === 'network' && liveRows && liveRows.length === 0) {
        emptyState = (
            <EmptyState
                title="No markets"
                body={openOnly ? 'No markets offer positions on this network right now.' : 'Markets created on this network appear here.'}
            />
        );
    } else if (inView && inView.length === 0) {
        const copy = emptyViewState(view, openOnly, (walletBets.rows || []).length > 0);
        emptyState = <EmptyState title={copy.title} body={copy.body} />;
    } else if (shown && shown.length === 0) {
        emptyState = <EmptyState title="No matching markets" body="Change or clear the filter to see more." titleAs="p" />;
    }
    const body = (
        <>
            {emptyState}
            {shown && shown.length > 0 ? (
                <div className={local.cardArea}>
                    <ul className={local.marketList} aria-label="Prediction markets" data-xc-split-list={twoPanel ? '' : undefined}>
                        {shown.map(card)}
                    </ul>
                </div>
            ) : null}
        </>
    );

    let notice = null;
    if (error) {
        notice = (
            <StatusMessage
                variant="error"
                recovery={{ label: 'Try Again', onAction: () => setFeedsReload((value) => value + 1) }}
            >
                {error}
            </StatusMessage>
        );
    } else if (!liveRows || betsPending) {
        notice = (
            <div role="status" aria-label="Loading prediction markets" aria-busy="true">
                Loading prediction markets…
            </div>
        );
    } else if (view === 'bets' && walletBets.error) {
        notice = (
            <StatusMessage variant="error" recovery={{ label: 'Try Again', onAction: walletBets.reload }}>
                {walletBets.error}
            </StatusMessage>
        );
    }

    const tabsToolbar = (
        <div className={`${local.toolbarRow} ${local.toolbarActions}`}>
            <Tabs
                aria-label="Prediction market views"
                items={[
                    { id: 'all', label: <span className={local.tabLabel}><Icon.GridIcon />All</span> },
                    { id: 'bets', label: <span className={local.tabLabel}><Icon.UserIcon />My predictions</span> },
                    { id: 'markets', label: <span className={local.tabLabel}><Icon.MarketIcon />My markets</span> },
                ]}
                value={view}
                onChange={setView}
            />
        </div>
    );

    const listPage = (
        <ListPage notices={notice} toolbar={twoPanel ? undefined : tabsToolbar}>
            {body}
        </ListPage>
    );
    // The split and its docked tabs are structural, not a data state. Empty,
    // loading and error results belong inside the left panel and never unmount
    // either the tabs or an existing detail.
    const showPanel = twoPanel;
    if (showPanel) {
        const fallback = <div role="status" aria-label="Loading market detail">Loading market…</div>;
        // With nothing picked, the detail loads only while the list does; once
        // the list has answered it says to pick a market, as Dispensers does.
        const detailPending = (!liveRows || betsPending) && !error;
        const detailEmpty = (
            <EmptyState
                title="Select a prediction market"
                body="Choose a prediction market from the list to see its details."
            />
        );
        return (
            <Screen variant={variant} header={header} bodyClassName={listDetailStyles.twoPanelBody}>
                <ListDetailSplit
                    measureRef={layoutRef}
                    storageKey="bets"
                    resizeLabel="Resize the prediction markets list"
                    resizeHint="Drag to resize the prediction markets list, or press Enter to reset."
                    layoutName="two-panel"
                    listHeader={tabsToolbar}
                    list={listPage}
                    listLabel="Prediction markets"
                    detailLabel={shownMarket?.label || 'Prediction market'}
                    detailBusy={!shownRef && detailPending}
                    detailFallback={fallback}
                    detail={shownRef ? (
                        <Fragment key={`${shownRef.chainId}:${shownRef.feedIndex}`}>
                            {renderMarket(shownRef)}
                        </Fragment>
                    ) : detailPending ? fallback : detailEmpty}
                />
            </Screen>
        );
    }
    return wrap(listPage);
}
