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
import { Screen,
    ScreenHeader, Button, Icon, Skeleton } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import {
    isEntryReplaceable,
    replaceFromHistoryEntry,
    RbfNotSupportedError,
    RbfInvalidEntryError,
} from '../../flows/rbfReplace.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { EmptyStateNudge } from '../components/EmptyStateNudge.jsx';
import { useToast } from '../components/ToastHost.jsx';
import { groupHistoryEntries } from '../utils/historyGrouping.js';
import { TxStatusTimeline } from '../components/TxStatusTimeline.jsx';
import { StalenessLabel } from '../components/StalenessLabel.jsx';
import { flows as flowsLib } from '@xchain-wallet/core';
import {
    applyHistoryFilters,
    classifyEntryStatus,
    ACTION_TYPE_OPTIONS,
    STATUS_OPTIONS,
} from '../utils/historyFilter.js';
import { readChainSet, writeChainSet } from '../utils/chainFilterMemory.js';
import styles from './History.module.css';

const HISTORY_CHAIN_FILTER_KEY = 'history';
const GROUPING_MODE_STORAGE_KEY = 'xc:historyGroupingMode';

function readPersistedGroupingMode() {
    try {
        const v = globalThis.localStorage?.getItem(GROUPING_MODE_STORAGE_KEY);
        return v === 'flat' ? 'flat' : 'grouped';
    } catch {
        return 'grouped';
    }
}

function writePersistedGroupingMode(mode) {
    try {
        globalThis.localStorage?.setItem(GROUPING_MODE_STORAGE_KEY, mode);
    } catch { /* best-effort */ }
}

const chainRegistry = registryLib.defaultRegistry();

// LINK action coin field is a ticker (e.g. "BTC", "DOGE", "LTC"). The
// chain registry's descriptor.coin is the lowercase coin name. This
// map covers every coin descriptor bundled in this wallet today;
// unknown tickers degrade to "render the raw coin code without
// chainId resolution," which keeps the row visible without crashing
// when the platform adds a coin before the wallet does.
const COIN_TICKER_TO_NAME = {
    BTC: 'bitcoin',
    DOGE: 'dogecoin',
    LTC: 'litecoin',
};

/**
 * History route: §23 unified timeline + §23.5 cross-chain thread
 * rendering.
 *
 * Read-only view that aggregates `getHistory(addr, 'address')` across
 * the wallet's addresses on every chain the wallet uses. Per row:
 *   - action label / amount / source / block / timestamp
 *   - 🔗 badge if the row is one side of a LINK pairing
 *   - vertical connector between two rows when both sides of a pair
 *     are visible in the current filtered view
 *
 * Click a row → opens an inline detail card. For LINK-threaded rows
 * the card renders side-by-side with the peer ACTION fetched via
 * `messaging.getActionByIndex`, matching the §23.5 dual-side layout.
 *
 * Filters:
 *   - Chain chips (toggle each chainId on/off)
 *   - "Cross-chain only": keep only entries that are part of a LINK
 *     pairing (regardless of whether both peers are in the result set)
 *
 * Wallet addresses are resolved up-front via
 * `messaging.getAddressesByChain(walletId)`. Per (chain, address) we
 * fan out two parallel reads (`getAddressHistory` + `getLinksForAddress`)
 * and merge into a flat `entries` list with `linkIdx` pointing at
 * matching entries when both sides happen to be in the wallet's
 * history (typical case: cross-chain LINK between two addresses owned
 * by the same wallet).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]   active BIP44 account; when set, history is scoped to that account's addresses
 * @param {() => void} props.onBack
 * @param {() => void} [props.onReceive]   surfaces a Receive CTA in the empty-state nudges (G077)
 * @param {string} [props.initialSearchQuery]   pre-populates the search box on mount; lets TokenDetail open History scoped to one tick (G071)
 * @param {{ chainId?: string, actionIndex?: string, txHash?: string } | null} [props.initialFocus]
 *        when set, the matching entry is auto-selected and scrolled into
 *        view as soon as it loads. §24.6 / Cluster Y FOLLOWUP 4; used
 *        by the desktop detach-pending-tx path.
 */
