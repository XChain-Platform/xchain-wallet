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
import { AddressText, Button, ChainBadge, EmptyState, Input, ListPage, PageHeader, Screen, SectionHeader, StatusMessage } from '@xchain-wallet/core/ui';
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
import styles from './ActionsMenu.module.css';

const chainRegistry = registryLib.defaultRegistry();

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
        /** @type {Record<string, { rows: any[], error: string | null }>} */ ({}),
    );
    const [lastQueried, setLastQueried] = useState(/** @type {string | null} */ (null));
    const searchRequestId = useRef(0);
    // A Mode B row carries no price on this lane; it comes from its oracle.
    const oracleEntries = useMemo(() => Object.entries(rowsByChain)
        .filter(([cid]) => cid !== '_error')
        .flatMap(([cid, v]) => (v.rows || []).map((row) => ({ chainId: cid, row }))), [rowsByChain]);
    const oracleFeedsFor = useOracleFeeds(messaging, oracleEntries);

    function handleSearch(event) {
        event.preventDefault();
        const q = query.trim();
        if (!q) return;
        const requestId = searchRequestId.current + 1;
        searchRequestId.current = requestId;
        const tokenError = searchMode === 'token'
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
        setRowsByChain({});

        const targetChains = chainFilter === 'all' ? chains : [chainFilter];
        if (targetChains.length === 0) {
            setSearching(false);
            setRowsByChain({ _error: { rows: [], error: 'No network is available to search yet.' } });
            setLastQueried(q);
            return;
        }
        const fetchOne = searchMode === 'token'
            ? (cid) => messaging.getDispensersForToken({ chainId: cid, token: q })
            : (cid) => messaging.getDispensersForAddress({ chainId: cid, address: q });

        Promise.all(targetChains.map((cid) =>
            Promise.resolve().then(() => fetchOne(cid))
                .then((resp) => ({
                    cid,
                    rows: extractRows(resp).filter((row) => isOpenDispenserSelling(
                        row,
                        searchMode === 'token' ? q : '',
                    )),
                }))
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
                    : { rows: r.rows, error: null };
            }
            setRowsByChain(next);
            setSearching(false);
        });
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title="Dispenser explorer"
        />
    );
    const toolbar = (
        <form onSubmit={handleSearch} noValidate>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
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
                <label className={styles.entryDescription} style={{ display: 'block' }}>
                    Chain
                    <select
                        value={chainFilter}
                        onChange={(e) => setChainFilter(e.target.value)}
                        style={{ marginLeft: '0.5rem', marginBottom: '0.5rem' }}
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
                        ? 'Ticker name (e.g. MYTOKEN) or TICK_ID reference (e.g. ^1234).'
                        : 'Dispenser address or source address.'}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                    autoCapitalize={searchMode === 'token' ? 'characters' : 'none'}
                    autoCorrect="off"
                    spellCheck={false}
                />
                {chains.length === 0 ? (
                    <p className={styles.entryDescription}>
                        {settings ? 'No chains are available for the active network.' : 'Loading available networks…'}
                    </p>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={searching}
                        disabled={!query.trim() || chains.length === 0}
                    >
                        Search
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

function ResultsPane({ rowsByChain, searching, onOpenDispenser, oracleFeedsFor }) {
    if (searching) {
        return <p className={styles.entryDescription}>Searching…</p>;
    }
    const entries = Object.entries(rowsByChain);
    if (entries.length === 0) {
        return <EmptyState title="No results." />;
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
        return <EmptyState title="No open dispensers matched." />;
    }
    return (
        <>
            {entries.map(([cid, state]) => {
                if (cid === '_error') return null;
                const d = chainRegistry.get(cid);
                if (state.rows.length === 0 && !state.error) return null;
                return (
                    <section key={cid} style={{ marginBottom: '1rem' }}>
                        <SectionHeader
                            title={d
                                ? <ChainBadge descriptor={d} size="sm" />
                                : <span>{cid}</span>}
                        />
                        {state.error ? (
                            <StatusMessage variant="error" className={styles.entryDescription}>
                                Couldn't search: {state.error}
                            </StatusMessage>
                        ) : (
                            state.rows.map((row) => (
                                <ResultRow
                                    key={String(row.action_index)}
                                    row={row}
                                    oracleFeeds={oracleFeedsFor(cid, row)}
                                    onSelect={() => onOpenDispenser(cid, String(row.action_index))}
                                />
                            ))
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
        <button
            type="button"
            className={styles.entry}
            onClick={onSelect}
        >
            <span className={styles.entryLabel}>
                {row.give_tick || '?'} @ <AddressText address={row.address || row.source || '?'} />
            </span>
            <span className={styles.entryDescription}>
                Gives {give} per fill · Price per fill: {price}
            </span>
            <span className={styles.entryDescription}>
                #{row.action_index ?? '?'} · status {status}
                {row.source ? ` · by ` : ''}
                {row.source ? <AddressText address={row.source} /> : null}
            </span>
        </button>
    );
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}
