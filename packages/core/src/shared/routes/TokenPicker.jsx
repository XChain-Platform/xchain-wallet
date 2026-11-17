// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EmptyState, Icon, IconSelect, ListPage, Notice, PageHeader, Screen, SectionHeader, Skeleton } from '@xchain-wallet/core/ui';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import {
    BalanceList,
    buildBalanceRows,
    buildNativeRow,
    buildPlatformTokenRow,
    sortByChainThenAsset,
    coinFromChainId,
} from '../components/BalanceList.jsx';
import { BalancesUncheckedState, useBalancesUnchecked } from '../components/BalancesUncheckedState.jsx';
import { bridgeDisplayTick } from './BridgeTick.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { loadBalancesByChain } from '../utils/chainBalanceLoader.js';
import { useSettings } from '../hooks/useSettings.js';
import {
    pinnedTokensForWallet,
    pinnedTokensPatchForWallet,
    resolveSmallBalanceFiat,
} from '../../schemas/settings.js';
import styles from './TokenPicker.module.css';

const PLATFORM_QUERY_MIN_CHARS = 3;
const PLATFORM_QUERY_DEBOUNCE_MS = 350;

const chainRegistry = registryLib.defaultRegistry();

// Rows show the chain only as an icon overlay, and every chain lists the same
// tickers, so the row's accessible name says which chain (without the network
// kind) the asset is on.
function tokenSelectionLabel(row) {
    const chain = chainRegistry.get(row.chainId)?.displayName;
    return `Select ${row.displayName || row.tick}${chain ? ` on ${chain}` : ''}`;
}

function withoutRenderedChainLabels(rows) {
    return rows.map((row) => ({ ...row, chainDisplayName: '', networkKind: '' }));
}

function hasSpendableBalance(row) {
    if (row?.unavailable) return true;
    try {
        return BigInt(row?.quantity || 0) > 0n;
    } catch {
        return false;
    }
}

// A plain decimal ("1234.5") as the atomic digits and places a balance row
// carries, or null for anything that is not a non-negative decimal.
function decimalToAtomic(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    const [whole, frac = ''] = text.split('.');
    const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, '');
    return { quantity: digits, divisibility: frac.length };
}

