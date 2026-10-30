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
import { Button, EmptyState, Icon, ListPage, ListRow, PageHeader, Screen, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '../../branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { ListToolbar } from '../components/ListToolbar.jsx';
import { NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { OfflineEmptyState } from '../components/OfflineEmptyState.jsx';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { listLabel } from '../utils/listLabel.js';
import { listStatusText } from '../utils/listItemStatusText.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/routes.js';
import styles from './ActionsMenu.module.css';
import local from './MyLists.module.css';

const chainRegistry = registryLib.defaultRegistry();
const OWNED_LIST_REVALIDATE_MS = 16_000;

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
 * @param {() => void} [props.onCreateUnionList]  shows "Create union list" when passed
 * @param {() => void} [props.onOpenSharedLists]   shows "Shared lists" when passed
 * @param {() => void} props.onBack
 */
export function MyLists(props) {
    const { walletId, activeAccountId } = props;
    const listKey = `${walletId}:${activeAccountId || ''}`;
    return <MyListsScreen key={listKey} {...props} />;
}

function MyListsScreen({ walletId, activeAccountId, onOpenList, onCreateList, onCreateUnionList, onOpenSharedLists, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { offline, recheck } = useNetworkOffline({ walletId });

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [addressesError, setAddressesError] = useState(
        /** @type {string | null} */ (null),
    );
    const [listsByChain, setListsByChain] = useState(
        /** @type {Record<string, { loading: boolean, rows: any[], error: string | null }>} */ ({}),
    );
    const [addressesReload, setAddressesReload] = useState(0);
    const [listsReload, setListsReload] = useState(0);
    const [listsRevalidated, setListsRevalidated] = useState(false);
    const [query, setQuery] = useState('');
    const [network, setNetwork] = useState('all');

    useEffect(() => {
        let cancelled = false;
        setAddressesError(null);
        messaging.getAddressesByChain(walletId, activeAccountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
            })
            .catch(() => {
                if (!cancelled) setAddressesError('Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, activeAccountId, addressesReload]);

    useEffect(() => {
        if (!addressesByChain) return;
        const chains = Object.keys(addressesByChain);
        if (chains.length === 0) return;
        // Offline the reads cannot finish; rows already shown stay, and the
        // lists load again when the connection returns.
        if (offline) return;

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
    }, [addressesByChain, messaging, listsReload, offline]);

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

    useEffect(() => {
        if (!addressesByChain || offline || anyLoading || listsRevalidated) return undefined;
        const timer = setTimeout(() => {
            setListsRevalidated(true);
            setListsReload((value) => value + 1);
        }, OWNED_LIST_REVALIDATE_MS);
        return () => clearTimeout(timer);
    }, [addressesByChain, offline, anyLoading, listsRevalidated]);

    const loadErrors = useMemo(() => (
        Object.entries(listsByChain)
            .filter(([, s]) => s.error)
            .map(([cid, s]) => chainRegistry.get(cid)?.displayName || cid)
    ), [listsByChain]);

    const visibleRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return allRows.filter((row) => {
            if (network !== 'all' && coinFromChainId(row.chainId) !== network) return false;
            if (!q) return true;
            // The row's own title (name and index) and kind are searchable, so what
            // the list shows is what the search finds.
            const kind = String(row.type) === '1' ? 'Token list' : 'Address list';
            return [
                row.source, row.status, String(row.action_index ?? ''),
                row.list_action_index != null ? String(row.list_action_index) : '',
                row.name, listLabel(row.action_index ?? '?', row.name, kind), kind,
            ].some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
        });
    }, [allRows, query, network]);

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            title="My lists"
        />
    );
    // The page header holds only the title and Back, so every action of the
    // screen sits in the content's actions row, in every state. An empty
    // list offers Create list from its EmptyState instead, so the screen
    // never shows it twice.
    const actionsFor = (emptyOffersCreate) => (
        (onCreateList && !emptyOffersCreate) || onOpenSharedLists || onCreateUnionList ? (
            <>
                {onCreateList && !emptyOffersCreate ? (
                    <Button
                        type="button"
                        variant="secondary"
                        icon={<Icon.PlusIcon />}
                        onClick={() => onCreateList()}
                    >
                        Create list
                    </Button>
                ) : null}
                {onOpenSharedLists ? (
                    <Button variant="secondary" onClick={() => onOpenSharedLists()}>Shared lists</Button>
                ) : null}
                {onCreateUnionList ? (
                    <Button variant="secondary" onClick={() => onCreateUnionList()}>Create union list</Button>
                ) : null}
            </>
        ) : null
    );

    const wrap = (children, toolbar, { notices = null, emptyOffersCreate = false } = {}) => (
        <Screen variant={variant} header={header}>
            <ListPage notices={notices} actions={actionsFor(emptyOffersCreate)} toolbar={toolbar}>
                {children}
            </ListPage>
        </Screen>
    );

    if (addressesError) {
        return wrap(null, undefined, {
            notices: (
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
            ),
        });
    }
    if (!addressesByChain) {
        return wrap(
            <div aria-hidden="true"><Skeleton.List rows={5} /></div>,
            undefined,
            { notices: <StatusMessage variant="status" label={t('routes.myLists.loading')} busy>{t('routes.myLists.loading')}</StatusMessage> },
        );
    }
    if (Object.keys(addressesByChain).length === 0) {
        return wrap(
            <EmptyState
                title="No supported address"
                body="Publishing a list requires an address on a supported network."
                titleAs="p"
            />,
        );
    }

    const toolbar = (
        <ListToolbar query={query} onQueryChange={setQuery} searchLabel="Search lists">
            <NetworkFilterDropdown value={network} onChange={setNetwork} />
        </ListToolbar>
    );

    // Offline, the screen's one message is its offline state below.
    const loadingNotice = anyLoading && visibleRows.length === 0 && !offline;
    const notices = loadErrors.length > 0 && !offline ? (
        <StatusMessage
            variant="error"
            className={styles.entryDescription}
            recovery={{
                label: 'Try again',
                onAction: () => {
                    setListsByChain({});
                    setListsReload((value) => value + 1);
                },
            }}
        >
            {/* Names the chains only: the raw fetch error carries API paths and
                HTTP codes that mean nothing to the user. */}
            Couldn't load your lists for {loadErrors.join(', ')}. Try again in a moment.
        </StatusMessage>
    ) : loadingNotice ? (
        <StatusMessage variant="status" label={t('routes.myLists.loading')} busy>{t('routes.myLists.loading')}</StatusMessage>
    ) : null;
    const emptyOffersCreate = !anyLoading && loadErrors.length === 0 && allRows.length === 0;

    return wrap(
        <>
            {offline && allRows.length === 0 ? (
                <OfflineEmptyState body="Your lists load when the connection returns." onRetry={recheck} />
            ) : loadingNotice ? (
                <div aria-hidden="true">
                    <Skeleton.List rows={5} />
                </div>
            ) : loadErrors.length > 0 && allRows.length === 0 ? (
                null
            ) : visibleRows.length === 0 ? (
                allRows.length === 0 ? (
                    <EmptyState
                        title="No lists yet"
                        body="Create an address list for airdrops or a token list for project rosters and gates."
                        actionLabel={onCreateList ? 'Create list' : undefined}
                        onAction={onCreateList ? () => onCreateList() : undefined}
                    />
                ) : (
                    <EmptyState title="No matching lists" body="Try a different search or network filter." titleAs="p" />
                )
            ) : (
                <ul className={local.list} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {visibleRows.map((row, index) => (
                        <li
                            key={`${row.chainId}:${row.action_index}`}
                            style={{ borderTop: index === 0 ? 'none' : '1px solid var(--xc-border)' }}
                        >
                            <MyListRow
                                row={row}
                                onSelect={() => onOpenList(row.chainId, String(row.action_index))}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </>,
        toolbar,
        { notices, emptyOffersCreate },
    );
}

function MyListRow({ row, onSelect }) {
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    const isTick = String(row.type) === '1';
    const isFork = row.list_action_index != null && row.list_action_index !== '';
    // Show one word in the badge (a short uppercase pill) and put the plain
    // reason for a refused list in its tooltip; never the indexer's code.
    const statusWhy = listStatusText(row.status);
    const valid = String(row.status ?? '').trim().toLowerCase() === 'valid';
    let statusLabel = 'Unavailable';
    let statusTitle;
    if (valid) statusLabel = 'Valid';
    else if (statusWhy === 'pending') statusLabel = 'Pending';
    else if (statusWhy) {
        statusLabel = 'Rejected';
        statusTitle = `Rejected: ${statusWhy}`;
    }
    const index = row.action_index ?? '?';
    const kind = isTick ? 'Token list' : 'Address list';
    const label = listLabel(index, row.name, kind);
    const ariaLabel = `Open ${listLabel(index, row.name, kind.toLowerCase())}`;
    return (
        <ListRow
            type="button"
            className={local.row}
            onClick={onSelect}
            aria-label={ariaLabel}
            leading={(
                <span className={local.iconWrap}>
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
                </span>
            )}
            title={<span className={local.name}>{label}</span>}
            subtitle={isFork
                ? `Forked from #${row.list_action_index} (${row.edit === '2' ? 'removed items' : 'added items'})`
                : 'Created list'}
            trailingClassName={local.statusSlot}
            trailing={(
                <span
                    className={`${local.status} ${valid ? local.status_valid : local.status_invalid}`}
                    title={statusTitle}
                >
                    {statusLabel}
                </span>
            )}
        />
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