export function History({ walletId, accountId, onBack, onReceive, onSelectEntry, initialSearchQuery = '', initialChainCoin = '', initialFocus = null }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const { showToast } = useToast();

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [entries, setEntries] = useState(/** @type {HistoryEntry[]} */ ([]));
    // Cluster G FOLLOWUP 5: Unix ms of the last successful per-chain
    // history+links fan-out completion. Surfaces as a "Last synced …"
    // hint in the filter bar so the user can spot stale views.
    const [historyFetchedAt, setHistoryFetchedAt] = useState(
        /** @type {number | null} */ (null),
    );
    const [loadingChains, setLoadingChains] = useState(/** @type {Set<string>} */ (new Set()));
    const [enabledChains, setEnabledChains] = useState(/** @type {Set<string>} */ (new Set()));
    const [crossChainOnly, setCrossChainOnly] = useState(false);
    const [multisigOnly, setMultisigOnly] = useState(false);
    const [multisigAddress, setMultisigAddress] = useState(/** @type {string | null} */ (null));
    const [groupingMode, setGroupingModeState] = useState(/** @type {'grouped' | 'flat'} */ (readPersistedGroupingMode));
    const setGroupingMode = (mode) => {
        setGroupingModeState(mode);
        writePersistedGroupingMode(mode);
    };
    const [expandedGroups, setExpandedGroups] = useState(/** @type {Set<string>} */ (new Set()));
    const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
    const [actionTypeFilter, setActionTypeFilter] = useState(/** @type {Set<string>} */ (new Set()));
    const [statusFilter, setStatusFilter] = useState(/** @type {Set<string>} */ (new Set()));
    // Default to the last 30 days so a fresh History view surfaces
    // recent activity without the user having to pick a range. ISO
    // YYYY-MM-DD format matches what <input type="date"> expects.
    const [dateFrom, setDateFrom] = useState(() => isoDateDaysAgo(30));
    const [dateTo, setDateTo] = useState(() => isoDateDaysAgo(0));
    const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
    // Cluster I FOLLOWUP 5: single-modal export. Holds the modal's
    // open state + the field choices (format / column set / date-range
    // override). Initial column set = every field; date range defaults
    // to the active filter when the modal opens.
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState(/** @type {'csv' | 'json'} */ ('csv'));
    const [exportColumns, setExportColumns] = useState(
        /** @type {Set<string>} */ (new Set(flowsLib.EXPORT_COLUMNS)),
    );
    const [exportFromDate, setExportFromDate] = useState('');
    const [exportToDate, setExportToDate] = useState('');
    const [exportScope, setExportScope] = useState(/** @type {'filtered' | 'all'} */ ('filtered'));
    const [selectedKey, setSelectedKey] = useState(/** @type {string | null} */ (null));
    const [peerCache, setPeerCache] = useState(
        /** @type {Record<string, { loading: boolean, action: any | null, error: string | null }>} */ ({}),
    );
    // §24.6 / Cluster Y FOLLOWUP 4; once a detached-window's initial
    // route resolves, ref-flag this so we don't re-select on every
    // re-render or after the user manually navigates away from the row.
    const initialFocusFiredRef = useRef(false);

    // Step 1: resolve the wallet's addresses grouped by chainId.
    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId, accountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const all = new Set(
                    Object.entries(byChain || {})
                        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                        .map(([cid]) => cid),
                );
                // When the caller asked us to scope to a specific coin
                // family (e.g. arrived from the Bitcoin TokenDetail's
                // History button), narrow enabledChains to only those
                // chains. One-shot override: we deliberately skip the
                // remembered-set restore and don't persist this scope,
                // so revisiting History via the menu reverts to the
                // user's last manually-chosen filter.
                if (initialChainCoin) {
                    const scoped = new Set(
                        [...all].filter((cid) => chainRegistry.get(cid)?.coin === initialChainCoin),
                    );
                    setEnabledChains(scoped.size > 0 ? scoped : all);
                    return;
                }
                // §23.5 / G052: restore the user's last chain-filter
                // choice if one is stored, intersected with the wallet's
                // currently-active chains so a removed chain doesn't
                // leave a stale entry. Falls back to "all enabled".
                const remembered = readChainSet(HISTORY_CHAIN_FILTER_KEY, all);
                setEnabledChains(remembered ?? all);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, initialChainCoin]);

    // §22 Multisig-only filter (Step 22). Resolve the wallet's
    // multisig receive address up-front so the chip can filter
    // entries by exact match without re-running deriveMultisigAddress
    // on every render. Best-effort: silently leaves the chip
    // disabled when no multisig is configured or when the BTC chain
    // isn't in the registry.
    useEffect(() => {
        let cancelled = false;
        const btcChain = chainRegistry.byCoin('bitcoin')[0]?.id;
        if (!btcChain) return undefined;
        messaging.getMultisigReceiveAddress({ walletId, chainId: btcChain })
            .then((r) => {
                if (cancelled) return;
                if (r && typeof r.address === 'string') setMultisigAddress(r.address);
            })
            .catch(() => { /* no multisig configured; chip stays disabled */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Step 2: fan out history + links per (chain, address). Merge
    // results into a single sorted list.
    useEffect(() => {
        if (!addressesByChain) return;
        const chainsToLoad = Object.entries(addressesByChain)
            .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
            .map(([cid]) => cid);
        if (chainsToLoad.length === 0) {
            setEntries([]);
            setHistoryFetchedAt(null);
            return;
        }
        let cancelled = false;
        setLoadingChains(new Set(chainsToLoad));

        // Cluster J FOLLOWUP 1: for the demo wallet, replace the SDK
        // fetch with synthesized fixture data so the History view
        // isn't an empty wasteland during the demo. Real history rows
        // arrive once the user exits demo mode + funds the wallet.
        const isDemo = flowsLib.isDemoWallet(walletId);

        const tasks = [];
        for (const cid of chainsToLoad) {
            for (const a of addressesByChain[cid]) {
                if (isDemo) {
                    tasks.push(Promise.resolve({
                        chainId: cid,
                        address: a.address,
                        history: flowsLib.synthesizeDemoHistory(cid, a.address),
                        links: flowsLib.synthesizeDemoLinks(),
                    }));
                    continue;
                }
                tasks.push(
                    Promise.all([
                        messaging.getAddressHistory({ chainId: cid, address: a.address })
                            .then((r) => extractRows(r))
                            .catch(() => []),
                        messaging.getLinksForAddress({ chainId: cid, address: a.address })
                            .then((r) => extractRows(r))
                            .catch(() => []),
                    ]).then(([history, links]) => {
                        // TEMP visual-design preview; fall back to
                        // the demo-mode synthesizer when a real wallet
                        // has zero history for this address, so the
                        // populated UI can be evaluated. Remove once
                        // the empty state has been reviewed.
                        if (history.length === 0) {
                            return {
                                chainId: cid,
                                address: a.address,
                                history: flowsLib.synthesizeDemoHistory(cid, a.address),
                                links: flowsLib.synthesizeDemoLinks(),
                            };
                        }
                        return { chainId: cid, address: a.address, history, links };
                    }),
                );
            }
        }

        Promise.all(tasks).then((perAddrResults) => {
            if (cancelled) return;
            // Build a (chainId, action_index) -> link record map so
            // history rows can identify their peer cheaply.
            /** @type {Map<string, { peerChainId: string | null, peerCoinTicker: string, peerActionIndex: string, linkActionIndex: string }>} */
            const linkMap = new Map();
            for (const r of perAddrResults) {
                for (const link of r.links) {
                    const sides = sidesFromLink(link, r.chainId);
                    if (!sides) continue;
                    linkMap.set(keyFor(sides.local.chainId, sides.local.actionIndex), {
                        peerChainId: sides.peer.chainId,
                        peerCoinTicker: sides.peer.coinTicker,
                        peerActionIndex: String(sides.peer.actionIndex),
                        linkActionIndex: String(link.action_index ?? link.actionIndex ?? ''),
                    });
                }
            }

            /** @type {HistoryEntry[]} */
            const all = [];
            for (const r of perAddrResults) {
                for (const row of r.history) {
                    const aIdx = String(row.action_index ?? row.actionIndex ?? '');
                    if (!aIdx) continue;
                    const k = keyFor(r.chainId, aIdx);
                    const link = linkMap.get(k) || null;
                    all.push({
                        key: `${k}:${r.address}`,
                        chainId: r.chainId,
                        address: r.address,
                        actionIndex: aIdx,
                        action: String(row.action || row.ACTION || 'ACTION'),
                        blockIndex: Number(row.block_index ?? row.blockIndex ?? 0),
                        timestamp: Number(row.timestamp ?? row.block_time ?? 0),
                        txHash: String(row.tx_hash ?? row.txHash ?? ''),
                        source: String(row.source ?? row.SOURCE ?? ''),
                        raw: row,
                        link,
                    });
                }
            }
            all.sort((a, b) => {
                if (b.blockIndex !== a.blockIndex) return b.blockIndex - a.blockIndex;
                return Number(b.actionIndex) - Number(a.actionIndex);
            });
            setEntries(all);
            setLoadingChains(new Set());
            setHistoryFetchedAt(Date.now());
        });

        return () => { cancelled = true; };
    }, [addressesByChain, messaging]);

    // Lowercase set of every wallet address across every chain. Used by
    // the action-type filter to discriminate Send (wallet is source)
    // from Receive (wallet is destination).
    const walletAddressSet = useMemo(() => {
        const s = new Set();
        for (const cid of Object.keys(addressesByChain || {})) {
            for (const a of (addressesByChain[cid] || [])) {
                if (a && a.address) s.add(String(a.address).toLowerCase());
            }
        }
        return s;
    }, [addressesByChain]);

    // Cluster I FOLLOWUP 6: Per-chain tip used to compute confirmation
    // counts on confirmed rows. Derived from the highest blockIndex
    // seen across loaded history rows (lower bound for the chain tip,
    // since the wallet has no dedicated tip endpoint yet; explorer's
    // /network is still a placeholder, see FOLLOWUPS.md). A user with
    // any confirmed activity sees a meaningful count; a user with one
    // freshly-confirmed row gets "1 confirmation" (the tip is at the
    // row itself, which is correct).
    const chainTipByChainId = useMemo(() => {
        /** @type {Record<string, number>} */
        const tips = {};
        for (const e of entries) {
            if (!e || !e.chainId) continue;
            const b = Number(e.blockIndex || 0);
            if (b <= 0) continue;
            if (!(e.chainId in tips) || b > tips[e.chainId]) tips[e.chainId] = b;
        }
        return tips;
    }, [entries]);

    const visibleEntries = useMemo(() => {
        let list = entries.filter((e) => enabledChains.has(e.chainId));
        if (crossChainOnly) list = list.filter((e) => Boolean(e.link));
        if (multisigOnly && multisigAddress) {
            const lower = multisigAddress.toLowerCase();
            list = list.filter((e) => {
                const a = (e.address || e.source || e.dest || '').toLowerCase();
                return a === lower;
            });
        }
        return applyHistoryFilters(list, {
            searchQuery,
            actionTypes: actionTypeFilter,
            statusSet: statusFilter,
            dateFromMs: dateFrom ? Date.parse(dateFrom) : null,
            // dateTo is interpreted as end-of-day so a "to: 2026-04-27"
            // pick includes everything that happened that day.
            dateToMs: dateTo ? Date.parse(dateTo) + 24 * 60 * 60 * 1000 - 1 : null,
            walletAddresses: walletAddressSet,
        });
    }, [
        entries, enabledChains, crossChainOnly, multisigOnly, multisigAddress,
        searchQuery, actionTypeFilter, statusFilter, dateFrom, dateTo,
        walletAddressSet,
    ]);

    const filtersActive = (
        searchQuery
        || actionTypeFilter.size > 0
        || statusFilter.size > 0
        || dateFrom
        || dateTo
    );

    const toggleSetMember = (setter) => (id) => {
        setter((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const clearAllFilters = () => {
        // Snapshot the active filter set so the §37.2 Undo toast can
        // restore exactly what the user had before pressing Clear.
        const snapshot = {
            searchQuery,
            actionTypeFilter: new Set(actionTypeFilter),
            statusFilter: new Set(statusFilter),
            dateFrom,
            dateTo,
        };
        const hadAny = Boolean(filtersActive);
        setSearchQuery('');
        setActionTypeFilter(new Set());
        setStatusFilter(new Set());
        setDateFrom('');
        setDateTo('');
        if (hadAny) {
            showToast({
                message: 'Filter cleared',
                actionLabel: 'Undo',
                onAction: () => {
                    setSearchQuery(snapshot.searchQuery);
                    setActionTypeFilter(snapshot.actionTypeFilter);
                    setStatusFilter(snapshot.statusFilter);
                    setDateFrom(snapshot.dateFrom);
                    setDateTo(snapshot.dateTo);
                },
            });
        }
    };

    // For drawing the vertical connector: an entry is "threaded with
    // the entry above it" iff both sides are linked AND the row above
    // is its peer (same linkActionIndex). We render the connector on
    // the lower row in the visible list (DESC order: lower = older).
    const connectorByKey = useMemo(() => {
        /** @type {Set<string>} */
        const set = new Set();
        for (let i = 1; i < visibleEntries.length; i += 1) {
            const cur = visibleEntries[i];
            const prev = visibleEntries[i - 1];
            if (!cur.link || !prev.link) continue;
            if (
                cur.link.linkActionIndex
                && cur.link.linkActionIndex === prev.link.linkActionIndex
            ) {
                set.add(cur.key);
            }
        }
        return set;
    }, [visibleEntries]);

    // §28.2 activity-feed grouping. Computed AFTER all filters so a
    // group only collapses when both leader and members survive the
    // current filter set; otherwise members render as ungrouped rows.
    const groupedItems = useMemo(
        () => groupHistoryEntries(visibleEntries, groupingMode),
        [visibleEntries, groupingMode],
    );

    // §24.6 / Cluster Y FOLLOWUP 4: auto-select the entry matching
    // `initialFocus` once entries have loaded, then scroll it into
    // view. Fires at most once per History mount so a user who
    // explicitly de-selects the row doesn't get the row re-selected
    // on every re-render.
    useEffect(() => {
        if (initialFocusFiredRef.current) return;
        if (!initialFocus) return;
        if (entries.length === 0) return;
        const match = entries.find((e) => {
            if (initialFocus.chainId && e.chainId !== initialFocus.chainId) return false;
            if (initialFocus.actionIndex && String(e.actionIndex) !== String(initialFocus.actionIndex)) return false;
            if (initialFocus.txHash && e.txHash !== initialFocus.txHash) return false;
            return true;
        });
        if (!match) return;
        initialFocusFiredRef.current = true;
        setSelectedKey(match.key);
        // Defer scrollIntoView until after the row's <li> has rendered;
        // looking up the DOM node by `data-history-key` keeps the
        // selector decoupled from React's internals.
        if (typeof window !== 'undefined') {
            setTimeout(() => {
                const node = document.querySelector(
                    `[data-history-key="${cssEscape(match.key)}"]`,
                );
                if (node && typeof node.scrollIntoView === 'function') {
                    node.scrollIntoView({ block: 'center', behavior: 'auto' });
                }
            }, 0);
        }
    }, [entries, initialFocus]);

    const toggleGroupExpanded = (groupKey) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupKey)) next.delete(groupKey);
            else next.add(groupKey);
            return next;
        });
    };

    const toggleChain = (cid) => {
        // §23.5 / G052: persist the new filter set so the user's
        // choice survives navigation. Capture the post-toggle Set
        // inside the updater so the write reflects the new state
        // even if React batches multiple toggles.
        setEnabledChains((prev) => {
            const next = new Set(prev);
            if (next.has(cid)) next.delete(cid);
            else next.add(cid);
            writeChainSet(HISTORY_CHAIN_FILTER_KEY, next);
            return next;
        });
    };

    const onRowClick = (entry) => {
        // When the parent shell wired the navigation callback, send the
        // selected entry up so it can route to the standalone ActionDetail
        // page. Falls back to the legacy inline expand for builds /
        // contexts where no handler is provided.
        if (typeof onSelectEntry === 'function') {
            onSelectEntry(entry);
            return;
        }
        setSelectedKey((cur) => (cur === entry.key ? null : entry.key));
        if (entry.link?.peerChainId && entry.link.peerActionIndex) {
            const pKey = peerCacheKey(entry.link.peerChainId, entry.link.peerActionIndex);
            if (!peerCache[pKey]) {
                setPeerCache((prev) => ({
                    ...prev,
                    [pKey]: { loading: true, action: null, error: null },
                }));
                messaging.getActionByIndex({
                    chainId: entry.link.peerChainId,
                    actionIndex: entry.link.peerActionIndex,
                })
                    .then((action) => {
                        setPeerCache((prev) => ({
                            ...prev,
                            [pKey]: { loading: false, action, error: null },
                        }));
                    })
                    .catch((err) => {
                        setPeerCache((prev) => ({
                            ...prev,
                            [pKey]: {
                                loading: false,
                                action: null,
                                error: err?.message || String(err),
                            },
                        }));
                    });
            }
        }
    };

        const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back to home"
            title="History"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div className={styles.body}>{children}</div>
            <div className={styles.actions}>
            </div>
        </Screen>
    );

    if (loadError) {
        return wrap(<p role="alert" className={styles.error}>{loadError}</p>);
    }
    if (!addressesByChain) {
        return wrap(
            <div role="status" aria-label="Loading history">
                <Skeleton.List rows={5} />
            </div>,
        );
    }
    const activeChainIds = Object.entries(addressesByChain)
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);
    if (activeChainIds.length === 0) {
        return wrap(
            <EmptyStateNudge
                title="No addresses yet"
                body="Generate a receive address to populate history."
                actionLabel={onReceive ? 'Receive' : undefined}
                onAction={onReceive}
                icon={onReceive ? <Icon.ReceiveIcon /> : undefined}
            />,
        );
    }

    return wrap(
        <>
            {/* Unified filter card: search, chain picker, and the
                collapsible Filters section all in one container. */}
            <div className={styles.filterCard} role="group" aria-label="History filters">
                <input
                    type="search"
                    className={styles.searchInput}
                    placeholder="Search action, address, token, txid, memo…"
                    aria-label="Search history"
                    value={searchQuery}
                    onChange={(ev) => setSearchQuery(ev.target.value)}
                />

                <div className={styles.dateRow}>
                    <input
                        type="date"
                        aria-label="From date"
                        value={dateFrom}
                        onChange={(ev) => setDateFrom(ev.target.value)}
                        className={styles.dateInput}
                    />
                    <span className={styles.dateSep}>→</span>
                    <input
                        type="date"
                        aria-label="To date"
                        value={dateTo}
                        onChange={(ev) => setDateTo(ev.target.value)}
                        className={styles.dateInput}
                    />
                </div>

                <div className={styles.filterFooter}>
                    <button
                        type="button"
                        className={`${styles.filterDisclosure} ${moreFiltersOpen ? styles.filterDisclosureActive : ''}`}
                        onClick={() => setMoreFiltersOpen((v) => !v)}
                        aria-expanded={moreFiltersOpen}
                        aria-controls="history-more-filters"
                    >
                        <span>Additional details</span>
                        {moreFiltersOpen
                            ? <DoubleChevron direction="up" />
                            : <DoubleChevron direction="down" />}
                    </button>
                    <div className={styles.segGroup} role="radiogroup" aria-label="Grouping mode">
                        <button
                            type="button"
                            role="radio"
                            aria-checked={groupingMode === 'grouped'}
                            onClick={() => setGroupingMode('grouped')}
                            className={`${styles.segBtn} ${groupingMode === 'grouped' ? styles.segBtnActive : ''}`}
                        >Grouped</button>
                        <button
                            type="button"
                            role="radio"
                            aria-checked={groupingMode === 'flat'}
                            onClick={() => setGroupingMode('flat')}
                            className={`${styles.segBtn} ${groupingMode === 'flat' ? styles.segBtnActive : ''}`}
                        >Flat</button>
                    </div>
                </div>

                {moreFiltersOpen ? (
                    <div
                        id="history-more-filters"
                        className={styles.morePanel}
                        role="group"
                        aria-label="Advanced filters"
                    >
                        <ChainPicker
                            activeChainIds={activeChainIds}
                            chainRegistry={chainRegistry}
                            enabledChains={enabledChains}
                            onChange={(next) => {
                                setEnabledChains(next);
                                writeChainSet(HISTORY_CHAIN_FILTER_KEY, next);
                            }}
                        />

                        <CheckboxPicker
                            options={ACTION_TYPE_OPTIONS}
                            selected={actionTypeFilter}
                            onToggle={toggleSetMember(setActionTypeFilter)}
                            allLabel="All action types"
                            summaryNoun="action type"
                            iconForId={actionTypeIcon}
                            menuHeader="Action types"
                        />

                        <CheckboxPicker
                            options={STATUS_OPTIONS}
                            selected={statusFilter}
                            onToggle={toggleSetMember(setStatusFilter)}
                            allLabel="All statuses"
                            summaryNoun="status"
                            menuHeader="Status"
                        />

                        <CheckboxPicker
                            options={[
                                { id: 'crosschain', label: 'Cross-chain only' },
                            ]}
                            selected={new Set([
                                ...(crossChainOnly ? ['crosschain'] : []),
                            ])}
                            onToggle={(id) => {
                                if (id === 'crosschain') setCrossChainOnly((v) => !v);
                            }}
                            allLabel="No special filters"
                            summaryNoun="filter"
                            iconForId={specialFilterIcon}
                            menuHeader="Special"
                        />

                        {multisigAddress ? (
                            <button
                                type="button"
                                className={`${styles.chip} ${multisigOnly ? styles.chipActive : ''}`}
                                aria-pressed={multisigOnly}
                                onClick={() => setMultisigOnly((v) => !v)}
                            >
                                Multisig only
                            </button>
                        ) : null}

                    </div>
                ) : null}
            </div>

            {exportModalOpen ? (
                <ExportModal
                    onClose={() => setExportModalOpen(false)}
                    format={exportFormat}
                    setFormat={setExportFormat}
                    columns={exportColumns}
                    setColumns={setExportColumns}
                    fromDate={exportFromDate}
                    setFromDate={setExportFromDate}
                    toDate={exportToDate}
                    setToDate={setExportToDate}
                    scope={exportScope}
                    setScope={setExportScope}
                    activeFilterFromDate={dateFrom}
                    activeFilterToDate={dateTo}
                    visibleCount={visibleEntries.length}
                    totalCount={entries.length}
                    onConfirm={() => {
                        const sourceEntries = exportScope === 'all' ? entries : visibleEntries;
                        const ranged = (exportFromDate || exportToDate)
                            ? flowsLib.filterEntriesByDateRange(sourceEntries, {
                                fromTs: exportFromDate ? Math.floor(Date.parse(exportFromDate) / 1000) : null,
                                toTs: exportToDate ? Math.floor((Date.parse(exportToDate) + 24 * 60 * 60 * 1000 - 1) / 1000) : null,
                            })
                            : sourceEntries;
                        runExport({
                            entries: ranged,
                            scope: chainScopeLabel(enabledChains, activeChainIds),
                            format: exportFormat,
                            columns: Array.from(exportColumns),
                        });
                        setExportModalOpen(false);
                    }}
                />
            ) : null}

            {loadingChains.size > 0 ? (
                <div role="status" aria-label="Loading history">
                    <Skeleton.List rows={Math.max(3, loadingChains.size)} />
                </div>
            ) : null}

            {visibleEntries.length === 0 && loadingChains.size === 0 ? (
                filtersActive ? (
                    <EmptyStateNudge
                        title="No matches for the current filters"
                        body="Adjust or clear the filters to see more history."
                        actionLabel="Clear filters"
                        onAction={clearAllFilters}
                    />
                ) : (
                    <EmptyStateNudge
                        title={crossChainOnly
                            ? 'No cross-chain actions yet'
                            : 'No history yet'}
                        body={crossChainOnly
                            ? 'Send a LINK action or receive one to see cross-chain entries here.'
                            : 'Once you send or receive on the selected chains, the activity feed populates.'}
                        actionLabel={!crossChainOnly && onReceive ? 'Receive' : undefined}
                        onAction={!crossChainOnly ? onReceive : undefined}
                        icon={!crossChainOnly && onReceive ? <Icon.ReceiveIcon /> : undefined}
                    />
                )
            ) : null}

            <ul className={styles.timeline}>
                {groupedItems.map((item) => {
                    if (item.kind === 'group') {
                        const expanded = expandedGroups.has(item.key);
                        return (
                            <li key={item.key}>
                                <div className={`${styles.groupCardWrap} ${expanded ? styles.groupCardWrapExpanded : ''}`}>
                                    <GroupCard
                                        item={item}
                                        expanded={expanded}
                                        onToggle={() => toggleGroupExpanded(item.key)}
                                    />
                                    {expanded ? (
                                        <ul className={styles.groupMembers}>
                                            {item.members.map((entry) => (
                                                <EntryRow
                                                    key={entry.key}
                                                    entry={entry}
                                                    selected={selectedKey === entry.key}
                                                    showConnector={
                                                        item.subkind === 'link-pair'
                                                            ? false
                                                            : connectorByKey.has(entry.key)
                                                    }
                                                    onClick={() => onRowClick(entry)}
                                                    peerCache={peerCache}
                                                    isFull={isFull}
                                                    chainTip={chainTipByChainId[entry.chainId]}
                                                    walletId={walletId}
                                                />
                                            ))}
                                        </ul>
                                    ) : null}
                                </div>
                            </li>
                        );
                    }
                    const entry = item.entry;
                    return (
                        <EntryRow
                            key={entry.key}
                            entry={entry}
                            selected={selectedKey === entry.key}
                            showConnector={connectorByKey.has(entry.key)}
                            onClick={() => onRowClick(entry)}
                            peerCache={peerCache}
                            isFull={isFull}
                            chainTip={chainTipByChainId[entry.chainId]}
                            walletId={walletId}
                        />
                    );
                })}
            </ul>
        </>,
    );
}

