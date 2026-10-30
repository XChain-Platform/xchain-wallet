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
import {
    Button,
    Checkbox,
    Chip,
    EmptyState,
    Icon,
    Input,
    ListPage,
    PageHeader,
    RadioGroup,
    Screen,
    SegmentedControl,
    SectionHeader,
    Skeleton,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { useSettings } from '../hooks/useSettings.js';
import { useActionProofVerification } from '../hooks/useProofVerification.js';
import { useToast } from '../components/ToastHost.jsx';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { groupHistoryEntries, groupHistoryItemsByLocalDay } from '../utils/historyGrouping.js';
import { normalizeHistoryRow } from '../utils/historyRow.js';
import {
    compareMergedEntries,
    mempoolRowToEntry,
    mergeMonotonicChainHeights,
    mergePendingEntries,
    pendingTxToEntry,
} from '../utils/pendingHistory.js';
import { getFormatLocale, t } from '../../i18n/index.js';
import { humanizeError } from '../utils/humanizeError.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { StalenessLabel } from '../components/StalenessLabel.jsx';
import { ActivityRow } from '../components/ActivityRow.jsx';
import { flows as flowsLib } from '@xchain-wallet/core';
import '../../i18n/locales/en/history.js';
import {
    applyHistoryFilters,
    classifyEntryStatus,
    ACTION_TYPE_OPTIONS,
    STATUS_OPTIONS,
} from '../utils/historyFilter.js';
import { readChainSet, writeChainSet } from '../utils/chainFilterMemory.js';
import { useScreenShortcuts } from '../keyboard/useScreenShortcuts.js';
import { useFocusTrap } from '../utils/focusTrap.js';
import { useBackHandler } from '../../ui/backStack.js';
import { useResponsivePlaceholder } from '../../ui/Input.jsx';
import { useReachability } from '../hooks/useReachability.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { OfflineEmptyState } from '../components/OfflineEmptyState.jsx';
import { useHideReachabilityNotice } from '../components/hideReachabilityNotice.js';
import { BalancesUncheckedState, useBalancesUnchecked } from '../components/BalancesUncheckedState.jsx';
import { useLongOperationStatus } from '../hooks/useLongOperationStatus.js';
import { isNavigatorOnline, useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { readHistoryCache, writeHistoryCache } from '../utils/historyCache.js';
import { readAllListPages } from '../utils/historyPages.js';
import { startVisibleInterval } from '../utils/visibleInterval.js';
import { Settings } from './Settings.jsx';
import { hasAvailableChain, NO_CHAINS_BODY, NO_CHAINS_TITLE } from '../utils/chainAvailability.js';
import styles from './History.module.css';
import { chainRegistry, peerCacheKey, OFFLINE_ACTION_REASON, DoubleChevron, coinOfChainId, formatTimestamp } from './HistoryShared.jsx';
import { EntryRow } from './HistoryEntryRow.jsx';

export { DetailCard, detailTransferDirection, detailActionLabel } from './HistoryDetailCard.jsx';
export { isGeneratedAddressLabel, EntryRow } from './HistoryEntryRow.jsx';

const HISTORY_CHAIN_FILTER_KEY = 'history';

const GROUPING_MODE_STORAGE_KEY = 'xc:historyGroupingMode';

// Session-scoped so the filters survive opening a transaction and coming
// back, but a new session starts from the default view.
const HISTORY_VIEW_STATE_STORAGE_KEY = 'xc:historyViewState';

const HISTORY_PAGE_SIZE = 100;

const EMPTY_PEER_CACHE = Object.freeze({});

function historyEntryPageAliases(entry) {
    const aliases = [entry?.key].filter(Boolean);
    const chainId = String(entry?.chainId || '');
    const actionIndex = String(entry?.actionIndex || '');
    const txHash = String(entry?.txHash || '').trim().toLowerCase();
    if (chainId && actionIndex) aliases.push(`action:${chainId}:${actionIndex}`);
    if (chainId && txHash) aliases.push(`tx:${chainId}:${txHash}`);
    return aliases;
}

function historyItemPageAliases(item) {
    if (item?.kind === 'entry') return historyEntryPageAliases(item.entry);
    if (item?.kind === 'group') {
        return [`group:${item.key}`, ...historyEntryPageAliases(item.leader)];
    }
    return [];
}

/**
 * Keep every previously rendered item inside the window when a refresh adds
 * rows ahead of it. Transaction aliases let a pending row become confirmed
 * without being counted as a second item.
 */
export function retainedHistoryItemCount(previousItems, nextItems, visibleCount, pageSize = HISTORY_PAGE_SIZE) {
    const next = Array.isArray(nextItems) ? nextItems : [];
    if (next.length === 0) return 0;
    const count = Math.max(0, Number(visibleCount) || 0);
    const retainedAliases = new Set(
        (Array.isArray(previousItems) ? previousItems : [])
            .slice(0, count)
            .flatMap(historyItemPageAliases),
    );
    let lastRetainedIndex = -1;
    next.forEach((item, index) => {
        if (historyItemPageAliases(item).some((alias) => retainedAliases.has(alias))) {
            lastRetainedIndex = index;
        }
    });
    return Math.min(next.length, Math.max(pageSize, count, lastRetainedIndex + 1));
}

function historyChainFilterKey(walletId) {
    return `${HISTORY_CHAIN_FILTER_KEY}:${walletId || 'none'}`;
}

function groupingModeStorageKey(walletId) {
    return `${GROUPING_MODE_STORAGE_KEY}:${walletId || 'none'}`;
}

function historyViewStateStorageKey(walletId, accountId) {
    return `${HISTORY_VIEW_STATE_STORAGE_KEY}:${walletId || 'none'}:${accountId || 'all'}`;
}

function readHistoryViewState(walletId, accountId, initialSearchQuery) {
    try {
        const raw = globalThis.sessionStorage?.getItem(
            historyViewStateStorageKey(walletId, accountId),
        );
        const parsed = raw ? JSON.parse(raw) : null;
        // A History opened with its own search (TokenDetail's scoped link)
        // starts from that search, not from an unrelated remembered view.
        if (!parsed || parsed.initialSearchQuery !== initialSearchQuery) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeHistoryViewState(walletId, accountId, state) {
    try {
        globalThis.sessionStorage?.setItem(
            historyViewStateStorageKey(walletId, accountId),
            JSON.stringify(state),
        );
    } catch { /* best-effort */ }
}

function formatFilterDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return value;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    try {
        return date.toLocaleDateString(getFormatLocale(), {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
    } catch {
        return value;
    }
}

function readPersistedGroupingMode(walletId) {
    try {
        const v = globalThis.localStorage?.getItem(groupingModeStorageKey(walletId));
        return v === 'flat' ? 'flat' : 'grouped';
    } catch {
        return 'grouped';
    }
}

function writePersistedGroupingMode(walletId, mode) {
    try {
        globalThis.localStorage?.setItem(groupingModeStorageKey(walletId), mode);
    } catch { /* best-effort */ }
}

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
 * The handle History keeps on the row the user opened, alongside its
 * key. Lowercased because the pending side normalizes hashes and the
 * confirmed feed does not.
 *
 * @param {{ chainId?: string, txHash?: string } | null | undefined} entry
 */
function rememberedSelection(entry) {
    return {
        chainId: String(entry?.chainId || ''),
        txHash: String(entry?.txHash || '').toLowerCase(),
    };
}

/**
 * Splits the timeline into its day headings and the runs of rows between
 * them, so each run renders as one flush card list.
 *
 * @param {Array<{ kind: string, key: string, label?: string }>} items
 * @returns {Array<{ kind: 'day', key: string, label: string } | { kind: 'rows', key: string, items: Array<object> }>}
 */
export function timelineRuns(items) {
    const runs = [];
    for (const item of items) {
        if (item.kind === 'day') {
            runs.push(item);
            continue;
        }
        const last = runs[runs.length - 1];
        if (last && last.kind === 'rows') last.items.push(item);
        else runs.push({ kind: 'rows', key: `rows:${item.key ?? item.entry?.key ?? runs.length}`, items: [item] });
    }
    return runs;
}

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
 * and merge into a flat `entries` list. A LINK is recorded on-chain by
 * the broadcasting side only, so each row's `link` is threaded from
 * whichever side of the pairing we saw, and applies to BOTH the local
 * action and its peer action when the peer is also in the wallet's
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
    const { overall: reachabilityOverall } = useReachability({});
    const networkOffline = reachabilityOverall === 'offline';
    const { unchecked: balancesUnchecked, recheck: recheckBalances } = useBalancesUnchecked();
    const { offline: offlineVerdict } = useNetworkOffline({ walletId });
    // Offline is the device report or the probe's verdict that no service
    // answers; either way the reads cannot finish, so the page shows its saved
    // rows or its offline state at once instead of a skeleton that waits them out.
    const browserOnline = useOnlineStatus() && !offlineVerdict;
    // Saved rows carry the page's own offline notice, which replaces the shell's.
    useHideReachabilityNotice(offlineVerdict);
    const rememberedViewRef = useRef(undefined);
    if (rememberedViewRef.current === undefined) {
        rememberedViewRef.current = readHistoryViewState(walletId, accountId, initialSearchQuery);
    }
    const rememberedView = rememberedViewRef.current;
    const proofSettings = useSettings();
    const activeNetwork = proofSettings.loading
        ? null
        : (proofSettings.settings?.activeNetwork || 'mainnet');

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [entries, setEntries] = useState(/** @type {HistoryEntry[]} */ ([]));
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [showingCachedHistory, setShowingCachedHistory] = useState(false);
    // Chains whose explorer could not be read on the load that filled the list;
    // the rows of the chains that answered still show.
    const [unreadChainIds, setUnreadChainIds] = useState(/** @type {string[]} */ ([]));
    const historyLoadedRef = useRef(false);
    historyLoadedRef.current = historyLoaded;
    const [refreshing, setRefreshing] = useState(false);
    const [addressesReload, setAddressesReload] = useState(0);
    const [networkSettingsOpen, setNetworkSettingsOpen] = useState(false);
    // Cluster G FOLLOWUP 5: Unix ms of the last successful per-chain
    // history+links fan-out completion. Surfaces as a "Last synced …"
    // hint in the filter bar so the user can spot stale views.
    const [historyFetchedAt, setHistoryFetchedAt] = useState(
        /** @type {number | null} */ (null),
    );
    const [loadingChains, setLoadingChains] = useState(/** @type {Set<string>} */ (new Set()));
    // §28.3 "Indexed" timeline stage: per-chain indexer watermark
    // (latest processed block index) keyed by chainId. Fetched once per
    // loaded chain via messaging.getIndexerWatermark; threaded into the
    // TxStatusTimeline so a confirmed row can show whether the indexer has
    // caught up to its block.
    const [indexerWatermarkByChainId, setIndexerWatermarkByChainId] = useState(
        /** @type {Record<string, number>} */ ({}),
    );
    const [enabledChains, setEnabledChains] = useState(/** @type {Set<string>} */ (new Set()));
    const [crossChainOnly, setCrossChainOnly] = useState(Boolean(rememberedView?.crossChainOnly));
    const [multisigOnly, setMultisigOnly] = useState(Boolean(rememberedView?.multisigOnly));
    const [multisigAddress, setMultisigAddress] = useState(/** @type {string | null} */ (null));
    const [groupingMode, setGroupingModeState] = useState(
        /** @type {'grouped' | 'flat'} */ (() => readPersistedGroupingMode(walletId)),
    );
    const [dayGroupingNowMs, setDayGroupingNowMs] = useState(Date.now);
    const setGroupingMode = (mode) => {
        setGroupingModeState(mode);
        writePersistedGroupingMode(walletId, mode);
    };
    const [expandedGroups, setExpandedGroups] = useState(/** @type {Set<string>} */ (new Set()));
    const [searchQuery, setSearchQuery] = useState(
        rememberedView?.searchQuery ?? initialSearchQuery ?? '',
    );
    const [searchContacts, setSearchContacts] = useState(/** @type {any[]} */ ([]));
    const [actionTypeFilter, setActionTypeFilter] = useState(
        /** @type {Set<string>} */ (new Set(rememberedView?.actionTypes || [])),
    );
    const [statusFilter, setStatusFilter] = useState(
        /** @type {Set<string>} */ (new Set(rememberedView?.statuses || [])),
    );
    // The inclusive endpoints cover exactly 30 local calendar days.
    const [dateFrom, setDateFrom] = useState(() => rememberedView?.dateFrom ?? isoDateDaysAgo(29));
    const [dateTo, setDateTo] = useState(() => rememberedView?.dateTo ?? isoDateDaysAgo(0));
    const [dateError, setDateError] = useState('');
    const [phoneFiltersOpen, setPhoneFiltersOpen] = useState(false);
    const [moreFiltersOpen, setMoreFiltersOpen] = useState(Boolean(rememberedView?.moreFiltersOpen));
    useEffect(() => {
        writeHistoryViewState(walletId, accountId, {
            initialSearchQuery,
            searchQuery,
            actionTypes: Array.from(actionTypeFilter),
            statuses: Array.from(statusFilter),
            dateFrom,
            dateTo,
            crossChainOnly,
            multisigOnly,
            moreFiltersOpen,
        });
    }, [
        walletId, accountId, initialSearchQuery, searchQuery, actionTypeFilter,
        statusFilter, dateFrom, dateTo, crossChainOnly, multisigOnly, moreFiltersOpen,
    ]);
    // The export modal controls only the file representation. Row selection
    // remains owned by the History filters so the file matches the list.
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState(/** @type {'csv' | 'json'} */ ('csv'));
    const [exportColumns, setExportColumns] = useState(
        /** @type {Set<string>} */ (new Set(flowsLib.EXPORT_COLUMNS)),
    );
    const [exporting, setExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState({ completed: 0, total: 0 });
    const [exportError, setExportError] = useState(/** @type {string | null} */ (null));
    const exportAbortRef = useRef(/** @type {AbortController | null} */ (null));
    const exportTime = useLongOperationStatus(exporting);
    useEffect(() => () => exportAbortRef.current?.abort(), []);
    const [selectedKey, setSelectedKey] = useState(/** @type {string | null} */ (null));
    const selectedKeyRef = useRef(selectedKey);
    selectedKeyRef.current = selectedKey;
    // M2.3: the open row is remembered by TRANSACTION as well as by key.
    // A pending entry is keyed on its hash and a confirmed one on its
    // action index, so the key of the row the user is reading changes at
    // the moment the transaction confirms, and changes again if a shallow
    // reorg reassigns that index. Without a second handle the detail
    // closes itself exactly when it finally has something new to say.
    const selectedTxRef = useRef(/** @type {{ chainId: string, txHash: string } | null} */ (null));
    const [peerCache, setPeerCache] = useState(
        /** @type {Record<string, { loading: boolean, action: any | null, error: string | null }>} */ ({}),
    );
    const peerCacheRef = useRef(peerCache);
    peerCacheRef.current = peerCache;
    // §24.6 / Cluster Y FOLLOWUP 4; once a detached-window's initial
    // route resolves, ref-flag this so we don't re-select on every
    // re-render or after the user manually navigates away from the row.
    const initialFocusFiredRef = useRef(false);
    const searchInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const timelineRef = useRef(/** @type {HTMLUListElement | null} */ (null));
    const fullSearchPlaceholder = t('history.filters.searchPlaceholder');
    const searchPlaceholder = useResponsivePlaceholder(
        fullSearchPlaceholder,
        t('history.filters.searchLabel'),
    );
    const searchDescriptionId = searchPlaceholder !== fullSearchPlaceholder
        ? 'history-search-description'
        : undefined;

    const closeSelectedRow = useCallback(() => {
        if (!selectedKey) return;
        const key = selectedKey;
        selectedTxRef.current = null;
        setSelectedKey(null);
        requestAnimationFrame(() => {
            const item = timelineRef.current?.querySelector(
                `[data-history-key="${cssEscape(key)}"]`,
            );
            item?.querySelector('button[data-history-row]')?.focus();
        });
    }, [selectedKey]);
    useBackHandler(selectedKey ? closeSelectedRow : undefined, false, 'screen');

    useEffect(() => {
        if (typeof messaging.listContacts !== 'function') return undefined;
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => {
                if (!cancelled) setSearchContacts(Array.isArray(rows) ? rows : []);
            })
            .catch(() => {
                if (!cancelled) setSearchContacts([]);
            });
        return () => { cancelled = true; };
    }, [messaging]);

    // Step 1: resolve the wallet's addresses grouped by chainId.
    useEffect(() => {
        if (!activeNetwork) return undefined;
        const cached = readHistoryCache(walletId, accountId, activeNetwork);
        setAddressesByChain(null);
        setEntries(cached?.entries || []);
        setHistoryFetchedAt(cached?.fetchedAt || null);
        setHistoryLoaded(Boolean(cached?.entries?.length));
        setShowingCachedHistory(!isNavigatorOnline() && Boolean(cached));
        setLoadingChains(new Set());
        setRefreshing(false);
        setLoadError(null);
        setIndexerWatermarkByChainId({});
        setMultisigAddress(null);
        setSelectedKey(null);
        selectedTxRef.current = null;
        setPeerCache({});
        setExpandedGroups(new Set());
        setGroupingModeState(readPersistedGroupingMode(walletId));
        observedAtRef.current.clear();
        lastMempoolSeenRef.current.clear();
        rememberedMempoolRef.current.clear();
        listPageSnapshotsRef.current.clear();
        initialFocusFiredRef.current = false;
        let cancelled = false;
        setLoadError(null);
        setAddressesByChain(null);
        messaging.getAddressesByChain(walletId, accountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const all = new Set(
                    Object.entries(byChain || {})
                        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                        .map(([cid]) => cid),
                );
                if (!cached?.entries?.length) setLoadingChains(all);
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
                const remembered = readChainSet(historyChainFilterKey(walletId), all);
                setEnabledChains(remembered ?? all);
            })
            .catch((err) => {
                if (cancelled) return;
                if (cached) {
                    setAddressesByChain(cached.addressesByChain);
                    return;
                }
                setLoadError(userFacingMessage(err, 'Failed to load addresses.'));
            });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, initialChainCoin, addressesReload, activeNetwork]);

    // §22 Multisig-only filter (Step 22). Resolve the wallet's
    // multisig receive address up-front so the chip can filter
    // entries by exact match without re-running deriveMultisigAddress
    // on every render. Best-effort: silently leaves the chip
    // disabled when no multisig is configured or when the BTC chain
    // isn't in the registry.
    useEffect(() => {
        let cancelled = false;
        if (!activeNetwork) return undefined;
        const btcChain = chainRegistry.byCoin('bitcoin')
            .find((descriptor) => descriptor.networkKind === activeNetwork)?.id;
        if (!btcChain) return undefined;
        setMultisigAddress(null);
        messaging.getMultisigReceiveAddress({ walletId, chainId: btcChain })
            .then((r) => {
                if (cancelled) return;
                if (r && typeof r.address === 'string') setMultisigAddress(r.address);
            })
            .catch(() => { /* no multisig configured; chip stays disabled */ });
        return () => { cancelled = true; };
    }, [walletId, messaging, activeNetwork]);

    // M2.1: pending rows have to keep the same timestamp between polls or
    // they would jump around the list, so the moment WE first saw each one is
    // remembered here rather than recomputed. It is only ever a fallback: a
    // row the network has actually seen carries `first_seen` instead.
    const observedAtRef = useRef(/** @type {Map<string, number>} */ (new Map()));
    // Read inside the fetch effect, which must not re-run when the list it
    // produces changes, so the current list travels by ref rather than by dep.
    const entriesRef = useRef(/** @type {HistoryEntry[]} */ ([]));
    entriesRef.current = entries;
    const rememberObservedAt = (chainId, txHash, nowMs) => {
        const key = `${chainId}:${String(txHash || '').toLowerCase()}`;
        const seen = observedAtRef.current.get(key);
        if (seen != null) return seen;
        observedAtRef.current.set(key, nowMs);
        return nowMs;
    };
    // M2.2 needs to tell "the network never saw this" apart from "the network
    // saw it and no longer does", and the difference is only visible ACROSS
    // polls: once the mempool row is gone, the read that would have carried it
    // is simply absent. So the last poll that did list each transaction is
    // remembered here, and travels to the entry that outlives the row.
    const lastMempoolSeenRef = useRef(/** @type {Map<string, number>} */ (new Map()));
    // Incoming transactions have no local PendingTx record to keep them in
    // the list after they leave the mempool. Retain the last network entry so
    // a successful later read can show it as dropped until confirmation takes
    // its place. A failed read keeps the last known state and proves nothing
    // about whether the transaction remains in the mempool.
    const rememberedMempoolRef = useRef(/** @type {Map<string, any>} */ (new Map()));
    // The last complete multi-page read of each address list, by kind, chain
    // and address; see readListPages in the fan-out below.
    const listPageSnapshotsRef = useRef(/** @type {Map<string, any>} */ (new Map()));

    // One re-fetch rule for this mount, on the same interval the beat below
    // runs at: a `focus` bump only buys something once the rows are older than
    // one beat, and a user flicking between windows used to land a full
    // history fan-out per switch. See flows/pollThrottle.js.
    const pollThrottleRef = useRef(flowsLib.createPollThrottle(flowsLib.BALANCE_POLL_INTERVAL_MS));

    // M2.1: History had no cadence of its own; a confirmed row only ever
    // appeared because the route remounted. Pending rows need one, so the
    // fetch below re-runs on the same 20s beat Home already uses for
    // balances, plus on focus, plus on mount. The tick is what re-triggers
    // it; the fetch itself decides whether to show the loading state.
    const [refreshTick, setRefreshTick] = useState(0);
    useEffect(() => {
        if (!addressesByChain) return undefined;
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        // The addresses or the wallet just changed, so the rows on screen no
        // longer describe what is being fetched: no earlier bump may hold off
        // the next one.
        const throttle = pollThrottleRef.current;
        throttle.reset();
        // Every bump costs a full fan-out per (chain, address), and the fan-out
        // effect below now owns the throttle end to end: it claims the
        // in-flight slot when it starts and restarts the window where it lands.
        // So the bump no longer notes a success of its own (asking for a
        // fan-out is not the same as having had one) and only has to decide
        // whether to ask at all. It skips while one is still running: a read
        // the SDK is holding open on a `Retry-After` can sit for up to 60 s,
        // and a 20 s beat firing through it would put three whole fan-outs
        // against the bucket the first one is waiting on.
        const bump = () => {
            if (throttle.isInFlight()) return;
            setRefreshTick((n) => n + 1);
        };
        const stopPollInterval = startVisibleInterval(bump, flowsLib.BALANCE_POLL_INTERVAL_MS);
        if (typeof window === 'undefined') return stopPollInterval;
        // A refocus is worth a fan-out only when the rows are already an
        // interval old; a burst of window switches used to cost one each.
        // `start()` rather than `claim()`: the fan-out this bump asks for is
        // what releases the slot, when it lands, so the focus must claim the
        // slot and leave it claimed. The fan-out effect re-marks it with its
        // own `reset(); start()` a tick later, which is harmless.
        const onFocus = () => { if (throttle.start()) setRefreshTick((n) => n + 1); };
        window.addEventListener('focus', onFocus);
        return () => {
            stopPollInterval();
            window.removeEventListener('focus', onFocus);
        };
    }, [addressesByChain, walletId]);

    // Step 2: fan out history + links + unconfirmed rows + our own in-flight
    // sends per (chain, address). Merge results into a single sorted list.
    useEffect(() => {
        if (!addressesByChain) return;
        const chainsToLoad = Object.entries(addressesByChain)
            .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
            .map(([cid]) => cid);
        if (chainsToLoad.length === 0) {
            setEntries([]);
            setHistoryLoaded(true);
            setHistoryFetchedAt(null);
            setRefreshing(false);
            // Nothing to fetch, so nothing lands below to release the slot a
            // focus may have claimed on the way here. `fail()` rather than
            // `succeed()`: no read happened, so the window must not move.
            pollThrottleRef.current.fail();
            return;
        }
        if (!browserOnline) {
            const cached = readHistoryCache(walletId, accountId, activeNetwork);
            if (cached) {
                setEntries(cached.entries);
                setHistoryFetchedAt(cached.fetchedAt);
                setShowingCachedHistory(true);
            } else if (entriesRef.current.length > 0) {
                setShowingCachedHistory(true);
            }
            setLoadingChains(new Set());
            // A read that was in flight when the verdict flipped is cancelled and
            // never lands, so the refresh state is released here.
            setRefreshing(false);
            setHistoryLoaded(true);
            pollThrottleRef.current.fail();
            return;
        }
        let cancelled = false;
        // This fan-out owns the throttle's in-flight slot from here until it
        // lands below. `reset(); start()` rather than a plain `start()`,
        // because `start()` marks the slot only when the WINDOW has aged, and
        // the fan-outs that run regardless of the window (the mount, and the
        // one a beat asked for) arrive with a window younger than the interval
        // by the previous fan-out's own latency. Those would run unmarked, and
        // the next beat would stack a second fan-out on one still waiting out a
        // 429. Clearing the window first makes the claim unconditional.
        const throttle = pollThrottleRef.current;
        throttle.reset();
        throttle.start();
        setRefreshing(true);
        // A background refresh must not blank the list it is refreshing; the
        // loading state belongs to the first load only.
        if (entriesRef.current.length === 0) setLoadingChains(new Set(chainsToLoad));

        // Cluster J FOLLOWUP 1: for the demo wallet, replace the SDK
        // fetch with synthesized fixture data so the History view
        // isn't an empty wasteland during the demo. Real history rows
        // arrive once the user exits demo mode + funds the wallet.
        const isDemo = flowsLib.isDemoWallet(walletId);
        const optionalRows = (promise) => promise
            .then((response) => extractRows(response))
            .catch((err) => {
                // An initial load can still show confirmed rows when an older
                // explorer lacks an optional channel. A refresh keeps every
                // shown row when any channel fails, because an empty fallback
                // is indistinguishable from pending activity disappearing.
                if (historyLoadedRef.current) throw err;
                return [];
            });

        // The explorer serves an address list 100 rows at a time. The rows of
        // an earlier complete read are reused while the list's total and head
        // are unchanged, so the beat re-reads one page, not all of them.
        const readListPages = async (kind, cid, address, read) => {
            const snapshotKey = `${kind}:${cid}:${String(address).toLowerCase()}`;
            const { rows, snapshot } = await readAllListPages(
                (page) => read(page ? { page } : null),
                listPageSnapshotsRef.current.get(snapshotKey) || null,
            );
            if (snapshot) listPageSnapshotsRef.current.set(snapshotKey, snapshot);
            else listPageSnapshotsRef.current.delete(snapshotKey);
            return rows;
        };

        const tasks = [];
        for (const cid of chainsToLoad) {
            for (const a of addressesByChain[cid]) {
                if (isDemo) {
                    tasks.push(Promise.resolve({
                        chainId: cid,
                        address: a.address,
                        addressLabel: a.label || '',
                        history: flowsLib.synthesizeDemoHistory(cid, a.address),
                        links: flowsLib.synthesizeDemoLinks(),
                    }));
                    continue;
                }
                tasks.push(
                    Promise.all([
                        readListPages(
                            'history',
                            cid,
                            a.address,
                            (opts) => messaging.getAddressHistory(
                                opts ? { chainId: cid, address: a.address, opts } : { chainId: cid, address: a.address },
                            ),
                        ),
                        optionalRows(readListPages(
                            'links',
                            cid,
                            a.address,
                            (opts) => messaging.getLinksForAddress(
                                opts ? { chainId: cid, address: a.address, opts } : { chainId: cid, address: a.address },
                            ),
                        )),
                        // M2.1: both pending sources. Each degrades to [] on
                        // the initial load, so an explorer without the
                        // unconfirmed surface still shows confirmed history.
                        // Refresh failures preserve the complete shown list.
                        typeof messaging.getAddressMempool === 'function'
                            ? messaging.getAddressMempool({ chainId: cid, address: a.address })
                                .then((r) => ({ rows: extractRows(r), ok: true }))
                                .catch((err) => {
                                    // A refresh keeps every shown row when the read fails.
                                    if (historyLoadedRef.current) throw err;
                                    return { rows: [], ok: false };
                                })
                            : Promise.resolve({ rows: [], ok: false }),
                        typeof messaging.getPendingTxsForAddress === 'function'
                            ? optionalRows(messaging.getPendingTxsForAddress({ chainId: cid, address: a.address }))
                            : Promise.resolve([]),
                    ]).then(([history, links, mempoolRead, pendingTxs]) => (
                        {
                            chainId: cid,
                            address: a.address,
                            addressLabel: a.label || '',
                            history,
                            links,
                            mempool: mempoolRead.rows,
                            mempoolReadOk: mempoolRead.ok,
                            pendingTxs,
                        }
                    )).catch((err) => {
                        // On the first load one chain's explorer being down must not
                        // blank the chains that answered: the task reports itself
                        // unread. A refresh keeps every shown row instead.
                        if (historyLoadedRef.current) throw err;
                        return {
                            chainId: cid,
                            address: a.address,
                            addressLabel: a.label || '',
                            history: [],
                            links: [],
                            mempool: [],
                            mempoolReadOk: false,
                            pendingTxs: [],
                            unread: true,
                            error: err,
                        };
                    }),
                );
            }
        }

        Promise.all(tasks).then((perAddrResults) => {
            if (cancelled) return;
            // Every read failed: that is the whole-load failure, not a partial one.
            if (perAddrResults.length > 0 && perAddrResults.every((r) => r.unread)) {
                throw perAddrResults[0].error;
            }
            const unread = [...new Set(perAddrResults.filter((r) => r.unread).map((r) => r.chainId))];
            // The fan-out landed: release the slot and restart the window from
            // here, so the next beat may ask for another and a refocus in
            // between is dropped as too fresh. Every task catches to [], so
            // this chain never rejects and there is no failure path to release
            // the slot on. A cancelled fan-out deliberately releases nothing:
            // it was replaced by a newer run of this effect, and that run took
            // the slot for itself.
            throttle.succeed();
            // Build a (chainId, action_index) -> link record map so
            // history rows can identify their peer cheaply. The protocol
            // records a LINK on the broadcasting chain only, so the peer
            // side is threaded here too, keyed off the SAME link row.
            // The local key is always set (it is that chain's own LINK
            // record); the peer key is set only when absent, so a chain's
            // own LINK always wins over another chain's guess about it,
            // regardless of which perAddrResults entry runs first.
            /** @type {Map<string, { peerChainId: string | null, peerCoinTicker: string, peerActionIndex: string, linkActionIndex: string }>} */
            const linkMap = new Map();
            for (const r of perAddrResults) {
                for (const link of r.links) {
                    const sides = sidesFromLink(link, r.chainId);
                    if (!sides) continue;
                    const linkActionIndex = String(link.action_index ?? link.actionIndex ?? '');
                    linkMap.set(keyFor(sides.local.chainId, sides.local.actionIndex), {
                        peerChainId: sides.peer.chainId,
                        peerCoinTicker: sides.peer.coinTicker,
                        peerActionIndex: String(sides.peer.actionIndex),
                        linkActionIndex,
                    });
                    // Peer chain unresolved (e.g. not a chain this wallet
                    // supports): nothing to key the peer entry on.
                    if (sides.peer.chainId == null) continue;
                    const peerKey = keyFor(sides.peer.chainId, sides.peer.actionIndex);
                    if (linkMap.has(peerKey)) continue;
                    linkMap.set(peerKey, {
                        peerChainId: sides.local.chainId,
                        peerCoinTicker: sides.local.coinTicker,
                        peerActionIndex: String(sides.local.actionIndex),
                        linkActionIndex,
                    });
                }
            }

            /** @type {HistoryEntry[]} */
            const all = [];
            for (const r of perAddrResults) {
                for (const row of r.history) {
                    // A hole or a scalar in the feed is one bad row, not a failed load.
                    if (!row || typeof row !== 'object') continue;
                    const aIdx = String(row.action_index ?? row.actionIndex ?? '');
                    if (!aIdx) continue;
                    // Normalized through the shared helper rather than inline,
                    // so the standalone detail page can rebuild the SAME entry
                    // from the same row when a pending action confirms under it.
                    const entry = normalizeHistoryRow(row, {
                        chainId: r.chainId,
                        address: r.address,
                        link: linkMap.get(keyFor(r.chainId, aIdx)) || null,
                    });
                    if (entry) all.push({ ...entry, receiveLabel: r.addressLabel });
                }
            }
            // M2.1: build the pending side, then reconcile it against the
            // confirmed side by transaction hash. A hash present on both is
            // the SAME transaction that has just confirmed, and the confirmed
            // record replaces the pending one in place rather than joining it.
            const ownAddresses = new Set();
            for (const cid of Object.keys(addressesByChain || {})) {
                for (const a of (addressesByChain[cid] || [])) {
                    if (a && a.address) ownAddresses.add(String(a.address).toLowerCase());
                }
            }
            const nowMs = Date.now();
            /** @type {any[]} */
            const pendingCandidates = [];
            const currentMempoolKeys = new Set();
            const successfulMempoolScopes = new Set();
            for (const r of perAddrResults) {
                const scope = `${r.chainId}:${String(r.address || '').toLowerCase()}`;
                if (r.mempoolReadOk) successfulMempoolScopes.add(scope);
                for (const row of (r.mempool || [])) {
                    const hash = String(row?.tx_hash ?? row?.txHash ?? '');
                    if (!hash) continue;
                    const key = `${r.chainId}:${hash.toLowerCase()}`;
                    currentMempoolKeys.add(key);
                    lastMempoolSeenRef.current.set(key, nowMs);
                    const baseEntry = mempoolRowToEntry({
                        chainId: r.chainId,
                        address: r.address,
                        row,
                        ownAddresses,
                        observedAtMs: rememberObservedAt(r.chainId, hash, nowMs),
                    });
                    const entry = baseEntry ? { ...baseEntry, receiveLabel: r.addressLabel } : baseEntry;
                    pendingCandidates.push(entry);
                    if (entry) rememberedMempoolRef.current.set(key, entry);
                }
                for (const record of (r.pendingTxs || [])) {
                    // A failed record may have no txid (it died before
                    // signing); its own id then keys the observation memory.
                    const identity = record?.txid || (record?.status === 'failed' && record?.id ? `ptx-${record.id}` : null);
                    if (!identity) continue;
                    const key = `${r.chainId}:${String(identity).toLowerCase()}`;
                    // A native send never has a mempool row above to refresh
                    // its sighting from; the host's own read of the UTXO set
                    // is that sighting, on the same clock.
                    if (record.networkSeenNow) lastMempoolSeenRef.current.set(key, nowMs);
                    pendingCandidates.push({ ...pendingTxToEntry({
                        chainId: r.chainId,
                        address: r.address,
                        pendingTx: record,
                        ownAddresses,
                        observedAtMs: rememberObservedAt(r.chainId, identity, nowMs),
                        lastMempoolSeenMs: lastMempoolSeenRef.current.get(key) ?? null,
                    }), receiveLabel: r.addressLabel });
                }
            }
            for (const [key, entry] of rememberedMempoolRef.current) {
                if (currentMempoolKeys.has(key)) continue;
                const scope = `${entry.chainId}:${String(entry.address || '').toLowerCase()}`;
                if (!successfulMempoolScopes.has(scope)) {
                    pendingCandidates.push(entry);
                    continue;
                }
                const remembered = {
                    ...entry,
                    pending: {
                        ...entry.pending,
                        origin: 'remembered',
                        lastMempoolSeenMs: lastMempoolSeenRef.current.get(key)
                            ?? entry.pending.lastMempoolSeenMs
                            ?? entry.pending.observedAtMs,
                    },
                };
                rememberedMempoolRef.current.set(key, remembered);
                pendingCandidates.push(remembered);
            }
            const merged = mergePendingEntries({ confirmed: all, pending: pendingCandidates });
            // Forget the observation times of transactions that are no longer
            // pending, so the map tracks the mempool rather than growing with
            // every transaction the wallet has ever made.
            const liveKeys = new Set(merged.pending.map((e) => (
                `${e.chainId}:${e.txHash || `ptx-${e.pending?.pendingTxId}`}`.toLowerCase()
            )));
            for (const key of [...observedAtRef.current.keys()]) {
                if (!liveKeys.has(key)) observedAtRef.current.delete(key);
            }
            for (const key of [...lastMempoolSeenRef.current.keys()]) {
                if (!liveKeys.has(key)) lastMempoolSeenRef.current.delete(key);
            }
            for (const key of [...rememberedMempoolRef.current.keys()]) {
                if (!liveKeys.has(key)) rememberedMempoolRef.current.delete(key);
            }
            merged.entries.sort(compareMergedEntries);
            const fetchedAt = Date.now();
            setEntries(merged.entries);
            setLoadingChains(new Set());
            setHistoryFetchedAt(Date.now());
            setHistoryLoaded(true);
            setShowingCachedHistory(false);
            setUnreadChainIds(unread);
            // A snapshot is saved only from a complete load.
            if (unread.length === 0) {
                writeHistoryCache(walletId, accountId, {
                    entries: merged.entries,
                    addressesByChain,
                    fetchedAt,
                }, activeNetwork);
            }
            setRefreshing(false);
        }).catch((err) => {
            if (cancelled) return;
            throttle.fail();
            setLoadingChains(new Set());
            setRefreshing(false);
            const cached = readHistoryCache(walletId, accountId, activeNetwork);
            if (historyLoadedRef.current) {
                // Rows are already on screen (live or saved): keep them, say
                // so, and name the saved copy when one exists.
                if (cached) setShowingCachedHistory(true);
                // One id, so refreshes that fail together share one toast.
                showToast({
                    id: 'history-refresh-failed',
                    message: humanizeError(err, 'refresh history').message,
                    variant: 'error',
                });
            } else if (cached) {
                setEntries(cached.entries);
                setHistoryFetchedAt(cached.fetchedAt);
                setHistoryLoaded(true);
                setShowingCachedHistory(true);
            } else {
                setHistoryLoaded(true);
                setLoadError('Could not load history. Try again.');
            }
        });

        return () => { cancelled = true; };
    }, [addressesByChain, messaging, refreshTick, walletId, accountId, browserOnline, activeNetwork]);

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

    const activeChainIds = Object.entries(addressesByChain || {})
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);

    const contactNamesByAddress = useMemo(() => {
        const names = new Map();
        for (const contact of searchContacts) {
            const name = String(contact?.name || '').trim();
            if (!name) continue;
            for (const contactEntry of contact?.entries || []) {
                const address = String(contactEntry?.address || '').trim().toLowerCase();
                if (address) names.set(address, name);
            }
        }
        return names;
    }, [searchContacts]);

    // Cluster I FOLLOWUP 6: Per-chain tip used to compute confirmation counts on confirmed rows.
    // The polled indexer watermark advances even when this wallet has no new
    // activity. Loaded rows remain a fallback and cover a watermark that lags
    // the history response during ingestion.
    const chainTipByChainId = useMemo(() => {
        /** @type {Record<string, number>} */
        const tips = { ...indexerWatermarkByChainId };
        for (const e of entries) {
            if (!e || !e.chainId) continue;
            // A record the wallet proved into a block names that block in
            // its meta rather than in blockIndex; it is as real a lower
            // bound for the tip as any explorer row.
            const b = Number(e.blockIndex || e.pending?.confirmedBlockIndex || 0);
            if (b <= 0) continue;
            if (!(e.chainId in tips) || b > tips[e.chainId]) tips[e.chainId] = b;
        }
        return tips;
    }, [entries, indexerWatermarkByChainId]);

    // The row click reads these through a ref so the callback, and with it
    // every memoised row, stays stable across the polling beat.
    const detailSourceRef = useRef({ chainTipByChainId: {}, indexerWatermarkByChainId: {}, walletAddressSet: [] });
    detailSourceRef.current = { chainTipByChainId, indexerWatermarkByChainId, walletAddressSet };

    // §28.3: fetch the indexer watermark (latest processed block)
    // per loaded chain so the TxStatusTimeline's Indexed stage reflects real
    // indexer progress rather than the confirmed-implies-indexed fallback.
    // Best-effort: a null/failed watermark for a chain is simply omitted, and
    // the timeline degrades gracefully. Demo wallets skip the probe (there is
    // no real explorer behind synthesized history).
    useEffect(() => {
        if (!addressesByChain) return undefined;
        if (!browserOnline) return undefined;
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        const chains = Object.entries(addressesByChain)
            .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
            .map(([cid]) => cid);
        if (chains.length === 0) return undefined;
        let cancelled = false;
        Promise.all(
            chains.map((cid) =>
                messaging.getIndexerWatermark({ chainId: cid })
                    .then((r) => ({ cid, watermark: r && r.watermark != null ? Number(r.watermark) : null }))
                    .catch(() => ({ cid, watermark: null })),
            ),
        ).then((results) => {
            if (cancelled) return;
            const next = {};
            for (const { cid, watermark } of results) {
                if (Number.isFinite(watermark) && watermark > 0) next[cid] = watermark;
            }
            setIndexerWatermarkByChainId((previous) => (
                mergeMonotonicChainHeights(previous, next)
            ));
        });
        return () => { cancelled = true; };
    }, [addressesByChain, messaging, walletId, browserOnline, refreshTick]);

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
            dateFromMs: localDayStartMs(dateFrom),
            // dateTo is interpreted as end-of-day so a "to: 2026-04-27"
            // pick includes everything that happened that day.
            dateToMs: localDayEndMs(dateTo),
            walletAddresses: walletAddressSet,
            contactNamesByAddress,
        });
    }, [
        entries, enabledChains, crossChainOnly, multisigOnly, multisigAddress,
        searchQuery, actionTypeFilter, statusFilter, dateFrom, dateTo,
        walletAddressSet, contactNamesByAddress,
    ]);

    // §7/§8: SPV action verification. Verify only visible, confirmed
    // entries that carry a numeric action index (an unconfirmed action has
    // no checkpointable block yet). Off for demo wallets and when the user
    // opts out via `verifyProofs` (default on). The map is keyed by
    // entry.key; EntryRow badges from it.
    const [fiatToggleBusy, setFiatToggleBusy] = useState(false);
    const verifyProofsEnabled = proofSettings.settings?.verifyProofs !== false
        && !flowsLib.isDemoWallet(walletId);
    // History-local fiat toggle, persisted on the Settings record
    // (same nested-patch pattern as the other §35 settings writes) so the
    // choice survives navigation and syncs across shells.
    const showFiatInHistory = Boolean(proofSettings.settings?.showFiatInHistory);
    const fiatCurrency = proofSettings.settings?.fiatCurrency || 'USD';
    // Context shortcuts share the trigger's empty-view guard. A disabled
    // button must not have a keyboard path that opens the same action.
    useScreenShortcuts({
        keys: {
            '/': () => { searchInputRef.current?.focus(); },
            e: () => {
                if (visibleEntries.length > 0) setExportModalOpen(true);
            },
        },
    });
    const closeExport = () => {
        exportAbortRef.current?.abort();
        exportAbortRef.current = null;
        setExporting(false);
        setExportError(null);
        setExportModalOpen(false);
    };
    const startExport = async () => {
        if (exporting) return;
        const controller = new AbortController();
        exportAbortRef.current = controller;
        setExporting(true);
        setExportError(null);
        setExportProgress({ completed: 0, total: visibleEntries.length });
        try {
            const completed = await runExport({
                entries: visibleEntries,
                scope: chainScopeLabel(enabledChains, activeChainIds),
                format: exportFormat,
                columns: Array.from(exportColumns),
                fiatCurrency,
                signal: controller.signal,
                onProgress: (count) => setExportProgress({
                    completed: count,
                    total: visibleEntries.length,
                }),
            });
            if (completed && !controller.signal.aborted) setExportModalOpen(false);
        } catch (err) {
            if (!controller.signal.aborted) {
                setExportError(humanizeError(err, 'export history').message);
            }
        } finally {
            if (exportAbortRef.current === controller) {
                exportAbortRef.current = null;
                setExporting(false);
            }
        }
    };
    const toggleShowFiatInHistory = async () => {
        if (fiatToggleBusy) return;
        setFiatToggleBusy(true);
        try {
            await proofSettings.update({ showFiatInHistory: !showFiatInHistory });
        } catch {
            // Best-effort; the toggle simply won't persist this time.
        } finally {
            setFiatToggleBusy(false);
        }
    };
    const chainFilterActive = activeChainIds.some((cid) => !enabledChains.has(cid));
    const activeFilterCount = [
        Boolean(searchQuery),
        actionTypeFilter.size > 0,
        statusFilter.size > 0,
        Boolean(dateFrom || dateTo),
        chainFilterActive,
        crossChainOnly,
        multisigOnly,
    ].filter(Boolean).length;
    const filtersActive = activeFilterCount > 0;

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
            enabledChains: new Set(enabledChains),
            chainFilterActive,
            crossChainOnly,
            multisigOnly,
        };
        const hadAny = Boolean(filtersActive);
        setSearchQuery('');
        setActionTypeFilter(new Set());
        setStatusFilter(new Set());
        setDateFrom('');
        setDateTo('');
        setDateError('');
        setEnabledChains(new Set(activeChainIds));
        setCrossChainOnly(false);
        setMultisigOnly(false);
        writeChainSet(historyChainFilterKey(walletId), null);
        if (hadAny) {
            showToast({
                message: 'Filters reset',
                actionLabel: 'Undo',
                onAction: () => {
                    setSearchQuery(snapshot.searchQuery);
                    setActionTypeFilter(snapshot.actionTypeFilter);
                    setStatusFilter(snapshot.statusFilter);
                    setDateFrom(snapshot.dateFrom);
                    setDateTo(snapshot.dateTo);
                    setEnabledChains(snapshot.enabledChains);
                    setCrossChainOnly(snapshot.crossChainOnly);
                    setMultisigOnly(snapshot.multisigOnly);
                    writeChainSet(
                        historyChainFilterKey(walletId),
                        snapshot.chainFilterActive ? snapshot.enabledChains : null,
                    );
                },
            });
        }
    };

    const updateDateFrom = (value) => {
        if (value && dateTo && value > dateTo) {
            setDateError('The from date must be on or before the to date.');
            return;
        }
        setDateFrom(value);
        setDateError('');
    };

    const updateDateTo = (value) => {
        if (value && dateFrom && value < dateFrom) {
            setDateError('The to date must be on or after the from date.');
            return;
        }
        setDateTo(value);
        setDateError('');
    };

    const setDatePreset = (days) => {
        if (days == null) {
            setDateFrom('');
            setDateTo('');
        } else {
            setDateFrom(isoDateDaysAgo(days - 1));
            setDateTo(isoDateDaysAgo(0));
        }
        setDateError('');
    };

    const todayIso = isoDateDaysAgo(0);
    const activeDatePreset = !dateFrom && !dateTo
        ? 'all'
        : dateTo === todayIso && dateFrom === isoDateDaysAgo(6)
            ? '7'
            : dateTo === todayIso && dateFrom === isoDateDaysAgo(29)
                ? '30'
                : '';

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

    useEffect(() => {
        let timer = null;
        const schedule = () => {
            const now = Date.now();
            const nextDay = new Date(now);
            nextDay.setHours(24, 0, 0, 0);
            timer = setTimeout(() => {
                setDayGroupingNowMs(Date.now());
                schedule();
            }, Math.max(1_000, nextDay.getTime() - now));
        };
        const refresh = () => {
            clearTimeout(timer);
            setDayGroupingNowMs(Date.now());
            schedule();
        };
        schedule();
        globalThis.addEventListener?.('focus', refresh);
        return () => {
            clearTimeout(timer);
            globalThis.removeEventListener?.('focus', refresh);
        };
    }, []);

    // Filtering and grouping still run over the complete result set, while the
    // DOM grows in bounded steps. This keeps exports and group membership exact
    // without making the browser lay out thousands of row buttons at once.
    const listScope = useMemo(() => [
        walletId,
        accountId || '',
        groupingMode,
        searchQuery,
        dateFrom,
        dateTo,
        crossChainOnly ? 'cross-chain' : '',
        multisigOnly ? 'multisig' : '',
        [...enabledChains].sort().join(','),
        [...actionTypeFilter].sort().join(','),
        [...statusFilter].sort().join(','),
    ].join('\u0000'), [
        walletId, accountId, groupingMode, searchQuery, dateFrom, dateTo, crossChainOnly, multisigOnly,
        enabledChains, actionTypeFilter, statusFilter,
    ]);
    const [listWindow, setListWindow] = useState(() => ({
        scope: '',
        count: HISTORY_PAGE_SIZE,
    }));
    const pagedItemsRef = useRef({ scope: '', items: [] });
    const [groupMemberLimits, setGroupMemberLimits] = useState(
        /** @type {Record<string, number>} */ ({}),
    );
    const visibleItemCount = listWindow.scope === listScope
        ? listWindow.count
        : HISTORY_PAGE_SIZE;
    const renderedItems = groupedItems.slice(0, visibleItemCount);
    const renderedTimelineItems = useMemo(
        () => groupHistoryItemsByLocalDay(renderedItems, dayGroupingNowMs)
            .flatMap((dayGroup) => [
                { kind: 'day', key: `day-heading:${dayGroup.key}`, label: dayGroup.label },
                ...dayGroup.items,
            ]),
        [renderedItems, dayGroupingNowMs],
    );

    // Each proof check is two explorer reads, so only the rows the screen can
    // show are checked: the rendered window, plus the members of an expanded
    // group card. Checking every filtered row would fan out one check per row
    // on every open, against the explorer's per-minute limits.
    const verifyItems = useMemo(() => {
        const shown = [];
        for (const item of renderedItems) {
            if (item.kind !== 'group') {
                shown.push(item.entry);
            } else if (expandedGroups.has(item.key)) {
                shown.push(...item.members.slice(0, groupMemberLimits[item.key] || HISTORY_PAGE_SIZE));
            }
        }
        return shown
            .filter((e) => Number(e.blockIndex) > 0 && e.actionIndex != null && e.actionIndex !== '')
            .map((e) => ({ key: e.key, chainId: e.chainId, actionIndex: e.actionIndex }));
    }, [renderedItems, expandedGroups, groupMemberLimits]);
    const actionVerifyMap = useActionProofVerification({
        messaging,
        items: verifyItems,
        enabled: verifyProofsEnabled && browserOnline,
    });

    useEffect(() => {
        setListWindow({ scope: listScope, count: HISTORY_PAGE_SIZE });
        setGroupMemberLimits({});
    }, [listScope]);

    useEffect(() => {
        const previous = pagedItemsRef.current;
        if (previous.scope === listScope) {
            setListWindow((window) => {
                if (window.scope !== listScope) return window;
                const count = retainedHistoryItemCount(
                    previous.items,
                    groupedItems,
                    window.count,
                );
                return count === window.count ? window : { ...window, count };
            });
        }
        pagedItemsRef.current = { scope: listScope, items: groupedItems };
    }, [groupedItems, listScope]);

    const showMoreItems = () => {
        setListWindow((prev) => {
            const current = prev.scope === listScope ? prev.count : HISTORY_PAGE_SIZE;
            return {
                scope: listScope,
                count: Math.min(groupedItems.length, current + HISTORY_PAGE_SIZE),
            };
        });
    };

    const showMoreGroupMembers = (groupKey, memberCount) => {
        setGroupMemberLimits((prev) => ({
            ...prev,
            [groupKey]: Math.min(
                memberCount,
                (prev[groupKey] || HISTORY_PAGE_SIZE) + HISTORY_PAGE_SIZE,
            ),
        }));
    };

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
            // Case-insensitive because the two sides are normalized
            // differently by design: a merged pending entry carries a
            // lowercased hash (it is the merge key), while a caller like the
            // send success card hands us the txid exactly as the node
            // returned it. An exact compare would fail silently, landing the
            // user on an unfocused list with nothing to explain why.
            if (initialFocus.txHash
                && String(e.txHash).toLowerCase() !== String(initialFocus.txHash).toLowerCase()) {
                return false;
            }
            return true;
        });
        if (!match) return;
        initialFocusFiredRef.current = true;
        selectedTxRef.current = rememberedSelection(match);
        setSelectedKey(match.key);
        const itemIndex = groupedItems.findIndex((item) => (
            item.kind === 'entry'
                ? item.entry.key === match.key
                : item.members.some((entry) => entry.key === match.key)
        ));
        if (itemIndex >= visibleItemCount) {
            setListWindow({ scope: listScope, count: itemIndex + 1 });
        }
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
    }, [entries, initialFocus, groupedItems, listScope, visibleItemCount]);

    // M2.3 handoff: the open row's key has just stopped existing, which
    // is what confirming looks like from here (the pending entry is
    // dropped and the confirmed one arrives under a different key). Point
    // the selection at the entry carrying the same transaction so the
    // detail upgrades in place instead of closing. A shallow reorg that
    // reassigns the action index lands here for the same reason, and gets
    // the same answer, because the transaction hash is the one handle
    // that survives both.
    //
    // A key that matches nothing at all is deliberately left alone: an
    // empty poll must not close a card the user is reading.
    useEffect(() => {
        if (!selectedKey) return;
        const tracked = selectedTxRef.current;
        if (!tracked?.txHash) return;
        if (entries.some((e) => e.key === selectedKey)) return;
        const match = entries.find((e) => e.chainId === tracked.chainId
            && String(e.txHash || '').toLowerCase() === tracked.txHash);
        if (match) setSelectedKey(match.key);
    }, [entries, selectedKey]);

    const toggleGroupExpanded = (groupKey) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupKey)) next.delete(groupKey);
            else next.add(groupKey);
            return next;
        });
    };

    // "Remove from history" on a failed local record. The host refuses
    // anything but a failed record, so this cannot make a live send vanish.
    // The row closes and the list re-reads; a refused or failed delete
    // leaves the row in place, which is the honest outcome.
    const dismissFailedPending = useCallback(async (pendingTxId) => {
        if (typeof messaging?.dismissFailedPendingTx !== 'function') return;
        try {
            await messaging.dismissFailedPendingTx({ pendingTxId });
        } catch {
            return;
        }
        selectedTxRef.current = null;
        setSelectedKey(null);
        setRefreshTick((n) => n + 1);
    }, [messaging]);

    // Every shell routes a row to the standalone detail page; only a host
    // that wires no handler falls back to the inline expand.
    const opensDetail = typeof onSelectEntry === 'function';
    const onRowClick = useCallback((entry) => {
        // When the parent shell wired the navigation callback, send the
        // selected entry up so it can route to the standalone ActionDetail
        // page. Falls back to the legacy inline expand for builds /
        // contexts where no handler is provided.
        if (typeof onSelectEntry === 'function') {
            onSelectEntry({
                ...entry,
                detailContext: {
                    chainTip: detailSourceRef.current.chainTipByChainId[entry.chainId] ?? null,
                    indexerWatermark: detailSourceRef.current.indexerWatermarkByChainId[entry.chainId] ?? null,
                    walletAddresses: [...detailSourceRef.current.walletAddressSet],
                },
            });
            return;
        }
        const closing = selectedKeyRef.current === entry.key;
        selectedKeyRef.current = closing ? null : entry.key;
        selectedTxRef.current = closing ? null : rememberedSelection(entry);
        setSelectedKey(closing ? null : entry.key);
        if (entry.link?.peerChainId && entry.link.peerActionIndex) {
            const pKey = peerCacheKey(entry.link.peerChainId, entry.link.peerActionIndex);
            if (!peerCacheRef.current[pKey]) {
                if (!browserOnline) {
                    setPeerCache((prev) => {
                        const next = {
                            ...prev,
                            [pKey]: { loading: false, action: null, error: OFFLINE_ACTION_REASON },
                        };
                        peerCacheRef.current = next;
                        return next;
                    });
                    return;
                }
                setPeerCache((prev) => {
                    const next = {
                        ...prev,
                        [pKey]: { loading: true, action: null, error: null },
                    };
                    peerCacheRef.current = next;
                    return next;
                });
                messaging.getActionByIndex({
                    chainId: entry.link.peerChainId,
                    actionIndex: entry.link.peerActionIndex,
                })
                    .then((action) => {
                        setPeerCache((prev) => {
                            const next = {
                                ...prev,
                                [pKey]: { loading: false, action, error: null },
                            };
                            peerCacheRef.current = next;
                            return next;
                        });
                    })
                    .catch((err) => {
                        setPeerCache((prev) => {
                            const next = {
                                ...prev,
                                [pKey]: {
                                    loading: false,
                                    action: null,
                                    error: userFacingMessage(err, 'Could not load the linked action. Try again.'),
                                },
                            };
                            peerCacheRef.current = next;
                            return next;
                        });
                    });
            }
        }
    }, [browserOnline, messaging, onSelectEntry]);

    const onTimelineKeyDown = (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const row = event.target.closest?.('button[data-history-row]');
        if (!row) return;
        const rows = Array.from(
            event.currentTarget.querySelectorAll('button[data-history-row]'),
        );
        const index = rows.indexOf(row);
        if (index < 0) return;
        let next = null;
        if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1);
        if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = rows.length - 1;
        if (next == null || next === index) return;
        event.preventDefault();
        rows[next]?.focus();
    };

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel={t('common.backToHome')}
            title={t('history.title')}
        />
    );
    // The page header holds only the title and Back, so Refresh sits in the
    // content's actions row. It shows whether or not there is any history
    // yet: an empty list is where a refresh matters most. Export joins it
    // once there is history to export, outside the collapsible filter card
    // so it stays reachable while the filters are folded away.
    const actions = (
        <>
            <Button
                variant="secondary"
                icon={(
                    <span className={refreshing ? styles.refreshing : undefined}>
                        <Icon.RefreshIcon />
                    </span>
                )}
                title={networkOffline ? t('history.offline.refreshTitle') : undefined}
                disabled={networkOffline || refreshing || !historyLoaded}
                onClick={() => {
                    const throttle = pollThrottleRef.current;
                    if (throttle.isInFlight()) return;
                    throttle.reset();
                    throttle.start();
                    setRefreshing(true);
                    setRefreshTick((n) => n + 1);
                }}
            >
                {refreshing ? t('history.refreshing') : t('history.refresh')}
            </Button>
            {entries.length > 0 ? (
                <>
                    <Button
                        className={`${styles.toolbarControl} ${styles.exportButton}`}
                        variant="secondary"
                        icon={null}
                        aria-haspopup="dialog"
                        aria-expanded={exportModalOpen}
                        aria-describedby={visibleEntries.length === 0 ? 'history-export-disabled-reason' : undefined}
                        onClick={() => setExportModalOpen(true)}
                        disabled={visibleEntries.length === 0}
                    >
                        {t('history.export.open')}
                    </Button>
                    {visibleEntries.length === 0 ? (
                        <span
                            id="history-export-disabled-reason"
                            className={styles.visuallyHidden}
                        >
                            {t('history.export.noMatchingRows')}
                        </span>
                    ) : null}
                </>
            ) : null}
        </>
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (networkSettingsOpen) {
        return (
            <Settings
                onBack={() => setNetworkSettingsOpen(false)}
                activeWallet={{ id: walletId }}
                initialSubpageId="network"
            />
        );
    }
    if (!hasAvailableChain(proofSettings, chainRegistry)) {
        return wrap(
            <ListPage>
                <EmptyState
                    title={NO_CHAINS_TITLE}
                    body={NO_CHAINS_BODY}
                    actionLabel={t('common.openNetworkSettings')}
                    onAction={() => setNetworkSettingsOpen(true)}
                    actionIcon={<Icon.GearIcon />}
                />
            </ListPage>,
        );
    }

    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage
                    variant="error"
                    recovery={{
                        label: t('common.tryAgain'),
                        onAction: () => {
                            setLoadError(null);
                            setAddressesByChain(null);
                            setHistoryLoaded(false);
                            setAddressesReload((value) => value + 1);
                        },
                    }}
                >
                    {loadError}
                </StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain) {
        return wrap(
            <ListPage actions={actions}>
                <div role="status" aria-label={t('history.loading')} aria-busy="true">
                    <Skeleton.List rows={5} rowHeight={88} avatar={false} />
                </div>
            </ListPage>,
        );
    }
    if (activeChainIds.length === 0) {
        return wrap(
            <ListPage>
                <EmptyState
                    title={t('history.empty.noAddressesTitle')}
                    body={t('history.empty.noAddressesBody')}
                    actionLabel={onReceive ? t('home.receive') : undefined}
                    onAction={onReceive}
                    actionIcon={onReceive ? <Icon.ReceiveIcon /> : undefined}
                />
            </ListPage>,
        );
    }

    // Offline with no saved history, the empty state below says so, and the
    // page notice stays out of its way so one state shows one message.
    const offlineWithoutHistory = offlineVerdict && historyLoaded && loadingChains.size === 0
        && entries.length === 0 && visibleEntries.length === 0;

    return wrap(
        <ListPage
            notices={(!browserOnline || showingCachedHistory) && !offlineWithoutHistory ? (
                <StatusMessage
                    variant="warning"
                    id="history-offline-action-reason"
                >
                    {!browserOnline
                        ? t('history.offline.cached')
                        : t('history.offline.refreshFailed')}
                </StatusMessage>
            ) : unreadChainIds.length > 0 && entries.length > 0 ? (
                <StatusMessage variant="warning" id="history-unread-chains">
                    {t('history.unreadChains', {
                        chains: unreadChainIds.map((cid) => chainRegistry.get(cid)?.displayName || cid).join(', '),
                    })}
                </StatusMessage>
            ) : null}
            actions={actions}
            toolbar={entries.length > 0 ? (
            <>
                <div className={styles.toolbarTop}>
                    <div className={styles.phoneFilterToggle}>
                        <Button
                            className={styles.toolbarControl}
                            variant="secondary"
                            block
                            icon={<Icon.FilterIcon />}
                            aria-expanded={phoneFiltersOpen}
                            aria-controls="history-filter-panel"
                            onClick={() => setPhoneFiltersOpen((open) => !open)}
                        >
                            {t('history.filters.toggle', { count: activeFilterCount })}
                        </Button>
                    </div>
                </div>
                <div
                    id="history-filter-panel"
                    className={`${styles.filterCard} ${phoneFiltersOpen ? styles.filterCardOpen : ''}`}
                    role="group"
                    aria-label={t('history.filters.label')}
                >
                <div className={styles.searchRow}>
                    <Input
                        ref={searchInputRef}
                        type="search"
                        enterKeyHint="search"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className={styles.searchInput}
                        placeholder={searchPlaceholder}
                        aria-label={t('history.filters.searchLabel')}
                        aria-describedby={searchDescriptionId}
                        value={searchQuery}
                        onChange={(ev) => setSearchQuery(ev.target.value)}
                        autoComplete="off"
                    />
                    {searchDescriptionId ? (
                        <span id={searchDescriptionId} className="sr-only">
                            {fullSearchPlaceholder}
                        </span>
                    ) : null}
                    {searchQuery ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon={null}
                            aria-label={t('history.filters.clearSearch')}
                            onClick={() => {
                                setSearchQuery('');
                                searchInputRef.current?.focus();
                            }}
                        >
                            {t('common.clear')}
                        </Button>
                    ) : null}
                </div>

                <div className={styles.dateRow}>
                    <Input
                        type="date"
                        aria-label={t('history.filters.fromDate')}
                        value={dateFrom}
                        max={dateTo || undefined}
                        onChange={(ev) => updateDateFrom(ev.target.value)}
                    />
                    <span className={styles.dateSep}>→</span>
                    <Input
                        type="date"
                        aria-label={t('history.filters.toDate')}
                        value={dateTo}
                        min={dateFrom || undefined}
                        onChange={(ev) => updateDateTo(ev.target.value)}
                    />
                </div>
                <div className={styles.dateTools}>
                    <div className={styles.datePresets} role="group" aria-label={t('history.filters.datePresets')}>
                        <Chip
                            pressed={activeDatePreset === '7'}
                            onPressedChange={() => setDatePreset(7)}
                        >{t('history.filters.last7Days')}</Chip>
                        <Chip
                            pressed={activeDatePreset === '30'}
                            onPressedChange={() => setDatePreset(30)}
                        >{t('history.filters.last30Days')}</Chip>
                        <Chip
                            pressed={activeDatePreset === 'all'}
                            onPressedChange={() => setDatePreset(null)}
                        >{t('history.filters.allDates')}</Chip>
                    </div>
                    <span className={styles.dateZone}>{t('history.filters.dateZone')}</span>
                </div>
                {dateError ? (
                    <div className={styles.dateError} role="alert">{dateError}</div>
                ) : null}
                {dateFrom || dateTo ? (
                    <div className={styles.activeDateRange}>
                        <span>{t('history.filters.activeRange', {
                            from: dateFrom ? formatFilterDate(dateFrom) : t('history.filters.anyDate'),
                            to: dateTo ? formatFilterDate(dateTo) : t('history.filters.anyDate'),
                        })}</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            icon={null}
                            onClick={() => setDatePreset(null)}
                        >
                            {t('history.filters.clearDateRange')}
                        </Button>
                    </div>
                ) : null}

                <div className={styles.filterFooter}>
                    <Chip
                        className={styles.toolbarControl}
                        pressed={moreFiltersOpen}
                        onPressedChange={() => setMoreFiltersOpen((v) => !v)}
                        aria-expanded={moreFiltersOpen}
                        aria-controls="history-more-filters"
                    >
                        <span>{t('history.filters.additionalDetails')}</span>
                        {moreFiltersOpen
                            ? <DoubleChevron direction="up" />
                            : <DoubleChevron direction="down" />}
                    </Chip>
                    <Chip
                        className={styles.toolbarControl}
                        pressed={showFiatInHistory}
                        onPressedChange={toggleShowFiatInHistory}
                        disabled={fiatToggleBusy}
                        aria-busy={fiatToggleBusy}
                        aria-label={showFiatInHistory
                            ? undefined
                            : t('history.filters.showFiatOff')}
                        title={t('history.filters.fiatHelp')}
                    >
                        {showFiatInHistory
                            ? t('history.filters.fiatCurrency', { currency: fiatCurrency })
                            : t('history.filters.fiatOff')}
                    </Chip>
                    <SegmentedControl
                        className={styles.toolbarControl}
                        aria-label={t('history.filters.groupingMode')}
                        value={groupingMode}
                        onChange={setGroupingMode}
                        items={[
                            { id: 'grouped', label: t('history.filters.grouped') },
                            { id: 'flat', label: t('history.filters.flat') },
                        ]}
                    />
                </div>

                {moreFiltersOpen ? (
                    <div
                        id="history-more-filters"
                        className={styles.morePanel}
                        role="group"
                        aria-label={t('history.filters.advanced')}
                    >
                        <ChainPicker
                            activeChainIds={activeChainIds}
                            chainRegistry={chainRegistry}
                            enabledChains={enabledChains}
                            onChange={(next) => {
                                setEnabledChains(next);
                                writeChainSet(historyChainFilterKey(walletId), next);
                            }}
                        />

                        <CheckboxPicker
                            options={ACTION_TYPE_OPTIONS}
                            selected={actionTypeFilter}
                            onToggle={toggleSetMember(setActionTypeFilter)}
                            allLabel={t('history.filters.allActionTypes')}
                            summaryNoun={t('history.filters.actionType')}
                            iconForId={actionTypeIcon}
                            menuHeader={t('history.filters.actionTypes')}
                        />

                        <CheckboxPicker
                            options={STATUS_OPTIONS}
                            selected={statusFilter}
                            onToggle={toggleSetMember(setStatusFilter)}
                            allLabel={t('history.filters.allStatuses')}
                            summaryNoun={t('history.filters.status')}
                            menuHeader={t('history.filters.statusHeader')}
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
                            allLabel={t('history.filters.noSpecialFilters')}
                            summaryNoun={t('history.filters.filter')}
                            iconForId={specialFilterIcon}
                            menuHeader={t('history.filters.special')}
                        />

                        {multisigAddress ? (
                            <Button
                                variant={multisigOnly ? 'primary' : 'ghost'}
                                size="sm"
                                icon={null}
                                aria-pressed={multisigOnly}
                                onClick={() => setMultisigOnly((v) => !v)}
                            >
                                {t('history.filters.multisigOnly')}
                            </Button>
                        ) : null}

                    </div>
                ) : null}
                </div>
            </>
        ) : null}
        >

            {exportModalOpen ? (
                <ExportModal
                    onClose={closeExport}
                    format={exportFormat}
                    setFormat={setExportFormat}
                    columns={exportColumns}
                    setColumns={setExportColumns}
                    fiatCurrency={fiatCurrency}
                    visibleCount={visibleEntries.length}
                    exporting={exporting}
                    progress={exportProgress}
                    operationTime={exportTime}
                    error={exportError}
                    onConfirm={startExport}
                />
            ) : null}

            {!historyLoaded || loadingChains.size > 0 ? (
                <div role="status" aria-label={t('history.loading')} aria-busy="true">
                    <Skeleton.List rows={Math.max(3, loadingChains.size)} rowHeight={88} avatar={false} />
                </div>
            ) : null}

            {historyLoaded && visibleEntries.length === 0 && loadingChains.size === 0 ? (
                filtersActive && entries.length > 0 ? (
                    <EmptyState
                        title={searchQuery.trim()
                            ? t('history.empty.noSearchResultsTitle', { query: searchQuery.trim() })
                            : t('history.empty.noMatchesTitle')}
                        body={t('history.empty.noMatchesBody')}
                        actionLabel={t('history.empty.clearFilters')}
                        onAction={clearAllFilters}
                    />
                ) : offlineWithoutHistory ? (
                    // Offline with nothing saved, the empty state is the one message:
                    // it also steps the shell's reachability notice aside.
                    <OfflineEmptyState
                        body={t('history.offline.emptyBody')}
                        onRetry={() => {
                            recheckBalances();
                            setRefreshTick((n) => n + 1);
                        }}
                    />
                ) : balancesUnchecked && !crossChainOnly && entries.length === 0 ? (
                    // An empty read while balances could not be checked proves
                    // nothing, so the page says that once instead of "No
                    // activity yet" beside the stale-balances notice.
                    <BalancesUncheckedState
                        onRetry={() => {
                            recheckBalances();
                            setRefreshTick((n) => n + 1);
                        }}
                        onReceive={onReceive}
                    />
                ) : (
                    <EmptyState
                        title={crossChainOnly
                            ? t('history.empty.noCrossChainTitle')
                            : t('history.empty.noActivityTitle')}
                        body={crossChainOnly
                            ? t('history.empty.noCrossChainBody')
                            : t('history.empty.noActivityBody')}
                        actionLabel={!crossChainOnly && onReceive
                            ? t('history.empty.startReceiving')
                            : undefined}
                        onAction={!crossChainOnly ? onReceive : undefined}
                        actionIcon={!crossChainOnly && onReceive ? <Icon.ReceiveIcon /> : undefined}
                    />
                )
            ) : null}

            {historyFetchedAt && entries.length > 0 ? (
                <div className={styles.resultsHeader}>
                    {/* Offline, the page notice already says the rows are saved, so the
                        freshness line stays out and one state shows one message. */}
                    {historyFetchedAt && loadingChains.size === 0 && browserOnline ? (
                        <StalenessLabel lastSyncedAt={historyFetchedAt} />
                    ) : <span />}
                </div>
            ) : null}

            <ul
                ref={timelineRef}
                className={styles.timeline}
                aria-label={t('history.title')}
                onKeyDown={onTimelineKeyDown}
            >
                {timelineRuns(renderedTimelineItems).map((run) => (run.kind === 'day' ? (
                    <li key={run.key}><SectionHeader as="h2" title={run.label} /></li>
                ) : (
                    // The rows under one heading are one flush card with dividers.
                    <li key={run.key}>
                        <ul className={styles.rowList}>
                {run.items.map((item) => {
                    if (item.kind === 'group') {
                        const expanded = expandedGroups.has(item.key);
                        const memberLimit = groupMemberLimits[item.key] || HISTORY_PAGE_SIZE;
                        const renderedMembers = item.members.slice(0, memberLimit);
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
                                            {renderedMembers.map((entry) => (
                                                <EntryRow
                                                    key={entry.key}
                                                    entry={entry}
                                                    selected={selectedKey === entry.key}
                                                    opensDetail={opensDetail}
                                                    showConnector={
                                                        item.subkind === 'link-pair'
                                                            ? false
                                                            : connectorByKey.has(entry.key)
                                                    }
                                                    onClick={onRowClick}
                                                    peerCache={selectedKey === entry.key ? peerCache : EMPTY_PEER_CACHE}
                                                    isFull={isFull}
                                                    chainTip={chainTipByChainId[entry.chainId]}
                                                    indexerWatermark={indexerWatermarkByChainId[entry.chainId]}
                                                    walletId={walletId}
                                                    verify={actionVerifyMap[entry.key]}
                                                    showFiatInHistory={showFiatInHistory}
                                                    fiatCurrency={fiatCurrency}
                                                    walletAddresses={walletAddressSet}
                                                    onDismissFailed={dismissFailedPending}
                                                    networkAvailable={browserOnline}
                                                />
                                            ))}
                                            {memberLimit < item.members.length ? (
                                                <li className={styles.groupPagination}>
                                                    <Button
                                                        type="button"
                                                        variant="secondary"
                                                        size="sm"
                                                        icon={null}
                                                        onClick={() => showMoreGroupMembers(
                                                            item.key,
                                                            item.members.length,
                                                        )}
                                                    >
                                                        {t('history.showMoreGroupEntries', {
                                                            shown: Math.min(memberLimit, item.members.length).toLocaleString('en-US'),
                                                            total: item.members.length.toLocaleString('en-US'),
                                                        })}
                                                    </Button>
                                                </li>
                                            ) : null}
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
                            opensDetail={opensDetail}
                            showConnector={connectorByKey.has(entry.key)}
                            onClick={onRowClick}
                            peerCache={selectedKey === entry.key ? peerCache : EMPTY_PEER_CACHE}
                            isFull={isFull}
                            chainTip={chainTipByChainId[entry.chainId]}
                            indexerWatermark={indexerWatermarkByChainId[entry.chainId]}
                            walletId={walletId}
                            verify={actionVerifyMap[entry.key]}
                            showFiatInHistory={showFiatInHistory}
                            fiatCurrency={fiatCurrency}
                            walletAddresses={walletAddressSet}
                            onDismissFailed={dismissFailedPending}
                            networkAvailable={browserOnline}
                        />
                    );
                })}
                        </ul>
                    </li>
                )))}
            </ul>
            {visibleItemCount < groupedItems.length ? (
                <div className={styles.pagination} aria-live="polite">
                    <span className={styles.paginationCount}>
                        {t('history.itemsShown', {
                            shown: Math.min(visibleItemCount, groupedItems.length),
                            total: groupedItems.length,
                        })}
                    </span>
                    <Button
                        type="button"
                        variant="secondary"
                        icon={null}
                        onClick={showMoreItems}
                    >
                        {t('history.showMore')}
                    </Button>
                </div>
            ) : null}
        </ListPage>,
    );
}

