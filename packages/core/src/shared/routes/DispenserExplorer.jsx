// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useMemo, useRef, useState } from 'react';
import { AddressText, Button, ChainBadge, EmptyState, Input, ListPage, PageHeader, Screen, SectionHeader, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { useOracleFeeds } from '../hooks/useOracleFeeds.js';
import {
    dispenserFillPriceLabel,
    formatDecimal,
    isOpenDispenserSelling,
} from '../utils/dispenserPricing.js';
import { actionRowIdentity, explorerPage, uniqueRows } from '../utils/pagedRows.js';
import styles from './ActionsMenu.module.css';
import local from './DispenserExplorer.module.css';

const chainRegistry = registryLib.defaultRegistry();
const RESULTS_PAGE_SIZE = 25;

/**
 * Dispenser explorer (§40.7.2 buyer-facing browse surface).
 *
 * The explorer backend doesn't expose an "all dispensers" wildcard;
 * every query is scoped to a token or an address. This view therefore
 * centers on a required search input. Users pick:
 *
 *   - "By token": ticker-based search (common case: "find open
 *     MYTOKEN dispensers"). Passes the input as `token` to
 *     `dispensersForToken`, which the backend matches against both
 *     GIVE_TICK and GET_TICK.
 *   - "By address": address-based search. Passes the input as
 *     `address` to `dispensersForAddress`, matching either source or
 *     dispenser address.
 *
 * Chain filter narrows the query to a single chain; "All chains"
 * fans out in parallel and merges results. Click a row → host's
 * onOpenDispenser(chainId, actionIndex) navigates to the detail page
 * (same one Piece 7b-part-1 "My dispensers" uses).
 *
 * @param {object} props
 * @param {(chainId: string, actionIndex: string) => void} props.onOpenDispenser
 * @param {() => void} props.onBack
 */
export function DispenserExplorer({ onOpenDispenser, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const { settings } = useSettings();

    // D-34(b): scope BOTH the dropdown and the "All chains" fan-out to the
    // user's active network. `supportedChains()` is every chain the registry
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

    const [searchMode, setSearchMode] = useState(/** @type {'token' | 'address'} */ ('token'));
    const [query, setQuery] = useState('');
    const [chainFilter, setChainFilter] = useState(/** @type {string} */ ('all'));
    const [searching, setSearching] = useState(false);
    const [rowsByChain, setRowsByChain] = useState(
        /** @type {Record<string, { rows: any[], error: string | null, moreError?: string | null, page?: number, total?: number | null, hasMore?: boolean, loadingMore?: boolean }>} */ ({}),
    );
    const [lastQueried, setLastQueried] = useState(/** @type {string | null} */ (null));
    const [lastSearchMode, setLastSearchMode] = useState(/** @type {'token' | 'address'} */ ('token'));
    const searchRequestId = useRef(0);
    const searchDisabledReason = !settings
        ? 'Loading available networks…'
        : chains.length === 0
            ? 'No chains are available for the active network.'
            : !query.trim()
                ? `Enter ${searchMode === 'token' ? 'a token ticker' : 'an address'} to search.`
                : null;
    // A Mode B row carries no price on this lane; it comes from its oracle.
    const oracleEntries = useMemo(() => Object.entries(rowsByChain)
        .filter(([cid]) => cid !== '_error')
        .flatMap(([cid, v]) => (v.rows || []).map((row) => ({ chainId: cid, row }))), [rowsByChain]);
    const oracleFeedsFor = useOracleFeeds(messaging, oracleEntries);

    function runSearch() {
        const q = query.trim();
        if (!q) return;
        const mode = searchMode;
        const requestId = searchRequestId.current + 1;
        searchRequestId.current = requestId;
        const tokenError = mode === 'token'
            ? tickerReferenceError(q, { noun: 'Token search', allowRef: true })
            : null;
        if (tokenError) {
            setSearching(false);
            setRowsByChain({ _error: { rows: [], error: tokenError } });
            setLastQueried(q);
            return;
        }
        setSearching(true);
        setLastQueried(q);
        setLastSearchMode(mode);
        setRowsByChain({});

        const targetChains = chainFilter === 'all' ? chains : [chainFilter];
        if (targetChains.length === 0) {
            setSearching(false);
            setRowsByChain({ _error: { rows: [], error: 'No network is available to search yet.' } });
            setLastQueried(q);
            return;
        }
        const fetchOne = mode === 'token'
            ? (cid) => messaging.getDispensersForToken({
                chainId: cid,
                token: q,
                opts: { page: 1, limit: RESULTS_PAGE_SIZE },
            })
            : (cid) => messaging.getDispensersForAddress({
                chainId: cid,
                address: q,
                opts: { page: 1, limit: RESULTS_PAGE_SIZE },
            });

        Promise.all(targetChains.map((cid) =>
            Promise.resolve().then(() => fetchOne(cid))
                .then((resp) => {
                    const rawRows = extractRows(resp).filter((row) => isOpenDispenserSelling(
                        row,
                        mode === 'token' ? q : '',
                    ));
                    const page = explorerPage(resp, rawRows, 1, RESULTS_PAGE_SIZE);
                    return {
                        cid,
                        rows: uniqueRows(rawRows, actionRowIdentity),
                        total: page.total,
                        hasMore: page.hasMore,
                    };
                })
                .catch((err) => {
                    const message = err?.message || String(err);
                    // D-34(b): the explorer answers 404 for "this token has no
                    // dispensers", which is an ordinary empty result and not a
                    // failure. Showing it raw put
                    // "Couldn't search: Explorer returned HTTP 404 for
                    // /BTC/api/dispensers/XCHAIN/token" in front of a user who
                    // had simply searched for a ticker nobody dispenses. Every
                    // other status still surfaces: a 500 or a dead host is a
                    // real failure and hiding it would be worse than the noise.
                    if (/\b404\b/.test(message)) return { cid, rows: [] };
                    return { cid, error: message };
                })
        )).then((results) => {
            if (requestId !== searchRequestId.current) return;
            /** @type {Record<string, { rows: any[], error: string | null }>} */
            const next = {};
            for (const r of results) {
                next[r.cid] = r.error
                    ? { rows: [], error: r.error }
                    : {
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
        });
    }

    function handleSearch(event) {
        event.preventDefault();
        runSearch();
    }

    function resetFilters() {
        searchRequestId.current += 1;
        setSearchMode('token');
        setQuery('');
        setChainFilter('all');
        setSearching(false);
        setRowsByChain({});
        setLastQueried(null);
        setLastSearchMode('token');
    }

    function handleLoadMore(cid) {
        const state = rowsByChain[cid];
        if (!state?.hasMore || state.loadingMore || !lastQueried) return;
        const requestId = searchRequestId.current;
        const nextPage = (state.page || 1) + 1;
        setRowsByChain((current) => ({
            ...current,
            [cid]: { ...current[cid], loadingMore: true, moreError: null },
        }));
        Promise.resolve().then(() => (lastSearchMode === 'token'
            ? messaging.getDispensersForToken({
                chainId: cid,
                token: lastQueried,
                opts: { page: nextPage, limit: RESULTS_PAGE_SIZE },
            })
            : messaging.getDispensersForAddress({
                chainId: cid,
                address: lastQueried,
                opts: { page: nextPage, limit: RESULTS_PAGE_SIZE },
            }))).then((resp) => {
            if (requestId !== searchRequestId.current) return;
            const rawRows = extractRows(resp);
            const page = explorerPage(resp, rawRows, nextPage, RESULTS_PAGE_SIZE);
            const pageRows = rawRows.filter((row) => isOpenDispenserSelling(
                row,
                lastSearchMode === 'token' ? lastQueried : '',
            ));
            setRowsByChain((current) => {
                const prior = current[cid];
                if (!prior) return current;
                const merged = uniqueRows([...prior.rows, ...pageRows], actionRowIdentity);
                return {
                    ...current,
                    [cid]: {
                        ...prior,
                        rows: merged,
                        page: nextPage,
                        total: page.total ?? prior.total ?? null,
                        hasMore: page.hasMore && merged.length > prior.rows.length,
                        loadingMore: false,
                    },
                };
            });
        }).catch((err) => {
            if (requestId !== searchRequestId.current) return;
            setRowsByChain((current) => ({
                ...current,
                [cid]: {
                    ...current[cid],
                    loadingMore: false,
                    moreError: err?.message || String(err),
                },
            }));
        });
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title="Dispenser explorer"
        />
    );
    const toolbar = (
        <form className={local.searchForm} onSubmit={handleSearch} noValidate>
                <div className={local.searchModes}>
                    <label>
                        <input
                            type="radio"
                            name="searchMode"
                            value="token"
                            checked={searchMode === 'token'}
                            onChange={() => setSearchMode('token')}
                        />
                        {' '}By token
                    </label>
                    <label>
                        <input
                            type="radio"
                            name="searchMode"
                            value="address"
                            checked={searchMode === 'address'}
                            onChange={() => setSearchMode('address')}
                        />
                        {' '}By address
                    </label>
                </div>
                <label className={`${styles.entryDescription} ${local.chainField}`}>
                    Chain
                    <select
                        value={chainFilter}
                        onChange={(e) => setChainFilter(e.target.value)}
                        className={local.chainSelect}
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
                    type="search"
                    role="textbox"
                    label={searchMode === 'token' ? 'Token ticker' : 'Address'}
                    hint={searchMode === 'token'
                        ? 'Ticker name, such as MYTOKEN, or a token reference from the explorer.'
                        : 'Dispenser address or source address.'}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                    autoCapitalize={searchMode === 'token' ? 'characters' : 'off'}
                    autoCorrect="off"
                    spellCheck={false}
                />
                {searchDisabledReason ? (
                    <p id="dispenser-search-disabled-reason" className={styles.entryDescription}>
                        {searchDisabledReason}
                    </p>
                ) : null}
                <div className={local.searchActions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={searching}
                        disabled={Boolean(searchDisabledReason)}
                        aria-describedby={searchDisabledReason ? 'dispenser-search-disabled-reason' : undefined}
                    >
                        {searching ? 'Searching…' : 'Search'}
                    </Button>
                </div>
        </form>
    );

    return (
        <Screen variant={variant} header={header}>
            <ListPage toolbar={toolbar}>
            {lastQueried ? (
                <ResultsPane
                    rowsByChain={rowsByChain}
                    searching={searching}
                    onOpenDispenser={onOpenDispenser}
                    oracleFeedsFor={oracleFeedsFor}
                    onLoadMore={handleLoadMore}
                    onRetry={runSearch}
                    onReset={resetFilters}
                />
            ) : (
                <p className={styles.entryDescription}>
                    Search by token ticker to find open dispensers, or by address to find
                    a specific creator's or dispenser's listings.
                </p>
            )}
            </ListPage>
        </Screen>
    );
}

function ResultsPane({ rowsByChain, searching, onOpenDispenser, oracleFeedsFor, onLoadMore, onRetry, onReset }) {
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
        return <StatusMessage variant="error" className={styles.entryDescription}>{overall.error}</StatusMessage>;
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
                body="Try a different ticker or address."
                actionLabel="Reset filters"
                onAction={onReset}
            />
        );
    }
    return (
        <>
            {entries.map(([cid, state]) => {
                if (cid === '_error') return null;
                const d = chainRegistry.get(cid);
                if (state.rows.length === 0 && !state.error) return null;
                return (
                    <section key={cid} className={local.resultGroup}>
                        <SectionHeader
                            title={(
                                <>
                                    {d ? <ChainBadge descriptor={d} size="sm" /> : <span>{cid}</span>}
                                    {' '}
                                    <span>
                                        {state.total != null && state.total > state.rows.length
                                            ? `${state.rows.length} of ${state.total}`
                                            : state.rows.length}
                                    </span>
                                </>
                            )}
                        />
                        {state.error ? (
                            <StatusMessage
                                variant="error"
                                className={styles.entryDescription}
                                recovery={{ label: 'Try again', onAction: onRetry }}
                            >
                                Couldn't search: {state.error}
                            </StatusMessage>
                        ) : (
                            <>
                                {state.rows.map((row, index) => (
                                    <ResultRow
                                        key={String(actionRowIdentity(row) ?? `result:${index}`)}
                                        row={row}
                                        oracleFeeds={oracleFeedsFor(cid, row)}
                                        onSelect={() => onOpenDispenser(cid, String(row.action_index))}
                                    />
                                ))}
                                {state.moreError ? (
                                    <StatusMessage
                                        variant="error"
                                        className={styles.entryDescription}
                                        recovery={{ label: 'Try again', onAction: () => onLoadMore(cid) }}
                                    >
                                        Couldn't load more: {state.moreError}
                                    </StatusMessage>
                                ) : null}
                                {state.hasMore ? (
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        loading={state.loadingMore}
                                        onClick={() => onLoadMore(cid)}
                                        aria-label={`Load more results for ${d?.displayName || cid}`}
                                    >
                                        Load more results
                                    </Button>
                                ) : null}
                            </>
                        )}
                    </section>
                );
            })}
        </>
    );
}

function ResultRow({ row, oracleFeeds, onSelect }) {
    const give = `${formatDecimal(row.give_amount)} ${row.give_tick || '?'}`;
    const price = dispenserFillPriceLabel(row, oracleFeeds);
    const status = String(flowsLib.dispenserLiveState(row).status || '-');
    return (
        <Button
            type="button"
            className={`${styles.entry} ${local.resultRow}`}
            onClick={onSelect}
        >
            <span className={styles.entryLabel}>
                {row.give_tick || '?'} @ <AddressText address={row.address || row.source || '?'} />
            </span>
            <span
                className={local.resultFacts}
                data-testid="dispenser-result-facts"
                role="list"
                aria-label="Dispenser terms"
            >
                <span className={local.factRow} role="listitem">
                    <span className={local.factLabel}>Give per fill</span>
                    <span className={local.factValue}>{give}</span>
                </span>
                <span className={local.factRow} role="listitem">
                    <span className={local.factLabel}>Price per fill</span>
                    <span className={local.factValue}>{price}</span>
                </span>
                <span className={local.factRow} role="listitem">
                    <span className={local.factLabel}>Status</span>
                    <span className={local.factValue}>{status}</span>
                </span>
            </span>
            <span className={`${styles.entryDescription} ${local.resultMeta}`}>
                #{row.action_index ?? '?'}
                {row.source ? ` · by ` : ''}
                {row.source ? <AddressText address={row.source} /> : null}
            </span>
        </Button>
    );
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.dispensers)) return resp.dispensers;
    return [];
}
