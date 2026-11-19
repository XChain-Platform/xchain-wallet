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
import { Button, EmptyState, Icon, ListPage, ListRow, PageHeader, Screen, Select, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '../../branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { sharedListDirectoryChainId } from '../chainSelection.js';
import { homeDescriptor, useSharedListDirectory } from '../hooks/useSharedListDirectory.js';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { OfflineEmptyState } from '../components/OfflineEmptyState.jsx';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { listLabel } from '../utils/listLabel.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
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
 * The filter's Show choice adds the shared-list directory (the Shared lists
 * screen's own loader) as the same list rows: My lists (default), Shared
 * with me, or All.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.activeAccountId]   scope the address union to this account
 * @param {(chainId: string, actionIndex: string, shared?: { origin: 'shared', directoryChainId: string | null }) => void} props.onOpenList
 * @param {() => void} [props.onCreateList]  opens the Create list form
 * @param {() => void} props.onBack
 * @param {'mine' | 'shared' | 'all'} [props.initialShow]  the filter's first Show choice (a deep link to Shared with me passes 'shared')
 */
export function MyLists(props) {
    const { walletId, activeAccountId } = props;
    const listKey = `${walletId}:${activeAccountId || ''}`;
    return <MyListsScreen key={listKey} {...props} />;
}

function MyListsScreen({ walletId, activeAccountId, onOpenList, onCreateList, onBack, initialShow = 'mine' }) {
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
    // Which lists show: the wallet's own, the shared-list directory, or both.
    const [show, setShow] = useState(/** @type {'mine' | 'shared' | 'all'} */ (initialShow));

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
                    .catch((err) => ({ addr, error: userFacingMessage(err, 'Failed to load lists.') }))
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

    // Shared with me: the Shared lists screen's own directory loader, read on
    // the wallet's network, shown as the same rows as the wallet's lists. It
    // reads only once Show asks for it.
    const directoryChainId = useMemo(() => {
        const firstChain = addressesByChain ? Object.keys(addressesByChain)[0] : null;
        return firstChain ? sharedListDirectoryChainId(null, chainRegistry.get(firstChain)?.networkKind) : null;
    }, [addressesByChain]);
    const shared = useSharedListDirectory({
        messaging,
        chainId: directoryChainId,
        enabled: show !== 'mine',
        scopeKey: walletId,
    });
    const sharedRows = useMemo(() => (shared.directory?.lists || []).map((entry) => {
        const descriptor = homeDescriptor(entry.homeChain, directoryChainId);
        if (!descriptor?.id) return null;
        return {
            chainId: descriptor.id,
            action_index: String(entry.homeListIndex),
            name: entry.name,
            type: entry.type === 'token' ? '1' : '2',
            status: 'valid',
            source: typeof entry.owner === 'string' ? entry.owner : '',
            shared: true,
        };
    }).filter(Boolean), [shared.directory, directoryChainId]);
    const sharedLoading = show !== 'mine' && !shared.directory && !shared.loadError;

    const shownRows = useMemo(() => {
        if (show === 'mine') return allRows;
        if (show === 'shared') return sharedRows;
        const seen = new Set(allRows.map((row) => `${row.chainId}:${row.action_index}`));
        return [...allRows, ...sharedRows.filter((row) => !seen.has(`${row.chainId}:${row.action_index}`))];
    }, [show, allRows, sharedRows]);

    const visibleRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return shownRows.filter((row) => {
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
    }, [shownRows, query, network]);

    // The title bar holds the filter (search, Network, Show) and, at the far
    // right, Create list as a plain plus; the page body is only the list and
    // the empty state is text only.
    const plus = onCreateList ? (
        <Button
            type="button"
            variant="secondary"
            icon={<Icon.PlusIcon />}
            aria-label="Create list"
            title="Create list"
            onClick={() => onCreateList()}
        >
            {null}
        </Button>
    ) : null;

    const wrap = (children, filterMenu = null, { notices = null } = {}) => (
        <Screen
            variant={variant}
            header={(
                <PageHeader
                    onBack={onBack}
                    backLabel="Back to home"
                    title="My Lists"
                    trailing={filterMenu || plus ? <>{filterMenu}{plus}</> : null}
                />
            )}
        >
            <ListPage notices={notices}>
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
                        label: 'Try Again',
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

    const filterMenu = (
        <ListFilterMenu
            query={query}
            onQueryChange={setQuery}
            active={network !== 'all' || show !== 'mine'}
            label="Filter lists"
            searchPlaceholder="Search"
            searchLabel="Search lists"
        >
            <NetworkFilterDropdown value={network} onChange={setNetwork} iconOnly={false} />
            <Select
                aria-label="Show lists"
                size="md"
                value={show}
                onChange={(event) => setShow(/** @type {'mine' | 'shared' | 'all'} */ (event.target.value))}
            >
                <Select.Option value="mine" icon={<Icon.UserIcon />}>My lists</Select.Option>
                <Select.Option value="shared" icon={<Icon.ShareIcon />}>Shared with me</Select.Option>
                <Select.Option value="all" icon={<Icon.ListIcon />}>All lists</Select.Option>
            </Select>
        </ListFilterMenu>
    );

    // The wallet's own lists count only when Show includes them, and the
    // directory only when Show asks for it.
    const mineErrors = show === 'shared' ? [] : loadErrors;
    const sharedError = show === 'mine' ? null : shared.loadError;
    // Offline, the screen's one message is its offline state below.
    const loadingNotice = ((show !== 'shared' && anyLoading) || sharedLoading) && visibleRows.length === 0 && !offline;
    const notices = sharedError && !offline ? (
        <StatusMessage
            variant="error"
            className={styles.entryDescription}
            recovery={{ label: 'Try Again', onAction: shared.reload }}
        >
            Couldn't load the shared lists. Try again in a moment.
        </StatusMessage>
    ) : mineErrors.length > 0 && !offline ? (
        <StatusMessage
            variant="error"
            className={styles.entryDescription}
            recovery={{
                label: 'Try Again',
                onAction: () => {
                    setListsByChain({});
                    setListsReload((value) => value + 1);
                },
            }}
        >
            {/* Names the chains only: the raw fetch error carries API paths and
                HTTP codes that mean nothing to the user. */}
            Couldn't load your lists for {mineErrors.join(', ')}. Try again in a moment.
        </StatusMessage>
    ) : loadingNotice ? (
        <StatusMessage variant="status" label={t('routes.myLists.loading')} busy>{t('routes.myLists.loading')}</StatusMessage>
    ) : null;
    return wrap(
        <>
            {offline && shownRows.length === 0 ? (
                <OfflineEmptyState body="Your lists load when the connection returns." onRetry={recheck} />
            ) : loadingNotice ? (
                <div aria-hidden="true">
                    <Skeleton.List rows={5} />
                </div>
            ) : (mineErrors.length > 0 || sharedError) && shownRows.length === 0 ? (
                null
            ) : visibleRows.length === 0 ? (
                shownRows.length === 0 ? (
                    show === 'shared' ? (
                        <EmptyState
                            title="No shared lists yet"
                            body="Published shared lists appear here after you or someone else publishes one."
                        />
                    ) : (
                        <EmptyState
                            title="No lists yet"
                            body="Create an address list for airdrops or a token list for project rosters and gates."
                        />
                    )
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
                                onSelect={() => (row.shared
                                    ? onOpenList(row.chainId, String(row.action_index), { origin: 'shared', directoryChainId })
                                    : onOpenList(row.chainId, String(row.action_index)))}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </>,
        filterMenu,
        { notices },
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
            chevron
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
