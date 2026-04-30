import { useEffect, useMemo, useState } from 'react';
import { Screen, Button, ChainBadge, Icon, Skeleton } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    isEntryReplaceable,
    replaceFromHistoryEntry,
    RbfNotSupportedError,
    RbfInvalidEntryError,
} from '../../flows/rbfReplace.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { EmptyStateNudge } from '../components/EmptyStateNudge.jsx';
import { useToast } from '../components/ToastHost.jsx';
import { groupHistoryEntries } from '../utils/historyGrouping.js';
import { TxStatusTimeline } from '../components/TxStatusTimeline.jsx';
import { StalenessLabel } from '../components/StalenessLabel.jsx';
import { flows as flowsLib } from '@xchain-wallet/core';
import {
    applyHistoryFilters,
    ACTION_TYPE_OPTIONS,
    STATUS_OPTIONS,
} from '../utils/historyFilter.js';
import { readChainSet, writeChainSet } from '../utils/chainFilterMemory.js';
import styles from './History.module.css';

const HISTORY_CHAIN_FILTER_KEY = 'history';

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
 * History route — §23 unified timeline + §23.5 cross-chain thread
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
 *   - "Cross-chain only" — keep only entries that are part of a LINK
 *     pairing (regardless of whether both peers are in the result set)
 *
 * Wallet addresses are resolved up-front via
 * `messaging.getAddressesByChain(walletId)`. Per (chain, address) we
 * fan out two parallel reads — `getAddressHistory` + `getLinksForAddress`
 * — and merge into a flat `entries` list with `linkIdx` pointing at
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
 */
