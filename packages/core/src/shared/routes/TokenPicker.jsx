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
import { Screen, PageHeader, Icon, Skeleton } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import {
    BalanceList,
    buildBalanceRows,
    buildNativeRow,
    buildPlatformTokenRow,
    sortByChainThenAsset,
    coinFromChainId,
} from '../components/BalanceList.jsx';
import { EmptyStateNudge } from '../components/EmptyStateNudge.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './TokenPicker.module.css';

const PLATFORM_QUERY_MIN_CHARS = 3;
const PLATFORM_QUERY_DEBOUNCE_MS = 350;

const chainRegistry = registryLib.defaultRegistry();

/**
 * TokenPicker: the single "pick a coin or token" screen shared by the
 * Send and Receive quick-actions (and the markets coin/token picker).
 * Renders a flat scrollable balance list with an inline filter toolbar
 * (free-text search + an All / Coins / Tokens segmented control) docked
 * above it. Selecting a row hands {chainId, tick} to the host.
 *
 * `purpose` is the only behavioural switch:
 *   - `'send'`    : lists only spendable balances the wallet holds.
 *   - `'receive'` : also surfaces every chain the wallet has an address
 *                   on (receive is meaningful at zero balance) and runs
 *                   the cross-chain "On the platform" token discovery so
 *                   the user can receive a token they have never held.
 *
 * Header title / icon / back-label and the filter props follow the
 * parent-vs-local pattern: when the shell passes controlled filter props
 * the picker stays in sync with the global filter; otherwise it owns its
 * own state. Hidden tokens (§27.4 / G073) are excluded; pinned tokens
 * (§27.3 / G072) sort to the top.
 *
 * @param {object} props
 * @param {'send' | 'receive'} [props.purpose]  defaults to 'receive'
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {string} [props.networkFilter]
 * @param {(coin: string) => void} [props.onNetworkFilterChange]
 * @param {string} [props.tokenQuery]
 * @param {(query: string) => void} [props.onTokenQueryChange]
 * @param {'all' | 'coins' | 'tokens'} [props.kindFilter]
 * @param {(kind: 'all' | 'coins' | 'tokens') => void} [props.onKindFilterChange]
 * @param {boolean} [props.kindLocked]  hide the kind segments because the
 *   caller's action only accepts one kind (: BET escrows tokens, so the
 *   native coin is not a legal wager and must not be offered)
 * @param {string} [props.title]
 * @param {import('react').ReactNode} [props.titleIcon]
 * @param {string} [props.backLabel]
 * @param {() => void} [props.onBack]
 * @param {(sel: { chainId: string, tick: string, kind?: string, displayName?: string, imageUrl?: string | null }) => void} props.onSelect
 */
