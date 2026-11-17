// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { AddressText, Button, EmptyState, Icon, ListPage, ListRow, PageHeader, Screen, SegmentedControl, Select, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import * as branding from '../../branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useWalletSource } from '../hooks/useDemoGuard.jsx';
// The standard list filter, on the title line.
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { OfflineEmptyState } from '../components/OfflineEmptyState.jsx';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { coinFromChainId, isAssetImageSourceAllowed, tickerColor } from '../components/BalanceList.jsx';
import { useOracleFeeds } from '../hooks/useOracleFeeds.js';
import { useSettings } from '../hooks/useSettings.js';
import { dispenserRateLabel } from '../utils/dispenserPricing.js';
import { TickerIcon } from '../components/TickerIcon.jsx';
import {
    CHAIN_TIME_REFRESH_MS, chainClockFromTipRead, dispenserCancelTimestamp, dispenserCloseEta,
} from '../utils/dispenserCloseWindow.js';
import { dispenserStatusLabel } from '../utils/dispenserReopen.js';
import { startVisibleInterval } from '../utils/visibleInterval.js';
import {
    LIST_DETAIL_MIN_WIDTH, ListDetailSplit, listDetailStyles, useWideContent,
} from '../components/PanelSplit.jsx';
import styles from './ActionsMenu.module.css';
import local from './DispensersList.module.css';
import marketsStyles from './MarketsList.module.css';

const chainRegistry = registryLib.defaultRegistry();
const DISPENSER_REFRESH_MS = 20000;

/**
 * Dispensers marketplace and owner-facing list view.
 *
 * Loads every dispenser this wallet's addresses have opened, grouped by
 * chain. Each entry links to DispenserDetail for management (cancel /
 * edit). Explorer-side data is still thin (no live escrow balance / fill
 * count); the row surfaces what's available and defers live state to
 * the detail page.
 *
 * Indexer TODO at `xchain-explorer/src/db.js` `getDispensers()`: once
 * escrow balance + dispense count land, this component can surface
 * "remaining fills" inline; for now that detail waits for the detail
 * page.
 *
 * Scoped to the active account: only that account's addresses are
 * unioned over, so the list shows the dispensers opened under the
 * account currently selected in the switcher.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.activeAccountId]   scope the address union to this account
 * @param {(chainId: string, actionIndex: string) => void} props.onOpenDispenser
 * @param {() => void} [props.onCreateDispenser]  opens the Create dispenser form
 * @param {() => void} props.onBack
 * @param {{ chainId: string, actionIndex: string } | null} [props.selectedDispenser]
 * @param {(ref: { chainId: string, actionIndex: string } | null) => void} [props.onSelectDispenser]
 * @param {(ref: { chainId: string, actionIndex: string }) => import('react').ReactNode} [props.renderDispenser]
 * @param {(ref: { chainId: string, actionIndex: string }, page: { measureRef: (el: HTMLElement | null) => void }) => import('react').ReactNode} [props.renderDispenserPage]
 * @param {{ chainId: string, tick: string, displayName?: string, kind?: string } | null} [props.marketAsset]
 * @param {() => void} [props.onChangeMarket]
 */