/**
 * Inline detail card. For LINK-threaded entries we render two
 * `detailSide` blocks side-by-side; for everything else, one block.
 */
export function DetailCard({ entry, peerCache, chainTip, walletId }) {
    const { messaging, shell } = useMessaging();
    const [balancesHidden] = useBalancesHidden();
    const [activeDetailTab, setActiveDetailTab] = useState(/** @type {'status' | 'details' | 'raw'} */ ('status'));

    // ───── More-menu / Save-as-contact state ─────
    // Contacts are fetched once so the "already a contact" check can run
    // synchronously when deciding whether to expose the Save-as-contact
    // option in the More dropdown.
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    const [contactsLoaded, setContactsLoaded] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [contactSaveStage, setContactSaveStage] = useState(
        /** @type {'hidden' | 'editing' | 'saving' | 'saved'} */ ('hidden'),
    );
    const [contactName, setContactName] = useState('');
    const [contactSaveError, setContactSaveError] = useState(/** @type {string | null} */ (null));
    const moreWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));

    // ───── RBF (Speed up / Cancel) state ─────
    // Exposed through the More menu now instead of as a standalone
    // button cluster below the tabs. The status message renders inline
    // between the action row and the tabs so the user sees the result
    // of their tap without scrolling.
    const [rbfBusy, setRbfBusy] = useState(/** @type {'speedup' | 'cancel' | null} */ (null));
    const [rbfError, setRbfError] = useState(/** @type {string | null} */ (null));
    const [rbfDone, setRbfDone] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => {
                if (cancelled) return;
                setContacts(Array.isArray(rows) ? rows : []);
                setContactsLoaded(true);
            })
            .catch(() => { if (!cancelled) setContactsLoaded(true); });
        return () => { cancelled = true; };
    }, [messaging]);

    useEffect(() => {
        if (!moreOpen) return undefined;
        const onClick = (e) => {
            if (moreWrapRef.current?.contains(e.target)) return;
            setMoreOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [moreOpen]);

    const isLinked = Boolean(entry.link);
    const peerKey = entry.link?.peerChainId && entry.link?.peerActionIndex
        ? peerCacheKey(entry.link.peerChainId, entry.link.peerActionIndex)
        : null;
    const peer = peerKey ? peerCache[peerKey] : null;
    const replaceable = isEntryReplaceable(entry);
    // §24.6 / Cluster Y FOLLOWUP 4: desktop-only "Open in new window"
    // affordance for pending (mempool-only) entries. The detached
    // window opens directly on this row via the History `initialFocus`
    // prop and keeps its own auto-lock + last-view memory because the
    // shared MessageHost stays singleton across windows. Surfaces on
    // desktop only; extension popup + web SPA have no equivalent
    // multi-window primitive.
    const isPending = !entry.blockIndex;
    const detachAvailable = shell === 'desktop'
        && isPending
        && typeof globalThis.xchainWalletWindow?.openDetached === 'function';

    const detailRows = basicDetailRows(entry, chainTip);
    const explorerButtons = explorerLinksFor(entry);

    const fullRows = fullDetailRows(entry, balancesHidden);
    // Redact entry + peer raw payloads before stringifying. Cheap walk;
    // returns the same shape so the JSON pretty-printer indents identically.
    const rawForDisplay = balancesHidden ? redactAmountFields(entry.raw) : entry.raw;
    const detailTabs = [
        { id: 'status',  label: 'Status'  },
        { id: 'details', label: 'Details' },
        { id: 'raw',     label: 'Raw'     },
    ];

    // Compute Save-as-contact saveability + assemble the More menu so
    // the rightmost button on the explorer row reads as a single
    // entry-point for follow-up actions instead of being buried below
    // the tab panels.
    const contactPeer = peerAddressOfEntry(entry);
    const contactPeerCoin = coinOfChainId(entry?.chainId);
    const contactPeerIsSelf = Boolean(entry?.address && contactPeer === entry.address);
    const contactAlreadySaved = Boolean(contactPeer && contacts.some((c) =>
        Array.isArray(c?.entries) && c.entries.some((e) => e?.address === contactPeer),
    ));
    const canSaveContact = contactsLoaded
        && Boolean(contactPeer)
        && !contactPeerIsSelf
        && !contactAlreadySaved
        && Boolean(contactPeerCoin)
        && contactSaveStage !== 'saved';
    async function runRbf(strategy) {
        if (rbfBusy) return;
        setMoreOpen(false);
        setRbfBusy(strategy);
        setRbfError(null);
        setRbfDone(null);
        try {
            const res = await replaceFromHistoryEntry({ messaging, entry, strategy });
            setRbfDone(`Replacement broadcast: ${res?.replacementTxHash || 'pending'}`);
        } catch (err) {
            if (err instanceof RbfNotSupportedError || err instanceof RbfInvalidEntryError) {
                setRbfError(err.message);
            } else {
                setRbfError(err?.message || 'Replacement failed.');
            }
        } finally {
            setRbfBusy(null);
        }
    }

    const moreOptions = [];
    if (canSaveContact) {
        moreOptions.push({
            id: 'save-contact',
            label: 'Save as contact',
            icon: <Icon.UsersIcon />,
            onClick: () => {
                setMoreOpen(false);
                setContactSaveStage('editing');
                setContactName('');
                setContactSaveError(null);
            },
        });
    }
    if (replaceable.ok) {
        moreOptions.push({
            id: 'rbf-speedup',
            label: rbfBusy === 'speedup' ? 'Speeding up…' : 'Speed up',
            icon: <Icon.ForwardIcon />,
            disabled: rbfBusy !== null,
            onClick: () => runRbf('speedup'),
        });
        moreOptions.push({
            id: 'rbf-cancel',
            label: rbfBusy === 'cancel' ? 'Cancelling…' : 'Cancel transaction',
            icon: <Icon.XIcon />,
            disabled: rbfBusy !== null,
            onClick: () => runRbf('cancel'),
        });
    }
    // Universal option: every entry can have a sharable link copied,
    // so the menu is never empty (DeFi rows, in particular, hit this
    // path since they don't have a peer or replaceable state).
    const shareUrl = xchainActionUrl(entry?.chainId, entry?.actionIndex);
    if (shareUrl) {
        moreOptions.push({
            id: 'copy-link',
            label: 'Copy action link',
            icon: <Icon.CopyIcon />,
            onClick: () => {
                setMoreOpen(false);
                if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(shareUrl).catch(() => { /* no-op */ });
                }
            },
        });
    }

    async function handleSaveContact(event) {
        event.preventDefault();
        const trimmed = contactName.trim();
        if (!trimmed) {
            setContactSaveError('Name is required.');
            return;
        }
        setContactSaveStage('saving');
        setContactSaveError(null);
        try {
            await messaging.saveContact({
                input: {
                    name: trimmed,
                    notes: '',
                    entries: [{ chain: contactPeerCoin, address: contactPeer, label: '' }],
                },
            });
            setContactSaveStage('saved');
        } catch (err) {
            setContactSaveError(err?.message || 'Save failed.');
            setContactSaveStage('editing');
        }
    }

    return (
        <div className={styles.detailContainer} role="region" aria-label="Action detail">
            {/* Basic details hero: concise summary at the top of the
                page. Flush variant: zero card padding so the table's
                row-divider lines run all the way to the card edges,
                with horizontal cell padding restoring the inner gutter
                so text doesn't crowd the border. */}
            <section className={`${styles.detailSection} ${styles.detailSectionFlush}`}>
                <table className={styles.detailsTable}>
                    <tbody>
                        {detailRows.map(([label, value]) => (
                            <tr key={label}>
                                <th scope="row">{label}</th>
                                <td>{value}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            {/* Action row: explorer links followed by a "More" button
                that drops down a list of follow-up actions (e.g. Save
                as contact, Speed up, Cancel). The More button always
                renders so users get a consistent place to look across
                every action type; when no actions apply, the menu
                surfaces a placeholder message instead. */}
            {explorerButtons.length > 0 ? (
                <div className={styles.detailActions} role="group" aria-label="Action options">
                    {explorerButtons.map((link) => (
                        <a
                            key={link.id}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.detailAction}
                        >
                            {link.iconImg ? (
                                <img
                                    src={link.iconImg}
                                    alt=""
                                    aria-hidden="true"
                                    className={styles.detailActionFavicon}
                                />
                            ) : (
                                <span className={styles.detailActionIcon} aria-hidden="true">{link.icon}</span>
                            )}
                            <span>{link.label}</span>
                        </a>
                    ))}
                    <div className={styles.detailActionMoreWrap} ref={moreWrapRef}>
                        <button
                            type="button"
                            className={styles.detailAction}
                            aria-haspopup="menu"
                            aria-expanded={moreOpen}
                            onClick={() => setMoreOpen((o) => !o)}
                        >
                            <span className={styles.detailActionIcon} aria-hidden="true"><Icon.MoreIcon /></span>
                            <span>More</span>
                        </button>
                        {moreOpen ? (
                            <div className={styles.moreMenu} role="menu">
                                {moreOptions.length > 0 ? (
                                    moreOptions.map((opt) => (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            role="menuitem"
                                            className={styles.moreMenuItem}
                                            onClick={opt.onClick}
                                            disabled={Boolean(opt.disabled)}
                                        >
                                            {opt.icon ? (
                                                <span className={styles.moreMenuItemIcon} aria-hidden="true">
                                                    {opt.icon}
                                                </span>
                                            ) : null}
                                            <span>{opt.label}</span>
                                        </button>
                                    ))
                                ) : (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className={styles.moreMenuItem}
                                        disabled
                                    >
                                        <span>No additional actions</span>
                                    </button>
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {/* RBF status: surfaces the outcome of Speed up / Cancel
                picked from the More menu. Sits between the action row
                and the tab strip so the user sees the result without
                scrolling, mirroring the inline save-contact form. */}
            {rbfError ? (
                <p className={styles.rbfError} role="alert">{rbfError}</p>
            ) : null}
            {rbfDone ? (
                <p className={styles.rbfDone} role="status">{rbfDone}</p>
            ) : null}

            {/* Inline Save-as-contact form. Shown when the user picks
                "Save as contact" from the More menu, sits between the
                action buttons and the tab strip so the user doesn't
                lose the page context the way the bottom-of-card prompt
                did. */}
            {contactSaveStage === 'editing' || contactSaveStage === 'saving' ? (
                <form className={styles.saveContactForm} onSubmit={handleSaveContact}>
                    <label className={styles.saveContactLabel}>
                        Save {shortenAddress(contactPeer || '')} as
                        <input
                            type="text"
                            className={styles.saveContactInput}
                            value={contactName}
                            onChange={(e) => setContactName(e.target.value)}
                            autoFocus
                            maxLength={80}
                            placeholder="Contact name"
                        />
                    </label>
                    {contactSaveError ? (
                        <p className={styles.saveContactError} role="alert">{contactSaveError}</p>
                    ) : null}
                    <div className={styles.saveContactActions}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setContactSaveStage('hidden');
                                setContactName('');
                                setContactSaveError(null);
                            }}
                            disabled={contactSaveStage === 'saving'}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            loading={contactSaveStage === 'saving'}
                        >
                            Save
                        </Button>
                    </div>
                </form>
            ) : null}

            {/* Tab strip: matches Home's HomeTabs visual rhythm. */}
            <div className={styles.detailTabs} role="tablist" aria-label="Action detail view">
                {detailTabs.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={activeDetailTab === t.id ? 'true' : 'false'}
                        className={`${styles.detailTab} ${activeDetailTab === t.id ? styles.detailTabActive : ''}`}
                        onClick={() => setActiveDetailTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <section
                className={`${styles.detailSection} ${activeDetailTab === 'details' ? styles.detailSectionFlush : ''}`}
                role="tabpanel"
            >
                {/* Details tab: full field dump (every value associated
                    with the action), as opposed to the curated hero
                    table at the top. */}
                {activeDetailTab === 'details' ? (
                    <table className={styles.detailsTable}>
                        <tbody>
                            {fullRows.map(([label, value]) => (
                                <tr key={label}>
                                    <th scope="row">{label}</th>
                                    <td>{value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : null}

                {activeDetailTab === 'status' ? (
                    <TxStatusTimeline entry={entry} chainTip={chainTip} />
                ) : null}

                {activeDetailTab === 'raw' ? (
                    <>
                        <div className={styles.rawJsonWrap}>
                            <span className={styles.rawJsonCopy}>
                                <CopyIconButton
                                    value={decodeActionToText(rawForDisplay)}
                                    label="Copy raw JSON"
                                />
                            </span>
                            <pre className={styles.detailDecoded}>
                                {decodeActionToText(rawForDisplay)}
                            </pre>
                        </div>
                        {isLinked ? (
                            <div className={styles.detailPeerBlock}>
                                <h4 className={styles.detailSectionHeading}>
                                    Peer · {entry.link.peerCoinTicker} #{entry.link.peerActionIndex}
                                </h4>
                                {peer?.loading ? (
                                    <p className={styles.empty}>Loading the linked transaction…</p>
                                ) : peer?.error ? (
                                    <p className={styles.error}>Couldn't load peer: {peer.error}</p>
                                ) : peer?.action ? (
                                    <div className={styles.rawJsonWrap}>
                                        <span className={styles.rawJsonCopy}>
                                            <CopyIconButton
                                                value={decodeActionToText(balancesHidden ? redactAmountFields(peer.action) : peer.action)}
                                                label="Copy peer raw JSON"
                                            />
                                        </span>
                                        <pre className={styles.detailDecoded}>
                                            {decodeActionToText(balancesHidden ? redactAmountFields(peer.action) : peer.action)}
                                        </pre>
                                    </div>
                                ) : (
                                    <p className={styles.empty}>
                                        Peer chain not bundled in this wallet; open the
                                        block explorer for {entry.link.peerCoinTicker} to
                                        view {entry.link.peerCoinTicker} #{entry.link.peerActionIndex}.
                                    </p>
                                )}
                            </div>
                        ) : null}
                    </>
                ) : null}
            </section>

            {/* Interactive widgets appended below the static sections.
                Save-as-contact and Speed up / Cancel moved up to the
                More button in the action row; recipient bulk-save
                stays here because it's a per-row affordance for
                DIVIDEND / AIRDROP entries with its own UI. */}
            <RecipientsBlock entry={entry} />
            {detachAvailable ? (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        globalThis.xchainWalletWindow.openDetached({
                            initialView: 'history',
                            initialContext: {
                                walletId,
                                chainId: entry.chainId,
                                actionIndex: entry.actionIndex,
                                txHash: entry.txHash,
                            },
                        }).catch(() => { /* main returns ok:false on failure */ });
                    }}
                >
                    Open in new window
                </Button>
            ) : null}
        </div>
    );
}

function capitalize(s) {
    if (typeof s !== 'string' || s.length === 0) return '';
    return s[0].toUpperCase() + s.slice(1);
}

/**
 * Build the rows shown in the "Action details" table at the top of
 * ActionDetail. Each tuple is `[label, value]`. Empty / missing fields
 * are skipped so the table only shows what's actually populated.
 */
function basicDetailRows(entry, chainTip) {
    if (!entry) return [];
    const rows = [];

    // Action: just the colored bubble. The action number now lives
    // on its own "Index" row below Block.
    rows.push(['Action', (
        <span className={styles.actionTag}>{entry.action || '-'}</span>
    )]);

    // Status: second, so success / failure is visible immediately.
    const status = classifyEntryStatus(entry);
    const statusLabel = status === 'confirmed' ? 'VALID'
        : status === 'failed' ? 'INVALID'
        : 'PENDING';
    const statusColorClass = status === 'confirmed' ? styles.statusPillSuccess
        : status === 'failed' ? styles.statusPillError
        : styles.statusPillPending;
    rows.push(['Status', (
        <span className={`${styles.statusBubble} ${statusColorClass}`}>{statusLabel}</span>
    )]);

    // Network: coin icon + full chain name (e.g. "Dogecoin Mainnet").
    if (entry.chainId) {
        const [coin = '', network = 'mainnet'] = String(entry.chainId).split('-');
        const label = `${capitalize(coin)} ${capitalize(network)}`.trim();
        rows.push(['Network', (
            <span className={styles.copyableValue}>
                <img
                    src={branding.chainIconSmallUrl(entry.chainId)}
                    alt=""
                    aria-hidden="true"
                    className={styles.rowChainIcon}
                    width={16}
                    height={16}
                />
                <span>{label}</span>
            </span>
        )]);
    }
    // Hero stays minimal: Action, Status, Network, Time only. Block,
    // Index, Tx hash, Source, Destination, Amount, Memo, and every
    // per-action field live in the Details tab below.
    if (entry.timestamp) rows.push(['Time', formatRelativeTime(entry.timestamp) || formatTimestamp(entry.timestamp)]);
    return rows;
}

/**
 * Inline value + small copy-icon button. Used in the ActionDetail
 * table for fields a user typically needs to paste somewhere else
 * (action_index, tx_hash, source / destination addresses).
 */
function CopyableValue({ display, fullValue, ariaLabel }) {
    return (
        <span className={styles.copyableValue}>
            <CopyIconButton value={fullValue} label={ariaLabel} />
            <span className={styles.copyableText}>{display}</span>
        </span>
    );
}

function CopyIconButton({ value, label = 'Copy to clipboard' }) {
    const [copied, setCopied] = useState(false);
    const handleClick = async (event) => {
        event.stopPropagation();
        const text = String(value ?? '');
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else if (typeof document !== 'undefined') {
                // Fallback for non-secure contexts; hidden textarea + execCommand.
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard may be unavailable; swallow silently */ }
    };
    return (
        <button
            type="button"
            onClick={handleClick}
            className={styles.copyIconButton}
            aria-label={copied ? 'Copied' : label}
            title={copied ? 'Copied!' : label}
        >
            {copied ? <Icon.CheckIcon /> : <Icon.CopyIcon />}
        </button>
    );
}

/**
 * Comprehensive field-by-field dump shown in the Details tab. Lists
 * every entry-level identifier plus every key in `entry.raw`, in a
 * stable order so the user can scan all values associated with the
 * transaction in one place. The curated hero table at the top of the
 * page covers the most-relevant fields; this is the long-form view.
 */
function fullDetailRows(entry, balancesHidden = false) {
    if (!entry) return [];
    const rows = [];
    const raw = entry.raw || {};

    if (entry.action) rows.push(['action', entry.action]);
    if (entry.actionIndex) {
        rows.push(['index', (
            <CopyableValue
                display={Number(entry.actionIndex).toLocaleString('en-US')}
                fullValue={String(entry.actionIndex)}
                ariaLabel="Copy index"
            />
        )]);
    }
    // Split chainId (e.g. 'bitcoin-regtest') into two rows so the
    // chain family and network kind read separately.
    if (entry.chainId) {
        const [coin = '', network = 'mainnet'] = String(entry.chainId).split('-');
        if (coin) rows.push(['chain', coin]);
        rows.push(['network', network]);
    }
    if (entry.blockIndex) rows.push(['block_index', Number(entry.blockIndex).toLocaleString('en-US')]);
    else if (entry.blockIndex === 0) rows.push(['block_index', 'pending']);
    if (entry.timestamp) {
        rows.push(['time', formatRelativeTime(entry.timestamp) || formatTimestamp(entry.timestamp)]);
    }
    if (entry.txHash) {
        rows.push(['tx_hash', (
            <CopyableValue
                display={shortenAddress(entry.txHash)}
                fullValue={entry.txHash}
                ariaLabel="Copy tx hash"
            />
        )]);
    }
    if (entry.source) {
        rows.push(['source', (
            <CopyableValue
                display={shortenAddress(entry.source)}
                fullValue={entry.source}
                ariaLabel="Copy source address"
            />
        )]);
    }
    if (entry.address) {
        rows.push(['address', (
            <CopyableValue
                display={shortenAddress(entry.address)}
                fullValue={entry.address}
                ariaLabel="Copy address"
            />
        )]);
    }

    // Every other raw key, sorted alphabetically. Skip the
    // entry-level fields we already surfaced above so we don't print
    // the same datum twice (matched by snake_case and camelCase).
    // `params` is also skipped because the synth fixtures nest the
    // same fields there as at the top level; would render twice.
    const skipKeys = new Set([
        'action', 'ACTION',
        'action_index', 'actionIndex', 'ACTION_INDEX',
        'chain_id', 'chainId', 'CHAIN_ID',
        'block_index', 'blockIndex', 'BLOCK_INDEX',
        'timestamp', 'block_time', 'BLOCK_TIME',
        'tx_hash', 'txHash', 'TX_HASH',
        'source', 'SOURCE',
        'address', 'ADDRESS',
        'params', 'PARAMS',
    ]);
    const rawKeys = Object.keys(raw).sort();
    for (const k of rawKeys) {
        if (skipKeys.has(k)) continue;
        const v = raw[k];
        let display;
        if (balancesHidden && AMOUNT_KEY_RE.test(k)) {
            display = '•••••';
        } else if (v === null || v === undefined) display = '-';
        else if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+$/.test(v))) {
            display = formatNumberWithCommas(v);
        }
        else if (typeof v === 'object') {
            try { display = JSON.stringify(v); } catch { display = String(v); }
        } else {
            display = String(v);
        }
        rows.push([k, display]);
    }

    return rows;
}

// Thousands-separated formatting that handles strings of digits (which
// is how the explorer / synth data delivers large integer amounts) as
// well as JS numbers. Uses BigInt for pure-integer strings so values
// past Number.MAX_SAFE_INTEGER still round-trip correctly.
function formatNumberWithCommas(value) {
    if (value === null || value === undefined) return '';
    const s = String(value).trim();
    if (!s) return '';
    if (/^-?\d+$/.test(s)) {
        try { return BigInt(s).toLocaleString('en-US'); } catch { /* fall through */ }
    }
    const n = Number(s);
    if (Number.isFinite(n)) return n.toLocaleString('en-US');
    return s;
}

/**
 * Map a wallet chainId ("bitcoin-mainnet" / "bitcoin-regtest" / …)
 * to the ticker code XChain Explorer uses in its URL path:
 *
 *     /{COIN}/action/{action_index}
 *
 * where COIN is the network-prefixed ticker:
 *   - mainnet   → BTC,  LTC,  DOGE
 *   - testnet   → TBTC, TLTC, TDOGE
 *   - regtest   → RBTC, RLTC, RDOGE
 *
 * Returns null when the chainId is malformed or the coin family isn't
 * in the XChain explorer's recognized list; the caller skips the
 * XChain button in that case.
 */
function xchainCoinForChainId(chainId) {
    if (typeof chainId !== 'string' || !chainId.includes('-')) return null;
    const [coin, network = 'mainnet'] = chainId.split('-');
    const ticker = ({ bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' })[coin];
    if (!ticker) return null;
    if (network === 'mainnet') return ticker;
    if (network === 'testnet') return `T${ticker}`;
    if (network === 'regtest') return `R${ticker}`;
    return null;
}

/**
 * Build a full XChain explorer action URL from the chain descriptor.
 * Mainnet/testnet descriptors embed the coin path in `defaultUrl`
 * (e.g. `https://explorer.xchain.io/BTC`), so we append just
 * `/action/<index>`. For non-standard ports (regtest localhost) the
 * descriptor carries only the host, so we append the coin ticker path
 * and the port before `/action/<index>`.
 * Returns null when the descriptor or coin ticker is unavailable.
 */
function xchainActionUrl(chainId, actionIndex) {
    const desc = chainRegistry.get(chainId);
    const ex = desc?.explorer;
    if (!ex || !actionIndex) return null;
    const standardPort = ex.defaultPort === 80 || ex.defaultPort === 443;
    if (standardPort) {
        // defaultUrl already includes the coin path.
        return `${ex.defaultUrl}/action/${actionIndex}`;
    }
    // Non-standard port: descriptor URL is just the host; append coin path.
    const coin = xchainCoinForChainId(chainId);
    if (!coin) return null;
    return `${ex.defaultUrl}:${ex.defaultPort}/${coin}/action/${actionIndex}`;
}

/**
 * Per-chain block-explorer link list. Demo entries (synthesized
 * tx hashes) get no links since they wouldn't resolve. Always
 * surfaces the XChain explorer when an action_index is available.
 */
function explorerLinksFor(entry) {
    const links = [];
    if (!entry) return links;
    const txHash = entry.txHash;
    const [coin = '', network = 'mainnet'] = String(entry.chainId || '').split('-');

    // XChain explorer first: addresses ACTIONs by `coin/action/index`
    // where `coin` is the XChain ticker code for the (chain, network)
    // pair: BTC/LTC/DOGE for mainnet, T-prefix for testnet, R-prefix
    // for regtest. Works for demo / regtest data too. Naked favicon
    // (no circular icon-wrap), just the chain-link glyph above the
    // label.
    if (entry.actionIndex) {
        const xchainUrl = xchainActionUrl(entry.chainId, entry.actionIndex);
        if (xchainUrl) {
            links.push({
                id: 'xchain',
                label: 'XChain',
                iconImg: branding.faviconUrl(),
                url: xchainUrl,
            });
        }
    }

    // External chain explorers: only mainnet and testnet have
    // working third-party coverage. Regtest is local-only; suppress
    // external links so they don't render mainnet URLs that 404.
    if (!txHash) return links;
    if (network !== 'mainnet' && network !== 'testnet') return links;

    if (coin === 'bitcoin') {
        // Mempool.space serves Bitcoin testnet under `/testnet4/`
        // (current testnet variant). Blockstream.info still indexes
        // the legacy `/testnet/` (testnet3) endpoint, so testnet
        // links there may not resolve for testnet4 hashes; kept
        // anyway as a second affordance.
        const mempoolPath = network === 'testnet' ? 'testnet4/' : '';
        const blockstreamPath = network === 'testnet' ? 'testnet/' : '';
        links.push({
            id: 'mempool',
            label: 'Mempool',
            iconImg: 'https://mempool.space/resources/favicons/favicon.ico',
            url: `https://mempool.space/${mempoolPath}tx/${txHash}`,
        });
        links.push({
            id: 'blockstream',
            label: 'Blockstream',
            iconImg: 'https://blockstream.info/favicon.ico',
            url: `https://blockstream.info/${blockstreamPath}tx/${txHash}`,
        });
    } else if (coin === 'litecoin') {
        // LitecoinSpace mirrors mempool.space's URL scheme (it's a
        // fork); mainnet has no prefix, testnet is `/testnet/`.
        // Blockchair covers mainnet only.
        const litecoinSpacePath = network === 'testnet' ? 'testnet/' : '';
        links.push({
            id: 'litecoinspace',
            label: 'LitecoinSpace',
            iconImg: 'https://litecoinspace.org/favicon.ico',
            url: `https://litecoinspace.org/${litecoinSpacePath}tx/${txHash}`,
        });
        if (network === 'mainnet') {
            links.push({
                id: 'blockchair',
                label: 'Blockchair',
                iconImg: 'https://blockchair.com/favicon.ico',
                url: `https://blockchair.com/litecoin/transaction/${txHash}`,
            });
        }
    } else if (coin === 'dogecoin') {
        // No reliable third-party DOGE testnet explorer at time of
        // writing; show external links on mainnet only.
        if (network === 'mainnet') {
            links.push({
                id: 'blockchair',
                label: 'Blockchair',
                iconImg: 'https://blockchair.com/favicon.ico',
                url: `https://blockchair.com/dogecoin/transaction/${txHash}`,
            });
            links.push({
                id: 'blockcypher',
                label: 'BlockCypher',
                iconImg: 'https://www.blockcypher.com/tokens/favicon/favicon.ico',
                url: `https://live.blockcypher.com/doge/tx/${txHash}`,
            });
        }
    }
    return links;
}

/**
 * §31.4 / Cluster O FOLLOWUP 2: recipient list for DIVIDEND / AIRDROP
 * rows. The recipient set is derived (holders of TICK for DIVIDEND, the
 * referenced LIST's ITEM array for AIRDROP), so the user has to opt in
 * to the fetch by clicking Show recipients. Once loaded, a "Save N as
 * one contact" affordance bulk-saves the addresses into a single
 * Contact record with N entries; the address-book grouping that
 * matches the data model best (one DIVIDEND / AIRDROP = one address
 * book).
 *
 * @param {{ entry: any }} props
 */
function RecipientsBlock({ entry }) {
    const { messaging } = useMessaging();
    const action = String(entry?.action || '').toUpperCase();
    const isDividend = action === 'DIVIDEND';
    const isAirdrop = action === 'AIRDROP';
    const supported = isDividend || isAirdrop;

    const [stage, setStage] = useState(/** @type {'idle' | 'loading' | 'loaded' | 'saving' | 'saved'} */ ('idle'));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [recipients, setRecipients] = useState(/** @type {object[]} */ ([]));
    const [snapshotNote, setSnapshotNote] = useState(/** @type {string | null} */ (null));
    const [name, setName] = useState('');

    if (!supported) return null;
    if (typeof messaging?.getDividendRecipients !== 'function'
        && typeof messaging?.getAirdropRecipients !== 'function') {
        // No host wiring; degrade silently.
        return null;
    }

    const coin = coinOfChainId(entry?.chainId);
    if (!coin) return null;

    const tick = String(entry?.raw?.TICK || entry?.raw?.tick || '').trim();
    const listIdx = String(entry?.raw?.LIST_ACTION_INDEX || entry?.raw?.list_action_index || '').trim();
    const defaultName = isDividend
        ? `DIVIDEND #${entry?.actionIndex || '?'}${tick ? ` (${tick})` : ''} holders`
        : `AIRDROP #${entry?.actionIndex || '?'}${listIdx ? ` (list #${listIdx})` : ''} recipients`;

    async function load() {
        setStage('loading');
        setError(null);
        try {
            const r = isDividend
                ? await messaging.getDividendRecipients({
                    chainId: entry.chainId,
                    actionIndex: String(entry.actionIndex),
                    tick: tick || undefined,
                })
                : await messaging.getAirdropRecipients({
                    chainId: entry.chainId,
                    actionIndex: String(entry.actionIndex),
                    listActionIndex: listIdx || undefined,
                });
            setRecipients(Array.isArray(r?.recipients) ? r.recipients : []);
            setSnapshotNote(typeof r?.snapshotNote === 'string' ? r.snapshotNote : null);
            setName(defaultName);
            setStage('loaded');
        } catch (err) {
            setError(err?.message || 'Failed to load recipients.');
            setStage('idle');
        }
    }

    async function handleSaveAll() {
        if (recipients.length === 0) return;
        if (!name.trim()) {
            setError('Name is required.');
            return;
        }
        setStage('saving');
        setError(null);
        try {
            await messaging.saveContact({
                input: {
                    name: name.trim(),
                    notes: '',
                    entries: recipients
                        .map((r) => r?.address)
                        .filter((a) => typeof a === 'string' && a.length > 0)
                        .map((address) => ({ chain: coin, address, label: '' })),
                },
            });
            setStage('saved');
        } catch (err) {
            setError(err?.message || 'Save failed.');
            setStage('loaded');
        }
    }

    const blockStyle = {
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--xc-space-1)',
        marginTop: 'var(--xc-space-2)',
    };
    const headingStyle = { color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-xs)' };

    if (stage === 'idle') {
        return (
            <div style={blockStyle}>
                <Button type="button" variant="secondary" size="sm" onClick={load}>
                    {isDividend ? 'Show holders' : 'Show recipients'}
                </Button>
                {error ? <span style={{ color: 'var(--xc-error, #c33)', fontSize: 'var(--xc-text-xs)' }} role="alert">{error}</span> : null}
            </div>
        );
    }
    if (stage === 'loading') {
        return (
            <div style={blockStyle}>
                <span style={headingStyle}>{isDividend ? 'Loading holders…' : 'Loading recipients…'}</span>
            </div>
        );
    }
    if (stage === 'saved') {
        return (
            <div style={blockStyle}>
                <span style={headingStyle} role="status">
                    Saved {recipients.length} address{recipients.length === 1 ? '' : 'es'} as a single contact "{name.trim()}".
                </span>
            </div>
        );
    }

    // stage === 'loaded' or 'saving'
    return (
        <div style={blockStyle}>
            <span style={headingStyle}>
                {recipients.length} {isDividend ? 'holder' : 'recipient'}{recipients.length === 1 ? '' : 's'}
            </span>
            {snapshotNote ? <span style={headingStyle}>{snapshotNote}</span> : null}
            {recipients.length > 0 ? (
                <div style={{
                    maxHeight: 160,
                    overflowY: 'auto',
                    border: '1px solid var(--xc-border)',
                    borderRadius: 'var(--xc-radius-sm)',
                    padding: 'var(--xc-space-1)',
                    fontFamily: 'monospace',
                    fontSize: 'var(--xc-text-xs)',
                    color: 'var(--xc-text)',
                }}>
                    {recipients.slice(0, 200).map((r, i) => (
                        <div key={`${r.address}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--xc-space-1)' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</span>
                            {r.balance !== undefined ? <span style={{ color: 'var(--xc-text-muted)' }}>{r.balance}</span> : null}
                        </div>
                    ))}
                    {recipients.length > 200 ? (
                        <div style={{ color: 'var(--xc-text-muted)', marginTop: 'var(--xc-space-1)' }}>
                            … and {recipients.length - 200} more not shown
                        </div>
                    ) : null}
                </div>
            ) : (
                <span style={headingStyle}>No {isDividend ? 'holders' : 'recipients'} found.</span>
            )}
            {recipients.length > 0 ? (
                <div style={{ display: 'flex', gap: 'var(--xc-space-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={120}
                        aria-label="Contact name"
                        disabled={stage === 'saving'}
                        style={{
                            flex: 1,
                            minWidth: 200,
                            background: 'var(--xc-bg)',
                            color: 'var(--xc-text)',
                            border: '1px solid var(--xc-border)',
                            borderRadius: 'var(--xc-radius-sm)',
                            padding: 'var(--xc-space-1) var(--xc-space-2)',
                            fontSize: 'var(--xc-text-sm)',
                        }}
                    />
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={stage === 'saving'}
                        onClick={handleSaveAll}
                    >
                        Save {recipients.length} as one contact
                    </Button>
                </div>
            ) : null}
            {error ? (
                <span style={{ color: 'var(--xc-error, #c33)', fontSize: 'var(--xc-text-xs)' }} role="alert">{error}</span>
            ) : null}
        </div>
    );
}

/**
 * Pull the peer-side address out of a history entry. Cluster O
 * FOLLOWUP 2: extended to action-kind-aware extractors so MESSAGE
 * incoming rows and ORDER_MATCH fill rows surface a usable counterparty
 * (the v0.207.0 implementation only handled the SEND case cleanly;
 * RECEIVE / MESSAGE-incoming / fill rows fell through to either a
 * self-address or null).
 *
 * Returns null when no salient peer address is on the row payload;
 * the caller suppresses the single-peer "Save as contact" prompt.
 *
 * DIVIDEND / AIRDROP rows have their *derived* recipient lists handled
 * by `<RecipientsBlock>` instead; those need an SDK round-trip
 * (holdersFor / listByActionIndex) to materialize the peer set.
 *
 * @param {any} entry
 * @returns {string | null}
 */
function peerAddressOfEntry(entry) {
    const raw = entry?.raw || {};
    const self = entry?.address;
    const isSelf = (a) => typeof self === 'string' && self.length > 0 && a === self;
    const action = String(entry?.action || '').toUpperCase();

    // ORDER_MATCH / fill rows carry both sides of the trade. The peer
    // is whichever address isn't the wallet's own. Different explorer
    // shapes use different field names; try them in priority order.
    if (action === 'ORDER_MATCH' || action === 'ORDER_FILL' || action === 'ORDERFILL') {
        const candidates = [
            raw.tx0_address, raw.TX0_ADDRESS,
            raw.tx1_address, raw.TX1_ADDRESS,
            raw.give_address, raw.GIVE_ADDRESS,
            raw.get_address, raw.GET_ADDRESS,
            raw.destination, raw.DESTINATION,
            raw.source, raw.SOURCE,
        ];
        for (const a of candidates) {
            if (typeof a === 'string' && a.length > 0 && !isSelf(a)) return a;
        }
        return null;
    }

    // SEND / RECEIVE / MESSAGE / generic: destination if it isn't
    // the wallet's own address (we received), otherwise source if
    // that isn't ours either (we sent).
    const dest = raw.destination ?? raw.DESTINATION ?? raw.recipient ?? raw.RECIPIENT;
    if (typeof dest === 'string' && dest.length > 0 && !isSelf(dest)) return dest;
    const src = raw.source ?? raw.SOURCE;
    if (typeof src === 'string' && src.length > 0 && !isSelf(src)) return src;
    return null;
}

/**
 * Map a chainId like "bitcoin-mainnet" / "litecoin-regtest" to the
 * coin family ("bitcoin" / "litecoin") that the contacts schema
 * expects. Returns null when the chainId is malformed.
 *
 * @param {string | undefined} chainId
 * @returns {string | null}
 */
function coinOfChainId(chainId) {
    if (typeof chainId !== 'string' || !chainId.includes('-')) return null;
    const [coin] = chainId.split('-', 1);
    return coin || null;
}

/**
 * One history row. Used both for top-level entries and for member rows
 * inside an expanded group card.
 */
export function EntryRow({ entry, selected, showConnector, onClick, peerCache, isFull, chainTip, walletId }) {
    const d = chainRegistry.get(entry.chainId);
    return (
        <li data-history-key={entry.key}>
            <button
                type="button"
                onClick={onClick}
                className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
                aria-expanded={selected}
            >
                {showConnector ? (
                    <span className={styles.connector} aria-hidden="true" />
                ) : null}
                <span className={styles.rowHeader}>
                    {d ? (
                        <img
                            src={branding.chainIconSmallUrl(d.id)}
                            alt=""
                            aria-hidden="true"
                            className={styles.rowChainIcon}
                            width={16}
                            height={16}
                        />
                    ) : null}
                    <span className={styles.actionBadge}>{entry.action}</span>
                    {entry.link ? (
                        <span
                            className={styles.crosschainBadge}
                            title={`Linked to ${entry.link.peerCoinTicker} #${entry.link.peerActionIndex}`}
                        >
                            🔗
                        </span>
                    ) : null}
                    <StatusPill status={classifyEntryStatus(entry)} />
                </span>
                <span className={styles.rowSourceAddress}>
                    {entry.source || '-'}
                </span>
                <span className={styles.rowMeta}>
                    {entry.blockIndex ? (
                        <>
                            <span>Block {Number(entry.blockIndex).toLocaleString('en-US')}</span>
                            {chainTip ? (
                                <span className={styles.confirmationsPill}>
                                    {Math.max(0, chainTip - Number(entry.blockIndex) + 1)} Confirms
                                </span>
                            ) : null}
                        </>
                    ) : <span>unconfirmed</span>}
                    {entry.timestamp ? (
                        <span className={styles.rowRelativeTime}>
                            {formatRelativeTime(entry.timestamp)}
                        </span>
                    ) : null}
                </span>
            </button>
            {selected ? (
                <DetailCard entry={entry} peerCache={peerCache} isFull={isFull} chainTip={chainTip} walletId={walletId} />
            ) : null}
        </li>
    );
}

/**
 * Collapsed group card (§28.2). Renders a single summary row that
 * expands to reveal its member entries when clicked.
 */
function GroupCard({ item, expanded, onToggle }) {
    const [balancesHidden] = useBalancesHidden();
    const d = chainRegistry.get(item.leader.chainId);
    // §28.3: link-pair groups span two chains; surface both badges so
    // the user sees the cross-chain relationship without expanding.
    // Other subkinds keep their single-chain header.
    const isLinkPair = item.subkind === 'link-pair';
    const peer = isLinkPair ? item.members[0] : null;
    const peerDescriptor = peer ? chainRegistry.get(peer.chainId) : null;
    const newest = item.members[0];
    // Only issue-mint group summaries embed a financial amount
    // ("Launched TICK (supply 12345)"); strip the supply parenthetical
    // when privacy mode is on. Other subkinds carry counts or
    // chain-link metadata that aren't amounts.
    const displaySummary = (balancesHidden && item.subkind === 'issue-mint')
        ? stripSupplyParenthetical(item.summary)
        : item.summary;
    return (
        <button
            type="button"
            onClick={onToggle}
            className={`${styles.row} ${styles.groupCard} ${expanded ? styles.groupCardExpanded : ''}`}
            aria-expanded={expanded}
        >
            <span className={styles.rowHeader}>
                {d ? (
                    <img
                        src={branding.chainIconSmallUrl(d.id)}
                        alt=""
                        aria-hidden="true"
                        className={styles.rowChainIcon}
                        width={16}
                        height={16}
                    />
                ) : null}
                {isLinkPair && peerDescriptor && peerDescriptor !== d ? (
                    <>
                        <span className={styles.linkPairConnector} aria-hidden="true">↔</span>
                        <img
                            src={branding.chainIconSmallUrl(peerDescriptor.id)}
                            alt=""
                            aria-hidden="true"
                            className={styles.rowChainIcon}
                            width={16}
                            height={16}
                        />
                    </>
                ) : null}
                <span className={styles.actionBadge}>{groupBadgeLabel(item.subkind)}</span>
                {!isLinkPair ? (
                    <span className={styles.groupCount}>{item.members.length}</span>
                ) : null}
            </span>
            <span className={styles.rowSummary}>{displaySummary}</span>
            <span className={styles.rowMeta}>
                {newest?.timestamp ? `Latest ${formatRelativeTime(newest.timestamp)}` : '-'}
                <span className={styles.groupChevron} aria-hidden="true">
                    <DoubleChevron direction={expanded ? 'up' : 'down'} />
                </span>
            </span>
        </button>
    );
}

function groupBadgeLabel(subkind) {
    if (subkind === 'issue-mint') return 'LAUNCH';
    if (subkind === 'dispenser-dispense') return 'DISPENSER';
    if (subkind === 'order-fills') return 'ORDER';
    if (subkind === 'link-pair') return 'CROSS-CHAIN';
    return 'GROUP';
}

/** @typedef {{
 *   key: string,
 *   chainId: string,
 *   address: string,
 *   actionIndex: string,
 *   action: string,
 *   blockIndex: number,
 *   timestamp: number,
 *   txHash: string,
 *   source: string,
 *   raw: any,
 *   link: { peerChainId: string | null, peerCoinTicker: string, peerActionIndex: string, linkActionIndex: string } | null
 * }} HistoryEntry
 */

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

/**
 * Given a LINK row and the chainId we read it from, identify which
 * (coin, action_index) is the local side and which is the peer.
 * Returns null if the row doesn't expose enough metadata.
 */
function sidesFromLink(link, localChainId) {
    if (!link) return null;
    const coin1 = link.coin1 || link.COIN1;
    const coin2 = link.coin2 || link.COIN2;
    const idx1 = link.coin1_action_index ?? link.COIN1_ACTION_INDEX;
    const idx2 = link.coin2_action_index ?? link.COIN2_ACTION_INDEX;
    if (!coin1 || !coin2 || idx1 == null || idx2 == null) return null;

    const localDescriptor = chainRegistry.get(localChainId);
    const localCoinName = localDescriptor?.coin || null;
    const c1Name = COIN_TICKER_TO_NAME[String(coin1).toUpperCase()] || null;
    const c2Name = COIN_TICKER_TO_NAME[String(coin2).toUpperCase()] || null;

    const networkKind = localDescriptor?.networkKind || 'mainnet';
    const c1ChainId = c1Name ? chainRegistry.chainIdFor(c1Name, networkKind) : null;
    const c2ChainId = c2Name ? chainRegistry.chainIdFor(c2Name, networkKind) : null;

    // Local side is whichever (coin, networkKind) maps to localChainId.
    const c1IsLocal = c1ChainId === localChainId
        || (localCoinName && c1Name === localCoinName);
    const c2IsLocal = c2ChainId === localChainId
        || (localCoinName && c2Name === localCoinName);

    if (c1IsLocal && !c2IsLocal) {
        return {
            local: { chainId: localChainId, coinTicker: String(coin1), actionIndex: idx1 },
            peer: { chainId: c2ChainId, coinTicker: String(coin2), actionIndex: idx2 },
        };
    }
    if (c2IsLocal && !c1IsLocal) {
        return {
            local: { chainId: localChainId, coinTicker: String(coin2), actionIndex: idx2 },
            peer: { chainId: c1ChainId, coinTicker: String(coin1), actionIndex: idx1 },
        };
    }
    // Same-chain LINK (rare but possible): treat side1 as local, side2
    // as peer so the connector still draws.
    if (c1IsLocal && c2IsLocal) {
        return {
            local: { chainId: localChainId, coinTicker: String(coin1), actionIndex: idx1 },
            peer: { chainId: localChainId, coinTicker: String(coin2), actionIndex: idx2 },
        };
    }
    return null;
}

function keyFor(chainId, actionIndex) {
    return `${chainId}:${actionIndex}`;
}

// Bare-bones CSS.escape replacement; we control the input shape (a
// chainId + ':' + actionIndex + ':' + address triple), so the only
// reliably-problematic chars are `:` and quotes; escape every non-
// alphanumeric to a backslash form rather than depending on
// `CSS.escape` (jsdom 25+ has it, but older renderers might not).
function cssEscape(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function peerCacheKey(chainId, actionIndex) {
    return `${chainId}:${actionIndex}`;
}

function shorten(addr) {
    if (!addr || addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Longer middle-ellipsis truncation used in the ActionDetail "Source"
// table cell. The cell has more horizontal room than the row meta so
// we can show more of each end before collapsing.
function shortenAddress(addr) {
    if (!addr) return '';
    if (addr.length <= 26) return addr;
    return `${addr.slice(0, 16)}…${addr.slice(-8)}`;
}

/**
 * Per-row success / error / pending indicator. Reads the entry's
 * classified status and renders a colored pill so the user can scan a
 * long list and pick out failures at a glance.
 */
function StatusPill({ status }) {
    if (status === 'confirmed') {
        return <span className={`${styles.statusPill} ${styles.statusPillSuccess}`} title="Valid">Valid</span>;
    }
    if (status === 'failed') {
        return <span className={`${styles.statusPill} ${styles.statusPillError}`} title="Invalid">Invalid</span>;
    }
    return <span className={`${styles.statusPill} ${styles.statusPillPending}`} title="Pending">Pending</span>;
}

function formatTimestamp(ts) {
    if (!ts) return '-';
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toISOString().replace('T', ' ').replace(/\..*/, ' UTC');
}

// Human-readable "X ago" from a unix timestamp (seconds or ms).
function formatRelativeTime(ts) {
    if (!ts) return '';
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const diffSec = Math.floor((Date.now() - ms) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec} seconds ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(diffSec / 3600);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(diffSec / 86400);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
    const year = Math.floor(day / 365);
    return `${year} year${year === 1 ? '' : 's'} ago`;
}

/**
 * Best-effort one-line summary for a row. Different ACTIONs join in
 * different fields; we surface the most useful per-action shape, then
 * fall back to a generic descriptor.
 */
function summarizeRow(row, action) {
    if (!row) return action;
    if (action === 'SEND') {
        const amt = row.amount ?? row.AMOUNT ?? row.quantity;
        const tick = row.tick ?? row.TICK ?? row.token;
        const dest = row.destination ?? row.DESTINATION ?? row.recipient;
        if (amt != null && tick && dest) return `${amt} ${tick} → ${shorten(String(dest))}`;
    }
    if (action === 'ISSUE') {
        const tick = row.tick ?? row.TICK;
        const amt = row.amount ?? row.AMOUNT ?? row.quantity;
        if (tick && amt != null) return `Issued ${amt} ${tick}`;
    }
    if (action === 'LINK') {
        const c1 = row.coin1 || row.COIN1;
        const c2 = row.coin2 || row.COIN2;
        if (c1 && c2) return `Link ${c1} ↔ ${c2}`;
    }
    if (row.memo || row.MEMO) return String(row.memo || row.MEMO);
    return action;
}

// Field names whose values are financial amounts the privacy toggle
// should opaque. Matched case-insensitively against both snake_case and
// camelCase variants. Keep this conservative: only known amount-bearing
// keys, not address / index / status fields.
const AMOUNT_KEY_RE = /^(amount|quantity|supply|max_supply|maxSupply|give_amount|giveAmount|get_amount|getAmount|give_remaining|giveRemaining|get_remaining|getRemaining|escrow_quantity|escrowQuantity|mainchainrate|dispense_quantity|dispenseQuantity|dispense_count|dispenseCount|fee|fee_per_kb|feePerKb)$/i;

// Drop the "(supply 12345)" tail from an issue-mint group summary when
// privacy mode is on. Matches the format emitted by historyGrouping's
// `summarizeGroup`: anything else is returned unchanged.
function stripSupplyParenthetical(summary) {
    if (typeof summary !== 'string') return summary;
    return summary.replace(/\s*\(supply [^)]+\)\s*$/, '');
}

/**
 * Recursively replace amount-field values with `'•••••'`. Object / array
 * traversal is preserved so the rest of the structure stays readable
 * when the redacted result is JSON.stringify'd into the Raw tab or
 * fed into the Details table. Returns the input unchanged when it
 * contains no amount fields, so the React identity stays stable.
 */
function redactAmountFields(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(redactAmountFields);
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = AMOUNT_KEY_RE.test(k) ? '•••••' : redactAmountFields(v);
        }
        return out;
    }
    return value;
}

/** Render the row's raw fields as pretty-printed JSON for the detail card. */
function decodeActionToText(row) {
    if (!row) return '(no data)';
    try {
        return JSON.stringify(row, null, 2);
    } catch (err) {
        return String(err);
    }
}

/* ───── §28.5 / G081 history export ───────────────────────────────── */

/**
 * Multi-select dropdown: same trigger button as ChainPicker but the
 * popover contains a checkbox per option. The button summary shows
 * "All <label>" when nothing's filtered (everything passes), a single
 * option's label when one is selected, or "N selected" otherwise.
 */
/** Per-action-type icon lookup. Maps each option id to an Icon
 *  element from the shared ui library. */
function actionTypeIcon(id) {
    switch (id) {
        case 'send':       return <Icon.SendIcon />;
        case 'receive':    return <Icon.ReceiveIcon />;
        case 'issue':      return <Icon.PlusIcon />;
        case 'mint':       return <Icon.TokenIcon />;
        case 'destroy':    return <Icon.TrashIcon />;
        case 'sweep':      return <Icon.DownloadIcon />;
        case 'dispenser':  return <Icon.MarketIcon />;
        case 'dispense':   return <Icon.DownloadIcon />;
        case 'order':      return <Icon.MarketIcon />;
        case 'swap':       return <Icon.SwapIcon />;
        case 'dividend':   return <Icon.DollarIcon />;
        case 'broadcast':  return <Icon.BroadcastIcon />;
        case 'message':    return <Icon.MessageIcon />;
        case 'crosschain': return <Icon.LinkIcon />;
        default:           return null;
    }
}

function specialFilterIcon(id) {
    if (id === 'crosschain') return <Icon.LinkIcon />;
    if (id === 'multisig') return <Icon.KeyIcon />;
    return null;
}

function CheckboxPicker({ options, selected, onToggle, allLabel, summaryNoun, iconForId, menuHeader }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // Empty filter = "no constraint" (everything passes). Match the
    // existing applyHistoryFilters semantics so this matches the prior
    // chip-toggle behavior exactly.
    const isAll = selected.size === 0;
    const summary = isAll
        ? allLabel
        : selected.size === 1
            ? (options.find((o) => o.id === Array.from(selected)[0])?.label || `1 ${summaryNoun}`)
            : `${selected.size} ${summaryNoun}s`;

    return (
        <div ref={wrapRef} className={styles.chainPickerWrap}>
            <button
                type="button"
                className={styles.chainPickerBtn}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <span className={styles.chainPickerLeft}>{summary}</span>
                <SingleChevron direction="down" />
            </button>
            {open ? (
                <ul className={styles.chainPickerMenu} role="listbox" aria-multiselectable="true">
                    {menuHeader ? (
                        <li className={styles.checkboxMenuHeader} aria-hidden="true">
                            {menuHeader}
                        </li>
                    ) : null}
                    {options.map((opt) => {
                        const active = selected.has(opt.id);
                        const icon = typeof iconForId === 'function' ? iconForId(opt.id) : null;
                        return (
                            <li key={opt.id}>
                                <label
                                    className={`${styles.chainPickerOption} ${active ? styles.chainPickerOptionActive : ''}`}
                                    role="option"
                                    aria-selected={active}
                                >
                                    <input
                                        type="checkbox"
                                        checked={active}
                                        onChange={() => onToggle(opt.id)}
                                    />
                                    {icon ? <span className={styles.checkboxOptionIcon} aria-hidden="true">{icon}</span> : null}
                                    <span>{opt.label}</span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}

/** Single chevron: render via SVG so the line weight matches the
 * surrounding text and stays crisp at any size. */
function SingleChevron({ direction = 'down' }) {
    const points = direction === 'up' ? '3,8 6,5 9,8' : '3,5 6,8 9,5';
    return (
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** Two chevrons stacked, both pointing the same way. */
function DoubleChevron({ direction = 'down' }) {
    const top = direction === 'up' ? '3,6 6,3 9,6' : '3,3 6,6 9,3';
    const bot = direction === 'up' ? '3,11 6,8 9,11' : '3,8 6,11 9,8';
    return (
        <svg viewBox="0 0 12 14" width="12" height="14" aria-hidden="true">
            <polyline
                points={top}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <polyline
                points={bot}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** Format a date N days ago in local time as YYYY-MM-DD for the
 *  native <input type="date"> control. */
function isoDateDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function chainScopeLabel(enabledChains, activeChainIds) {
    if (!enabledChains) return 'all';
    const total = activeChainIds.length;
    if (enabledChains.size === 0 || enabledChains.size === total) return 'all';
    return Array.from(enabledChains).sort().join('+');
}

/**
 * Custom chain picker: full-width button that opens a popover with
 * each option rendered as its chain logo + display name. Used instead
 * of a native <select> because browsers don't render HTML / images
 * inside <option> elements.
 */
function ChainPicker({ activeChainIds, chainRegistry, enabledChains, onChange }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const isAll = enabledChains.size === activeChainIds.length || enabledChains.size === 0;
    const selectedId = isAll ? null : Array.from(enabledChains)[0];
    const selectedDesc = selectedId ? chainRegistry.get(selectedId) : null;

    const choose = (id) => {
        const next = id === 'all'
            ? new Set(activeChainIds)
            : new Set([id]);
        onChange(next);
        setOpen(false);
    };

    return (
        <div ref={wrapRef} className={styles.chainPickerWrap}>
            <button
                type="button"
                className={styles.chainPickerBtn}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <span className={styles.chainPickerLeft}>
                    {selectedDesc ? (
                        <img
                            src={branding.chainIconSmallUrl(selectedDesc.id)}
                            alt=""
                            aria-hidden="true"
                            className={styles.chainPickerIcon}
                        />
                    ) : (
                        <span className={styles.chainPickerAllIcon} aria-hidden="true">⛓</span>
                    )}
                    <span>{selectedDesc ? selectedDesc.displayName : 'All chains'}</span>
                </span>
                <SingleChevron direction="down" />
            </button>
            {open ? (
                <ul className={styles.chainPickerMenu} role="listbox">
                    <li>
                        <button
                            type="button"
                            role="option"
                            aria-selected={isAll}
                            className={`${styles.chainPickerOption} ${isAll ? styles.chainPickerOptionActive : ''}`}
                            onClick={() => choose('all')}
                        >
                            <span className={styles.chainPickerAllIcon} aria-hidden="true">⛓</span>
                            <span>All chains</span>
                        </button>
                    </li>
                    {activeChainIds.map((cid) => {
                        const d = chainRegistry.get(cid);
                        const isSel = selectedId === cid;
                        return (
                            <li key={cid}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={isSel}
                                    className={`${styles.chainPickerOption} ${isSel ? styles.chainPickerOptionActive : ''}`}
                                    onClick={() => choose(cid)}
                                >
                                    <img
                                        src={branding.chainIconSmallUrl(cid)}
                                        alt=""
                                        aria-hidden="true"
                                        className={styles.chainPickerIcon}
                                    />
                                    <span>{d?.displayName || cid}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}

function runExport({ entries, scope, format, columns }) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const filename = flowsLib.buildExportFilename({ scope, format });
    const fileContent = format === 'csv'
        ? flowsLib.entriesToCsv(entries, { columns })
        : flowsLib.entriesToJson(entries, { scope, columns });
    const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
    const blob = new Blob([fileContent], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ───── Cluster I FOLLOWUP 5 - export modal ───────────────────────── */

const MODAL_SCRIM = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
};
const MODAL_CARD = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    padding: 'var(--xc-space-3)',
    width: 'min(420px, 90vw)',
    maxHeight: '80vh',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-3)',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.25)',
};
const MODAL_FIELDSET = {
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-2)',
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-1)',
    fontSize: 'var(--xc-text-sm)',
};
const MODAL_LEGEND = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-xs)',
    padding: '0 var(--xc-space-1)',
};
const MODAL_LABEL = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--xc-space-2)',
    fontSize: 'var(--xc-text-sm)',
};
const MODAL_ACTIONS = {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 'var(--xc-space-2)',
};

function ExportModal({
    onClose,
    format, setFormat,
    columns, setColumns,
    fromDate, setFromDate,
    toDate, setToDate,
    scope, setScope,
    activeFilterFromDate, activeFilterToDate,
    visibleCount, totalCount,
    onConfirm,
}) {
    useEffect(() => {
        function onKey(e) { if (e.key === 'Escape') onClose(); }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const toggleColumn = (col) => {
        const next = new Set(columns);
        if (next.has(col)) next.delete(col);
        else next.add(col);
        setColumns(next);
    };

    const filterChanged = fromDate !== activeFilterFromDate || toDate !== activeFilterToDate;
    const sourceCount = scope === 'all' ? totalCount : visibleCount;

    return (
        <div
            style={MODAL_SCRIM}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            role="presentation"
            tabIndex={-1}
        >
            <div
                style={MODAL_CARD}
                role="dialog"
                aria-modal="true"
                aria-label="Export history"
            >
                <h2 style={{ margin: 0, fontSize: 'var(--xc-text-base)' }}>Export history</h2>

                <fieldset style={MODAL_FIELDSET}>
                    <legend style={MODAL_LEGEND}>Format</legend>
                    <label style={MODAL_LABEL}>
                        <input
                            type="radio"
                            name="export-format"
                            value="csv"
                            checked={format === 'csv'}
                            onChange={() => setFormat('csv')}
                        />
                        CSV (RFC-4180; compact, opens in spreadsheets)
                    </label>
                    <label style={MODAL_LABEL}>
                        <input
                            type="radio"
                            name="export-format"
                            value="json"
                            checked={format === 'json'}
                            onChange={() => setFormat('json')}
                        />
                        JSON (preserves the full row including link / raw)
                    </label>
                </fieldset>

                <fieldset style={MODAL_FIELDSET}>
                    <legend style={MODAL_LEGEND}>Columns</legend>
                    {flowsLib.EXPORT_COLUMNS.map((col) => (
                        <label key={col} style={MODAL_LABEL}>
                            <input
                                type="checkbox"
                                checked={columns.has(col)}
                                onChange={() => toggleColumn(col)}
                            />
                            <span style={{ fontFamily: 'var(--xc-font-mono, monospace)', fontSize: 'var(--xc-text-xs)' }}>{col}</span>
                        </label>
                    ))}
                </fieldset>

                <fieldset style={MODAL_FIELDSET}>
                    <legend style={MODAL_LEGEND}>Scope</legend>
                    <label style={MODAL_LABEL}>
                        <input
                            type="radio"
                            name="export-scope"
                            value="filtered"
                            checked={scope === 'filtered'}
                            onChange={() => setScope('filtered')}
                        />
                        Filtered ({visibleCount.toLocaleString()} row{visibleCount === 1 ? '' : 's'})
                    </label>
                    <label style={MODAL_LABEL}>
                        <input
                            type="radio"
                            name="export-scope"
                            value="all"
                            checked={scope === 'all'}
                            onChange={() => setScope('all')}
                        />
                        Everything loaded ({totalCount.toLocaleString()} row{totalCount === 1 ? '' : 's'})
                    </label>
                </fieldset>

                <fieldset style={MODAL_FIELDSET}>
                    <legend style={MODAL_LEGEND}>
                        Date range {filterChanged ? '(overrides active filter)' : '(matches active filter)'}
                    </legend>
                    <label style={MODAL_LABEL}>
                        From
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            style={{ marginLeft: 'auto' }}
                            aria-label="From date"
                        />
                    </label>
                    <label style={MODAL_LABEL}>
                        To
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            style={{ marginLeft: 'auto' }}
                            aria-label="To date"
                        />
                    </label>
                </fieldset>

                <div style={MODAL_ACTIONS}>
                    <button type="button" className={styles.chip} onClick={onClose}>Cancel</button>
                    <button
                        type="button"
                        className={styles.chip}
                        onClick={onConfirm}
                        disabled={sourceCount === 0 || columns.size === 0}
                    >
                        Export
                    </button>
                </div>
            </div>
        </div>
    );
}