export function TokenPicker({
    purpose = 'receive',
    walletId,
    accountId,
    networkFilter: networkFilterProp,
    onNetworkFilterChange: onNetworkFilterChangeProp,
    tokenQuery: tokenQueryProp,
    onTokenQueryChange: onTokenQueryChangeProp,
    kindFilter: kindFilterProp,
    onKindFilterChange: onKindFilterChangeProp,
    kindLocked = false,
    title,
    titleIcon,
    backLabel,
    onBack,
    onSelect,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const isReceive = purpose === 'receive';

    const [balances, setBalances] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [hiddenTokens, setHiddenTokens] = useState(/** @type {string[]} */ ([]));
    const [pinnedTokens, setPinnedTokens] = useState(/** @type {string[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [networkFilterLocal, setNetworkFilterLocal] = useState('all');
    const networkFilter = networkFilterProp ?? networkFilterLocal;
    const setNetworkFilter = onNetworkFilterChangeProp ?? setNetworkFilterLocal;

    const [tokenQueryLocal, setTokenQueryLocal] = useState('');
    const tokenQuery = tokenQueryProp ?? tokenQueryLocal;
    const setTokenQuery = onTokenQueryChangeProp ?? setTokenQueryLocal;

    const [kindFilterLocal, setKindFilterLocal] = useState(/** @type {'all' | 'coins' | 'tokens'} */ ('all'));
    const kindFilter = kindFilterProp ?? kindFilterLocal;
    const setKindFilter = onKindFilterChangeProp ?? setKindFilterLocal;

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.getSettings !== 'function') return undefined;
        messaging.getSettings()
            .then((s) => {
                if (cancelled) return;
                const hides = Array.isArray(s?.hiddenTokens)
                    ? s.hiddenTokens.filter((k) => typeof k === 'string')
                    : [];
                const pins = Array.isArray(s?.pinnedTokens)
                    ? s.pinnedTokens.filter((k) => typeof k === 'string')
                    : [];
                setHiddenTokens(hides);
                setPinnedTokens(pins);
            })
            .catch(() => { /* empty hide/pin lists are fine defaults */ });
        return () => { cancelled = true; };
    }, [messaging]);

    useEffect(() => {
        if (!walletId) return undefined;
        let cancelled = false;
        setBalances(null);
        setAddressesByChain(null);
        setLoadError(null);
        (async () => {
            try {
                // Receive needs addresses-by-chain too: it surfaces every
                // chain the wallet has an address on (even zero-balance) and
                // drives the platform token search. Send only needs balances.
                const canByChain = typeof messaging.getAddressesByChain === 'function';
                const isDemo = flowsLib.isDemoWallet(walletId);
                let b;
                if (isDemo && canByChain) {
                    // Demo balances are synthesized from the address map for
                    // both purposes; only Receive keeps the map around.
                    const byChain = await messaging.getAddressesByChain(walletId, accountId);
                    if (!cancelled && isReceive) setAddressesByChain(byChain);
                    b = flowsLib.synthesizeDemoBalances(byChain);
                } else {
                    const byChainPromise = (isReceive && canByChain)
                        ? messaging.getAddressesByChain(walletId, accountId)
                        : Promise.resolve(null);
                    const [byChain, walletBalances] = await Promise.all([
                        byChainPromise,
                        messaging.getWalletBalances(walletId, accountId),
                    ]);
                    if (!cancelled && isReceive) setAddressesByChain(byChain);
                    b = walletBalances;
                }
                if (!cancelled) setBalances(b);
            } catch (err) {
                if (!cancelled) setLoadError(err?.message || 'Failed to load balances.');
            }
        })();
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, isReceive]);

    const allRows = useMemo(() => {
        const rowsFromBalances = buildBalanceRows(balances, chainRegistry);
        // Receive only: ensure every chain with an address contributes a
        // native row, even at zero balance (receive is meaningful then).
        if (!isReceive || !addressesByChain) return rowsFromBalances;
        const seenChains = new Set();
        for (const r of rowsFromBalances) {
            if (r.kind === 'native') seenChains.add(r.chainId);
        }
        const synthesized = [];
        for (const chainId of Object.keys(addressesByChain)) {
            if (seenChains.has(chainId)) continue;
            const row = buildNativeRow(chainId, chainRegistry);
            if (row) synthesized.push(row);
        }
        return synthesized.length > 0 ? [...rowsFromBalances, ...synthesized] : rowsFromBalances;
    }, [balances, addressesByChain, isReceive]);

    const coinFamilies = useMemo(() => {
        const seen = new Set();
        for (const r of allRows) {
            const coin = coinFromChainId(r.chainId);
            if (coin) seen.add(coin);
        }
        const ordered = ['bitcoin', 'litecoin', 'dogecoin'].filter((c) => seen.has(c));
        for (const c of seen) if (!ordered.includes(c)) ordered.push(c);
        return ordered;
    }, [allRows]);

    const tokenQueryTrim = tokenQuery.trim().toLowerCase();
    const rows = useMemo(() => {
        let next = allRows;
        if (networkFilter !== 'all') {
            next = next.filter((r) => coinFromChainId(r.chainId) === networkFilter);
        }
        if (kindFilter === 'coins') {
            next = next.filter((r) => r.kind === 'native');
        } else if (kindFilter === 'tokens') {
            next = next.filter((r) => r.kind !== 'native');
        }
        if (tokenQueryTrim) {
            next = next.filter((r) => {
                const tick = String(r.tick || '').toLowerCase();
                const name = String(r.displayName || '').toLowerCase();
                return tick.includes(tokenQueryTrim) || name.includes(tokenQueryTrim);
            });
        }
        return sortByChainThenAsset(next);
    }, [allRows, networkFilter, kindFilter, tokenQueryTrim]);

    const hiddenSet = useMemo(() => new Set(hiddenTokens), [hiddenTokens]);
    const pinnedSet = useMemo(() => new Set(pinnedTokens), [pinnedTokens]);

    // Platform discovery (receive only): when the user types a partial
    // ticker, substring-search every chain the wallet has addresses on and
    // surface matching tokens that aren't already in their balance as a
    // second "On the platform" section. Lets the user receive a token they
    // have never held in one tap. Server-side `LIKE '%query%'`, debounced,
    // with a per-component cache keyed by `${chainId}::${query}`.
    const [platformResults, setPlatformResults] = useState(/** @type {any[]} */ ([]));
    const [platformBusy, setPlatformBusy] = useState(false);
    const platformCacheRef = useRef(/** @type {Map<string, any>} */ (new Map()));

    const localKeySet = useMemo(() => {
        const s = new Set();
        for (const r of allRows) s.add(`${r.chainId}:${r.tick}`);
        return s;
    }, [allRows]);

    useEffect(() => {
        const query = tokenQuery.trim().toUpperCase();
        if (!isReceive
            || !query
            || query.length < PLATFORM_QUERY_MIN_CHARS
            || kindFilter === 'coins'
            || !addressesByChain
            || typeof messaging?.searchTokens !== 'function'
        ) {
            setPlatformResults([]);
            setPlatformBusy(false);
            return undefined;
        }
        let cancelled = false;
        setPlatformBusy(true);
        const handle = setTimeout(async () => {
            const chainIds = Object.keys(addressesByChain);
            const cache = platformCacheRef.current;
            try {
                const lookups = await Promise.all(chainIds.map(async (chainId) => {
                    const cacheKey = `${chainId}::${query}`;
                    if (cache.has(cacheKey)) return { chainId, hits: cache.get(cacheKey) };
                    try {
                        const hits = await messaging.searchTokens({ chainId, query });
                        const normalized = Array.isArray(hits) ? hits : [];
                        cache.set(cacheKey, normalized);
                        return { chainId, hits: normalized };
                    } catch {
                        cache.set(cacheKey, []);
                        return { chainId, hits: [] };
                    }
                }));
                if (cancelled) return;
                const found = [];
                for (const { chainId, hits } of lookups) {
                    for (const hit of hits) {
                        if (!hit || !hit.tick) continue;
                        if (localKeySet.has(`${chainId}:${hit.tick}`)) continue;
                        const row = buildPlatformTokenRow(chainId, hit.tick, null, chainRegistry);
                        if (row) found.push(row);
                    }
                }
                setPlatformResults(sortByChainThenAsset(found));
            } finally {
                if (!cancelled) setPlatformBusy(false);
            }
        }, PLATFORM_QUERY_DEBOUNCE_MS);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [isReceive, tokenQuery, kindFilter, addressesByChain, messaging, localKeySet]);

    const handleSelect = (tok) => onSelect?.({
        chainId: tok.chainId,
        tick: tok.tick,
        kind: tok.kind,
        displayName: tok.displayName,
        imageUrl: tok.imageUrl,
    });

    const headerTitle = title ?? (isReceive ? 'Receive' : 'Send');
    const headerIcon = titleIcon ?? (isReceive ? <Icon.ReceiveIcon /> : <Icon.SendIcon />);
    const headerBackLabel = backLabel ?? 'Back to home';

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel={headerBackLabel}
            title={headerTitle}
            titleIcon={headerIcon}
        />
    );

    const emptyTitle = tokenQueryTrim
        ? 'No matching balances'
        : (networkFilter === 'all'
            ? (isReceive ? 'No balances to receive against yet' : 'Nothing to send yet')
            : 'No balances on this network');
    const emptyBody = tokenQueryTrim
        ? `Nothing matches "${tokenQuery.trim()}". Clear the filter to see everything.`
        : (networkFilter === 'all'
            ? (isReceive
                ? 'Pick a chain to display a fresh receive address. Tokens you have not held before can be received on whichever chain they belong to.'
                : 'Receive coins or tokens first, then come back to send them.')
            : undefined);

    const KIND_OPTIONS = [
        { id: 'all',    label: 'All' },
        { id: 'coins',  label: 'Coins' },
        { id: 'tokens', label: 'Tokens' },
    ];

    const body = (
        <>
            {loadError ? (
                <div role="alert" className={styles.error}>{loadError}</div>
            ) : null}
            <div className={styles.toolbar}>
                <input
                    type="text"
                    className={styles.search}
                    placeholder="Search"
                    value={tokenQuery}
                    onChange={(e) => setTokenQuery(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-label="Search coins or tokens"
                />
                {/* : a caller that pins `kindFilter` is stating a
                    protocol constraint, not a default. Rendering the segments
                    anyway would offer a choice the action cannot honour, and
                    the segments would appear dead because the pinned prop wins
                    over the local state they set. */}
                <div
                    className={styles.kindSegments}
                    role="tablist"
                    aria-label="Asset kind"
                    hidden={kindLocked}
                    style={kindLocked ? { display: 'none' } : undefined}
                >
                    {KIND_OPTIONS.map((opt) => {
                        const active = (kindFilter || 'all') === opt.id;
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                className={`${styles.kindSegment} ${active ? styles.kindSegmentActive : ''}`}
                                onClick={() => setKindFilter(opt.id)}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
            </div>
            {balances === null && !loadError ? (
                <div role="status" aria-label="Loading balances">
                    <Skeleton.List rows={5} />
                </div>
            ) : null}
            {balances ? (
                <>
                    {rows.length > 0 ? (
                        <BalanceList
                            rows={rows}
                            onSelectToken={handleSelect}
                            hiddenKeys={hiddenSet}
                            pinnedKeys={pinnedSet}
                        />
                    ) : (platformResults.length === 0 && !platformBusy) ? (
                        <EmptyStateNudge
                            title={emptyTitle}
                            body={emptyBody}
                        />
                    ) : null}
                    {(platformResults.length > 0 || platformBusy) ? (
                        <div className={styles.platformSection}>
                            <div className={styles.platformHeading}>On the platform</div>
                            {platformBusy && platformResults.length === 0 ? (
                                <div role="status" aria-label="Searching platform">
                                    <Skeleton.List rows={1} />
                                </div>
                            ) : null}
                            {platformResults.length > 0 ? (
                                <BalanceList
                                    rows={platformResults}
                                    onSelectToken={handleSelect}
                                    // : this section searches EVERY chain
                                    // the wallet holds an address on, so the
                                    // same tick legitimately appears once per
                                    // chain. Without the chain named, those
                                    // rows are identical, and picking one
                                    // re-targets the calling form's network.
                                    showChain
                                />
                            ) : null}
                        </div>
                    ) : null}
                </>
            ) : null}
        </>
    );

    return (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{body}</div> : body}
        </Screen>
    );
}