export function History({ walletId, accountId, onBack, onReceive, initialSearchQuery = '' }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const { showToast } = useToast();

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [entries, setEntries] = useState(/** @type {HistoryEntry[]} */ ([]));
    // Cluster G FOLLOWUP 5 — Unix ms of the last successful per-chain
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
    const [groupingMode, setGroupingMode] = useState(/** @type {'grouped' | 'flat'} */ ('grouped'));
    const [expandedGroups, setExpandedGroups] = useState(/** @type {Set<string>} */ (new Set()));
    const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
    const [actionTypeFilter, setActionTypeFilter] = useState(/** @type {Set<string>} */ (new Set()));
    const [statusFilter, setStatusFilter] = useState(/** @type {Set<string>} */ (new Set()));
    const [dateFrom, setDateFrom] = useState(/** @type {string} */ (''));
    const [dateTo, setDateTo] = useState(/** @type {string} */ (''));
    const [moreFiltersOpen, setMoreFiltersOpen] = useState(Boolean(initialSearchQuery));
    // Cluster I FOLLOWUP 5 — single-modal export. Holds the modal's
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

    // Step 1 — resolve the wallet's addresses grouped by chainId.
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
                // §23.5 / G052 — restore the user's last chain-filter
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
    }, [walletId, accountId, messaging]);

    // §22 Multisig-only filter (Step 22). Resolve the wallet's
    // multisig receive address up-front so the chip can filter
    // entries by exact match without re-running deriveMultisigAddress
    // on every render. Best-effort — silently leaves the chip
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
            .catch(() => { /* no multisig configured — chip stays disabled */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Step 2 — fan out history + links per (chain, address). Merge
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

        // Cluster J FOLLOWUP 1 — for the demo wallet, replace the SDK
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
                    ]).then(([history, links]) => ({
                        chainId: cid,
                        address: a.address,
                        history,
                        links,
                    })),
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

    // Cluster I FOLLOWUP 6 — Per-chain tip used to compute confirmation
    // counts on confirmed rows. Derived from the highest blockIndex
    // seen across loaded history rows (lower bound for the chain tip,
    // since the wallet has no dedicated tip endpoint yet — explorer's
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

    const toggleGroupExpanded = (groupKey) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupKey)) next.delete(groupKey);
            else next.add(groupKey);
            return next;
        });
    };

    const toggleChain = (cid) => {
        // §23.5 / G052 — persist the new filter set so the user's
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
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back to home"
            >
                <Icon.BackIcon />
            </button>
            <span className={styles.title}>History</span>
            <span className={styles.spacer} />
        </div>
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
            <div className={styles.filterBar} role="group" aria-label="History filters">
                <span className={styles.filterLabel}>Chains</span>
                {activeChainIds.map((cid) => {
                    const d = chainRegistry.get(cid);
                    const active = enabledChains.has(cid);
                    return (
                        <button
                            key={cid}
                            type="button"
                            onClick={() => toggleChain(cid)}
                            className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                            aria-pressed={active}
                        >
                            {d ? <ChainBadge descriptor={d} size="sm" /> : null}
                            <span>{d?.displayName || cid}</span>
                        </button>
                    );
                })}
                <span className={styles.divider} aria-hidden="true" />
                <button
                    type="button"
                    onClick={() => setCrossChainOnly((v) => !v)}
                    className={`${styles.chip} ${styles.chipCrossChain} ${crossChainOnly ? styles.chipActive : ''}`}
                    aria-pressed={crossChainOnly}
                    title="Show only entries that are one side of a LINK pairing (§23.5)."
                >
                    🔗 Cross-chain actions
                </button>
                <button
                    type="button"
                    onClick={() => setMultisigOnly((v) => !v)}
                    disabled={!multisigAddress}
                    className={`${styles.chip} ${styles.chipCrossChain} ${multisigOnly ? styles.chipActive : ''}`}
                    aria-pressed={multisigOnly}
                    title={multisigAddress
                        ? 'Show only entries on this wallet\'s multisig address (§22).'
                        : 'No multisig address configured for this wallet.'}
                >
                    🔐 Multisig only
                </button>
                <span className={styles.divider} aria-hidden="true" />
                <button
                    type="button"
                    onClick={() => setGroupingMode((m) => (m === 'grouped' ? 'flat' : 'grouped'))}
                    className={`${styles.chip} ${groupingMode === 'grouped' ? styles.chipActive : ''}`}
                    aria-pressed={groupingMode === 'grouped'}
                    title="Collapse related actions (issuance + mints, dispenser + dispenses, order + fills) into a single expandable card (§28.2)."
                >
                    {groupingMode === 'grouped' ? 'Grouped' : 'Flat'}
                </button>
                <span className={styles.divider} aria-hidden="true" />
                <button
                    type="button"
                    onClick={() => {
                        // Pre-fill date range from the active filter so
                        // the modal is "ready to go" if the user just
                        // wants to export what's on screen.
                        setExportFromDate(dateFrom);
                        setExportToDate(dateTo);
                        setExportScope('filtered');
                        setExportModalOpen(true);
                    }}
                    disabled={entries.length === 0}
                    className={styles.chip}
                    title="Export history with format / column / date-range options (§28.5)."
                    aria-haspopup="dialog"
                    aria-expanded={exportModalOpen}
                >
                    Export…
                </button>
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

            <div className={styles.searchRow}>
                <input
                    type="search"
                    className={styles.searchInput}
                    placeholder="Search action, address, token, txid, memo…"
                    aria-label="Search history"
                    value={searchQuery}
                    onChange={(ev) => setSearchQuery(ev.target.value)}
                />
                <button
                    type="button"
                    className={`${styles.chip} ${moreFiltersOpen ? styles.chipActive : ''}`}
                    onClick={() => setMoreFiltersOpen((v) => !v)}
                    aria-expanded={moreFiltersOpen}
                    aria-controls="history-more-filters"
                >
                    More filters
                    {filtersActive ? <span className={styles.filterBadge} aria-hidden="true">•</span> : null}
                </button>
                {filtersActive ? (
                    <button
                        type="button"
                        className={styles.clearLink}
                        onClick={clearAllFilters}
                    >
                        Clear
                    </button>
                ) : null}
            </div>

            {moreFiltersOpen ? (
                <div
                    id="history-more-filters"
                    className={styles.morePanel}
                    role="group"
                    aria-label="Advanced filters"
                >
                    <fieldset className={styles.fieldset}>
                        <legend className={styles.legend}>Action types</legend>
                        <div className={styles.checkboxGrid}>
                            {ACTION_TYPE_OPTIONS.map((opt) => (
                                <label key={opt.id} className={styles.checkLabel}>
                                    <input
                                        type="checkbox"
                                        checked={actionTypeFilter.has(opt.id)}
                                        onChange={() => toggleSetMember(setActionTypeFilter)(opt.id)}
                                    />
                                    {opt.label}
                                </label>
                            ))}
                        </div>
                    </fieldset>

                    <fieldset className={styles.fieldset}>
                        <legend className={styles.legend}>Status</legend>
                        <div className={styles.statusChips}>
                            {STATUS_OPTIONS.map((opt) => {
                                const active = statusFilter.has(opt.id);
                                return (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => toggleSetMember(setStatusFilter)(opt.id)}
                                        className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                                        aria-pressed={active}
                                    >
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
                    </fieldset>

                    <fieldset className={styles.fieldset}>
                        <legend className={styles.legend}>Date range</legend>
                        <div className={styles.dateRow}>
                            <label className={styles.dateLabel}>
                                From
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={(ev) => setDateFrom(ev.target.value)}
                                />
                            </label>
                            <label className={styles.dateLabel}>
                                To
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={(ev) => setDateTo(ev.target.value)}
                                />
                            </label>
                        </div>
                    </fieldset>
                </div>
            ) : null}

            {loadingChains.size > 0 ? (
                <div role="status" aria-label="Loading history">
                    <Skeleton.List rows={Math.max(3, loadingChains.size)} />
                </div>
            ) : null}

            {historyFetchedAt && loadingChains.size === 0 ? (
                <div className={styles.stalenessRow}>
                    <StalenessLabel
                        lastSyncedAt={historyFetchedAt}
                        warnAfterMs={5 * 60_000}
                    />
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
                                            />
                                        ))}
                                    </ul>
                                ) : null}
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
function DetailCard({ entry, peerCache, chainTip }) {
    const isLinked = Boolean(entry.link);
    const peerKey = entry.link?.peerChainId && entry.link?.peerActionIndex
        ? peerCacheKey(entry.link.peerChainId, entry.link.peerActionIndex)
        : null;
    const peer = peerKey ? peerCache[peerKey] : null;
    const replaceable = isEntryReplaceable(entry);

    return (
        <div className={`${styles.detail} ${isLinked ? styles.detailDual : ''}`} role="region" aria-label="Action detail">
            <div className={styles.detailSide}>
                <span className={styles.detailSideTitle}>
                    This side · {entry.action} #{entry.actionIndex}
                </span>
                <TxStatusTimeline entry={entry} chainTip={chainTip} />
                <pre className={styles.detailDecoded}>
                    {decodeActionToText(entry.raw)}
                </pre>
                <SaveContactPrompt entry={entry} />
                {replaceable.ok ? <RbfActions entry={entry} /> : null}
            </div>
            {isLinked ? (
                <div className={styles.detailSide}>
                    <span className={styles.detailSideTitle}>
                        Peer · {entry.link.peerCoinTicker}
                        {' '}#{entry.link.peerActionIndex}
                    </span>
                    {peer?.loading ? (
                        <p className={styles.empty}>Loading peer ACTION…</p>
                    ) : peer?.error ? (
                        <p className={styles.error}>Couldn't load peer: {peer.error}</p>
                    ) : peer?.action ? (
                        <pre className={styles.detailDecoded}>
                            {decodeActionToText(peer.action)}
                        </pre>
                    ) : (
                        <p className={styles.empty}>
                            Peer chain not bundled in this wallet — open the
                            block explorer for {entry.link.peerCoinTicker} to
                            view {entry.link.peerCoinTicker} #{entry.link.peerActionIndex}.
                        </p>
                    )}
                </div>
            ) : null}
        </div>
    );
}

/**
 * §31.4 — Auto-suggest from history. When a history entry has a peer
 * address (destination on a SEND, source on a RECEIVE) that isn't
 * already saved as a contact and isn't the wallet's own address,
 * surface a "Save as contact" affordance so the user can add it
 * without leaving History.
 *
 * Fetches contacts on first mount and caches across re-renders so
 * scrolling through several entries doesn't refetch repeatedly.
 * Failure modes degrade silently — the prompt just doesn't show.
 *
 * @param {{ entry: any }} props
 */
function SaveContactPrompt({ entry }) {
    const { messaging } = useMessaging();
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    const [loaded, setLoaded] = useState(false);
    const [stage, setStage] = useState(/** @type {'idle' | 'editing' | 'saving' | 'saved'} */ ('idle'));
    const [name, setName] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => {
                if (cancelled) return;
                setContacts(Array.isArray(rows) ? rows : []);
                setLoaded(true);
            })
            .catch(() => { if (!cancelled) setLoaded(true); });
        return () => { cancelled = true; };
    }, [messaging]);

    if (!loaded) return null;

    const peer = peerAddressOfEntry(entry);
    if (!peer) return null;
    if (entry?.address && peer === entry.address) return null;

    const isAlreadyContact = contacts.some((c) =>
        Array.isArray(c?.entries) && c.entries.some((e) => e?.address === peer),
    );
    if (isAlreadyContact) return null;
    if (stage === 'saved') return null;

    const coin = coinOfChainId(entry.chainId);
    if (!coin) return null;

    async function handleSave(event) {
        event.preventDefault();
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
                    entries: [{ chain: coin, address: peer, label: '' }],
                },
            });
            setStage('saved');
        } catch (err) {
            setError(err?.message || 'Save failed.');
            setStage('editing');
        }
    }

    if (stage === 'idle') {
        return (
            <div className={styles.saveContactRow}>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setStage('editing')}
                >
                    Save as contact
                </Button>
            </div>
        );
    }

    return (
        <form className={styles.saveContactForm} onSubmit={handleSave}>
            <label className={styles.saveContactLabel}>
                Name
                <input
                    type="text"
                    className={styles.saveContactInput}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    maxLength={80}
                />
            </label>
            {error ? (
                <p className={styles.saveContactError} role="alert">{error}</p>
            ) : null}
            <div className={styles.saveContactActions}>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setStage('idle'); setName(''); setError(null); }}
                    disabled={stage === 'saving'}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={stage === 'saving'}
                >
                    Save
                </Button>
            </div>
        </form>
    );
}

