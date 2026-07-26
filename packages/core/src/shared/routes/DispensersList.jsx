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
    PageHeader,
    Icon,
} from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import * as branding from '../../branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { coinFromChainId, tickerColor } from '../components/BalanceList.jsx';
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
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [addressesError, setAddressesError] = useState(
        /** @type {string | null} */ (null),
    );
    const [dispensersByChain, setDispensersByChain] = useState(
        /** @type {Record<string, { loading: boolean, rows: any[], error: string | null }>} */ ({}),
    );
    // In-page filters: free-text search + network dropdown, mirroring the
    // contacts / messaging toolbars.
    const [query, setQuery] = useState('');
    const [network, setNetwork] = useState('all');

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId, activeAccountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
            })
            .catch((err) => {
                if (!cancelled) setAddressesError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, activeAccountId]);

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

    // Phase 2: for each chain with addresses, fan out one explorer
    // query per address and merge the results. A per-chain error
    // surfaces inline; other chains keep loading.
    useEffect(() => {
        if (!addressesByChain) return;
        const chains = Object.keys(addressesByChain);
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
                const first = (addressesByChain[cid] || [])[0]?.address;
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
            const addrs = (addressesByChain[cid] || []).map((a) => a.address);
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
            });
        }
        return () => { cancelled = true; };
    }, [addressesByChain, messaging, walletId]);

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

    const anyLoading = useMemo(() => {
        const states = Object.values(dispensersByChain);
        if (states.length === 0) return true;
        return states.some((s) => s.loading);
    }, [dispensersByChain]);

    const loadErrors = useMemo(() => (
        Object.entries(dispensersByChain)
            .filter(([, s]) => s.error)
            .map(([cid, s]) => `${chainRegistry.get(cid)?.displayName || cid}: ${s.error}`)
    ), [dispensersByChain]);

    const visibleRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return allRows.filter((row) => {
            if (network !== 'all' && coinFromChainId(row.chainId) !== network) return false;
            if (!q) return true;
            const label = row.address ? dispenserLabels[row.address] : undefined;
            return [
                row.give_tick, row.get_tick, row.get_coin, row.status,
                row.memo, row.address, row.source, label,
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
                <button
                    type="button"
                    className={local.addBtn}
                    onClick={() => onCreateDispenser()}
                    aria-label="Create dispenser"
                    title="Create dispenser"
                >
                    <Icon.PlusIcon />
                </button>
            ) : undefined}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div className={isFull ? local.wrapFull : local.wrapPopup}>
                {children}
            </div>
        </Screen>
    );

    if (addressesError) {
        return wrap(<div role="alert" className={styles.entryDescription}>{addressesError}</div>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.entryDescription}>Loading addresses…</p>);
    }
    if (Object.keys(addressesByChain).length === 0) {
        return wrap(
            <p className={styles.entryDescription}>
                No addresses on any chain yet. Use Receive to generate one first, or Create dispenser to open your first.
            </p>,
        );
    }

    return wrap(
        <>
            <div className={local.toolbar}>
                <input
                    type="text"
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
            </div>
            {loadErrors.length > 0 ? (
                <p role="alert" className={styles.entryDescription}>
                    Couldn't load some dispensers. {loadErrors.join('; ')}
                </p>
            ) : null}
            {anyLoading && visibleRows.length === 0 ? (
                <p className={styles.entryDescription}>Loading…</p>
            ) : visibleRows.length === 0 ? (
                <p className={styles.entryDescription}>
                    {allRows.length === 0
                        ? 'No dispensers opened yet. Use Create dispenser to open your first.'
                        : 'No dispensers match the current filter.'}
                </p>
            ) : (
                <div className={local.list} role="list">
                    {visibleRows.map((row) => (
                        <DispenserRow
                            key={`${row.chainId}:${row.action_index}`}
                            row={row}
                            label={row.address ? dispenserLabels[row.address] : undefined}
                            onSelect={() => onOpenDispenser(row.chainId, String(row.action_index))}
                        />
                    ))}
                </div>
            )}
        </>,
    );
}

function DispenserRow({ row, label, onSelect }) {
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    const status = String(row.status || '?');
    return (
        <button
            type="button"
            className={local.row}
            role="listitem"
            onClick={onSelect}
            aria-label={`Open ${row.give_tick || '?'} dispenser #${row.action_index ?? '?'}`}
        >
            <div className={local.iconWrap}>
                {row.imageUrl ? (
                    <img
                        src={row.imageUrl}
                        alt=""
                        aria-hidden="true"
                        className={local.iconImg}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                ) : (
                    <span
                        className={local.iconLetter}
                        style={{ background: tickerColor(row.give_tick || '?'), color: '#FFFFFF' }}
                        aria-hidden="true"
                    >
                        {(row.give_tick || '?').slice(0, 1)}
                    </span>
                )}
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
                <div className={local.subtitle}>{rateLabel(row)}</div>
                {/* Escrow is only stated when it is known. The explorer's
                    dispenser LIST lane carries no escrow column (remaining is
                    derived per action, in the detail read path), so on real
                    dispensers this is absent - and the old 'Escrow pending'
                    fallback then told every owner their fully-escrowed
                    dispenser had not funded yet (D-40). Open the dispenser to
                    see its live balance. */}
                {row.escrow_remaining != null ? (
                    <div className={local.subtitle}>
                        {`${formatNum(row.escrow_remaining)} ${row.give_tick || ''} in escrow`.trim()}
                    </div>
                ) : null}
            </div>
            <div className={local.trailing}>
                <span className={`${local.status} ${local[`status_${status}`] || ''}`}>{status}</span>
                <span className={local.dispenseCount}>
                    {row.dispense_count != null
                        ? `${formatNum(row.dispense_count)} dispense${Number(row.dispense_count) === 1 ? '' : 's'}`
                        : ''}
                </span>
            </div>
        </button>
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

function rateLabel(row) {
    const give = `${formatNum(row.give_amount)} ${row.give_tick || '?'}`;
    const coin = row.get_coin || '';
    const tick = row.get_tick || '';
    const amt = formatNum(row.get_amount);
    const payAsset = tick || coin || '?';
    return `${give} per ${amt} ${payAsset}`;
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