/**
 * Collapsed group card (§28.2). Renders a single summary row that
 * expands to reveal its member entries when clicked.
 */
function GroupCard({ item, expanded, onToggle }) {
    const [balancesHidden] = useBalancesHidden();
    const d = chainRegistry.get(item.leader.chainId);
    const isLinkPair = item.subkind === 'link-pair';
    const newest = item.members[0];
    // Only issue-mint group summaries embed a financial amount
    // ("Launched TICK (supply 12345)"); strip the supply parenthetical
    // when privacy mode is on. Other subkinds carry counts or
    // chain-link metadata that aren't amounts.
    const displaySummary = (balancesHidden && item.subkind === 'issue-mint')
        ? stripSupplyParenthetical(item.summary)
        : item.summary;
    const nativeTick = tickerForDescriptor(d || { coin: coinOfChainId(item.leader.chainId) });
    const tick = String(item.leader.raw?.tick ?? item.leader.raw?.TICK ?? nativeTick ?? '?');
    return (
        <ActivityRow
            onClick={onToggle}
            data-history-row
            className={`${styles.row} ${styles.groupCard} ${expanded ? styles.groupCardExpanded : ''}`}
            aria-expanded={expanded}
            chainId={item.leader.chainId}
            tick={tick}
            isNative={tick === nativeTick}
            label={groupBadgeLabel(item.subkind)}
            context={isLinkPair ? 'Linked' : `${item.members.length}`}
            amount={displaySummary}
            status={classifyEntryStatus(item.leader)}
            statusLabels={{
                confirmed: t('history.status.confirmed'),
                failed: t('history.status.failed'),
                pending: t('history.status.pending'),
            }}
            timestamp={newest?.timestamp}
            selected={expanded}
            aria-description={newest?.timestamp
                ? t('history.group.latest', { when: formatTimestamp(newest.timestamp) })
                : undefined}
            trailing={<DoubleChevron direction={expanded ? 'up' : 'down'} />}
        />
    );
}

