// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Icon, ListPage, PageHeader, Screen, Select, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useChainIdsWithAction } from '../hooks/useSupportedChains.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { outcomeLabelsOf } from '../utils/betOutcomeLabels.js';
// The standard title-line filter, the gauge card and the My bets tab body.
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { BetMarketCard, betPoolTotal } from '../components/BetMarketCard.jsx';
import { BetMyBetsPanel, useWalletBets, yourBetText } from '../components/BetMyBetsPanel.jsx';
// The My markets tab is the oracle console drawn inside this page.
import { OracleConsole } from './OracleConsole.jsx';
import local from './BetFeedsList.module.css';

/** The tab ids a caller may open the list on. */
export const BET_LIST_VIEWS = ['all', 'bets', 'markets'];

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
 * @param {object} props
 * @param {string} props.walletId
 * @param {(chainId: string, feedIndex: string | number) => void} props.onOpenMarket
 * @param {(chainId: string) => void} [props.onCreate]
 * @param {'all' | 'bets' | 'markets'} [props.view]   The tab to show (the shell keeps it, so
 *   the My bets and My markets palette entries open the list on their tab)
 * @param {(view: string) => void} [props.onViewChange]  Told when the user picks a tab
 * @param {(chainId: string, feedIndex: string | number) => void} [props.onDuplicate]  My markets'
 *   "Copy to a new market" (a new market pre-filled from this one)
 * @param {() => void} props.onBack
 */
