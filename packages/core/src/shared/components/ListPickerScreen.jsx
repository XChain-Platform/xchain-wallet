// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ListPickerScreen (PC-04): a full-screen picker over LIST actions, in three
// views on one full-width toggle:
//
//   My lists  the lists the wallet published from its own addresses on a
//             chain, fanning `messaging.getListsForSource` over each address
//             and merging by action_index (same read MyLists uses).
//   All       those lists plus every list in the shared-list directory
//             (useSharedListDirectory) that is mirrored onto this chain. A
//             search of digits also looks that list index up directly, so a
//             list published by anyone is reachable by its index.
//   Recent    the lists this wallet picked lately on this chain, kept
//             locally per wallet (utils/listPickerRecents.js). Shown when the
//             caller passes walletId.
//
// My lists opens first when the wallet has lists, otherwise All. Search sits
// behind the title bar filter (G95) and narrows the open view by name,
// description or list index. Rows only select, so they carry no chevron (G97).
//
// `filterType` restricts the choices: '2' = address lists only (the
// ALLOW_LIST / BLOCK_LIST access-list use case), '1' = token lists, or
// omit for all. Each own row's member count comes from a per-list
// `getListByActionIndex` read so the owner sees how many entries a list
// carries before binding it to a token; a directory row carries its count.
//
// `includeUnions` (default false) also offers union lists (type 3) whose
// first member list has the requested `filterType`; a union whose member
// read fails or that has no members is left out.

import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Icon, ListPage, ListRow, PageHeader, Screen, SegmentedControl, StatusMessage } from '@xchain-wallet/core/ui';
import { contactsPickerStyles as styles } from './ContactsPickerScreen.jsx';
import { ListFilterMenu } from './ListFilterMenu.jsx';
import { currentListItems, currentListMemberCount } from '../../flows/listMembership.js';
import { listLabel } from '../utils/listLabel.js';
import { listStatusText } from '../utils/listItemStatusText.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { formatDecimalAmount } from '../utils/amountFormat.js';
import { listType, useSharedListDirectory } from '../hooks/useSharedListDirectory.js';
import { directoryText, orderSharedLists, pickableSharedLists } from '../utils/sharedListRows.js';
import { validActionIndex } from '../utils/sharedBlockPick.js';
import { readListPickerRecents, recordListPickerRecent } from '../utils/listPickerRecents.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/common.js';
import '../../i18n/locales/en/ui.js';

// Lists read at once while counting members; the explorer rate-limits a burst.
const LIST_DETAIL_CONCURRENCY = 4;
// A typed list index is looked up once typing pauses this long.
const INDEX_LOOKUP_DELAY_MS = 300;

function firstMemberIndex(detail) {
    const first = (currentListItems(detail) || [])[0];
    const idx = first && typeof first === 'object' ? first.action_index : first;
    return idx == null || idx === '' ? null : String(idx);
}

async function unionMatchesType(messaging, chainId, row, filterType) {
    if (typeof messaging.getListByActionIndex !== 'function') return false;
    try {
        const union = await messaging.getListByActionIndex({ chainId, actionIndex: String(row.action_index) });
        const memberIdx = firstMemberIndex(union);
        if (!memberIdx) return false;
        const member = await messaging.getListByActionIndex({ chainId, actionIndex: memberIdx });
        return String(member?.type) === String(filterType);
    } catch {
        return false;
    }
}

function extractListRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

function bindableStatus(status) {
    return !status || ['valid', 'pending'].includes(String(status).trim().toLowerCase());
}

function typeNumber(type) {
    const word = listType(type);
    if (word === 'token') return '1';
    if (word === 'address') return '2';
    return String(type ?? '');
}

function typeWord(type) {
    if (String(type) === '3') return t('components.listPickerScreen.typeUnion');
    if (String(type) === '1') return t('components.listPickerScreen.typeToken');
    return t('components.listPickerScreen.typeAddress');
}

function memberCountOrNull(value) {
    if (value == null || value === '') return null;
    const count = Number(value);
    return Number.isFinite(count) ? count : null;
}

