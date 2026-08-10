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
import { Icon, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '../../branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import styles from './ActionsMenu.module.css';
import local from './MyLists.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * PC-10 "My Lists": owner-facing list view over every LIST action this
 * wallet's addresses have authored (address lists, TYPE=2, and token
 * lists, TYPE=1). Mirrors DispensersList's shape: fan out one explorer
 * query per address, merge + de-dupe, defer per-list detail (membership,
 * "used by") to ListDetail.
 *
 * The explorer's `/lists/{address}/address` row is metadata-only
 * (type, edit, parent index, source, block, status) - no member count
 * or item preview - so this list stays lightweight and the detail page
 * carries the heavier per-list read.
 *
 * Scoped to the active account: only that account's addresses are
 * unioned over, matching DispensersList.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.activeAccountId]   scope the address union to this account
 * @param {(chainId: string, actionIndex: string) => void} props.onOpenList
 * @param {() => void} [props.onCreateList]  opens the Create list form
 * @param {() => void} props.onBack
 */
export function MyLists({ walletId, activeAccountId, onOpenList, onCreateList, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [addressesError, setAddressesError] = useState(
        /** @type {string | null} */ (null),
    );
    const [listsByChain, setListsByChain] = useState(
        /** @type {Record<string, { loading: boolean, rows: any[], error: string | null }>} */ ({}),
    );
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

    useEffect(() => {
        if (!addressesByChain) return;
        const chains = Object.keys(addressesByChain);
        if (chains.length === 0) return;

        const initial = {};
        for (const cid of chains) initial[cid] = { loading: true, rows: [], error: null };
        setListsByChain(initial);

        let cancelled = false;
        for (const cid of chains) {
            const addrs = (addressesByChain[cid] || []).map((a) => a.address);
            if (addrs.length === 0) {
                if (!cancelled) {
                    setListsByChain((prev) => ({ ...prev, [cid]: { loading: false, rows: [], error: null } }));
                }
                continue;
            }

            Promise.all(addrs.map((addr) =>
                messaging.getListsForSource({ chainId: cid, address: addr })
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
                setListsByChain((prev) => ({
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
    }, [addressesByChain, messaging]);

    const allRows = useMemo(() => {
        /** @type {any[]} */
        const out = [];
        for (const [cid, state] of Object.entries(listsByChain)) {
            for (const row of (state.rows || [])) out.push({ ...row, chainId: cid });
        }
        out.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
        return out;
    }, [listsByChain]);

    const anyLoading = useMemo(() => {
        const states = Object.values(listsByChain);
        if (states.length === 0) return true;
        return states.some((s) => s.loading);
    }, [listsByChain]);

    const loadErrors = useMemo(() => (
        Object.entries(listsByChain)
            .filter(([, s]) => s.error)
            .map(([cid, s]) => `${chainRegistry.get(cid)?.displayName || cid}: ${s.error}`)
    ), [listsByChain]);

    const visibleRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return allRows.filter((row) => {
            if (network !== 'all' && coinFromChainId(row.chainId) !== network) return false;
            if (!q) return true;
            return [
                row.source, row.status, String(row.action_index ?? ''),
                row.list_action_index != null ? String(row.list_action_index) : '',
            ].some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
        });
    }, [allRows, query, network]);

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            titleIcon={<Icon.TokenListIcon />}
            title="My Lists"
            trailing={onCreateList ? (
                <button
                    type="button"
                    className={local.addBtn}
                    onClick={() => onCreateList()}
                    aria-label="Create list"
                    title="Create list"
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
        return wrap(<StatusMessage variant="error" className={styles.entryDescription}>{addressesError}</StatusMessage>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.entryDescription}>Loading addresses…</p>);
    }
    if (Object.keys(addressesByChain).length === 0) {
        return wrap(
            <p className={styles.entryDescription}>
                No addresses on any chain yet. Use Receive to generate one first, or Create list to publish your first.
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
                    aria-label="Search lists"
                />
                <NetworkFilterDropdown value={network} onChange={setNetwork} />
            </div>
            {loadErrors.length > 0 ? (
                <StatusMessage variant="error" className={styles.entryDescription}>
                    Couldn't load some lists. {loadErrors.join('; ')}
                </StatusMessage>
            ) : null}
            {anyLoading && visibleRows.length === 0 ? (
                <p className={styles.entryDescription}>Loading…</p>
            ) : visibleRows.length === 0 ? (
                <p className={styles.entryDescription}>
                    {allRows.length === 0
                        ? 'No lists published yet. Use Create list to publish your first (an address list for airdrops, or a token list for a project roster or gate).'
                        : 'No lists match the current filter.'}
                </p>
            ) : (
                <div className={local.list} role="list">
                    {visibleRows.map((row) => (
                        <ListRow
                            key={`${row.chainId}:${row.action_index}`}
                            row={row}
                            onSelect={() => onOpenList(row.chainId, String(row.action_index))}
                        />
                    ))}
                </div>
            )}
        </>,
    );
}

function ListRow({ row, onSelect }) {
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    const isTick = String(row.type) === '1';
    const isFork = row.list_action_index != null && row.list_action_index !== '';
    const status = String(row.status || '?');
    const valid = status === 'valid';
    return (
        <button
            type="button"
            className={local.row}
            role="listitem"
            onClick={onSelect}
            aria-label={`Open ${isTick ? 'token' : 'address'} list #${row.action_index ?? '?'}`}
        >
            <div className={local.iconWrap}>
                <span className={local.iconLetter} aria-hidden="true">
                    {isTick ? <Icon.TokenIcon /> : <Icon.AddressIcon />}
                </span>
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
                    {isTick ? 'Token list' : 'Address list'} #{row.action_index ?? '?'}
                </div>
                <div className={local.subtitle}>
                    {isFork
                        ? `Forked from #${row.list_action_index} (${row.edit === '2' ? 'removed items' : 'added items'})`
                        : 'Created list'}
                </div>
            </div>
            <div className={local.trailing}>
                <span className={`${local.status} ${valid ? local.status_valid : local.status_invalid}`}>
                    {valid ? 'Valid' : status}
                </span>
            </div>
        </button>
    );
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