export function DispensersList({
    walletId,
    activeAccountId,
    onOpenDispenser,
    onCreateDispenser,
    onBack,
    selectedDispenser = null,
    onSelectDispenser,
    renderDispenser,
    renderDispenserPage,
    marketAsset = null,
    onChangeMarket,
}) {
    const { shell } = useMessaging();
    const source = useWalletSource(walletId);
    const { messaging } = source;
    const variant = screenVariantFor(shell);
    const { offline, recheck } = useNetworkOffline({ walletId });
    const { settings } = useSettings();
    const allowRemoteImages = Boolean(settings)
        && settings.privacy?.metadataFetchEnabled !== false;
    const canSplit = typeof renderDispenser === 'function';
    const [layoutRef, wideContent, measured] = useWideContent(LIST_DETAIL_MIN_WIDTH, canSplit);
    const twoPanel = canSplit && wideContent;
    const detailRoute = typeof renderDispenserPage === 'function' && Boolean(selectedDispenser);
    const listShown = !detailRoute || (measured && twoPanel);
    const marketReadSupported = typeof messaging.getDispensersForToken === 'function';
    const [view, setView] = useState(detailRoute || !marketReadSupported || !marketAsset ? 'mine' : 'all');
    const [marketSide, setMarketSide] = useState('buy');
    const [localPick, setLocalPick] = useState(
        /** @type {{ chainId: string, actionIndex: string } | null} */ (null),
    );

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [addressesError, setAddressesError] = useState(
        /** @type {string | null} */ (null),
    );
    const [dispensersByChain, setDispensersByChain] = useState(
        /** @type {Record<string, { loading: boolean, rows: any[], error: string | null }>} */ ({}),
    );
    const [addressesReload, setAddressesReload] = useState(0);
    const [dispensersReload, setDispensersReload] = useState(0);
    const [marketReload, setMarketReload] = useState(0);
    const [marketState, setMarketState] = useState(
        /** @type {{ key: string, loading: boolean, rows: any[], error: string | null }} */ (
            { key: '', loading: false, rows: [], error: null }
        ),
    );
    // In-page filters: free-text search + network dropdown, mirroring the
    // contacts / messaging toolbars.
    const [query, setQuery] = useState('');
    const [network, setNetwork] = useState('all');
    // Status and Sort live in the title-line filter panel.
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortBy, setSortBy] = useState('newest');
    // Cancel block times of closing dispensers, keyed `chainId:actionIndex`.
    const [cancelTimes, setCancelTimes] = useState(/** @type {Record<string, number>} */ ({}));
    const [nowMs, setNowMs] = useState(() => Date.now());
    // Each chain's protocol time, the clock the close window is judged by,
    // keyed by chainId: one read per chain with a closing row, never per row.
    const [chainClocks, setChainClocks] = useState(
        /** @type {Record<string, null | { chainTime: number, chainTimeReadAtMs: number }>} */ ({}),
    );

    // Lifecycle changes land independently of this route. Refreshing on the
    // standard wallet cadence lets an open row become closing or terminal as
    // soon as the explorer indexes the owner transaction.
    useEffect(() => {
        if (!source.live || offline || !listShown) return undefined;
        return startVisibleInterval(
            () => {
                if (view === 'all') setMarketReload((value) => value + 1);
                else if (addressesByChain) setDispensersReload((value) => value + 1);
            },
            DISPENSER_REFRESH_MS,
        );
    }, [addressesByChain, source.live, offline, listShown, view]);

    useEffect(() => {
        if (!listShown || view !== 'mine') return undefined;
        let cancelled = false;
        setAddressesByChain(null);
        setAddressesError(null);
        messaging.getAddressesByChain(walletId, activeAccountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
            })
            .catch(() => {
                if (!cancelled) setAddressesError('Could not load addresses. Try again.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, activeAccountId, addressesReload, listShown, view]);

    const marketKey = marketAsset?.chainId && marketAsset?.tick
        ? `${marketAsset.chainId}:${String(marketAsset.tick).toUpperCase()}`
        : '';
    const nativeMarketUnsupported = view === 'all' && marketAsset?.kind === 'native';
    useEffect(() => {
        if (!listShown || view !== 'all' || !marketKey || nativeMarketUnsupported || offline) return undefined;
        let cancelled = false;
        setMarketState({ key: marketKey, loading: true, rows: [], error: null });
        messaging.getDispensersForToken({
            chainId: marketAsset.chainId,
            token: String(marketAsset.tick).toUpperCase(),
        }).then((response) => {
            if (cancelled) return;
            setMarketState({
                key: marketKey,
                loading: false,
                rows: extractRows(response).map((row) => ({ ...row, chainId: marketAsset.chainId })),
                error: null,
            });
        }).catch(() => {
            if (!cancelled) {
                setMarketState({
                    key: marketKey,
                    loading: false,
                    rows: [],
                    error: 'Could not load market dispensers. Try again.',
                });
            }
        });
        return () => { cancelled = true; };
    }, [listShown, view, marketKey, nativeMarketUnsupported, offline, marketReload, messaging, marketAsset?.chainId, marketAsset?.tick]);

    // Local labels for this account's dispenser sub-addresses (role=2
    // branch), keyed by address. A dispenser row whose on-chain dispenser
    // address matches one of these shows the wallet's own label.
    const dispenserLabels = useMemo(() => {
        /** @type {Record<string, string>} */
        const map = {};
        if (!addressesByChain) return map;
        for (const list of Object.values(addressesByChain)) {
            for (const a of (list || [])) {
                if (a.role === 'dispenser' && a.address && a.label) map[a.address] = a.label;
            }
        }
        return map;
    }, [addressesByChain]);

    const chainsWithAddresses = useMemo(() => {
        if (!addressesByChain) return [];
        return Object.entries(addressesByChain)
            .filter(([, rows]) => Array.isArray(rows)
                && rows.some((row) => typeof row?.address === 'string' && row.address.length > 0))
            .map(([chainId]) => chainId);
    }, [addressesByChain]);

    // Phase 2: for each chain with addresses, fan out one explorer
    // query per address and merge the results. A per-chain error
    // surfaces inline; other chains keep loading.
    useEffect(() => {
        if (!addressesByChain) return;
        const chains = chainsWithAddresses;
        if (chains.length === 0) return;
        // Offline the reads cannot finish; rows already shown stay, and the
        // dispensers load again when the connection returns.
        if (offline) return;

        setDispensersByChain((previous) => {
            const initial = {};
            for (const cid of chains) {
                initial[cid] = {
                    loading: true,
                    rows: previous[cid]?.rows || [],
                    error: null,
                };
            }
            return initial;
        });

        let cancelled = false;

        for (const cid of chains) {
            const addrs = (addressesByChain[cid] || [])
                .map((a) => a.address)
                .filter((address) => typeof address === 'string' && address.length > 0);
            if (addrs.length === 0) {
                if (!cancelled) {
                    setDispensersByChain((prev) => ({
                        ...prev,
                        [cid]: { loading: false, rows: [], error: null },
                    }));
                }
                continue;
            }

            Promise.all(addrs.map((addr) =>
                messaging.getDispensersForSource({ chainId: cid, address: addr })
                    .then((resp) => ({ addr, rows: extractRows(resp) }))
                    .catch((err) => ({ addr, error: err?.message || String(err) }))
            )).then((results) => {
                if (cancelled) return;
                /** @type {any[]} */
                const merged = [];
                const errs = [];
                for (const r of results) {
                    if (r.error) errs.push(`${short(r.addr)}: ${r.error}`);
                    else merged.push(...r.rows);
                }
                // De-dupe by action_index in case an address appears twice.
                const seen = new Set();
                const uniq = merged.filter((row) => {
                    const key = String(row.action_index ?? row.tx_hash ?? JSON.stringify(row));
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                uniq.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
                setDispensersByChain((prev) => ({
                    ...prev,
                    [cid]: {
                        loading: false,
                        rows: uniq,
                        error: errs.length > 0 ? errs.join('; ') : null,
                    },
                }));
                // The list lane carries no cancel time, so a closing row's
                // countdown needs the cancels feed. It is keyed by the cancelling
                // address (the creator or the dispenser address), so it is read
                // once per distinct address of a closing row, never per row, and
                // not at all when nothing is closing.
                const closing = uniq.filter((row) => flowsLib.dispenserLiveState(row).status === 'cancelling');
                if (closing.length === 0 || typeof messaging.getDispenserLifecycle !== 'function') return;
                const cancelAddrs = [...new Set(closing.flatMap((row) => [row.source, row.address]).filter(Boolean))];
                Promise.all(cancelAddrs.map((addr) => messaging
                    .getDispenserLifecycle({ chainId: cid, kind: 'cancels', query: addr, type: 'address' })
                    .then((r) => extractRows(r))
                    .catch(() => [])))
                    .then((lists) => {
                        if (cancelled) return;
                        const cancelRows = lists.flat();
                        const found = {};
                        for (const row of closing) {
                            const ts = dispenserCancelTimestamp(cancelRows, row.action_index);
                            if (ts != null) found[`${cid}:${row.action_index}`] = ts;
                        }
                        if (Object.keys(found).length > 0) setCancelTimes((prev) => ({ ...prev, ...found }));
                    });
            });
        }
        return () => { cancelled = true; };
    }, [addressesByChain, chainsWithAddresses, messaging, dispensersReload, offline]);
    // Re-render once a minute while any closing row shows a countdown, and
    // re-read the protocol time of each chain with one, at most once per
    // CHAIN_TIME_REFRESH_MS. The key is a sorted list so it only changes when
    // the set of chains does.
    const countdownChains = [...new Set(Object.keys(cancelTimes)
        .map((key) => key.slice(0, key.lastIndexOf(':'))))].sort().join(',');
    useEffect(() => {
        if (!countdownChains || !source.live) return undefined;
        let stopped = false;
        let lastReadMs = -Infinity;
        const chains = countdownChains.split(',');
        const tick = () => {
            const now = Date.now();
            setNowMs(now);
            if (now - lastReadMs < CHAIN_TIME_REFRESH_MS) return;
            if (typeof messaging.getChainTipBlockTime !== 'function') return;
            lastReadMs = now;
            for (const chainId of chains) {
                // A failed read keeps the chain's last reading.
                messaging.getChainTipBlockTime({ chainId, withProtocolTime: true })
                    .then((r) => {
                        if (stopped) return;
                        const clock = chainClockFromTipRead(r, Date.now());
                        setChainClocks((prev) => ({ ...prev, [chainId]: clock }));
                    })
                    .catch(() => {});
            }
        };
        tick();
        const timer = setInterval(tick, 60000);
        return () => { stopped = true; clearInterval(timer); };
    }, [countdownChains, messaging, source.live]);
    // Flatten every chain's rows into one list, newest first. Each row is
    // annotated with its chainId for the network overlay + detail link.
    const allRows = useMemo(() => {
        /** @type {any[]} */
        const out = [];
        for (const [cid, state] of Object.entries(dispensersByChain)) {
            for (const row of (state.rows || [])) out.push({ ...row, chainId: cid });
        }
        out.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
        return out;
    }, [dispensersByChain]);
    const marketRows = marketState.key === marketKey ? marketState.rows : [];
    const rowsForView = view === 'all' ? marketRows : allRows;

    // This list lane serves ORACLE_ADDRESS but no price for a Mode B row, so
    // its price comes from the oracle's own feeds.
    const oracleEntries = useMemo(
        () => source.live && view === 'mine'
            ? rowsForView.map((row) => ({ chainId: row.chainId, row }))
            : [],
        [rowsForView, source.live, view],
    );
    const oracleFeedsFor = useOracleFeeds(messaging, oracleEntries);

    const anyLoading = useMemo(() => {
        const states = Object.values(dispensersByChain);
        if (states.length === 0) return chainsWithAddresses.length > 0;
        return states.some((s) => s.loading);
    }, [dispensersByChain, chainsWithAddresses]);

    const hasLoadErrors = useMemo(
        () => Object.values(dispensersByChain).some((state) => state.error),
        [dispensersByChain],
    );
    const activeLoading = view === 'all'
        ? Boolean(marketKey && !nativeMarketUnsupported
            && (marketState.key !== marketKey || marketState.loading))
        : anyLoading;
    const activeError = view === 'all'
        ? (marketState.key === marketKey ? marketState.error : null)
        : (hasLoadErrors ? "Couldn't load some dispensers. Try again." : null);
    const selectedAsset = String(marketAsset?.tick || '').toUpperCase();

    const visibleRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return rowsForView.filter((row) => {
            if (view === 'all') {
                const sideAsset = marketSide === 'buy' ? giveAsset(row) : getAsset(row);
                if (sideAsset !== selectedAsset) return false;
            }
            if (network !== 'all' && coinFromChainId(row.chainId) !== network) return false;
            // Status narrows by the lifecycle state the row badge shows.
            if (statusFilter !== 'all' && statusGroup(row) !== statusFilter) return false;
            if (!q) return true;
            const label = row.address ? dispenserLabels[row.address] : undefined;
            return [
                row.give_tick, row.give_coin, row.get_tick, row.get_coin, row.status,
                row.current_status, row.memo, row.address, row.source, label,
                String(row.action_index ?? ''),
            ].some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
        });
    }, [rowsForView, view, marketSide, selectedAsset, query, network, statusFilter, dispenserLabels]);

    // Sort orders the filtered rows (Newest first is the default).
    const sortedRows = useMemo(() => {
        const rows = [...visibleRows];
        const at = (row) => Number(row.block_index || 0);
        if (sortBy === 'oldest') rows.sort((a, b) => at(a) - at(b));
        else if (sortBy === 'token') rows.sort((a, b) => giveAsset(a).localeCompare(giveAsset(b)) || (at(b) - at(a)));
        else rows.sort((a, b) => at(b) - at(a));
        return rows;
    }, [visibleRows, sortBy]);
    const coinFamilies = useMemo(
        () => [...new Set((view === 'all' && marketAsset?.chainId
            ? [marketAsset.chainId]
            : chainsWithAddresses).map((cid) => coinFromChainId(cid)))],
        [chainsWithAddresses, view, marketAsset?.chainId],
    );

    const shownDispenser = useMemo(() => {
        const ready = view === 'all'
            ? marketState.key === marketKey && !marketState.loading
            : Boolean(addressesByChain);
        if (!twoPanel || !ready) return null;
        const pick = selectedDispenser ?? localPick;
        if (pick && sortedRows.some((row) => sameDispenser(row, pick))) return pick;
        if (activeLoading) return null;
        const first = sortedRows[0];
        return first ? dispenserRef(first) : null;
    }, [twoPanel, view, marketState.key, marketState.loading, marketKey, addressesByChain, selectedDispenser, localPick, activeLoading, sortedRows]);
    const shownRow = shownDispenser
        ? sortedRows.find((row) => sameDispenser(row, shownDispenser))
        : null;
    const activeAddressError = view === 'mine' ? addressesError : null;
    const dataPending = view === 'all'
        ? marketState.key !== marketKey || marketState.loading
        : !addressesByChain || anyLoading;
    const showPanel = twoPanel && listShown && !activeAddressError && !activeError
        && (Boolean(shownDispenser) || (!offline && dataPending));
    useEffect(() => {
        if (showPanel && shownDispenser && !sameDispenser(shownDispenser, selectedDispenser)) {
            onSelectDispenser?.(shownDispenser);
        }
    }, [showPanel, shownDispenser, selectedDispenser, onSelectDispenser]);
    const pickDispenser = (ref) => {
        setLocalPick(ref);
        onSelectDispenser?.(ref);
    };

    // The title bar holds the filter and New dispenser icons. The fixed list
    // header holds the marketplace controls above the scrolling rows.
    const filterMenu = (
        <ListFilterMenu
            query={query}
            onQueryChange={setQuery}
            active={statusFilter !== 'all' || sortBy !== 'newest'}
            label="Filter dispensers"
            searchPlaceholder="Search"
            searchLabel="Search dispensers"
            chainRegistry={chainRegistry}
            coinFamilies={coinFamilies}
            networkFilter={network}
            onNetworkFilterChange={setNetwork}
        >
            <Select
                label="Status"
                help="Shows only dispensers in the status you pick, such as open or sold out."
                size="md"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
            >
                <Select.Option value="all" icon={<Icon.ListIcon />}>All statuses</Select.Option>
                <Select.Option value="open" icon={<Icon.PlayIcon />}>Open</Select.Option>
                <Select.Option value="closing" icon={<Icon.ClockIcon />}>Closing</Select.Option>
                <Select.Option value="soldout" icon={<Icon.CheckIcon />}>Sold out</Select.Option>
                <Select.Option value="limit" icon={<Icon.MaxIcon />}>Limit reached</Select.Option>
                <Select.Option value="closed" icon={<Icon.LockIcon />}>Closed</Select.Option>
                <Select.Option value="expired" icon={<Icon.HistoryIcon />}>Expired</Select.Option>
            </Select>
            <Select
                label="Sort"
                help="The order your dispensers are listed in: newest, oldest, or by token name."
                size="md"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
            >
                <Select.Option value="newest" icon={<Icon.HistoryIcon />}>Newest first</Select.Option>
                <Select.Option value="oldest" icon={<Icon.ClockIcon />}>Oldest first</Select.Option>
                <Select.Option value="token" icon={<Icon.TokenIcon />}>Token A to Z</Select.Option>
            </Select>
        </ListFilterMenu>
    );
    const viewToggle = (
        <SegmentedControl
            aria-label="Dispenser views"
            value={view}
            onChange={(next) => {
                setView(next);
                setLocalPick(null);
                onSelectDispenser?.(null);
            }}
            items={[
                { id: 'all', disabled: !marketReadSupported, label: <><Icon.GridIcon aria-hidden="true" /><span>All</span></> },
                { id: 'mine', label: <><Icon.WalletIcon aria-hidden="true" /><span>My Dispensers</span></> },
            ]}
        />
    );
    const marketSelector = view === 'all' ? (
        <Button
            type="button"
            className={`${marketsStyles.assetCard} ${marketsStyles.assetButton}`}
            icon={null}
            onClick={onChangeMarket}
            disabled={!onChangeMarket}
            aria-label={marketAsset ? `Change market (currently ${marketAsset.displayName || marketAsset.tick})` : 'Select market'}
        >
            {marketAsset ? <TickerIcon chainId={marketAsset.chainId} tick={marketAsset.tick} /> : null}
            <span className={marketsStyles.assetText}>
                <span className={marketsStyles.assetName}>{marketAsset?.displayName || marketAsset?.tick || 'Select Market'}</span>
            </span>
            <span className={marketsStyles.assetChevron} aria-hidden="true">›</span>
        </Button>
    ) : null;
    const sideToggle = view === 'all' ? (
        <SegmentedControl
            aria-label="Market side"
            value={marketSide}
            onChange={(next) => {
                setMarketSide(next);
                setLocalPick(null);
                onSelectDispenser?.(null);
            }}
            items={[
                { id: 'buy', label: <><Icon.ReceiveIcon aria-hidden="true" /><span>Buy</span></> },
                { id: 'sell', label: <><Icon.SendIcon aria-hidden="true" /><span>Sell</span></> },
            ]}
        />
    ) : null;
    const listToolbar = (
        <div className={local.toolbarStack}>
            {viewToggle}
            {marketSelector}
            {sideToggle}
        </div>
    );
    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Dispensers"
            trailing={(
                <>
                    {filterMenu}
                    {onCreateDispenser ? (
                        <Button variant="secondary" icon={<Icon.PlusIcon />} aria-label="New dispenser" title="New dispenser" onClick={() => onCreateDispenser()}>
                            {null}
                        </Button>
                    ) : null}
                </>
            )}
        />
    );
    const wrap = (body, notices = null) => {
        if (!showPanel) {
            return (
                <Screen variant={variant} header={header}>
                    <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="list">
                        <ListPage notices={notices} toolbar={listToolbar}>{body}</ListPage>
                    </div>
                </Screen>
            );
        }
        const detailSkeleton = <div aria-hidden="true"><Skeleton height={190} /></div>;
        return (
            <Screen variant={variant} header={header} bodyClassName={listDetailStyles.twoPanelBody}>
                <ListDetailSplit
                    measureRef={layoutRef}
                    storageKey="dispensers"
                    resizeLabel="Resize the dispensers list"
                    resizeHint="Drag to resize the dispensers list, or press Enter to reset."
                    layoutName="two-panel"
                    listHeader={<ListPage notices={notices} toolbar={listToolbar} />}
                    list={<ListPage>{body}</ListPage>}
                    listLabel="Dispensers"
                    detailLabel={shownRow ? `${giveAsset(shownRow) || 'Asset'} dispenser #${shownRow.action_index}` : 'Dispenser'}
                    detailBusy={!shownDispenser}
                    detailFallback={detailSkeleton}
                    detail={shownDispenser ? (
                        <Fragment key={`${shownDispenser.chainId}:${shownDispenser.actionIndex}`}>
                            {renderDispenser(shownDispenser)}
                        </Fragment>
                    ) : detailSkeleton}
                />
            </Screen>
        );
    };

    if (detailRoute && !(measured && twoPanel)) {
        if (!measured) {
            return (
                <Screen variant={variant} header={header}>
                    <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="measuring" />
                </Screen>
            );
        }
        return renderDispenserPage(selectedDispenser, { measureRef: layoutRef });
    }

    if (view === 'mine' && addressesError) {
        return wrap(
            null,
            <StatusMessage
                variant="error"
                className={styles.entryDescription}
                recovery={{
                    label: 'Try Again',
                    onAction: () => {
                        setAddressesError(null);
                        setAddressesByChain(null);
                        setAddressesReload((value) => value + 1);
                    },
                }}
            >
                {addressesError}
            </StatusMessage>,
        );
    }
    if (view === 'mine' && !addressesByChain) {
        return wrap(
            <div role="status" aria-label="Loading dispensers">
                <Skeleton.List rows={5} />
            </div>,
        );
    }
    if (view === 'mine' && chainsWithAddresses.length === 0) {
        return wrap(
            <EmptyState
                title="No supported address"
                body="A supported address is required before dispensers can be created or viewed."
            />,
        );
    }
    const retryActive = () => {
        if (view === 'all') setMarketReload((value) => value + 1);
        else {
            setDispensersByChain({});
            setDispensersReload((value) => value + 1);
        }
    };
    const notice = activeError && !offline ? (
        <StatusMessage
            variant="error"
            className={styles.entryDescription}
            recovery={{ label: 'Try Again', onAction: retryActive }}
        >
            {activeError}
        </StatusMessage>
    ) : null;
    const body = nativeMarketUnsupported ? (
        <EmptyState
            title="Market unavailable"
            body="Choose a token market because explorer discovery is not available for native coin dispensers yet."
        />
    ) : !marketAsset && view === 'all' ? (
        <EmptyState title="No market selected" body="Choose a token to view its dispensers." />
    ) : offline && rowsForView.length === 0 ? (
        <OfflineEmptyState
            body={view === 'mine'
                ? 'Your dispensers load when the connection returns.'
                : 'Dispensers load when the connection returns.'}
            onRetry={recheck}
        />
    ) : activeLoading && visibleRows.length === 0 ? (
                <div role="status" aria-label="Loading dispensers">
                    <Skeleton.List rows={5} />
                </div>
    ) : activeError && rowsForView.length === 0 ? (
                null
    ) : visibleRows.length === 0 ? (
                rowsForView.length === 0 ? (
                    <EmptyState
                        title={view === 'all' ? `No ${marketSide} dispensers` : 'No dispensers yet'}
                        body={view === 'all'
                            ? `No dispensers ${marketSide === 'buy' ? 'give' : 'accept'} ${selectedAsset}.`
                            : 'A dispenser sells an asset at a fixed price.'}
                    />
                ) : (
                    <EmptyState
                        title="No matching dispensers"
                        body="Change or clear the filter to see more."
                    />
                )
    ) : (
                <ul className={local.list} data-xc-split-list={showPanel ? '' : undefined}>
                    {sortedRows.map((row) => (
                        <li
                            className={local.listItem}
                            key={`${row.chainId}:${row.action_index}`}
                            data-selected={showPanel && sameDispenser(row, shownDispenser) ? 'true' : undefined}
                        >
                            {view === 'all' ? (
                                <MarketDispenserRow
                                    row={row}
                                    split={showPanel}
                                    selected={showPanel && sameDispenser(row, shownDispenser)}
                                    onSelect={() => {
                                        const ref = dispenserRef(row);
                                        if (twoPanel) pickDispenser(ref);
                                        else onOpenDispenser(ref.chainId, ref.actionIndex);
                                    }}
                                />
                            ) : (
                                <DispenserRow
                                    row={row}
                                    split={showPanel}
                                    label={row.address ? dispenserLabels[row.address] : undefined}
                                    oracleFeeds={oracleFeedsFor(row.chainId, row)}
                                    cancelTimestamp={cancelTimes[`${row.chainId}:${row.action_index}`]}
                                    nowMs={nowMs}
                                    chainClock={chainClocks[row.chainId] || null}
                                    selected={showPanel && sameDispenser(row, shownDispenser)}
                                    onSelect={() => {
                                        const ref = dispenserRef(row);
                                        if (twoPanel) pickDispenser(ref);
                                        else onOpenDispenser(ref.chainId, ref.actionIndex);
                                    }}
                                    allowRemoteImages={allowRemoteImages}
                                />
                            )}
                        </li>
                    ))}
                </ul>
    );
    return wrap(body, notice);
}

// The Status filter's group for a row, from the lifecycle status its badge shows.
function statusGroup(row) {
    const status = String(flowsLib.dispenserLiveState(row).status || '');
    if (status === 'cancelling') return 'closing';
    if (status === 'empty' || status === 'complete') return 'soldout';
    if (status === 'max_dispenses_reached') return 'limit';
    if (status === 'cancelled' || status === 'closed') return 'closed';
    if (status === 'expired') return 'expired';
    return status === 'open' ? 'open' : 'other';
}

function MarketDispenserRow({ row, onSelect, selected = false, split = false }) {
    const give = giveAsset(row) || '?';
    const get = getAsset(row) || '?';
    const remaining = flowsLib.dispenserLiveState(row).giveRemaining;
    const seller = String(row.source || row.address || 'Unknown');
    return (
        <ListRow
            type="button"
            className={local.marketRow}
            data-xc-split-row={split ? '' : undefined}
            onClick={onSelect}
            aria-current={selected ? 'true' : undefined}
            aria-label={`Open ${give} dispenser #${row.action_index ?? '?'}`}
            chevron
            leading={<TickerIcon chainId={row.chainId} tick={give} />}
            title={`Get ${formatNum(row.give_amount)} ${give}`}
            subtitle={(
                <span className={local.marketBody}>
                    <span>{`Pay ${formatNum(row.get_amount)} ${get} per dispense`}</span>
                    <span>{remaining == null ? 'Remaining unavailable' : `${formatNum(remaining)} ${give} left`}</span>
                    <span className={local.marketSeller}>
                        <span>Seller </span>
                        {seller === 'Unknown' ? seller : <AddressText address={seller} focusable={false} />}
                    </span>
                </span>
            )}
        />
    );
}

function DispenserRow({ row, label, oracleFeeds, cancelTimestamp, nowMs, chainClock, onSelect, allowRemoteImages, selected = false, split = false }) {
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    const tokenImageUrl = isAssetImageSourceAllowed(row.imageUrl, allowRemoteImages)
        ? row.imageUrl
        : null;
    // Badge the LIFECYCLE state (open / cancelling / cancelled / expired /
    // complete), not the create action's validity: `row.status` is frozen at
    // 'valid' forever, which dressed every dispenser - cancelled and drained
    // ones included - in the same badge. dispenserLiveState resolves the
    // list lane's `current_status`, demo fixtures' `status`, and falls back
    // to validity against an explorer that predates the lifecycle column.
    const status = String(flowsLib.dispenserLiveState(row).status || '?');
    // A terminal dispenser's escrow went back to its owner with the closing
    // action; saying "in escrow" on such a row misstates where the tokens
    // are, so the line only renders while the figure still means something.
    const isTerminal = ['cancelled', 'expired', 'complete', 'closed'].includes(status);
    // A cancelling dispenser is in its close window: say "Closing", with the
    // countdown when the cancel time is known.
    const closeEta = status === 'cancelling' && cancelTimestamp != null
        ? dispenserCloseEta(cancelTimestamp, { nowMs, ...(chainClock || {}) })
        : null;
    const badge = status === 'cancelling'
        ? (closeEta ? `Closing · ${closeEta.shortCountdown}` : 'Closing')
        : dispenserStatusLabel(status);
    return (
        <ListRow
            type="button"
            className={local.row}
            data-xc-split-row={split ? '' : undefined}
            onClick={onSelect}
            aria-current={selected ? 'true' : undefined}
            aria-label={`Open ${row.give_tick || '?'} dispenser #${row.action_index ?? '?'}`}
            chevron
            leading={<span className={local.iconWrap}>
                <span
                    className={local.iconLetter}
                    style={{ background: tickerColor(row.give_tick || '?'), color: '#FFFFFF' }}
                    aria-hidden="true"
                >
                    {(row.give_tick || '?').slice(0, 1)}
                </span>
                {tokenImageUrl ? (
                    <img
                        src={tokenImageUrl}
                        alt=""
                        aria-hidden="true"
                        className={local.iconImg}
                        loading="lazy"
                        decoding="async"
                        style={{ position: 'absolute', inset: 0 }}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                ) : null}
                {chainIconUrl ? (
                    <img
                        src={chainIconUrl}
                        alt=""
                        aria-hidden="true"
                        className={local.chainOverlay}
                        loading="lazy"
                        decoding="async"
                    />
                ) : null}
            </span>}
            title={<span className={local.name}>{label ? `${label}: ` : ''}{row.give_tick || '?'}</span>}
            subtitle={(
                <span className={local.body}>
                    {/* The status pill rides the price line's end edge: the
                        price truncates first, the pill never shrinks or wraps. */}
                    <span className={local.priceLine}>
                        <span className={`${local.subtitle} ${local.price}`}><bdi dir="ltr">{dispenserRateLabel(row, oracleFeeds)}</bdi></span>
                        <span
                            className={`${local.status} ${local[`status_${status}`] || ''}`}
                            title={closeEta && !closeEta.pastDue ? `Earliest close ${new Date(closeEta.closeAtMs).toLocaleString()}` : undefined}
                        >
                            {badge}
                        </span>
                    </span>
                {/* Escrow is only stated when it is known. The explorer's
                    dispenser LIST lane carries no escrow column (remaining is
                    derived per action, in the detail read path), so on real
                    dispensers this is absent - and the old 'Escrow pending'
                    fallback then told every owner their fully-escrowed
                    dispenser had not funded yet (D-40). Open the dispenser to
                    see its live balance. */}
                {row.escrow_remaining != null && !isTerminal ? (
                    <span className={local.subtitle}>
                        <bdi dir="ltr">{`${formatNum(row.escrow_remaining)} ${row.give_tick || ''} in escrow`.trim()}</bdi>
                    </span>
                ) : null}
                </span>
            )}
        />
    );
}

function giveAsset(row) {
    return String(row?.give_tick || row?.give_coin || '').toUpperCase();
}

function getAsset(row) {
    return String(row?.get_tick || row?.get_coin || '').toUpperCase();
}

function dispenserRef(row) {
    return { chainId: row.chainId, actionIndex: String(row.action_index) };
}

function sameDispenser(a, b) {
    return Boolean(a && b)
        && String(a.chainId) === String(b.chainId)
        && String(a.actionIndex ?? a.action_index) === String(b.actionIndex ?? b.action_index);
}

// Thousands separators on the integer part of a decimal string, exact
// (no float round-trip): '4750' -> '4,750', '0.005' stays '0.005'.
function formatNum(v) {
    if (v == null || v === '') return '?';
    const s = String(v);
    const [int, frac] = s.split('.');
    if (!/^\d+$/.test(int)) return s;
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return frac != null ? `${grouped}.${frac}` : grouped;
}

function extractRows(resp) {
    // Explorer returns { data: [...] } for list queries; be defensive
    // because some wrapper layers unwrap to a bare array.
    // A null or scalar entry is no dispenser; keeping it would throw in the
    // de-dupe and leave the whole chain's list unloaded.
    const rows = Array.isArray(resp) ? resp
        : Array.isArray(resp?.data) ? resp.data
            : Array.isArray(resp?.rows) ? resp.rows : [];
    return rows.filter((row) => row !== null && typeof row === 'object');
}

function short(addr) {
    if (!addr || typeof addr !== 'string') return '?';
    return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