/**
 * Pull the peer-side address out of a history entry. Cluster O
 * FOLLOWUP 2 — extended to action-kind-aware extractors so MESSAGE
 * incoming rows and ORDER_MATCH fill rows surface a usable counterparty
 * (the v0.207.0 implementation only handled the SEND case cleanly —
 * RECEIVE / MESSAGE-incoming / fill rows fell through to either a
 * self-address or null).
 *
 * Returns null when no salient peer address is on the row payload —
 * the caller suppresses the prompt.
 *
 * Unsupported on-row today, deferred to a future FOLLOWUP that fetches
 * derived data:
 *   - DIVIDEND recipients are computed at runtime from holders of the
 *     dividend's TICK at the snapshot block. The row itself does not
 *     carry the recipient list. Surfacing "Save N recipients" here
 *     needs a `messaging.getDividendRecipients({ chainId, actionIndex })`
 *     host method that walks the holders table or the per-recipient
 *     dispense rows, which doesn't exist yet.
 *   - AIRDROP is similar — the row carries TICK + AMOUNT but the
 *     recipients are derived from a LIST action's contents.
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
    // shapes use different field names — try them in priority order.
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

    // SEND / RECEIVE / MESSAGE / generic — destination if it isn't
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
 * §29.9 / §44.4 RBF actions — Speed up + Cancel buttons for pending
 * (mempool-only) coin-moving entries. Replacement engine wiring is
 * §44.4 / §44.5 SDK / encoder work; until that lands, the messaging
 * layer surfaces an honest "RBF replacement is not supported by this
 * build" error and we render it inline.
 */