// One row of a caller's explicit list. A row with its own quantity (what a
// contract holds) shows that amount; a row without one shows the wallet's own
// balance of the token, or 0 when the wallet holds none.
function explicitPickerRow(entry, walletRow, balanceReadFailed) {
    if (!entry || typeof entry.chainId !== 'string' || typeof entry.tick !== 'string' || !entry.tick) return null;
    const meta = { displayName: entry.displayName || entry.tick, imageUrl: null };
    if (entry.quantity == null) {
        if (walletRow) return walletRow;
        const row = buildPlatformTokenRow(entry.chainId, entry.tick, meta, chainRegistry);
        if (!row) return null;
        return balanceReadFailed
            ? { ...row, divisibility: 0, unavailable: 'all' }
            : { ...row, divisibility: 0 };
    }
    const row = buildPlatformTokenRow(entry.chainId, entry.tick, meta, chainRegistry);
    if (!row) return null;
    const atomic = decimalToAtomic(entry.quantity);
    return atomic ? { ...row, ...atomic } : { ...row, divisibility: 0, unavailable: 'all' };
}

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
 * `rows` is how a form whose eligible tokens are not the wallet's balances
 * (a contract's holdings on Withdraw, the tokens this wallet owns on Bind)
 * still opens this one picker: the list is exactly those rows, under the same
 * header, filter and row style, with no spendable-balance or small-balance
 * trimming and no platform search, unless `searchPlatform` asks for it.
 *
 * @param {Array<{ chainId: string, tick: string, quantity?: string | null, displayName?: string }> | null} [props.rows]
 *   the only tokens the caller accepts; null while the caller loads them.
 *   `quantity` is a plain decimal shown as the row's balance; without it the
 *   row shows the wallet's own balance of that token.
 * @param {string} [props.emptyTitle]  explicit rows only: the empty list's title
 * @param {string} [props.emptyBody]   explicit rows only: the empty list's body
 * @param {boolean} [props.searchPlatform]  explicit rows only: the rows list
 *   first and a typed search also finds any token on the platform, on
 *   `chainIdFilter` (or the rows' own chains), in an "On the platform"
 *   section; for a form that accepts every token (an oracle prices any one)
 *
 * @param {object} props
 * @param {'send' | 'receive'} [props.purpose]  defaults to 'receive'
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {string} [props.networkFilter]
 * @param {string} [props.chainIdFilter] exact chain to show within a coin-family filter
 * @param {(coin: string) => void} [props.onNetworkFilterChange]
 * @param {string} [props.tokenQuery]
 * @param {(query: string) => void} [props.onTokenQueryChange]
 * @param {'all' | 'coins' | 'tokens'} [props.kindFilter]
 * @param {(kind: 'all' | 'coins' | 'tokens') => void} [props.onKindFilterChange]
 * @param {boolean} [props.kindLocked]  hide the kind segments because the
 * Caller's action only accepts one kind (BET escrows tokens, so the
 *   native coin is not a legal wager and must not be offered)
 * @param {string} [props.title]
 * @param {string} [props.backLabel]
 * @param {() => void} [props.onBack]
 * @param {import('react').ElementType} [props.listPageComponent]
 * @param {boolean} [props.embedded] render the picker body without its own Screen
 * @param {HTMLElement | null} [props.filterHost] portal target for the embedded picker's filter
 * @param {string | null} [props.selectedKey] current `chainId:tick` in a wide list-detail view
 * @param {boolean} [props.splitRows] render the embedded results as wide split rows
 * @param {(sel: { chainId: string, tick: string, kind?: string, displayName?: string, imageUrl?: string | null }) => void} [props.onFirstOption]
 * @param {(sel: { chainId: string, tick: string, kind?: string, displayName?: string, imageUrl?: string | null }) => void} props.onSelect
 */
export function TokenPicker({
    purpose = 'receive',
    walletId,
    accountId,
    networkFilter: networkFilterProp,
    chainIdFilter,
    onNetworkFilterChange: onNetworkFilterChangeProp,
    tokenQuery: tokenQueryProp,
    onTokenQueryChange: onTokenQueryChangeProp,
    kindFilter: kindFilterProp,
    onKindFilterChange: onKindFilterChangeProp,
    kindLocked = false,
    title,
    backLabel,
    onBack,
    listPageComponent: ListPageComponent = ListPage,
    rows: explicitRows,
    emptyTitle: explicitEmptyTitle,
    emptyBody: explicitEmptyBody,
    searchPlatform = false,
    embedded = false,
    filterHost = null,
    selectedKey = null,
    splitRows = false,
    onFirstOption,
    onSelect,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const explicit = explicitRows !== undefined;
    const isReceive = !explicit && purpose === 'receive';
    // A caller's explicit list that also searches every token on the platform.
    const explicitSearch = explicit && searchPlatform === true;
    // Explicit rows read the wallet's balances only for rows that carry no
    // quantity of their own.
    const needsWalletBalances = !explicit
        || (Array.isArray(explicitRows) && explicitRows.some((entry) => entry?.quantity == null));
    const { settings } = useSettings();
    const allowRemoteImages = Boolean(settings)
        && settings.privacy?.metadataFetchEnabled !== false;

    const [hiddenTokens, setHiddenTokens] = useState(/** @type {string[]} */ ([]));
    const [pinnedTokens, setPinnedTokens] = useState(/** @type {string[]} */ ([]));
    const [balanceReload, setBalanceReload] = useState(0);
    const { unchecked: balancesUnchecked, recheck: recheckBalances } = useBalancesUnchecked();
    const [balanceLoad, setBalanceLoad] = useState({
        walletId: null,
        accountId: null,
        isReceive: null,
        reload: null,
        balances: null,
        addressesByChain: null,
        error: null,
        slowChainIds: [],
        pendingCount: 0,
    });
    const balanceLoadMatches = balanceLoad.walletId === walletId
        && balanceLoad.accountId === accountId
        && balanceLoad.isReceive === isReceive
        && balanceLoad.reload === balanceReload;
    const balances = balanceLoadMatches ? balanceLoad.balances : null;
    const addressesByChain = balanceLoadMatches ? balanceLoad.addressesByChain : null;
    const loadError = balanceLoadMatches ? balanceLoad.error : null;
    const slowChainIds = balanceLoadMatches ? balanceLoad.slowChainIds : [];
    const pendingChainCount = balanceLoadMatches ? balanceLoad.pendingCount : 0;

    const [networkFilterLocal, setNetworkFilterLocal] = useState('all');
    const networkFilter = networkFilterProp ?? networkFilterLocal;
    const setNetworkFilter = onNetworkFilterChangeProp ?? setNetworkFilterLocal;

    const [tokenQueryLocal, setTokenQueryLocal] = useState('');
    const tokenQuery = tokenQueryProp ?? tokenQueryLocal;
    const setTokenQuery = onTokenQueryChangeProp ?? setTokenQueryLocal;

    const [kindFilterLocal, setKindFilterLocal] = useState(/** @type {'all' | 'coins' | 'tokens'} */ ('all'));
    const kindFilter = kindFilterProp ?? kindFilterLocal;
    const setKindFilter = onKindFilterChangeProp ?? setKindFilterLocal;
    const [rovingOption, setRovingOption] = useState(null);

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.getSettings !== 'function') return undefined;
        setPinnedTokens([]);
        messaging.getSettings()
            .then((s) => {
                if (cancelled) return;
                const hides = Array.isArray(s?.hiddenTokens)
                    ? s.hiddenTokens.filter((k) => typeof k === 'string')
                    : [];
                const pins = pinnedTokensForWallet(s, walletId)
                    .filter((k) => typeof k === 'string');
                setHiddenTokens(hides);
                setPinnedTokens(pins);
            })
            .catch(() => { /* empty hide/pin lists are fine defaults */ });
        return () => { cancelled = true; };
    }, [messaging, walletId]);

    useEffect(() => {
        if (!walletId || !needsWalletBalances) return undefined;
        let cancelled = false;
        const pendingLoad = {
            walletId,
            accountId,
            isReceive,
            reload: balanceReload,
            balances: null,
            addressesByChain: null,
            error: null,
            slowChainIds: [],
            pendingCount: 0,
        };
        setBalanceLoad(pendingLoad);
        (async () => {
            try {
                // Receive needs addresses-by-chain too: it surfaces every
                // chain the wallet has an address on (even zero-balance) and
                // drives the platform token search. Send only needs balances.
                const canByChain = typeof messaging.getAddressesByChain === 'function';
                const isDemo = flowsLib.isDemoWallet(walletId);
                let b;
                let byChain = null;
                if (isDemo && canByChain) {
                    // Demo balances are synthesized from the address map for
                    // both purposes; only Receive keeps the map around.
                    byChain = await messaging.getAddressesByChain(walletId, accountId);
                    b = flowsLib.synthesizeDemoBalances(byChain);
                } else if (canByChain && typeof messaging.getWalletBalances === 'function') {
                    // Each chain is read on its own, so a chain whose explorer
                    // never answers holds back only itself: every other chain
                    // lists the moment it replies.
                    byChain = await messaging.getAddressesByChain(walletId, accountId);
                    const chainIds = Object.keys(byChain || {});
                    if (cancelled) return;
                    if (chainIds.length === 0) {
                        setBalanceLoad({ ...pendingLoad, balances: {}, addressesByChain: isReceive ? byChain : null });
                        return;
                    }
                    setBalanceLoad((prev) => ({ ...prev, pendingCount: chainIds.length }));
                    const patch = (fn) => setBalanceLoad((prev) => (
                        prev.walletId === walletId && prev.accountId === accountId
                            && prev.isReceive === isReceive && prev.reload === balanceReload
                            ? fn(prev) : prev));
                    await loadBalancesByChain({
                        messaging, walletId, accountId, chainIds,
                        isCancelled: () => cancelled,
                        onChain: (chainId, entries) => {
                            patch((prev) => ({
                                ...prev,
                                balances: { ...(prev.balances || {}), [chainId]: entries },
                                addressesByChain: isReceive ? byChain : null,
                                slowChainIds: prev.slowChainIds.filter((id) => id !== chainId),
                                pendingCount: Math.max(0, prev.pendingCount - 1),
                            }));
                        },
                        onSlow: (chainId) => patch((prev) => ({
                            ...prev,
                            balances: prev.balances || {},
                            addressesByChain: isReceive ? byChain : null,
                            slowChainIds: prev.slowChainIds.includes(chainId)
                                ? prev.slowChainIds : [...prev.slowChainIds, chainId],
                        })),
                        onError: (chainId, err) => {
                            // A chain that fails keeps the chains that answered on
                            // screen and offers one retry for the whole read.
                            patch((prev) => ({
                                ...prev,
                                error: prev.error || err.message || 'Failed to load balances.',
                                slowChainIds: prev.slowChainIds.filter((id) => id !== chainId),
                                pendingCount: Math.max(0, prev.pendingCount - 1),
                            }));
                        },
                    });
                    if (!cancelled) {
                        patch((prev) => ({
                            ...prev,
                            balances: prev.balances || {},
                            addressesByChain: isReceive ? byChain : null,
                        }));
                    }
                    return;
                } else {
                    const byChainPromise = (isReceive && canByChain)
                        ? messaging.getAddressesByChain(walletId, accountId)
                        : Promise.resolve(null);
                    const [nextByChain, walletBalances] = await Promise.all([
                        byChainPromise,
                        messaging.getWalletBalances(walletId, accountId),
                    ]);
                    byChain = nextByChain;
                    b = walletBalances;
                }
                if (!cancelled) {
                    setBalanceLoad({
                        ...pendingLoad,
                        balances: b,
                        addressesByChain: isReceive ? byChain : null,
                    });
                }
            } catch (err) {
                if (!cancelled) {
                    setBalanceLoad({
                        ...pendingLoad,
                        error: err?.message || 'Failed to load balances.',
                    });
                }
            }
        })();
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, isReceive, balanceReload, needsWalletBalances]);

    const allRows = useMemo(() => {
        if (explicit) {
            if (!Array.isArray(explicitRows)) return [];
            const walletRows = new Map();
            if (needsWalletBalances) {
                for (const row of buildBalanceRows(balances, chainRegistry)) {
                    walletRows.set(`${row.chainId}:${row.tick}`, row);
                }
            }
            const seen = new Set();
            const out = [];
            for (const entry of explicitRows) {
                const row = explicitPickerRow(
                    entry,
                    walletRows.get(`${entry?.chainId}:${entry?.tick}`),
                    Boolean(loadError),
                );
                const key = row ? `${row.chainId}:${row.tick}` : null;
                if (!row || seen.has(key)) continue;
                seen.add(key);
                out.push(row);
            }
            return out;
        }
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
    }, [balances, addressesByChain, isReceive, explicit, explicitRows, needsWalletBalances, loadError]);

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
        // A caller's explicit rows are the eligible set as given, zero included.
        let next = (isReceive || explicit)
            ? allRows
            : allRows.filter(hasSpendableBalance);
        if (chainIdFilter) {
            next = next.filter((r) => r.chainId === chainIdFilter);
        }
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
                // The chain id is matched only when the query is a chain:tick pair, so "bitcoin" does not match every row on the bitcoin chain.
                const assetId = tokenQueryTrim.includes(':') ? `${r.chainId || ''}:${r.tick || ''}`.toLowerCase() : '';
                return tick.includes(tokenQueryTrim)
                    || name.includes(tokenQueryTrim)
                    || (assetId !== '' && assetId.includes(tokenQueryTrim));
            });
        }
        // A bridged copy is stored origin-rooted ('BTC.PEPECASH') and must not
        // be listed by its wire name: on a picker the rooted string reads as a
        // subasset of a token called BTC. Named here rather than in BalanceList
        // so the rows' own `tick` (what a selection hands back, and what the
        // action is composed against) is untouched - only the label moves.
        // Search still matches the rooted form above, which is what someone
        // pasting a ticker from the explorer will type.
        next = next.map((r) => {
            const { label, origin } = bridgeDisplayTick(r.tick, coinFromChainId(r.chainId));
            if (!origin) return r;
            return { ...r, displayName: `${label} (from ${origin})` };
        });
        const sorted = sortByChainThenAsset(next);
        return isReceive
            ? [
                ...sorted.filter(hasSpendableBalance),
                ...sorted.filter((row) => !hasSpendableBalance(row)),
            ]
            : sorted;
    }, [allRows, isReceive, explicit, networkFilter, chainIdFilter, kindFilter, tokenQueryTrim]);

    const hiddenSet = useMemo(() => new Set(hiddenTokens), [hiddenTokens]);
    const pinnedSet = useMemo(() => new Set(pinnedTokens), [pinnedTokens]);
    const handleTogglePin = useCallback((key, nextPinned) => {
        if (typeof key !== 'string' || !key) return;
        setPinnedTokens((previous) => {
            const nextSet = new Set(previous);
            if (nextPinned) nextSet.add(key);
            else nextSet.delete(key);
            const next = Array.from(nextSet);
            if (typeof messaging?.updateSettings === 'function') {
                messaging.updateSettings(
                    pinnedTokensPatchForWallet(walletId, next),
                ).catch(() => {});
            }
            return next;
        });
    }, [messaging, walletId]);

    // Platform discovery (receive only): when the user types a partial
    // ticker, substring-search every chain the wallet has addresses on and
    // surface matching tokens that aren't already in their balance as a
    // second "On the platform" section. Lets the user receive a token they
    // have never held in one tap. Server-side `LIKE '%query%'`, debounced,
    // with a per-component cache keyed by `${chainId}::${query}`.
    const [platformResults, setPlatformResults] = useState(/** @type {any[]} */ ([]));
    const [platformBusy, setPlatformBusy] = useState(false);
    const [platformError, setPlatformError] = useState(/** @type {string | null} */ (null));
    const [platformReload, setPlatformReload] = useState(0);
    const platformCacheRef = useRef(/** @type {Map<string, any>} */ (new Map()));

    const localKeySet = useMemo(() => {
        const s = new Set();
        for (const r of allRows) s.add(`${r.chainId}:${r.tick}`);
        return s;
    }, [allRows]);

    // The chains a platform search reads, joined so the effect below reruns
    // only when the set changes: Receive searches every chain the wallet has
    // an address on; an explicit list with searchPlatform searches its
    // chainIdFilter, or the chains its own rows sit on.
    const platformChainKey = useMemo(() => {
        if (isReceive) return addressesByChain ? Object.keys(addressesByChain).join('|') : null;
        if (!explicitSearch) return null;
        if (chainIdFilter) return chainIdFilter;
        const chains = new Set((Array.isArray(explicitRows) ? explicitRows : [])
            .map((entry) => entry?.chainId)
            .filter((chainId) => typeof chainId === 'string' && chainId));
        return chains.size ? [...chains].join('|') : null;
    }, [isReceive, addressesByChain, explicitSearch, chainIdFilter, explicitRows]);

    useEffect(() => {
        const query = tokenQuery.trim().toUpperCase();
        // A form that accepts any token searches from the first letter, since
        // a ticker may be one character long and otherwise could not be found.
        if (!platformChainKey
            || !query
            || query.length < (explicitSearch ? 1 : PLATFORM_QUERY_MIN_CHARS)
            || kindFilter === 'coins'
            || typeof messaging?.searchTokens !== 'function'
        ) {
            setPlatformResults([]);
            setPlatformBusy(false);
            setPlatformError(null);
            return undefined;
        }
        let cancelled = false;
        setPlatformResults([]);
        setPlatformBusy(true);
        setPlatformError(null);
        const handle = setTimeout(async () => {
            const chainIds = platformChainKey.split('|').filter((chainId) => (
                (!chainIdFilter || chainId === chainIdFilter)
                && (networkFilter === 'all' || coinFromChainId(chainId) === networkFilter)
            ));
            const cache = platformCacheRef.current;
            try {
                const lookups = await Promise.all(chainIds.map(async (chainId) => {
                    const cacheKey = `${chainId}::${query}`;
                    if (cache.has(cacheKey)) return { chainId, hits: cache.get(cacheKey) };
                    try {
                        const hits = await messaging.searchTokens({ chainId, query, limit: 50 });
                        const normalized = Array.isArray(hits) ? hits : [];
                        cache.set(cacheKey, normalized);
                        return { chainId, hits: normalized, failed: false };
                    } catch {
                        return { chainId, hits: [], failed: true };
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
                if (lookups.some(({ failed }) => failed)) {
                    setPlatformError('Could not search all platform tokens. Try again.');
                }
            } finally {
                if (!cancelled) setPlatformBusy(false);
            }
        }, PLATFORM_QUERY_DEBOUNCE_MS);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [platformChainKey, explicitSearch, tokenQuery, kindFilter, networkFilter, chainIdFilter, messaging, localKeySet, platformReload]);

    const resetFilters = () => {
        setTokenQuery('');
        setNetworkFilter('all');
        if (!kindLocked) setKindFilter('all');
    };
    const filtersActive = Boolean(tokenQuery.trim())
        || networkFilter !== 'all'
        || (!kindLocked && kindFilter !== 'all');

    const visibleOptionRows = rows.filter((row) => !hiddenSet.has(`${row.chainId}:${row.tick}`));
    const hiddenOptionRows = rows.filter((row) => hiddenSet.has(`${row.chainId}:${row.tick}`));
    const sortedOptionRows = pinnedSet.size > 0
        ? [
            ...visibleOptionRows.filter((row) => pinnedSet.has(`${row.chainId}:${row.tick}`)),
            ...visibleOptionRows.filter((row) => !pinnedSet.has(`${row.chainId}:${row.tick}`)),
        ]
        : visibleOptionRows;
    const optionRows = [
        ...sortedOptionRows,
        ...hiddenOptionRows,
        ...platformResults,
    ];
    const renderedRows = useMemo(() => withoutRenderedChainLabels(rows), [rows]);
    const renderedPlatformResults = useMemo(
        () => withoutRenderedChainLabels(platformResults),
        [platformResults],
    );
    const optionKeys = optionRows.map((row) => `${row.chainId}:${row.tick}`);
    const firstOption = optionRows[0] || null;
    const optionTabStop = rovingOption && optionKeys.includes(rovingOption)
        ? rovingOption
        : optionKeys[0];

    const handlePickerKeyDown = (e) => {
        if (e.key === 'Escape' && typeof onBack === 'function') {
            e.preventDefault();
            onBack();
            return;
        }
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const current = e.target.closest?.('[data-balance-option]');
        if (!current) return;
        const options = Array.from(e.currentTarget.querySelectorAll('[data-balance-option]'));
        const index = options.indexOf(current);
        let next = null;
        if (e.key === 'ArrowDown') next = (index + 1) % options.length;
        if (e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = options.length - 1;
        if (next === null || next === index) return;
        e.preventDefault();
        setRovingOption(options[next].dataset.balanceOption);
        options[next].focus();
    };

    const handlePickerFocus = (e) => {
        const option = e.target.closest?.('[data-balance-option]');
        if (option) setRovingOption(option.dataset.balanceOption);
    };

    const handleSelect = (tok) => onSelect?.({
        chainId: tok.chainId,
        tick: tok.tick,
        kind: tok.kind,
        displayName: tok.displayName,
        imageUrl: tok.imageUrl,
    });
    const resultsRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const handleSearchKeyDown = (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
        const results = Array.from(resultsRef.current?.querySelectorAll('button[aria-label^="Select "]') || []);
        const result = event.key === 'ArrowUp' ? results.at(-1) : results[0];
        if (!result) return;
        event.preventDefault();
        if (event.key === 'Enter') result.click();
        else result.focus();
    };

    // An explicit list is always tokens, so its own title says Token.
    const headerTitle = title ?? (explicit ? 'Select Token' : (isReceive ? 'Receive' : 'Send'));
    const headerBackLabel = backLabel ?? 'Back to home';
    // Balances still arriving from chains that have not answered or gone slow.
    const waitingOnChains = pendingChainCount > 0 && allRows.length === 0 && slowChainIds.length < pendingChainCount;
    // Explicit rows list once the caller has them and, where a row shows the
    // wallet's own balance, once every answering chain has replied.
    const listReady = explicit
        ? Array.isArray(explicitRows) && (
            !needsWalletBalances
            || Boolean(loadError)
            || (balances !== null && pendingChainCount <= slowChainIds.length))
        : Boolean(balances) && !waitingOnChains;
    const showSkeleton = explicit
        ? !listReady
        : (balances === null || waitingOnChains) && !loadError;

    useEffect(() => {
        if (!listReady || typeof onFirstOption !== 'function' || !firstOption) return;
        handleFirstOption(onFirstOption, firstOption);
    }, [listReady, onFirstOption, firstOption]);

    const filterMenu = (
        <ListFilterMenu
            query={tokenQuery}
            onQueryChange={setTokenQuery}
            active={!kindLocked && Boolean(kindFilter) && kindFilter !== 'all'}
            label="Filter coins and tokens"
            searchPlaceholder="Search coins or tokens..."
            searchLabel="Search coins or tokens"
            // Home's network picker, from the shared filter.
            chainRegistry={chainRegistry}
            coinFamilies={coinFamilies}
            networkFilter={networkFilter}
            onNetworkFilterChange={setNetworkFilter}
            // Enter picks the top row and the arrows move into the list (xchain-wallet#57).
            onSearchKeyDown={handleSearchKeyDown}
            resultsId={(explicit ? listReady : balances !== null) ? 'xc-token-picker-results' : undefined}
        >
            {/* A pinned kindFilter is a protocol constraint, so no kind choice is offered. */}
            {kindLocked ? null : (
                <IconSelect
                    size="md"
                    aria-label="Asset kind"
                    value={kindFilter || 'all'}
                    onChange={(value) => setKindFilter(value)}
                    options={[
                        { value: 'all', label: 'Coins and tokens', icon: <Icon.TokenListIcon /> },
                        { value: 'coins', label: 'Coins', icon: <Icon.CoinsIcon /> },
                        { value: 'tokens', label: 'Tokens', icon: <Icon.TokenIcon /> },
                    ]}
                />
            )}
        </ListFilterMenu>
    );
    const header = (
        <PageHeader
            nested
            onBack={onBack}
            backLabel={headerBackLabel}
            title={headerTitle}
            // The standard filter on the title line holds the search,
            // the network and the coin or token choice; the list fills the page.
            trailing={filterMenu}
        />
    );

    // D-152. A token-ledger read that failed degrades to an EMPTY token list
    // (flows/balances.js `fetchAddressShape`), which is indistinguishable from
    // holding nothing - so "Nothing matches X" was being printed with equal
    // confidence over a token the address was holding. Where the read is known
    // to be incomplete, say so instead of asserting an absence.
    const partialRead = useMemo(() => {
        if (!balances || typeof balances !== 'object') return false;
        for (const entries of Object.values(balances)) {
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
                if (entry?.error) return true;
                if (Array.isArray(entry?.balances?.unavailable)
                    && entry.balances.unavailable.includes('tokens')) return true;
            }
        }
        return false;
    }, [balances]);

    // The caller's list itself is empty, so no filter could bring a row back:
    // say the caller's words and offer no reset.
    const explicitEmpty = explicit && allRows.length === 0;
    const emptyTitle = explicitEmpty
        ? (explicitEmptyTitle || 'No tokens to choose')
        : partialRead
        ? 'Incomplete balance data'
        : tokenQueryTrim
            ? 'No matching balances'
            : (networkFilter === 'all'
                ? (isReceive ? 'No balances to receive against yet' : 'Nothing to send yet')
                : 'No balances on this network');
    const emptyBody = explicitEmpty
        ? (explicitEmptyBody || 'Tokens this form can use appear here.')
        : partialRead
        ? 'Some token balances could not be read, so this list may be incomplete.'
        : tokenQueryTrim
        ? `No balances match "${tokenQuery.trim()}".`
        : (networkFilter === 'all'
            ? (isReceive
                ? 'Choose a network to display a fresh receive address for it.'
                : 'Sendable coin and token balances appear here after funds are received.')
            : 'Balances on this network appear here after this wallet receives funds.');

    const body = (
        // No toolbar above the list; its controls live in the filter.
        <ListPageComponent toolbar={null} onKeyDown={handlePickerKeyDown} onFocus={handlePickerFocus}>
            {loadError ? (
                <Notice
                    tone="danger"
                    action={{ label: 'Try Again', onAction: () => setBalanceReload((value) => value + 1) }}
                >
                    {loadError}
                </Notice>
            ) : null}
            {slowChainIds.map((chainId) => (
                <Notice key={chainId} variant="warning">
                    {`${chainRegistry.get(chainId)?.displayName || chainId} is not responding. Its assets appear when it answers.`}
                </Notice>
            ))}
            {showSkeleton ? (
                <div role="status" aria-label="Loading balances">
                    <Skeleton.List rows={5} />
                </div>
            ) : null}
            {listReady ? (
                <div id="xc-token-picker-results" ref={resultsRef} role="group" aria-label="Coins and tokens">
                    {rows.length > 0 ? (
                        <BalanceList
                            rows={renderedRows}
                            onSelectToken={handleSelect}
                            getRowActionLabel={tokenSelectionLabel}
                            hiddenKeys={hiddenSet}
                            pinnedKeys={pinnedSet}
                            // A plain list to pick from; pinning stays on Home.
                            onTogglePin={undefined}
                            // An explicit list is the eligible set; none of it folds away as dust.
                            hideSmallBalances={!explicit && settings?.privacy?.hideSmallBalances === true}
                            smallBalanceFiat={resolveSmallBalanceFiat(settings)}
                            allowRemoteImages={allowRemoteImages}
                            selectedKey={selectedKey}
                            splitRows={splitRows}
                            getRowTabIndex={(row) => (
                                `${row.chainId}:${row.tick}` === optionTabStop ? 0 : -1
                            )}
                        />
                    ) : loadError ? (
                        // A failed read with nothing listed is already said by the
                        // error notice above, with its own Try again.
                        null
                    ) : (!explicit && platformResults.length === 0 && !platformBusy && !platformError && balancesUnchecked && !tokenQueryTrim) ? (
                        // An empty list while balances could not be checked is
                        // not proof of an empty wallet: say that once instead.
                        <BalancesUncheckedState
                            plain={false}
                            onRetry={() => {
                                recheckBalances();
                                setBalanceReload((value) => value + 1);
                            }}
                        />
                    ) : (platformResults.length === 0 && !platformBusy && !platformError) ? (
                        <EmptyState
                            title={emptyTitle}
                            body={emptyBody}
                            actionLabel={filtersActive && !explicitEmpty ? 'Reset Filters' : undefined}
                            actionIcon={<Icon.RefreshIcon />}
                            onAction={filtersActive && !explicitEmpty ? resetFilters : undefined}
                        />
                    ) : null}
                    {(platformResults.length > 0 || platformBusy || platformError) ? (
                        <div className={styles.platformSection}>
                            <SectionHeader title="On the platform" />
                            {platformBusy && platformResults.length === 0 ? (
                                <div role="status" aria-label="Searching platform">
                                    <Skeleton.List rows={1} />
                                </div>
                            ) : null}
                            {platformError ? (
                                <Notice
                                    tone="danger"
                                    action={{ label: 'Try Again', onAction: () => setPlatformReload((value) => value + 1) }}
                                >
                                    {platformError}
                                </Notice>
                            ) : null}
                            {platformResults.length > 0 ? (
                                <BalanceList
                                    rows={renderedPlatformResults}
                                    onSelectToken={handleSelect}
                                    getRowActionLabel={tokenSelectionLabel}
                                    allowRemoteImages={allowRemoteImages}
                                    selectedKey={selectedKey}
                                    splitRows={splitRows}
                                    getRowTabIndex={(row) => (
                                        `${row.chainId}:${row.tick}` === optionTabStop ? 0 : -1
                                    )}
                                />
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </ListPageComponent>
    );

    if (embedded) {
        return (
            <>
                {filterHost ? createPortal(filterMenu, filterHost) : null}
                {body}
            </>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            {body}
        </Screen>
    );
}

function handleFirstOption(onFirstOption, row) {
    onFirstOption({
        chainId: row.chainId,
        tick: row.tick,
        kind: row.kind,
        displayName: row.displayName,
        imageUrl: row.imageUrl,
    });
}