// Humanized labels (the badge CSS uppercases visually); raw opcodes like
// DISPENSER/ORDER route through the shared display map so the copy stays in
// the house voice if the styling ever changes.
function groupBadgeLabel(subkind) {
    if (subkind === 'issue-mint') return 'Launch';
    if (subkind === 'dispenser-dispense') return actionDisplayLabel('DISPENSER');
    if (subkind === 'order-fills') return actionDisplayLabel('ORDER');
    if (subkind === 'link-pair') return actionDisplayLabel('LINK');
    if (subkind === 'batch') return actionDisplayLabel('BATCH');
    return 'Group';
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

// Drop the "(supply 12345)" tail from an issue-mint group summary when
// privacy mode is on. Matches the format emitted by historyGrouping's
// `summarizeGroup`: anything else is returned unchanged.
function stripSupplyParenthetical(summary) {
    if (typeof summary !== 'string') return summary;
    return summary.replace(/\s*\(supply [^)]+\)\s*$/, '');
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

function listboxOptions(menu) {
    return Array.from(menu?.querySelectorAll('[role="option"]') || [])
        .filter((option) => !option.disabled && option.getAttribute('aria-disabled') !== 'true');
}

function focusListboxOption(menuRef, edge = 'selected') {
    requestAnimationFrame(() => {
        const options = listboxOptions(menuRef.current);
        if (options.length === 0) return;
        if (edge === 'last') {
            options.at(-1)?.focus();
            return;
        }
        const selected = options.find((option) => option.getAttribute('aria-selected') === 'true');
        (selected || options[0])?.focus();
    });
}

function handleListboxKeyDown(event, menuRef, close) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
    }
    const options = listboxOptions(menuRef.current);
    const option = event.target.closest?.('[role="option"]');
    const index = options.indexOf(option);
    if (index < 0) return;
    let next = null;
    if (event.key === 'ArrowDown') next = (index + 1) % options.length;
    if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (next == null) return;
    event.preventDefault();
    options[next]?.focus();
}