export function BetFeedsList({ walletId, onOpenMarket, onCreate, onDuplicate, view: viewProp, onViewChange, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const betChainIds = useBetChainIds();

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
    // bets loader and the My markets tab so neither asks again.
    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    // The wallet's bets, read once for the cards' "You bet" chips and the My bets tab.
    const walletBets = useWalletBets({ byChain: addressesByChain, messaging });

    useEffect(() => {
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
                if (avail.length > 0) setChainId(avail[0]);
                else setNoChain(true);
            })
            .catch((err) => {
                if (!cancelled) setError(userFacingMessage(err, 'Could not load betting addresses. Try again.'));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, betChainIds, addressesReload]);

    useEffect(() => {
        if (!chainId) return undefined;
        let cancelled = false;
        let latestRequestId = 0;

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
            return messaging.betFeeds(req)
                .then((resp) => {
                    if (!cancelled && requestId === latestRequestId) {
                        setRows(extractRows(resp));
                        setError(null);
                    }
                })
                .catch((err) => {
                    // A failed REFRESH keeps the markets already on screen: they
                    // are still the best thing known about the chain, and
                    // replacing them with an error would punish a momentary blip.
                    if (cancelled || requestId !== latestRequestId) return;
                    if (clear) setError(userFacingMessage(err, 'Could not load betting markets. Try again.'));
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
    }, [chainId, openOnly, messaging, feedsReload]);

    // My markets is the oracle console drawn in this page (below), which
    // reads the markets this wallet's addresses run, with the owner records its
    // actions sign from.

    const betsByMarket = useMemo(() => {
        const map = new Map();
        for (const b of walletBets.rows || []) {
            const key = `${b.chainId}:${b.feed_action_index}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(b);
        }
        return map;
    }, [walletBets.rows]);

    // The title bar holds the filter (search, Network, Status, Sort)
    // and a plus for Create market at the far right; the icon is lit when any
    // filter is off its default.
    const defaultChain = betChains[0] || null;
    const filterOn = statusFilter !== 'open' || sortBy !== 'newest' || Boolean(defaultChain && chainId && chainId !== defaultChain);
    const offeredChains = betChains.length ? betChains : (chainId ? [chainId] : []);
    const header = (
        <PageHeader
            onBack={onBack}
            title="Bet Markets"
            trailing={chainId ? (
                <>
                    <ListFilterMenu
                        query={query}
                        onQueryChange={setQuery}
                        active={filterOn}
                        label="Filter bet markets"
                        searchPlaceholder="Search"
                        searchLabel="Search bet markets"
                    >
                        <Select
                            label="Network"
                            size="md"
                            value={chainId}
                            onChange={(event) => setChainId(event.target.value)}
                        >
                            {offeredChains.map((cid) => (
                                <option key={cid} value={cid}>{chainRegistry.get(cid)?.displayName || cid}</option>
                            ))}
                        </Select>
                        <Select
                            label="Status"
                            size="md"
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value)}
                        >
                            <option value="open">Taking bets</option>
                            <option value="all">All markets</option>
                        </Select>
                        <Select
                            label="Sort"
                            size="md"
                            value={sortBy}
                            onChange={(event) => setSortBy(event.target.value)}
                        >
                            <option value="newest">Newest first</option>
                            <option value="closing">Closing soonest</option>
                            <option value="pool">Biggest pool</option>
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
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (noChain) {
        return wrap(
            <ListPage>
                <EmptyState
                    title="No betting address"
                    body="Betting requires an address on a supported network."
                />
            </ListPage>,
        );
    }
    if (!chainId && !error) {
        return wrap(
            <ListPage>
                <div role="status" aria-label="Loading betting addresses" aria-busy="true">
                    Loading betting addresses…
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

    const needle = query.trim().toLowerCase();
    const card = (m, marketChainId, yours = false) => (
        <li key={`${marketChainId}:${String(m.action_index)}`}>
            <BetMarketCard
                market={m}
                onOpen={() => onOpenMarket(marketChainId, m.action_index)}
                yourBet={yourBetText(betsByMarket.get(`${marketChainId}:${m.action_index}`), m)}
                yours={yours}
            />
        </li>
    );
    const noMatches = <EmptyState title="No matching markets" body="Change or clear the filter to see more." titleAs="p" />;

    let body = null;
    if (view === 'all') {
        const shown = rows ? sortMarkets(rows.filter((m) => matchesSearch(m, needle)), sortBy) : null;
        body = (
            <>
                {rows && rows.length === 0 ? (
                    <EmptyState
                        title="No markets"
                        body={openOnly ? 'No markets are taking bets on this network right now.' : 'Markets created on this network appear here.'}
                    />
                ) : null}
                {rows && rows.length > 0 && shown.length === 0 ? noMatches : null}
                {shown && shown.length > 0 ? (
                    <div className={local.cardArea}>
                        <ul className={local.marketList} aria-label="Bet markets">
                            {shown.map((m) => card(m, chainId))}
                        </ul>
                    </div>
                ) : null}
            </>
        );
    } else if (view === 'bets') {
        body = (
            <BetMyBetsPanel
                rows={walletBets.rows}
                error={walletBets.error}
                onRetry={walletBets.reload}
                messaging={messaging}
                onOpenMarket={onOpenMarket}
            />
        );
    }

    const tabsToolbar = (
        <div className={`${local.toolbarRow} ${local.toolbarActions}`}>
            <Tabs
                aria-label="Bet market views"
                items={[
                    { id: 'all', label: <span className={local.tabLabel}><Icon.GridIcon />All</span> },
                    { id: 'bets', label: <span className={local.tabLabel}><Icon.UserIcon />My bets</span> },
                    { id: 'markets', label: <span className={local.tabLabel}><Icon.MarketIcon />My markets</span> },
                ]}
                value={view}
                onChange={setView}
            />
        </div>
    );

    // My markets lists the markets this wallet runs as the same gauge cards, each with its
    // actions (post the result, cancel and refund, edit lists, copy) inline. The console
    // owns its page while a confirm or unsigned result is open.
    if (view === 'markets') {
        return (
            <OracleConsole
                walletId={walletId}
                header={header}
                toolbar={tabsToolbar}
                arrange={(list) => sortMarkets(list.filter((m) => matchesSearch(m, needle)), sortBy)}
                yourBetFor={(m) => yourBetText(betsByMarket.get(`${m.chainId}:${m.action_index}`), m)}
                onOpenMarket={onOpenMarket}
                onDuplicate={onDuplicate}
                onBack={onBack}
            />
        );
    }

    return wrap(
        <ListPage
            notices={view !== 'all' ? null : (error ? (
                <StatusMessage
                    variant="error"
                    recovery={{ label: 'Try Again', onAction: () => setFeedsReload((value) => value + 1) }}
                >
                    {error}
                </StatusMessage>
            ) : (chainId && !rows ? (
                <div role="status" aria-label="Loading betting markets" aria-busy="true">
                    Loading betting markets…
                </div>
            ) : null))}
            toolbar={tabsToolbar}
        >
            {body}
        </ListPage>,
    );
}
