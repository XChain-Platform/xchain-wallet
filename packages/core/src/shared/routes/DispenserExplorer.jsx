// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AddressText, Button, EmptyState, Icon, ListPage, NetworkField, PageHeader, Screen, SectionHeader, Skeleton, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { useOracleFeeds } from '../hooks/useOracleFeeds.js';
import {
    dispenserFillPriceLabel,
    isDispenserPriceStale,
    isOpenDispenserSelling,
    isOraclePricedRow,
} from '../utils/dispenserPricing.js';
import { actionRowIdentity, explorerPage, uniqueRows } from '../utils/pagedRows.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { isValidAddressAnyNetwork } from '../utils/addressValidation.js';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import {
    DispenserExplorerCard,
    DispenserExplorerGroupRow,
    dispenserStockLeft,
    dispenserStockTotal,
} from '../components/DispenserExplorerCard.jsx';
import { normalizeMarket } from './MarketsList.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/dispenserExplorer.js';
import '../../i18n/locales/en/send.js';
import local from './DispenserExplorer.module.css';

const chainRegistry = registryLib.defaultRegistry();
const RESULTS_PAGE_SIZE = 25;
// How many market tokens the browse list reads dispensers for. With no
// "every dispenser" lane, browse shows the deepest markets' open dispensers:
// one read per chain plus one per seed token, fixed however many cards return.
const BROWSE_SEED_LIMIT = 6;
// A query this shape can be an address on every chain the wallet knows.
const ADDRESS_SHAPE = /^[A-Za-z0-9]{25,90}$/;
const PANEL_ID = 'dispenser-explorer-browse';

const BROWSE_TABS = [
    { id: 'popular', label: 'Popular', Glyph: Icon.ZapIcon, note: 'Most fills first.' },
    { id: 'newest', label: 'Newest', Glyph: Icon.ClockIcon, note: 'Newest dispensers first.' },
    { id: 'deals', label: 'Best deals', Glyph: Icon.DollarIcon, note: 'Lowest price per token against the same token\'s other dispensers.' },
];

/**
 * Dispenser explorer (§40.7.2 buyer-facing browse surface).
 *
 * The title bar's filter holds the search box and the Network filter. With
 * nothing typed the page is the Popular | Newest | Best deals toggle, first
 * under the header, over one list card of three-line dispenser rows.
 *
 * The explorer backend doesn't expose an "all dispensers" wildcard; every
 * query is scoped to a token or an address. So:
 *
 *   - The search decides what the query is. A valid ticker runs the token
 *     lane (`dispensersForToken`, GIVE_TICK or GET_TICK); an address-shaped
 *     query also runs the address lane (`dispensersForAddress`, source or
 *     dispenser address). Results group into Tokens and Sellers.
 *   - The browse list reads the network's market list once per chain, takes
 *     the deepest markets' tokens (BROWSE_SEED_LIMIT in all), and reads each
 *     one's open dispensers once. The three tabs re-sort those same rows, so
 *     switching tabs costs no read.
 *
 * Searches fan out across the chains on the active Settings network and merge
 * results; the Network filter narrows them to one chain. Tapping a card calls
 * the host's onOpenDispenser(chainId, actionIndex), which opens the detail
 * page (the same one "My dispensers" uses).
 *
 * @param {object} props
 * @param {(chainId: string, actionIndex: string) => void} props.onOpenDispenser
 * @param {() => void} props.onBack
 */
