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
import { Button, ChainBadge, EmptyState, Icon, ListPage, PageHeader, Screen, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import * as branding from '../../branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { coinFromChainId, isAssetImageSourceAllowed, tickerColor } from '../components/BalanceList.jsx';
import { useOracleFeeds } from '../hooks/useOracleFeeds.js';
import { useSettings } from '../hooks/useSettings.js';
import { dispenserRateLabel } from '../utils/dispenserPricing.js';
import {
    CHAIN_TIME_REFRESH_MS, chainClockFromTipRead, dispenserCancelTimestamp, dispenserCloseEta,
} from '../utils/dispenserCloseWindow.js';
import styles from './ActionsMenu.module.css';
import local from './DispensersList.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * "My dispensers": §40.7.1 / §40.7.2 owner-facing list view.
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
 */
export function DispensersList({ walletId, activeAccountId, onOpenDispenser, onCreateDispenser, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { settings } = useSettings();
    const allowRemoteImages = Boolean(settings)
        && settings.privacy?.metadataFetchEnabled !== false;

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
    // In-page filters: free-text search + network dropdown, mirroring the
    // contacts / messaging toolbars.
    const [query, setQuery] = useState('');
    const [network, setNetwork] = useState('all');
    // Cancel block times of closing dispensers, keyed `chainId:actionIndex`.
    const [cancelTimes, setCancelTimes] = useState(/** @type {Record<string, number>} */ ({}));
    const [nowMs, setNowMs] = useState(() => Date.now());
    // Each chain's protocol time, the clock the close window is judged by,
    // keyed by chainId: one read per chain with a closing row, never per row.
    const [chainClocks, setChainClocks] = useState(
        /** @type {Record<string, null | { chainTime: number, chainTimeReadAtMs: number }>} */ ({}),
    );

    useEffect(() => {
        let cancelled = false;
        setAddressesByChain(null);
        setAddressesError(null);
        messaging.getAddressesByChain(walletId, activeAccountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
            })
            .catch(() => {
                if (!cancelled) setAddressesError('Could not load wallet addresses. Try again.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, activeAccountId, addressesReload]);

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

        const initial = {};
        for (const cid of chains) initial[cid] = { loading: true, rows: [], error: null };
        setDispensersByChain(initial);

        let cancelled = false;

        // Demo wallet: no explorer to query; serve the fabricated dispensers
        // owned by the first address on each chain.
        if (flowsLib.isDemoWallet(walletId)) {
            const demo = {};
            for (const cid of chains) {
                const first = (addressesByChain[cid] || [])
                    .find((row) => typeof row?.address === 'string' && row.address.length > 0)
                    ?.address;
                demo[cid] = {
                    loading: false,
                    rows: first ? flowsLib.synthesizeDemoDispensers(cid, first) : [],
                    error: null,
                };
            }
            setDispensersByChain(demo);
            return undefined;
        }
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
    }, [addressesByChain, chainsWithAddresses, messaging, walletId, dispensersReload]);
    // Re-render once a minute while any closing row shows a countdown, and
    // re-read the protocol time of each chain with one, at most once per
    // CHAIN_TIME_REFRESH_MS. The key is a sorted list so it only changes when
    // the set of chains does.
    const countdownChains = [...new Set(Object.keys(cancelTimes)
        .map((key) => key.slice(0, key.lastIndexOf(':'))))].sort().join(',');
    useEffect(() => {
        if (!countdownChains) return undefined;
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
    }, [countdownChains, messaging]);
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

    // This list lane serves ORACLE_ADDRESS but no price for a Mode B row, so
    // its price comes from the oracle's own feeds.
    const oracleEntries = useMemo(() => allRows.map((row) => ({ chainId: row.chainId, row })), [allRows]);
    const oracleFeedsFor = useOracleFeeds(messaging, oracleEntries);

    const anyLoading = useMemo(() => {
        const states = Object.values(dispensersByChain);
        if (states.length === 0) return true;
        return states.some((s) => s.loading);
    }, [dispensersByChain]);

    const loadErrors = useMemo(() => (
        Object.entries(dispensersByChain)
            .filter(([, s]) => s.error)
            .map(([cid]) => chainRegistry.get(cid)?.displayName || cid)
    ), [dispensersByChain]);

    const visibleRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return allRows.filter((row) => {
            if (network !== 'all' && coinFromChainId(row.chainId) !== network) return false;
            if (!q) return true;
            const label = row.address ? dispenserLabels[row.address] : undefined;
            return [
                row.give_tick, row.get_tick, row.get_coin, row.status,
                row.current_status, row.memo, row.address, row.source, label,
                String(row.action_index ?? ''),
            ].some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
        });
    }, [allRows, query, network, dispenserLabels]);

        const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            titleIcon={<Icon.TokenIcon />}
            title="My dispensers"
            trailing={onCreateDispenser ? (
                <Button
                    type="button"
                    className={local.addBtn}
                    onClick={() => onCreateDispenser()}
                    aria-label="Create dispenser"
                    title="Create dispenser"
                >
                    <Icon.PlusIcon />
                </Button>
            ) : undefined}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
    );

    if (addressesError) {
        return wrap(
            <ListPage>
                <StatusMessage
                    variant="error"
                    className={styles.entryDescription}
                    recovery={{
                        label: 'Try again',
                        onAction: () => {
                            setAddressesError(null);
                            setAddressesByChain(null);
                            setAddressesReload((value) => value + 1);
                        },
                    }}
                >
                    {addressesError}
                </StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain) {
        return wrap(
            <ListPage>
                <div role="status" aria-label="Loading dispensers">
                    <Skeleton.List rows={5} />
                </div>
            </ListPage>,
        );
    }
    if (chainsWithAddresses.length === 0) {
        return wrap(
            <ListPage>
                <EmptyState
                    title="No supported address"
                    body="A supported address is required before dispensers can be created or viewed."
                />
            </ListPage>,
        );
    }

    return wrap(
        <ListPage
            toolbar={(
                <>
                    <input
                        type="search"
                        enterKeyHint="search"
                        autoCapitalize="off"
                        className={local.search}
                        placeholder="Search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        aria-label="Search dispensers"
                    />
                    <NetworkFilterDropdown value={network} onChange={setNetwork} />
                </>
            )}
        >
            {loadErrors.length > 0 ? (
                <StatusMessage
                    variant="error"
                    className={styles.entryDescription}
                    recovery={{
                        label: 'Try again',
                        onAction: () => {
                            setDispensersByChain({});
                            setDispensersReload((value) => value + 1);
                        },
                    }}
                >
                    Couldn't load some dispensers. Failed networks: {loadErrors.join(', ')}. Try again.
                </StatusMessage>
            ) : null}
            {anyLoading && visibleRows.length === 0 ? (
                <div role="status" aria-label="Loading dispensers">
                    <Skeleton.List rows={5} />
                </div>
            ) : loadErrors.length > 0 && allRows.length === 0 ? (
                null
            ) : visibleRows.length === 0 ? (
                allRows.length === 0 ? (
                    <EmptyState
                        title="No dispensers yet"
                        body="A dispenser sells a token for coin at a fixed price."
                        actionLabel={onCreateDispenser ? 'Create dispenser' : undefined}
                        onAction={onCreateDispenser ? () => onCreateDispenser() : undefined}
                    />
                ) : (
                    <EmptyState title="No matching dispensers" body="Try a different search or network filter." />
                )
            ) : (
                <div className={local.list} role="list">
                    {visibleRows.map((row) => (
                        <DispenserRow
                            key={`${row.chainId}:${row.action_index}`}
                            row={row}
                            label={row.address ? dispenserLabels[row.address] : undefined}
                            oracleFeeds={oracleFeedsFor(row.chainId, row)}
                            cancelTimestamp={cancelTimes[`${row.chainId}:${row.action_index}`]}
                            nowMs={nowMs}
                            chainClock={chainClocks[row.chainId] || null}
                            onSelect={() => onOpenDispenser(row.chainId, String(row.action_index))}
                            allowRemoteImages={allowRemoteImages}
                        />
                    ))}
                </div>
            )}
        </ListPage>,
    );
}

function DispenserRow({ row, label, oracleFeeds, cancelTimestamp, nowMs, chainClock, onSelect, allowRemoteImages }) {
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    const tokenImageUrl = isAssetImageSourceAllowed(row.imageUrl, allowRemoteImages)
        ? row.imageUrl
        : null;
    const descriptor = chainRegistry.get(row.chainId);
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
        : status;
    return (
        <Button
            type="button"
            className={local.row}
            role="listitem"
            onClick={onSelect}
            aria-label={`Open ${row.give_tick || '?'} dispenser #${row.action_index ?? '?'}`}
        >
            <div className={local.iconWrap}>
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
                        style={{ position: 'absolute', inset: 0 }}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                ) : null}
                {chainIconUrl ? (
                    <img
                        src={chainIconUrl}
                        alt=""
                        aria-hidden="true"
                        title={chainRegistry.get(row.chainId)?.displayName}
                        className={local.chainOverlay}
                    />
                ) : null}
            </div>
            <div className={local.body}>
                <div className={local.name}>
                    {label ? `${label}: ` : ''}{row.give_tick || '?'}
                </div>
                <div className={local.subtitle}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : row.chainId}
                </div>
                <div className={local.subtitle}>{dispenserRateLabel(row, oracleFeeds)}</div>
                {/* Escrow is only stated when it is known. The explorer's
                    dispenser LIST lane carries no escrow column (remaining is
                    derived per action, in the detail read path), so on real
                    dispensers this is absent - and the old 'Escrow pending'
                    fallback then told every owner their fully-escrowed
                    dispenser had not funded yet (D-40). Open the dispenser to
                    see its live balance. */}
                {row.escrow_remaining != null && !isTerminal ? (
                    <div className={local.subtitle}>
                        {`${formatNum(row.escrow_remaining)} ${row.give_tick || ''} in escrow`.trim()}
                    </div>
                ) : null}
            </div>
            <div className={local.trailing}>
                <span
                    className={`${local.status} ${local[`status_${status}`] || ''}`}
                    title={closeEta && !closeEta.pastDue ? `Earliest close ${new Date(closeEta.closeAtMs).toLocaleString()}` : undefined}
                >
                    {badge}
                </span>
            </div>
        </Button>
    );
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
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

function short(addr) {
    if (!addr || typeof addr !== 'string') return '?';
    return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