function CheckboxPicker({ options, selected, onToggle, allLabel, summaryNoun, iconForId, menuHeader }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);

    const close = () => {
        setOpen(false);
        triggerRef.current?.querySelector('button')?.focus();
    };

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            setOpen(false);
            triggerRef.current?.querySelector('button')?.focus();
        };
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
            <div ref={triggerRef}>
                <Chip
                    pressed={!isAll}
                    className={styles.chainPickerLeft}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                    onKeyDown={(event) => {
                        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                        event.preventDefault();
                        if (!open) setOpen(true);
                        focusListboxOption(menuRef, event.key === 'ArrowUp' ? 'last' : 'selected');
                    }}
                >
                    <span className={styles.chainPickerLeft}>{summary}</span>
                    <SingleChevron direction="down" />
                </Chip>
            </div>
            {open ? (
                <ul
                    ref={menuRef}
                    className={styles.chainPickerMenu}
                    role="listbox"
                    aria-multiselectable="true"
                    onKeyDown={(event) => handleListboxKeyDown(event, menuRef, close)}
                >
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
                                {/* Native options preserve the custom multiselect listbox keyboard model. */}
                                <button
                                    type="button"
                                    className={`${styles.chainPickerOption} ${active ? styles.chainPickerOptionActive : ''}`}
                                    role="option"
                                    aria-selected={active}
                                    onClick={() => onToggle(opt.id)}
                                >
                                    <span aria-hidden="true">{active ? '✓' : '○'}</span>
                                    {icon ? <span className={styles.checkboxOptionIcon} aria-hidden="true">{icon}</span> : null}
                                    <span>{opt.label}</span>
                                </button>
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

/** Format a date N days ago in local time as YYYY-MM-DD for the
 *  native <input type="date"> control. */
/**
 * The date inputs speak in the user's own days. `isoDateDaysAgo` builds its
 * string from LOCAL calendar components and `<input type="date">` shows the
 * user a local day, but `Date.parse('2026-08-27')` is UTC midnight by spec.
 * Reading the two the same way is the whole point of these helpers.
 *
 * The asymmetry was not cosmetic. West of UTC, "today" as a UTC-parsed day
 * ends BEFORE the current moment for as long as the local date lags the UTC
 * date: in US Pacific that is every evening from 17:00 until midnight, and
 * for those seven hours the default 30-day window silently hid everything
 * that had just happened, which is exactly the moment a pending transaction
 * needs to be visible.
 *
 * @param {string} iso  `YYYY-MM-DD`, or empty for no bound
 * @returns {number | null}
 */
function localDayStartMs(iso) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!parts) return null;
    return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 0, 0, 0, 0).getTime();
}