export function DispenserExplorer({ onOpenDispenser, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const { settings } = useSettings();

    // D-34(b): scope the search fan-out to the user's active network.
    // `supportedChains()` is every chain the registry
    // knows, so a wallet sitting on Regtest was querying mainnet and testnet
    // explorers on every search - requests it has no business making, against
    // hosts it is not configured for, whose failures it then showed the user.
    // `filterChainIdsByActiveNetwork` is the same helper Home, History and
    // every balance fan-out already use, so this screen stops being the
    // exception. While settings are still loading the list is empty rather
    // than everything: a search a few hundred ms early must not escape the
    // filter.
    const chains = useMemo(() => {
        const all = chainRegistry.supportedChains().map((d) => d.id);
        if (!settings) return [];
        return flowsLib.filterChainIdsByActiveNetwork(all, settings, chainRegistry);
    }, [settings]);

    const [query, setQuery] = useState('');
    const [chainFilter, setChainFilter] = useState(/** @type {string} */ ('all'));
    const [searching, setSearching] = useState(false);
    // Typed-search results, keyed `${lane}\u0000${chainId}`; `_error` holds a
    // query the search could not run at all.
    const [rowsByChain, setRowsByChain] = useState(
        /** @type {Record<string, { lane?: 'token' | 'address', cid?: string, rows: any[], error: string | null, moreError?: string | null, page?: number, total?: number | null, hasMore?: boolean, loadingMore?: boolean }>} */ ({}),
    );
    const [lastQueried, setLastQueried] = useState(/** @type {string | null} */ (null));
    const [tab, setTab] = useState(/** @type {'popular' | 'newest' | 'deals'} */ ('popular'));
    const [browse, setBrowse] = useState(
        /** @type {{ status: 'idle' | 'loading' | 'ready', entries: Array<{ cid: string, row: any, seedRank: number }>, error: string | null }} */ ({ status: 'idle', entries: [], error: null }),
    );
    const [browseReload, setBrowseReload] = useState(0);
    const searchRequestId = useRef(0);
    const searchInFlightRef = useRef(/** @type {string | null} */ (null));
    const loadMoreInFlightRef = useRef(/** @type {Set<string>} */ (new Set()));
    const chainScopeRef = useRef('');
    useEffect(() => {
        const scope = chains.join('\u0000');
        if (scope === chainScopeRef.current) return;
        chainScopeRef.current = scope;
        searchRequestId.current += 1;
        searchInFlightRef.current = null;
        loadMoreInFlightRef.current.clear();
        setChainFilter('all');
        setSearching(false);
        setRowsByChain({});
        setLastQueried(null);
    }, [chains]);
    const searchDisabledReason = !settings
        ? 'Loading available networks…'
        : chains.length === 0
            ? 'No networks are available for the active network.'
            : !query.trim()
                ? 'Enter a token or seller address to search.'
                : null;
    const scopeChains = useMemo(
        () => (chainFilter === 'all' || !chains.includes(chainFilter) ? chains : [chainFilter]),
        [chains, chainFilter],
    );
    const scopeKey = scopeChains.join('\u0000');

    // The browse list. One markets read per chain picks the seed
    // tokens; one dispenser read per seed fills the list. Never a read per card.
    useEffect(() => {
        if (!settings || scopeChains.length === 0) return undefined;
        if (typeof messaging.getMarkets !== 'function' || typeof messaging.getDispensersForToken !== 'function') {
            setBrowse({ status: 'ready', entries: [], error: null });
            return undefined;
        }
        let cancelled = false;
        setBrowse((current) => ({ ...current, status: 'loading', error: null }));
        const isNotFound = (err) => /\b404\b/.test(err?.message || String(err));
        Promise.all(scopeChains.map((cid) => Promise.resolve()
            .then(() => messaging.getMarkets({ chainId: cid }))
            .then((resp) => ({ cid, rows: extractRows(resp), failed: false }),
                (err) => ({ cid, rows: [], failed: !isNotFound(err) }))))
            .then((marketReads) => {
                const seeds = browseSeeds(marketReads, BROWSE_SEED_LIMIT);
                return Promise.all(seeds.map((seed) => Promise.resolve()
                    .then(() => messaging.getDispensersForToken({
                        chainId: seed.cid,
                        token: seed.tick,
                        opts: { page: 1, limit: RESULTS_PAGE_SIZE },
                    }))
                    .then((resp) => ({ seed, rows: extractRows(resp), failed: false }),
                        (err) => ({ seed, rows: [], failed: !isNotFound(err) }))))
                    .then((dispenserReads) => ({ marketReads, dispenserReads }));
            })
            .then(({ marketReads, dispenserReads }) => {
                if (cancelled) return;
                const seen = new Set();
                /** @type {Array<{ cid: string, row: any, seedRank: number }>} */
                const entries = [];
                for (const { seed, rows } of dispenserReads) {
                    for (const row of rows) {
                        if (!isOpenDispenserSelling(row, seed.tick)) continue;
                        const key = `${seed.cid}\u0000${actionRowIdentity(row) ?? row.action_index}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        entries.push({ cid: seed.cid, row, seedRank: seed.rank });
                    }
                }
                const everyRead = [...marketReads, ...dispenserReads];
                const allFailed = everyRead.length > 0 && everyRead.every((r) => r.failed);
                setBrowse({
                    status: 'ready',
                    entries,
                    error: allFailed ? 'Could not load dispensers. Try again.' : null,
                });
            });
        return () => { cancelled = true; };
    // scopeKey stands for scopeChains; a Try again bumps browseReload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messaging, settings, scopeKey, browseReload]);

    // A Mode B row carries no price on this lane; it comes from its oracle.
    const oracleEntries = useMemo(() => [
        ...Object.entries(rowsByChain)
            .filter(([key]) => key !== '_error')
            .flatMap(([, v]) => (v.rows || []).map((row) => ({ chainId: v.cid, row }))),
        ...browse.entries.map(({ cid, row }) => ({ chainId: cid, row })),
    ], [rowsByChain, browse.entries]);
    const oracleFeedsFor = useOracleFeeds(messaging, oracleEntries);

    function fetchLane(lane, cid, q, page) {
        return lane === 'token'
            ? messaging.getDispensersForToken({
                chainId: cid,
                token: q,
                opts: { page, limit: RESULTS_PAGE_SIZE },
            })
            : messaging.getDispensersForAddress({
                chainId: cid,
                address: q,
                opts: { page, limit: RESULTS_PAGE_SIZE },
            });
    }

    function runSearch(text = query, targetChains = scopeChains) {
        const q = String(text || '').trim();
        if (!q) return;
        const lanes = searchLanes(q);
        const searchKey = `${lanes.join(',')}\u0000${q}\u0000${targetChains.join('\u0000')}`;
        if (searchInFlightRef.current === searchKey) return;
        const requestId = searchRequestId.current + 1;
        searchRequestId.current = requestId;
        if (lanes.length === 0) {
            setSearching(false);
            setRowsByChain({ _error: {
                rows: [],
                error: tickerReferenceError(q, { noun: 'Token search', allowRef: true })
                    || 'Enter a token name or a seller address.',
            } });
            setLastQueried(q);
            return;
        }
        searchInFlightRef.current = searchKey;
        loadMoreInFlightRef.current.clear();
        setSearching(true);
        setLastQueried(q);
        setRowsByChain({});

        if (targetChains.length === 0) {
            searchInFlightRef.current = null;
            setSearching(false);
            setRowsByChain({ _error: { rows: [], error: 'No network is available to search yet.' } });
            setLastQueried(q);
            return;
        }
        const jobs = lanes.flatMap((lane) => targetChains.map((cid) => ({ lane, cid })));

        Promise.all(jobs.map(({ lane, cid }) =>
            Promise.resolve().then(() => fetchLane(lane, cid, q, 1))
                .then((resp) => {
                    const rawRows = extractRows(resp).filter((row) => isOpenDispenserSelling(
                        row,
                        lane === 'token' ? q : '',
                    ));
                    const page = explorerPage(resp, rawRows, 1, RESULTS_PAGE_SIZE);
                    return {
                        lane,
                        cid,
                        rows: uniqueRows(rawRows, actionRowIdentity),
                        total: page.total,
                        hasMore: page.hasMore,
                    };
                })
                .catch((err) => {
                    const message = err?.message || String(err);
                    // Treat an explorer 404 as an ordinary empty result because
                    // this endpoint uses it to report that no dispensers match.
                    // Avoid presenting an absent ticker as a broken search.

                    // Keep every other failure visible through plain fallback
                    // copy, while the shared filter removes provider and runtime
                    // details that do not help someone retry the search.

                    // Preserve the per-chain failure so partial results remain
                    // useful when another network succeeds.
                    if (/\b404\b/.test(message)) return { lane, cid, rows: [] };
                    return {
                        lane,
                        cid,
                        error: userFacingMessage(err, 'Could not search for dispensers. Try again.'),
                    };
                })
        )).then((results) => {
            if (requestId !== searchRequestId.current) return;
            /** @type {Record<string, any>} */
            const next = {};
            for (const r of results) {
                next[`${r.lane}\u0000${r.cid}`] = r.error
                    ? { lane: r.lane, cid: r.cid, rows: [], error: r.error }
                    : {
                        lane: r.lane,
                        cid: r.cid,
                        rows: r.rows,
                        error: null,
                        page: 1,
                        total: r.total,
                        hasMore: r.hasMore,
                        loadingMore: false,
                        moreError: null,
                    };
            }
            setRowsByChain(next);
            setSearching(false);
            if (searchInFlightRef.current === searchKey) searchInFlightRef.current = null;
        });
    }

    function handleSearch(event) {
        event.preventDefault();
        if (searchDisabledReason) return;
        runSearch();
    }

    // Clearing the field (its X, or deleting the text) returns to the browse
    // list and drops the typed results.
    function clearSearch() {
        searchRequestId.current += 1;
        searchInFlightRef.current = null;
        loadMoreInFlightRef.current.clear();
        setQuery('');
        setSearching(false);
        setRowsByChain({});
        setLastQueried(null);
    }

    function handleQueryChange(value) {
        setQuery(value);
        if (!value.trim() && lastQueried) clearSearch();
    }

    function handleChainFilterChange(value) {
        setChainFilter(value);
        // A typed search follows the filter at once instead of waiting for
        // the next submit; the browse list reloads through its effect.
        if (lastQueried) {
            const nextScope = value === 'all' || !chains.includes(value) ? chains : [value];
            runSearch(lastQueried, nextScope);
        }
    }

    function handleLoadMore(key) {
        const state = rowsByChain[key];
        if (!state?.hasMore || state.loadingMore || !lastQueried) return;
        const { lane, cid } = state;
        const requestId = searchRequestId.current;
        const nextPage = (state.page || 1) + 1;
        const loadKey = `${requestId}\u0000${key}\u0000${nextPage}`;
        if (loadMoreInFlightRef.current.has(loadKey)) return;
        loadMoreInFlightRef.current.add(loadKey);
        setRowsByChain((current) => ({
            ...current,
            [key]: { ...current[key], loadingMore: true, moreError: null },
        }));
        Promise.resolve().then(() => fetchLane(lane, cid, lastQueried, nextPage)).then((resp) => {
            if (requestId !== searchRequestId.current) return;
            const rawRows = extractRows(resp);
            const page = explorerPage(resp, rawRows, nextPage, RESULTS_PAGE_SIZE);
            const pageRows = rawRows.filter((row) => isOpenDispenserSelling(
                row,
                lane === 'token' ? lastQueried : '',
            ));
            setRowsByChain((current) => {
                const prior = current[key];
                if (!prior) return current;
                const merged = uniqueRows([...prior.rows, ...pageRows], actionRowIdentity);
                return {
                    ...current,
                    [key]: {
                        ...prior,
                        rows: merged,
                        page: nextPage,
                        total: page.total ?? prior.total ?? null,
                        hasMore: page.hasMore && merged.length > prior.rows.length,
                        loadingMore: false,
                    },
                };
            });
            loadMoreInFlightRef.current.delete(loadKey);
        }).catch((err) => {
            loadMoreInFlightRef.current.delete(loadKey);
            if (requestId !== searchRequestId.current) return;
            setRowsByChain((current) => ({
                ...current,
                [key]: {
                    ...current[key],
                    loadingMore: false,
                    moreError: userFacingMessage(err, 'Could not load more dispensers. Try again.'),
                },
            }));
        });
    }

    // The title bar's filter icon holds the search box and Network; the body
    // has neither, so the Popular | Newest | Best deals toggle sits first under
    // the header. Enter submits the search from the standard menu search field.
    const filterPopover = (
        <ListFilterMenu
            query={query}
            onQueryChange={handleQueryChange}
            searchPlaceholder="Search a token or seller address"
            searchLabel="Search a token or seller address"
            label="Filter dispensers"
            active={chainFilter !== 'all' || Boolean(lastQueried)}
            onSearchKeyDown={(event) => {
                if (event.key === 'Enter') handleSearch(event);
            }}
        >
            {searchDisabledReason ? (
                <p id="dispenser-search-disabled-reason" className="sr-only">
                    {searchDisabledReason}
                </p>
            ) : null}
            {/* The standard Network field: it opens the full-screen network
                list (operator ruling 2026-11-13), with All networks first. */}
            <NetworkField
                label="Network"
                help="Shows only the dispensers on the network you pick, or on every network."
                size="md"
                value={chainFilter}
                onChange={handleChainFilterChange}
                chainIds={chains}
                chainRegistry={chainRegistry}
                allOption
                notSource
            />
        </ListFilterMenu>
    );
    const header = (
        <PageHeader
            onBack={onBack}
            title="Dispenser Explorer"            trailing={filterPopover}
        />
    );
    return (
        <Screen variant={variant} header={header}>
            <ListPage>
            {lastQueried ? (
                <ResultsPane
                    rowsByChain={rowsByChain}
                    searching={searching}
                    query={lastQueried}
                    onOpenDispenser={onOpenDispenser}
                    oracleFeedsFor={oracleFeedsFor}
                    onLoadMore={handleLoadMore}
                    onRetry={() => runSearch(lastQueried)}
                    onReset={clearSearch}
                />
            ) : (
                <BrowsePane
                    tab={tab}
                    onTabChange={setTab}
                    browse={browse}
                    ready={Boolean(settings) && chains.length > 0}
                    noNetworks={Boolean(settings) && chains.length === 0}
                    onOpenDispenser={onOpenDispenser}
                    oracleFeedsFor={oracleFeedsFor}
                    onRetry={() => setBrowseReload((n) => n + 1)}
                />
            )}
            </ListPage>
        </Screen>
    );
}

/**
 * The nothing-typed view. Icon tabs over one card list; only the
 * chosen tab's order shows. The tabs re-sort rows already loaded.
 */
function BrowsePane({ tab, onTabChange, browse, ready, noNetworks, onOpenDispenser, oracleFeedsFor, onRetry }) {
    const sorted = useMemo(() => rankBrowse(browse.entries, tab), [browse.entries, tab]);
    const current = BROWSE_TABS.find((item) => item.id === tab) || BROWSE_TABS[0];
    let body;
    if (noNetworks) {
        body = <EmptyState title="No networks to browse" body="No networks are available for the active network." titleAs="p" />;
    } else if (!ready || browse.status !== 'ready') {
        body = (
            <div role="status" aria-label="Loading dispensers">
                <Skeleton.List rows={4} />
            </div>
        );
    } else if (browse.error) {
        body = (
            <StatusMessage variant="error" recovery={{ label: 'Try Again', onAction: onRetry }}>
                {browse.error}
            </StatusMessage>
        );
    } else if (sorted.length === 0) {
        body = (
            <EmptyState
                title="No dispensers to browse yet"
                body="Search a token or seller address to find dispensers beyond the busiest market tokens."
                titleAs="p"
            />
        );
    } else {
        body = (
            <>
                {/* The tabs sit directly above the list (G41); the order each
                    tab uses is its tooltip, not a loose line between them. */}
                <div className={local.cardList}>
                    {sorted.map(({ cid, row }, index) => (
                        <DispenserExplorerCard
                            key={`${cid}:${String(actionRowIdentity(row) ?? index)}`}
                            chainId={cid}
                            row={row}
                            priceLabel={dispenserFillPriceLabel(row, oracleFeedsFor(cid, row))}
                            onSelect={() => onOpenDispenser(cid, String(row.action_index))}
                        />
                    ))}
                </div>
            </>
        );
    }
    return (
        <section className={local.browse} aria-label="Browse dispensers">
            <Tabs
                aria-label="Dispenser order"
                items={BROWSE_TABS.map(({ id, label, Glyph, note }) => ({
                    id,
                    label: <span className={local.tabLabel} title={note}><Glyph />{label}</span>,
                }))}
                value={tab}
                onChange={onTabChange}
                panelId={PANEL_ID}
            />
            <div id={PANEL_ID} role="tabpanel" aria-label={current.label} className={local.panel}>
                {body}
            </div>
        </section>
    );
}

/**
 * Typed results, grouped into Tokens (token-lane rows by ticker) and
 * Sellers (address-lane rows by seller). Each group row opens its cards; a
 * search with one group opens it straight away.
 */
function ResultsPane({ rowsByChain, searching, query, onOpenDispenser, oracleFeedsFor, onLoadMore, onRetry, onReset }) {
    const [toggled, setToggled] = useState(/** @type {Record<string, boolean>} */ ({}));
    useEffect(() => { setToggled({}); }, [query]);
    const groups = useMemo(() => groupResults(rowsByChain), [rowsByChain]);
    if (searching) {
        return (
            <div role="status" aria-label="Searching dispensers">
                <Skeleton.List rows={4} />
            </div>
        );
    }
    const entries = Object.entries(rowsByChain);
    if (entries.length === 0) {
        return <EmptyState title="No results yet" body="Search results appear here after a query finishes." />;
    }
    // Surface an overall-error row when the precondition failed (e.g.,
    // invalid token regex). That uses the sentinel "_error" key.
    const overall = rowsByChain._error;
    if (overall && overall.error) {
        return <StatusMessage variant="error">{overall.error}</StatusMessage>;
    }
    let anyRow = false;
    let anyError = false;
    for (const [, v] of entries) {
        if (v.rows.length > 0) anyRow = true;
        if (v.error) anyError = true;
    }
    // "No open dispensers matched" is only true when nothing FAILED. Found
    // while fixing D-34(b): this early return fired on rows alone, so a search
    // where every chain errored - the whole explorer down, the wrong endpoint
    // configured - reported an empty result and swallowed every error message.
    // The raw-404 complaint only ever became visible because ONE chain
    // happened to return rows; the total-failure case was silently worse.
    if (!anyRow && !anyError) {
        return (
            <EmptyState
                title="No matching dispensers"
                body="Try a different token or seller address."
                actionLabel="Clear Search"
                onAction={onReset}
            />
        );
    }
    // A small result (a ticker on a chain or three, one seller) opens its
    // groups at once; a longer one starts folded so the groups read as a list.
    const groupCount = groups.tokens.length + groups.sellers.length;
    const isOpen = (key) => (key in toggled ? toggled[key] : groupCount <= 3);
    const toggle = (key) => setToggled((current) => ({ ...current, [key]: !isOpen(key) }));
    const renderCards = (items) => items.map(({ cid, row }, index) => (
        <DispenserExplorerCard
            key={`${cid}:${String(actionRowIdentity(row) ?? index)}`}
            chainId={cid}
            row={row}
            priceLabel={dispenserFillPriceLabel(row, oracleFeedsFor(cid, row))}
            onSelect={() => onOpenDispenser(cid, String(row.action_index))}
        />
    ));
    // Paging and failures stay per lane and chain, under the section they feed.
    const laneFooter = (lane) => entries
        .filter(([key, state]) => key !== '_error' && state.lane === lane)
        .map(([key, state]) => {
            const d = chainRegistry.get(state.cid);
            const name = d?.displayName || t('send.rbf.thisChain');
            if (state.error) {
                return (
                    <StatusMessage
                        key={key}
                        variant="error"
                        recovery={{ label: 'Try Again', onAction: onRetry }}
                    >
                        Couldn't search {name}: {state.error}
                    </StatusMessage>
                );
            }
            if (!state.moreError && !state.hasMore) return null;
            return (
                <div key={key} className={local.laneFooter}>
                    {state.moreError ? (
                        <StatusMessage
                            variant="error"
                            recovery={{ label: 'Try Again', onAction: () => onLoadMore(key) }}
                        >
                            Couldn't load more: {state.moreError}
                        </StatusMessage>
                    ) : null}
                    {state.hasMore ? (
                        <Button
                            type="button"
                            variant="secondary"
                            icon={<Icon.ChevronDownIcon />}
                            loading={state.loadingMore}
                            onClick={() => onLoadMore(key)}
                            aria-label={t('dispenserExplorer.loadMoreFor', { name })}
                        >
                            Load More Results
                        </Button>
                    ) : null}
                </div>
            );
        });
    const section = (lane, title, glyph, list, renderRow) => {
        const footer = laneFooter(lane).filter(Boolean);
        if (list.length === 0 && !entries.some(([key, s]) => key !== '_error' && s.lane === lane && s.error)) return null;
        return (
            <section className={local.resultGroup} aria-label={title}>
                <SectionHeader title={<span className={local.sectionTitle}>{glyph}{title}</span>} />
                <div className={local.cardList}>
                    {list.map(renderRow)}
                </div>
                {footer}
            </section>
        );
    };
    return (
        <>
            {section('token', 'Tokens', <Icon.TokenIcon />, groups.tokens, (group) => {
                const panel = `dispenser-token-${slug(group.key)}`;
                const open = isOpen(group.key);
                return (
                    <div key={group.key} className={local.group}>
                        <DispenserExplorerGroupRow
                            leading={<TickerIcon chainId={group.chainId} tick={group.tick} context="list" />}
                            title={group.tick}
                            subtitle={groupSubtitle(group)}
                            expanded={open}
                            controls={panel}
                            onToggle={() => toggle(group.key)}
                        />
                        {open ? <div id={panel} className={local.groupCards}>{renderCards(group.items)}</div> : null}
                    </div>
                );
            })}
            {section('address', 'Sellers', <Icon.UserIcon />, groups.sellers, (group) => {
                const panel = `dispenser-seller-${slug(group.key)}`;
                const open = isOpen(group.key);
                return (
                    <div key={group.key} className={local.group}>
                        <DispenserExplorerGroupRow
                            leading={<span className={local.sellerAvatar}><Icon.UserIcon /></span>}
                            title={<AddressText address={group.seller} />}
                            subtitle={groupSubtitle(group)}
                            expanded={open}
                            controls={panel}
                            onToggle={() => toggle(group.key)}
                        />
                        {open ? <div id={panel} className={local.groupCards}>{renderCards(group.items)}</div> : null}
                    </div>
                );
            })}
        </>
    );
}

/**
 * Which lanes a typed query runs. A well-formed address on any supported
 * chain searches sellers (source or dispenser address) only. An
 * address-shaped query the validator does not know runs both lanes rather
 * than guessing; anything else that is a valid ticker searches tokens.
 *
 * @param {string} q trimmed query
 * @returns {Array<'token' | 'address'>}
 */
function searchLanes(q) {
    if (isValidAddressAnyNetwork(q)) return ['address'];
    const isTicker = !tickerReferenceError(q, { noun: 'Token search', allowRef: true });
    /** @type {Array<'token' | 'address'>} */
    const lanes = isTicker ? ['token'] : [];
    if (ADDRESS_SHAPE.test(q)) lanes.push('address');
    return lanes;
}

/**
 * Seed tokens for the browse list: each chain's markets, token side only,
 * deepest first, then round-robin across chains up to `limit`.
 *
 * @param {Array<{ cid: string, rows: any[] }>} marketReads
 * @param {number} limit
 * @returns {Array<{ cid: string, tick: string, rank: number }>}
 */
function browseSeeds(marketReads, limit) {
    const perChain = marketReads.map(({ cid, rows }) => {
        const native = String(tickerForDescriptor(chainRegistry.get(cid)) || '').toUpperCase();
        const depthByTick = new Map();
        for (const raw of rows || []) {
            const market = normalizeMarket(raw);
            if (!market) continue;
            const tick = market.tick1.toUpperCase() !== native ? market.tick1
                : market.tick2.toUpperCase() !== native ? market.tick2 : null;
            if (!tick) continue;
            const depth = market.depth ?? 0;
            if (!depthByTick.has(tick) || depthByTick.get(tick) < depth) depthByTick.set(tick, depth);
        }
        return [...depthByTick.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([tick]) => ({ cid, tick }));
    });
    const seeds = [];
    for (let i = 0; seeds.length < limit && perChain.some((list) => i < list.length); i += 1) {
        for (const list of perChain) {
            if (seeds.length >= limit) break;
            if (i < list.length) seeds.push({ ...list[i], rank: seeds.length });
        }
    }
    return seeds;
}

/**
 * What one token costs on a coin- or token-paid dispenser, or null for a
 * fiat, oracle or stale price that cannot be compared.
 *
 * @param {any} row
 * @returns {number | null}
 */
function unitPrice(row) {
    if (isDispenserPriceStale(row) || isOraclePricedRow(row) || row?.fiat_code) return null;
    const give = Number(row?.give_amount);
    const get = Number(row?.get_amount);
    if (!(give > 0) || !(get > 0)) return null;
    return get / give;
}

function payAsset(row) {
    return String(row?.get_tick || row?.get_coin || '').toUpperCase();
}

/**
 * Fills so far: the explorer's dispense_count when the row has it, else
 * what has left the escrow measured in fills.
 *
 * @param {any} row
 * @returns {number}
 */
function fillsSoFar(row) {
    const count = Number(row?.dispense_count);
    if (row?.dispense_count != null && Number.isFinite(count)) return count;
    const left = dispenserStockLeft(row);
    const total = dispenserStockTotal(row);
    const per = Number(row?.give_amount);
    if (left == null || total == null || !(per > 0)) return 0;
    return Math.max(0, (total - left) / per);
}

function openedTime(row) {
    const ts = Number(row?.timestamp ?? row?.block_time);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
}

function blockHeight(row) {
    const block = Number(row?.block_index);
    return Number.isFinite(block) && block > 0 ? block : null;
}

/**
 * Newest first. Block heights only compare within one chain (a Dogecoin
 * height is not later than a Bitcoin one), so across chains the opening
 * time decides; a row with no time sorts after the timed ones.
 */
function newerFirst(a, b) {
    const ta = openedTime(a.row);
    const tb = openedTime(b.row);
    if (ta != null && tb != null && ta !== tb) return tb - ta;
    if (a.cid === b.cid) {
        const ha = blockHeight(a.row);
        const hb = blockHeight(b.row);
        if (ha != null && hb != null && ha !== hb) return hb - ha;
    }
    if (ta != null && tb == null) return -1;
    if (ta == null && tb != null) return 1;
    return 0;
}

/**
 * The three browse orders over the same rows.
 *   popular: most fills first (dispense_count, else escrow sold in fills)
 *   newest:  latest opening time first (block height within one chain)
 *   deals:   price per token over the median of the same token's
 *            dispensers in the same pay asset, cheapest first; prices that
 *            cannot be compared go last
 *
 * @param {Array<{ cid: string, row: any, seedRank: number }>} entries
 * @param {'popular' | 'newest' | 'deals'} tab
 */
function rankBrowse(entries, tab) {
    const list = [...entries];
    const bySeed = (a, b) => a.seedRank - b.seedRank;
    if (tab === 'newest') {
        return list.sort((a, b) => newerFirst(a, b) || bySeed(a, b));
    }
    if (tab === 'deals') {
        const pools = new Map();
        for (const e of list) {
            const unit = unitPrice(e.row);
            if (unit == null) continue;
            const key = `${e.cid}\u0000${String(e.row.give_tick).toUpperCase()}\u0000${payAsset(e.row)}`;
            if (!pools.has(key)) pools.set(key, []);
            pools.get(key).push(unit);
        }
        const medians = new Map([...pools.entries()].map(([key, units]) => {
            const s = [...units].sort((a, b) => a - b);
            const mid = Math.floor(s.length / 2);
            return [key, s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2];
        }));
        const score = (e) => {
            const unit = unitPrice(e.row);
            if (unit == null) return Infinity;
            const key = `${e.cid}\u0000${String(e.row.give_tick).toUpperCase()}\u0000${payAsset(e.row)}`;
            const median = medians.get(key);
            return median > 0 ? unit / median : 1;
        };
        return list.sort((a, b) => {
            const sa = score(a);
            const sb = score(b);
            if (sa !== sb) return sa === Infinity ? 1 : sb === Infinity ? -1 : sa - sb;
            return bySeed(a, b);
        });
    }
    return list.sort((a, b) => fillsSoFar(b.row) - fillsSoFar(a.row) || bySeed(a, b));
}

/**
 * Typed results grouped for the Tokens and Sellers sections.
 *
 * @param {Record<string, any>} rowsByChain
 */
function groupResults(rowsByChain) {
    const tokens = new Map();
    const sellers = new Map();
    for (const [key, state] of Object.entries(rowsByChain)) {
        if (key === '_error' || !state?.rows) continue;
        for (const row of state.rows) {
            const item = { cid: state.cid, row };
            if (state.lane === 'token') {
                // One group per token per chain, so a "from" price never
                // compares BTC with DOGE.
                const tick = String(row.give_tick || '?');
                const gk = `token:${state.cid}:${tick}`;
                if (!tokens.has(gk)) tokens.set(gk, { key: gk, tick, chainId: state.cid, items: [], chains: new Set(), fedBy: new Map() });
                addToGroup(tokens.get(gk), item, key);
            } else {
                const seller = String(row.source || row.address || '?');
                const gk = `seller:${seller}`;
                if (!sellers.has(gk)) sellers.set(gk, { key: gk, seller, chainId: state.cid, items: [], chains: new Set(), fedBy: new Map() });
                addToGroup(sellers.get(gk), item, key);
            }
        }
    }
    const cheapestFirst = (group) => {
        group.items.sort((a, b) => (unitPrice(a.row) ?? Infinity) - (unitPrice(b.row) ?? Infinity));
        // The explorer's total is per lane and chain, so the group can say
        // "25 of 49" only when one search fed it and every row of that search
        // landed here; otherwise the total would describe other groups too.
        const [only] = group.fedBy.size === 1 ? [...group.fedBy] : [];
        const lane = only ? rowsByChain[only[0]] : null;
        group.paging = lane && only[1] === lane.rows.length
            && lane.total != null && lane.total > lane.rows.length
            ? { loaded: lane.rows.length, total: lane.total }
            : null;
        return group;
    };
    return {
        tokens: [...tokens.values()].map(cheapestFirst),
        sellers: [...sellers.values()].map(cheapestFirst),
    };
}

function formatUnit(n) {
    const fixed = n.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
    return fixed === '0' ? n.toPrecision(3) : fixed;
}

function addToGroup(group, item, laneKey) {
    group.items.push(item);
    group.chains.add(item.cid);
    group.fedBy.set(laneKey, (group.fedBy.get(laneKey) || 0) + 1);
}

function groupSubtitle(group) {
    const n = group.items.length;
    const parts = [];
    const first = group.items[0]?.row;
    const unit = first ? unitPrice(first) : null;
    if (unit != null) parts.push(`from ${formatUnit(unit)} ${payAsset(first)} each`);
    const chainNames = [...group.chains].map((cid) => chainRegistry.get(cid)?.displayName || cid.split('-')[0]);
    parts.push(chainNames.join(', '));
    const rest = ` · ${parts.join(' · ')}`;
    // A paged group leads with loaded-of-total, so Load more reads as finishing it.
    if (group.paging) {
        return (
            <>
                <span>{`${group.paging.loaded} of ${group.paging.total}`}</span>
                {` dispensers${rest}`}
            </>
        );
    }
    return `${n} ${n === 1 ? 'dispenser' : 'dispensers'}${rest}`;
}

function slug(value) {
    return String(value).replace(/[^A-Za-z0-9_-]/g, '-');
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.dispensers)) return resp.dispensers;
    return [];
}