/**
 * @param {object} props
 * @param {'small' | 'full' | 'compact'} props.variant
 * @param {{
 *   getListsForSource: (req: { chainId: string, address: string }) => Promise<unknown>,
 *   getListByActionIndex: (req: { chainId: string, actionIndex: string }) => Promise<unknown>,
 *   getSharedLists?: (req: { chainId: string }) => Promise<unknown>,
 * }} props.messaging
 * @param {string} props.chainId
 * @param {any[]} props.addresses            the wallet's own addresses on chainId
 * @param {'1' | '2'} [props.filterType]     restrict to token ('1') or address ('2') lists
 * @param {boolean} [props.includeUnions]   also list union lists whose first member matches filterType
 * @param {string} [props.title]
 * @param {string} [props.walletId]          keeps this wallet's recent picks and shows the Recent view
 * @param {'all' | 'recent' | 'mine'} [props.initialTab]   the view to open on, in place of the default
 * @param {(row: { actionIndex: string, type: string, memberCount: number | null, name?: string, homeChain?: string, homeListIndex?: string, shared?: boolean }) => void} props.onSelect
 *        a directory list also carries its home chain and list index, and `shared: true`
 * @param {() => void} props.onBack
 */
export function ListPickerScreen({
    variant, messaging, chainId, addresses, filterType, includeUnions = false, title = t('components.listPickerScreen.chooseAList'),
    walletId, initialTab, onSelect, onBack,
}) {
    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [counts, setCounts] = useState(/** @type {Record<string, number | null>} */ ({}));
    const [descriptions, setDescriptions] = useState(/** @type {Record<string, string | null>} */ ({}));
    const [query, setQuery] = useState('');
    const [loadAttempt, setLoadAttempt] = useState(0);
    const recentsOn = Boolean(walletId);
    const [userTab, setUserTab] = useState(
        /** @type {'all' | 'recent' | 'mine' | null} */ (initialTab === 'recent' && !recentsOn ? null : (initialTab || null)),
    );
    const [recents, setRecents] = useState(() => readListPickerRecents(walletId, chainId));
    const [lookup, setLookup] = useState(/** @type {{ query: string, row: any | null } | null} */ (null));

    // The open view: the caller's or the user's pick, else My lists once the
    // wallet's own lists are known to exist, else All. A failed read of the
    // own lists opens My lists, where its retry is.
    const tab = userTab ?? (loadError ? 'mine' : rows === null ? null : (rows.length > 0 ? 'mine' : 'all'));

    const typeOk = (type) => !filterType
        || String(type) === String(filterType)
        || (includeUnions && String(type) === '3');

    useEffect(() => {
        setRecents(readListPickerRecents(walletId, chainId));
    }, [walletId, chainId]);

    const { directory, loadError: directoryError, reload: reloadDirectory } = useSharedListDirectory({
        messaging,
        chainId,
        enabled: tab === 'all' && typeof messaging?.getSharedLists === 'function',
        scopeKey: walletId || '',
    });

    useEffect(() => {
        let cancelled = false;
        setRows(null);
        setLoadError(null);
        setCounts({});
        setDescriptions({});
        const addrList = (addresses || []).map((a) => a.address).filter(Boolean);
        if (addrList.length === 0) { setRows([]); return undefined; }
        Promise.all(addrList.map((addr) => Promise.resolve()
            .then(() => messaging.getListsForSource({ chainId, address: addr }))
            .then((resp) => extractListRows(resp))))
            .then(async (results) => {
                if (cancelled) return;
                const merged = results.flat();
                const seen = new Set();
                let uniq = merged.filter((row) => {
                    if (row?.action_index == null || row.action_index === '') return false;
                    const key = String(row.action_index);
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                // A rejected LIST action cannot enforce an access filter and
                // must not be offered as a bindable allow-list or block-list.
                // Pending lists are not rejected and stay selectable.
                uniq = uniq.filter((row) => bindableStatus(row.status));
                if (filterType) {
                    const keep = await Promise.all(uniq.map(async (row) => {
                        if (String(row.type) === String(filterType)) return true;
                        if (includeUnions && String(row.type) === '3') {
                            return unionMatchesType(messaging, chainId, row, filterType);
                        }
                        return false;
                    }));
                    if (cancelled) return;
                    uniq = uniq.filter((_, i) => keep[i]);
                }
                uniq.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
                setRows(uniq);
                if (typeof messaging.getListByActionIndex !== 'function') return;
                // Counts arrive a few at a time. A state update per list
                // re-renders every row each time, which grows with the square
                // of the list count and froze the screen for a wallet with
                // hundreds of lists, so results are buffered and flushed in
                // batches.
                let pendingCounts = {};
                let pendingDescriptions = {};
                let flushTimer = null;
                const flush = () => {
                    flushTimer = null;
                    if (cancelled) return;
                    const nextCounts = pendingCounts;
                    const nextDescriptions = pendingDescriptions;
                    pendingCounts = {};
                    pendingDescriptions = {};
                    setCounts((prev) => ({ ...prev, ...nextCounts }));
                    setDescriptions((prev) => ({ ...prev, ...nextDescriptions }));
                };
                const queue = [...uniq];
                const readNext = async () => {
                    while (queue.length >= 1 && !cancelled) {
                        const idx = String(queue.shift().action_index);
                        try {
                            // eslint-disable-next-line no-await-in-loop
                            const detail = await messaging.getListByActionIndex({ chainId, actionIndex: idx });
                            pendingCounts[idx] = currentListMemberCount(detail);
                            pendingDescriptions[idx] = typeof detail?.description === 'string' && detail.description.length > 0
                                ? detail.description
                                : null;
                        } catch {
                            pendingCounts[idx] = null;
                            pendingDescriptions[idx] = null;
                        }
                        if (!cancelled && flushTimer === null) flushTimer = setTimeout(flush, 100);
                    }
                };
                await Promise.all(Array.from({ length: LIST_DETAIL_CONCURRENCY }, readNext));
                if (flushTimer !== null) clearTimeout(flushTimer);
                flush();
            })
            .catch(() => { if (!cancelled) setLoadError('Couldn’t load lists. Check your connection and try again.'); });
        return () => { cancelled = true; };
    }, [chainId, addresses, messaging, filterType, includeUnions, loadAttempt]);

    // The wallet's own lists as picker rows.
    const ownRows = useMemo(() => (rows || []).map((row) => {
        const idx = String(row.action_index);
        return {
            key: `own:${idx}`,
            actionIndex: idx,
            type: String(row.type),
            name: typeof row.name === 'string' && row.name.length > 0 ? row.name : null,
            description: descriptions[idx] || row.description || null,
            status: row.status,
            memberCount: counts[idx],
            shared: null,
        };
    }), [rows, counts, descriptions]);

    // Directory lists mirrored onto this chain, minus the wallet's own.
    const sharedRows = useMemo(() => {
        if (!directory) return [];
        const own = new Set(ownRows.map((row) => row.actionIndex));
        const entries = filterType
            ? pickableSharedLists(directory.lists, listType(filterType))
            : orderSharedLists(directory.lists).filter((entry) => validActionIndex(entry.bindTarget));
        return entries
            .filter((entry) => !own.has(String(entry.bindTarget)))
            .map((entry) => ({
                key: `shared:${entry.homeChain}:${entry.homeListIndex}`,
                actionIndex: String(entry.bindTarget),
                type: typeNumber(entry.type),
                name: entry.name,
                description: typeof entry.description === 'string' ? entry.description : null,
                status: null,
                memberCount: memberCountOrNull(entry.memberCount),
                shared: { homeChain: String(entry.homeChain), homeListIndex: String(entry.homeListIndex) },
            }));
    }, [directory, ownRows, filterType]);

    const recentRows = useMemo(() => recents
        .filter((entry) => typeOk(entry.type))
        .map((entry) => {
            const own = ownRows.find((row) => row.actionIndex === entry.actionIndex);
            return {
                key: `recent:${entry.actionIndex}`,
                actionIndex: entry.actionIndex,
                type: entry.type,
                name: entry.name || own?.name || null,
                description: own?.description || null,
                status: own?.status,
                memberCount: own && own.memberCount !== undefined ? own.memberCount : entry.memberCount,
                shared: entry.homeChain ? { homeChain: entry.homeChain, homeListIndex: entry.homeListIndex } : null,
            };
        }),
    // typeOk reads only filterType and includeUnions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recents, ownRows, filterType, includeUnions]);

    const baseRows = tab === 'mine' ? ownRows
        : tab === 'recent' ? recentRows
            : tab === 'all' ? [...ownRows, ...sharedRows]
                : [];

    const trimmedQuery = query.trim();
    const knownIndexes = useMemo(
        () => new Set([...ownRows, ...sharedRows].map((row) => row.actionIndex)),
        [ownRows, sharedRows],
    );
    const lookupWanted = tab === 'all' && validActionIndex(trimmedQuery) && !knownIndexes.has(trimmedQuery)
        && typeof messaging?.getListByActionIndex === 'function';

    // All: a list index nobody's directory row carries is looked up directly,
    // so any published list of the right type is reachable by its number.
    useEffect(() => {
        if (!lookupWanted) { setLookup(null); return undefined; }
        let cancelled = false;
        const wanted = trimmedQuery;
        const timer = setTimeout(() => {
            Promise.resolve()
                .then(() => messaging.getListByActionIndex({ chainId, actionIndex: wanted }))
                .then(async (detail) => {
                    if (cancelled) return;
                    const type = detail?.type == null ? '' : String(detail.type);
                    const isList = detail && typeof detail === 'object'
                        && (detail.action == null || String(detail.action).toUpperCase() === 'LIST');
                    let ok = Boolean(isList && type && bindableStatus(detail.status) && typeOk(type));
                    if (ok && filterType && type === '3') {
                        ok = await unionMatchesType(messaging, chainId, { action_index: wanted }, filterType);
                    }
                    if (cancelled) return;
                    setLookup({
                        query: wanted,
                        row: ok ? {
                            key: `lookup:${wanted}`,
                            actionIndex: String(detail.action_index ?? wanted),
                            type,
                            name: typeof detail.name === 'string' && detail.name.length > 0 ? detail.name : null,
                            description: typeof detail.description === 'string' ? detail.description : null,
                            status: detail.status,
                            memberCount: currentListMemberCount(detail),
                            shared: null,
                        } : null,
                    });
                })
                .catch(() => { if (!cancelled) setLookup({ query: wanted, row: null }); });
        }, INDEX_LOOKUP_DELAY_MS);
        return () => { cancelled = true; clearTimeout(timer); };
    // typeOk reads only filterType and includeUnions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lookupWanted, trimmedQuery, chainId, messaging, filterType, includeUnions]);

    const visibleRows = useMemo(() => {
        const q = trimmedQuery.toLowerCase();
        const matched = !q ? baseRows : baseRows.filter((row) => [
            row.actionIndex,
            row.name,
            row.description,
            row.status,
            typeWord(row.type),
            row.shared?.homeChain,
            row.shared?.homeListIndex,
        ].some((value) => String(value ?? '').toLowerCase().includes(q)));
        if (lookupWanted && lookup?.query === trimmedQuery && lookup.row) return [...matched, lookup.row];
        return matched;
    }, [baseRows, trimmedQuery, lookupWanted, lookup]);

    const choose = (row) => {
        const pick = {
            actionIndex: row.actionIndex,
            type: String(row.type),
            memberCount: row.memberCount ?? null,
            ...(typeof row.name === 'string' && row.name.length > 0 ? { name: row.name } : {}),
            ...(row.shared ? { homeChain: row.shared.homeChain, homeListIndex: row.shared.homeListIndex, shared: true } : {}),
        };
        recordListPickerRecent(walletId, chainId, pick);
        setRecents(readListPickerRecents(walletId, chainId));
        onSelect(pick);
    };

    const header = (
        <PageHeader
            nested
            onBack={onBack}
            title={title}
            trailing={(
                <ListFilterMenu
                    query={query}
                    onQueryChange={setQuery}
                    label={t('components.listPickerScreen.filterLists')}
                    searchPlaceholder={t('components.listPickerScreen.searchPlaceholder')}
                    searchLabel={t('components.listPickerScreen.searchLists')}
                />
            )}
        />
    );

    const toggle = tab ? (
        <SegmentedControl
            aria-label={t('components.listPickerScreen.views')}
            value={tab}
            onChange={(next) => setUserTab(/** @type {'all' | 'recent' | 'mine'} */ (next))}
            items={[
                { id: 'all', label: <><Icon.TokenListIcon aria-hidden="true" /><span>{t('components.listPickerScreen.tabAll')}</span></> },
                ...(recentsOn ? [{ id: 'recent', label: <><Icon.ClockIcon aria-hidden="true" /><span>{t('ui.addressCombobox.recent')}</span></> }] : []),
                { id: 'mine', label: <><Icon.WalletIcon aria-hidden="true" /><span>{t('components.listPickerScreen.tabMine')}</span></> },
            ]}
        />
    ) : null;

    const wrap = (body, notices = null) => (
        <Screen variant={variant} header={header}>
            <ListPage toolbar={toggle} notices={notices}>{body}</ListPage>
        </Screen>
    );

    if (loadError && tab !== 'all') {
        return wrap(
            <>
                <StatusMessage variant="error" className={styles.abEmpty}>{loadError}</StatusMessage>
                <Button variant="secondary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
                    {t('home.retryBalances')}
                </Button>
            </>,
        );
    }
    if (!tab || (tab !== 'recent' && !rows && !loadError)) {
        return wrap(<div className={styles.abEmpty}>{t('components.listPickerScreen.loadingLists')}</div>);
    }

    const directoryNotice = tab === 'all' && (directoryError || loadError) ? (
        <StatusMessage
            variant="error"
            recovery={{
                label: t('common.tryAgain'),
                onAction: () => {
                    if (directoryError) reloadDirectory();
                    if (loadError) setLoadAttempt((attempt) => attempt + 1);
                },
            }}
        >
            {directoryError ? t('components.listPickerScreen.publishedListsUnavailable') : loadError}
        </StatusMessage>
    ) : null;
    const directoryLoading = tab === 'all' && !directory && !directoryError
        && typeof messaging?.getSharedLists === 'function';

    let empty = null;
    if (visibleRows.length === 0) {
        if (directoryLoading) {
            empty = <div className={styles.abEmpty}>{t('components.listPickerScreen.loadingPublishedLists')}</div>;
        } else if (trimmedQuery && baseRows.length > 0) {
            empty = (
                <EmptyState
                    title={t('components.listPickerScreen.noMatchingLists')}
                    body={t('components.listPickerScreen.tryADifferentSearch')}
                    titleAs="p"
                    role={null}
                />
            );
        } else if (tab === 'recent') {
            empty = (
                <EmptyState
                    title={t('components.listPickerScreen.noRecentLists')}
                    body={t('components.listPickerScreen.recentListsAppearHere')}
                    titleAs="p"
                    role={null}
                />
            );
        } else if (tab === 'all') {
            empty = (
                <EmptyState
                    title={t('components.listPickerScreen.noListsFound')}
                    body={t('components.listPickerScreen.publishedListsAppearHere')}
                    titleAs="p"
                    role={null}
                />
            );
        } else {
            empty = (
                <EmptyState
                    title={filterType === '2'
                        ? t('components.listPickerScreen.noAddressListsYet')
                        : t('components.listPickerScreen.noPublishedListsYet')}
                    body={filterType === '2'
                        ? t('components.listPickerScreen.addressListsPublishedFromThis')
                        : t('components.listPickerScreen.listsPublishedFromThisChain')}
                    titleAs="p"
                    role={null}
                />
            );
        }
    }

    return wrap(
        empty || (
            <>
                <ul className={styles.abList}>
                    {visibleRows.map((row) => {
                        const idx = row.actionIndex;
                        const statusWhy = listStatusText(row.status);
                        const count = row.memberCount;
                        const named = typeof row.name === 'string' && row.name.length > 0;
                        const titleLabel = named
                            ? listLabel(idx, row.name)
                            : `${typeWord(row.type)} #${idx}`;
                        const description = typeof row.description === 'string' && row.description.length > 0
                            ? neutralizeControlText(row.description)
                            : '';
                        const countText = count === undefined
                            ? 'counting…'
                            : count == null
                                ? 'members unavailable'
                                : `${formatDecimalAmount(count)} member${count === 1 ? '' : 's'}`;
                        // A named row's title carries no type, so its line names it.
                        const lead = [
                            named || row.shared ? typeWord(row.type) : null,
                            row.shared ? t('components.listPickerScreen.sharedFrom', {
                                chain: directoryText(row.shared.homeChain),
                                index: directoryText(row.shared.homeListIndex),
                            }) : null,
                            countText,
                        ].filter(Boolean).join(' · ');
                        return (
                            <li key={row.key}>
                                <ListRow
                                    className={styles.abRow}
                                    onClick={() => choose(row)}
                                    title={(
                                        <span className={styles.abName}>
                                            {titleLabel}
                                            {statusWhy ? ` (${statusWhy})` : ''}
                                        </span>
                                    )}
                                    subtitle={(
                                        <span className={styles.abAddr}>
                                            {description && count !== undefined
                                                ? `${lead} · ${description}`
                                                : lead}
                                        </span>
                                    )}
                                />
                            </li>
                        );
                    })}
                </ul>
            </>
        ),
        directoryNotice,
    );
}