/**
 * End of the local day named by `iso`, inclusive.
 *
 * @param {string} iso
 * @returns {number | null}
 */
function localDayEndMs(iso) {
    const start = localDayStartMs(iso);
    if (start == null) return null;
    const d = new Date(start);
    d.setDate(d.getDate() + 1);
    return d.getTime() - 1;
}

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
    const triggerRef = useRef(null);
    const menuRef = useRef(null);

    const close = () => {
        setOpen(false);
        triggerRef.current?.focus();
    };

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            setOpen(false);
            triggerRef.current?.focus();
        };
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
        close();
    };

    return (
        <div ref={wrapRef} className={styles.chainPickerWrap}>
            {/* A native trigger retains the ref-driven focus handoff for this rich custom listbox. */}
            <button
                ref={triggerRef}
                type="button"
                className={styles.chainPickerBtn}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                    event.preventDefault();
                    if (!open) setOpen(true);
                    focusListboxOption(menuRef, event.key === 'ArrowUp' ? 'last' : 'selected');
                }}
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
                    <span>{selectedDesc ? selectedDesc.displayName : t('common.allNetworks')}</span>
                </span>
                <SingleChevron direction="down" />
            </button>
            {open ? (
                <ul
                    ref={menuRef}
                    className={styles.chainPickerMenu}
                    role="listbox"
                    onKeyDown={(event) => handleListboxKeyDown(event, menuRef, close)}
                >
                    <li>
                        {/* Native options preserve the rich listbox keyboard model. */}
                        <button
                            type="button"
                            role="option"
                            aria-selected={isAll}
                            className={`${styles.chainPickerOption} ${isAll ? styles.chainPickerOptionActive : ''}`}
                            onClick={() => choose('all')}
                        >
                            <span className={styles.chainPickerAllIcon} aria-hidden="true">⛓</span>
                            <span>{t('common.allNetworks')}</span>
                        </button>
                    </li>
                    {activeChainIds.map((cid) => {
                        const d = chainRegistry.get(cid);
                        const isSel = selectedId === cid;
                        return (
                            <li key={cid}>
                                {/* Native options preserve the rich listbox keyboard model. */}
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

const EXPORT_CHUNK_SIZE = 250;

function exportTurn() {
    return new Promise((resolve) => setTimeout(resolve, 16));
}

async function runExport({
    entries, scope, format, columns, fiatCurrency, signal, onProgress,
}) {
    if (!Array.isArray(entries) || entries.length === 0) return false;
    const filename = flowsLib.buildExportFilename({ scope, format });
    const exportedAt = new Date().toISOString();
    const chunks = [];
    let jsonMetadata = null;
    for (let offset = 0; offset < entries.length; offset += EXPORT_CHUNK_SIZE) {
        await exportTurn();
        if (signal?.aborted) return false;
        const slice = entries.slice(offset, offset + EXPORT_CHUNK_SIZE);
        if (format === 'csv') {
            const text = flowsLib.entriesToCsv(slice, { columns, fiatCurrency });
            const firstBreak = text.indexOf('\n');
            chunks.push(offset === 0 ? text : text.slice(firstBreak + 1));
        } else {
            const payload = JSON.parse(flowsLib.entriesToJson(slice, {
                scope,
                columns,
                fiatCurrency,
                exportedAt,
            }));
            if (!jsonMetadata) {
                jsonMetadata = { ...payload };
                delete jsonMetadata.entries;
            }
            chunks.push(...payload.entries.map((entry) => (
                JSON.stringify(entry, null, 2)
                    .split('\n')
                    .map((line) => `    ${line}`)
                    .join('\n')
            )));
        }
        if (onProgress) onProgress(Math.min(offset + slice.length, entries.length));
    }
    if (signal?.aborted) return false;
    let fileContent;
    if (format === 'csv') {
        fileContent = chunks.join('');
    } else {
        const metadataText = JSON.stringify(jsonMetadata, null, 2);
        fileContent = `${metadataText.slice(0, -2)},\n  "entries": [\n${chunks.join(',\n')}\n  ]\n}`;
    }
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
    return true;
}

/* ───── Cluster I FOLLOWUP 5 - export modal ───────────────────────── */

const MODAL_SCRIM = {
    position: 'fixed',
    inset: 0,
    padding: 'env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)',
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
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-3)',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.25)',
};

const MODAL_BODY = {
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-3)',
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

const MODAL_ACTIONS = {
    display: 'flex',
    flex: '0 0 auto',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 'var(--xc-space-2)',
};

const EXPORT_DIALOG_COLUMN_LABELS = Object.freeze({
    actionIndex: 'Action number',
    txHash: 'Transaction ID',
    blockIndex: 'Block',
    iso: 'Date and time (UTC)',
    source: 'From',
});

function ExportModal({
    onClose,
    format, setFormat,
    columns, setColumns,
    fiatCurrency,
    visibleCount,
    exporting,
    progress,
    operationTime,
    error,
    onConfirm,
}) {
    // Opened by the 'e' key or its button: focus moves in, Tab stays in, and
    // closing hands focus back to the opener.
    const dialogRef = useRef(null);
    useFocusTrap(dialogRef, { active: true });
    useBackHandler(onClose);
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

    return (
        <div
            style={MODAL_SCRIM}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            role="presentation"
            tabIndex={-1}
        >
            <div
                ref={dialogRef}
                style={MODAL_CARD}
                role="dialog"
                aria-modal="true"
                aria-labelledby="xc-history-export-title"
            >
                <SectionHeader id="xc-history-export-title" title={t('history.export.title')} />

                <div style={MODAL_BODY}>
                    <RadioGroup
                        style={MODAL_FIELDSET}
                        legend={t('history.export.format')}
                        name="export-format"
                        value={format}
                        onChange={setFormat}
                        disabled={exporting}
                        options={[
                            { value: 'csv', label: t('history.export.csv') },
                            { value: 'json', label: t('history.export.json') },
                        ]}
                    />

                    <fieldset style={MODAL_FIELDSET}>
                        <legend style={MODAL_LEGEND}>{t('history.export.columns')}</legend>
                        {flowsLib.EXPORT_COLUMNS.map((col) => {
                            const detail = flowsLib.EXPORT_COLUMN_DETAILS[col];
                            const dialogLabel = EXPORT_DIALOG_COLUMN_LABELS[col] || detail.label;
                            const label = col === 'fiatCurrency'
                                ? `${dialogLabel} (${String(fiatCurrency || 'USD').trim().toUpperCase()})`
                                : dialogLabel;
                            return (
                                <Checkbox
                                    key={col}
                                    label={label}
                                    description={detail.description}
                                    title={detail.description}
                                    checked={columns.has(col)}
                                    onChange={() => toggleColumn(col)}
                                    disabled={exporting}
                                />
                            );
                        })}
                    </fieldset>

                    <p style={{ margin: 0, fontSize: 'var(--xc-text-sm)' }}>
                        {t('history.export.rowCount', { count: visibleCount })}
                    </p>

                    {exporting ? (
                        <StatusMessage variant="info">
                            {t('history.export.progress', {
                                completed: progress.completed,
                                total: progress.total,
                            })}
                            {operationTime.showElapsed
                                ? ` ${t('history.export.elapsed', { seconds: operationTime.elapsedSeconds })}`
                                : ''}
                        </StatusMessage>
                    ) : null}
                    {operationTime.timedOut ? (
                        <StatusMessage variant="warning" role="alert">{t('history.export.slow')}</StatusMessage>
                    ) : null}
                    <StatusMessage variant="error">{error}</StatusMessage>
                </div>

                <div style={MODAL_ACTIONS}>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={onConfirm}
                        disabled={exporting || visibleCount === 0 || columns.size === 0}
                    >
                        {exporting ? t('history.export.preparing') : t('history.export.confirm')}
                    </Button>
                </div>
            </div>
        </div>
    );
}
