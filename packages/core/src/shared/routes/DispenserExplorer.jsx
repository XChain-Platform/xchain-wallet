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
import {
    Screen,
    ScreenHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Dispenser explorer — §40.7.2 buyer-facing browse surface.
 *
 * The explorer backend doesn't expose an "all dispensers" wildcard;
 * every query is scoped to a token or an address. This view therefore
 * centers on a required search input. Users pick:
 *
 *   - "By token" — ticker-based search (common case: "find open
 *     MYTOKEN dispensers"). Passes the input as `token` to
 *     `dispensersForToken`, which the backend matches against both
 *     GIVE_TICK and GET_TICK.
 *   - "By address" — address-based search. Passes the input as
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
    const isFull = variant === 'full';

    const chains = useMemo(() => chainRegistry.supportedChains().map((d) => d.id), []);

    const [searchMode, setSearchMode] = useState(/** @type {'token' | 'address'} */ ('token'));
    const [query, setQuery] = useState('');
    const [chainFilter, setChainFilter] = useState(/** @type {string} */ ('all'));
    const [searching, setSearching] = useState(false);
    const [rowsByChain, setRowsByChain] = useState(
        /** @type {Record<string, { rows: any[], error: string | null }>} */ ({}),
    );
    const [lastQueried, setLastQueried] = useState(/** @type {string | null} */ (null));

    function handleSearch(event) {
        event.preventDefault();
        const q = query.trim();
        if (!q) return;
        if (searchMode === 'token' && !/^[A-Za-z0-9.^]+$/.test(q)) {
            setRowsByChain({ _error: { rows: [], error: 'Token search accepts A–Z, 0–9, period, or ^TICK_ID.' } });
            setLastQueried(q);
            return;
        }
        setSearching(true);
        setLastQueried(q);
        setRowsByChain({});

        const targetChains = chainFilter === 'all' ? chains : [chainFilter];
        const fetchOne = searchMode === 'token'
            ? (cid) => messaging.getDispensersForToken({ chainId: cid, token: q })
            : (cid) => messaging.getDispensersForAddress({ chainId: cid, address: q });

        Promise.all(targetChains.map((cid) =>
            fetchOne(cid)
                .then((resp) => ({ cid, rows: extractRows(resp) }))
                .catch((err) => ({ cid, error: err?.message || String(err) }))
        )).then((results) => {
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
        <ScreenHeader
            onBack={onBack}
            title="Dispenser explorer"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div style={{ maxWidth: 1080, margin: '0 auto', padding: '1rem' }}>{children}</div> : children}
        </Screen>
    );

    return wrap(
        <>
            <form onSubmit={handleSearch} noValidate style={{ marginBottom: '1rem' }}>
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
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={searching}
                        disabled={!query.trim()}
                    >
                        Search
                    </Button>
                </div>
            </form>

            {lastQueried ? (
                <ResultsPane
                    rowsByChain={rowsByChain}
                    searching={searching}
                    onOpenDispenser={onOpenDispenser}
                />
            ) : (
                <p className={styles.entryDescription}>
                    Search by token ticker to find open dispensers, or by address to find
                    a specific creator's or dispenser's listings.
                </p>
            )}
        </>,
    );
}

function ResultsPane({ rowsByChain, searching, onOpenDispenser }) {
    if (searching) {
        return <p className={styles.entryDescription}>Searching…</p>;
    }
    const entries = Object.entries(rowsByChain);
    if (entries.length === 0) {
        return <p className={styles.entryDescription}>No results.</p>;
    }
    // Surface an overall-error row when the precondition failed (e.g.,
    // invalid token regex). That uses the sentinel "_error" key.
    const overall = rowsByChain._error;
    if (overall && overall.error) {
        return <p role="alert" className={styles.entryDescription}>{overall.error}</p>;
    }
    let anyRow = false;
    for (const [, v] of entries) if (v.rows.length > 0) { anyRow = true; break; }
    if (!anyRow) {
        return <p className={styles.entryDescription}>No open dispensers matched.</p>;
    }
    return (
        <>
            {entries.map(([cid, state]) => {
                if (cid === '_error') return null;
                const d = chainRegistry.get(cid);
                if (state.rows.length === 0 && !state.error) return null;
                return (
                    <section key={cid} style={{ marginBottom: '1rem' }}>
                        <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            {d
                                ? <ChainBadge descriptor={d} size="sm" />
                                : <span>{cid}</span>}
                        </header>
                        {state.error ? (
                            <p role="alert" className={styles.entryDescription}>
                                Couldn't search: {state.error}
                            </p>
                        ) : (
                            state.rows.map((row) => (
                                <ResultRow
                                    key={String(row.action_index)}
                                    row={row}
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

function ResultRow({ row, onSelect }) {
    const rate = rateLabel(row);
    const status = String(row.status || '—');
    return (
        <button
            type="button"
            className={styles.entry}
            onClick={onSelect}
        >
            <span className={styles.entryLabel}>
                {row.give_tick || '?'} @ <AddressText address={row.address || row.source || '?'} /> · {rate}
            </span>
            <span className={styles.entryDescription}>
                #{row.action_index ?? '?'} · status {status}
                {row.source ? ` · by ` : ''}
                {row.source ? <AddressText address={row.source} /> : null}
            </span>
        </button>
    );
}

function rateLabel(row) {
    const give = `${row.give_amount ?? '?'} ${row.give_tick || '?'}`;
    const coin = row.get_coin || '';
    const tick = row.get_tick || '';
    const amt = row.get_amount ?? '?';
    const payAsset = tick || coin || '?';
    return `${give} per ${amt} ${payAsset}`;
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}