function RbfActions({ entry }) {
    const { messaging } = useMessaging();
    const [busy, setBusy] = useState(/** @type {'speedup' | 'cancel' | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [done, setDone] = useState(/** @type {string | null} */ (null));

    const run = async (strategy) => {
        if (busy) return;
        setBusy(strategy);
        setError(null);
        setDone(null);
        try {
            const res = await replaceFromHistoryEntry({
                messaging,
                entry,
                strategy,
            });
            setDone(`Replacement broadcast: ${res?.replacementTxHash || 'pending'}`);
        } catch (err) {
            if (err instanceof RbfNotSupportedError) {
                setError(err.message);
            } else if (err instanceof RbfInvalidEntryError) {
                setError(err.message);
            } else {
                setError(err?.message || 'Replacement failed.');
            }
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className={styles.rbfActions}>
            <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={busy === 'speedup'}
                disabled={busy !== null}
                onClick={() => run('speedup')}
            >
                Speed up
            </Button>
            <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={busy === 'cancel'}
                disabled={busy !== null}
                onClick={() => run('cancel')}
            >
                Cancel
            </Button>
            {error ? (
                <p className={styles.rbfError} role="alert">{error}</p>
            ) : null}
            {done ? (
                <p className={styles.rbfDone} role="status">{done}</p>
            ) : null}
        </div>
    );
}

/**
 * One history row. Used both for top-level entries and for member rows
 * inside an expanded group card.
 */
function EntryRow({ entry, selected, showConnector, onClick, peerCache, isFull, chainTip }) {
    const d = chainRegistry.get(entry.chainId);
    return (
        <li>
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
                    {d ? <ChainBadge descriptor={d} size="sm" /> : null}
                    <span className={styles.actionBadge}>{entry.action}</span>
                    {entry.link ? (
                        <span
                            className={styles.crosschainBadge}
                            title={`Linked to ${entry.link.peerCoinTicker} #${entry.link.peerActionIndex}`}
                        >
                            🔗
                        </span>
                    ) : null}
                </span>
                <span className={styles.rowSummary}>
                    {summarizeRow(entry.raw, entry.action)}
                </span>
                <span className={styles.rowMeta}>
                    {entry.blockIndex ? `Block ${entry.blockIndex}` : 'unconfirmed'}
                    {' · '}
                    {entry.timestamp ? formatTimestamp(entry.timestamp) : '—'}
                    {entry.source ? ` · ${shorten(entry.source)}` : ''}
                </span>
            </button>
            {selected ? (
                <DetailCard entry={entry} peerCache={peerCache} isFull={isFull} chainTip={chainTip} />
            ) : null}
        </li>
    );
}

/**
 * Collapsed group card (§28.2). Renders a single summary row that
 * expands to reveal its member entries when clicked.
 */
function GroupCard({ item, expanded, onToggle }) {
    const d = chainRegistry.get(item.leader.chainId);
    // §28.3 — link-pair groups span two chains; surface both badges so
    // the user sees the cross-chain relationship without expanding.
    // Other subkinds keep their single-chain header.
    const isLinkPair = item.subkind === 'link-pair';
    const peer = isLinkPair ? item.members[0] : null;
    const peerDescriptor = peer ? chainRegistry.get(peer.chainId) : null;
    const newest = item.members[0];
    return (
        <button
            type="button"
            onClick={onToggle}
            className={`${styles.row} ${styles.groupCard} ${expanded ? styles.groupCardExpanded : ''}`}
            aria-expanded={expanded}
        >
            <span className={styles.rowHeader}>
                {d ? <ChainBadge descriptor={d} size="sm" /> : null}
                {isLinkPair && peerDescriptor && peerDescriptor !== d ? (
                    <>
                        <span className={styles.linkPairConnector} aria-hidden="true">↔</span>
                        <ChainBadge descriptor={peerDescriptor} size="sm" />
                    </>
                ) : null}
                <span className={styles.actionBadge}>{groupBadgeLabel(item.subkind)}</span>
                {!isLinkPair ? (
                    <span className={styles.groupCount}>{item.members.length}</span>
                ) : null}
            </span>
            <span className={styles.rowSummary}>{item.summary}</span>
            <span className={styles.rowMeta}>
                {newest?.timestamp ? `Latest ${formatTimestamp(newest.timestamp)}` : '—'}
                {' · '}
                <span className={styles.groupExpand} aria-hidden="true">
                    {expanded ? 'Hide details ▾' : 'Show details ▸'}
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

function peerCacheKey(chainId, actionIndex) {
    return `${chainId}:${actionIndex}`;
}

function shorten(addr) {
    if (!addr || addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatTimestamp(ts) {
    if (!ts) return '—';
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toISOString().replace('T', ' ').replace(/\..*/, ' UTC');
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

function chainScopeLabel(enabledChains, activeChainIds) {
    if (!enabledChains) return 'all';
    const total = activeChainIds.length;
    if (enabledChains.size === 0 || enabledChains.size === total) return 'all';
    return Array.from(enabledChains).sort().join('+');
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

/* ───── Cluster I FOLLOWUP 5 — export modal ───────────────────────── */

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
                        />
                    </label>
                    <label style={MODAL_LABEL}>
                        To
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            style={{ marginLeft: 'auto' }}
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
