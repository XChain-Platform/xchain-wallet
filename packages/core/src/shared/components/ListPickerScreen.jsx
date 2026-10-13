// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ListPickerScreen (PC-04): a full-screen picker over the LIST actions
// the wallet has published from its own addresses on a chain, fanning
// `messaging.getListsForSource` over each address and merging by
// action_index (same read MyLists + AirdropForm's private picker use).
//
// `filterType` restricts the choices: '2' = address lists only (the
// ALLOW_LIST / BLOCK_LIST access-list use case), '1' = token lists, or
// omit for all. Each row's member count comes from a per-list
// `getListByActionIndex` read so the owner sees how many entries a list
// carries before binding it to a token.
//
// `includeUnions` (default false) also offers union lists (type 3) whose
// first member list has the requested `filterType`; a union whose member
// read fails or that has no members is left out.

import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, ListPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { contactsPickerStyles as styles } from './ContactsPickerScreen.jsx';
import { currentListItems, currentListMemberCount } from '../../flows/listMembership.js';
import { listLabel } from '../utils/listLabel.js';
import { neutralizeControlText } from '../utils/textHardening.js';

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

/**
 * @param {object} props
 * @param {'small' | 'full' | 'compact'} props.variant
 * @param {{
 *   getListsForSource: (req: { chainId: string, address: string }) => Promise<unknown>,
 *   getListByActionIndex: (req: { chainId: string, actionIndex: string }) => Promise<unknown>,
 * }} props.messaging
 * @param {string} props.chainId
 * @param {any[]} props.addresses            the wallet's own addresses on chainId
 * @param {'1' | '2'} [props.filterType]     restrict to token ('1') or address ('2') lists
 * @param {boolean} [props.includeUnions]   also list union lists whose first member matches filterType
 * @param {string} [props.title]
 * @param {(row: { actionIndex: string, type: string, memberCount: number | null, name?: string }) => void} props.onSelect
 * @param {() => void} props.onBack
 */
export function ListPickerScreen({
    variant, messaging, chainId, addresses, filterType, includeUnions = false, title = 'Choose a list', onSelect, onBack,
}) {
    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [counts, setCounts] = useState(/** @type {Record<string, number | null>} */ ({}));
    const [descriptions, setDescriptions] = useState(/** @type {Record<string, string | null>} */ ({}));
    const [query, setQuery] = useState('');
    const [loadAttempt, setLoadAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setRows(null);
        setLoadError(null);
        const addrList = (addresses || []).map((a) => a.address).filter(Boolean);
        if (addrList.length === 0) { setRows([]); return undefined; }
        Promise.all(addrList.map((addr) => messaging.getListsForSource({ chainId, address: addr })
            .then((resp) => extractListRows(resp))))
            .then(async (results) => {
                if (cancelled) return;
                const merged = results.flat();
                const seen = new Set();
                let uniq = merged.filter((row) => {
                    const key = String(row.action_index ?? row.tx_hash ?? JSON.stringify(row));
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                // A rejected LIST action cannot enforce an access filter and
                // must not be offered as a bindable allow-list or block-list.
                // Pending lists are not rejected and stay selectable.
                uniq = uniq.filter((row) => !row.status
                    || ['valid', 'pending'].includes(String(row.status).trim().toLowerCase()));
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
            })
            .catch(() => { if (!cancelled) setLoadError('Couldn’t load lists. Check your connection and try again.'); });
        return () => { cancelled = true; };
    }, [chainId, addresses, messaging, filterType, includeUnions, loadAttempt]);

    // Best-effort member counts for the shown lists (one detail read each).
    useEffect(() => {
        if (!rows || rows.length === 0) return undefined;
        if (typeof messaging.getListByActionIndex !== 'function') return undefined;
        let cancelled = false;
        (async () => {
            for (const row of rows) {
                const idx = String(row.action_index ?? '');
                if (!idx || counts[idx] !== undefined) continue;
                try {
                    const detail = await messaging.getListByActionIndex({ chainId, actionIndex: idx });
                    if (cancelled) return;
                    // Count the newest valid edit's members: what a gate bound to this index checks
                    setCounts((prev) => ({ ...prev, [idx]: currentListMemberCount(detail) }));
                    setDescriptions((prev) => ({
                        ...prev,
                        [idx]: typeof detail?.description === 'string' && detail.description.length > 0
                            ? detail.description
                            : null,
                    }));
                } catch {
                    if (cancelled) return;
                    setCounts((prev) => ({ ...prev, [idx]: null }));
                    setDescriptions((prev) => ({ ...prev, [idx]: null }));
                }
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, chainId, messaging]);

    const visibleRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q || !rows) return rows || [];
        return rows.filter((row) => {
            const idx = String(row.action_index ?? '');
            const kind = String(row.type) === '3'
                ? 'union'
                : String(row.type) === '1' ? 'token' : 'address';
            return [
                idx,
                row.name,
                descriptions[idx],
                row.description,
                row.status,
                kind,
            ].some((value) => String(value ?? '').toLowerCase().includes(q));
        });
    }, [rows, query, descriptions]);

    const header = <PageHeader onBack={onBack} title={title} />;

    if (loadError) {
        return (
            <Screen variant={variant} header={header}>
                <ListPage>
                    <StatusMessage variant="error" className={styles.abEmpty}>{loadError}</StatusMessage>
                    <Button variant="secondary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
                        Retry
                    </Button>
                </ListPage>
            </Screen>
        );
    }
    if (!rows) {
        return <Screen variant={variant} header={header}><ListPage><div className={styles.abEmpty}>Loading lists…</div></ListPage></Screen>;
    }
    if (rows.length === 0) {
        return (
            <Screen variant={variant} header={header}>
                <ListPage>
                    <EmptyState
                        title={filterType === '2'
                            ? 'No address lists yet'
                            : 'No published lists yet'}
                        body={filterType === '2'
                            ? 'Address lists published from this chain appear here.'
                            : 'Lists published from this chain appear here.'}
                        titleAs="p"
                        role={null}
                    />
                </ListPage>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <ListPage toolbar={(
                <input
                    type="search"
                    enterKeyHint="search"
                    autoCapitalize="off"
                    role="textbox"
                    className={styles.abSearch}
                    placeholder="Search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Search lists"
                />
            )}>
                {visibleRows.length === 0 ? (
                    <EmptyState
                        title="No matching lists"
                        body="Try a different search."
                        titleAs="p"
                        role={null}
                    />
                ) : (
                    <ul className={styles.abList}>
                        {visibleRows.map((row) => {
                            const idx = String(row.action_index ?? '?');
                            const isTick = String(row.type) === '1';
                            const isUnion = String(row.type) === '3';
                            const status = String(row.status || '');
                            const count = counts[idx];
                            const kind = isUnion ? 'Union' : isTick ? 'Token' : 'Address';
                            const titleLabel = typeof row.name === 'string' && row.name.length > 0
                                ? listLabel(idx, row.name)
                                : `${kind} list #${idx}`;
                            const rawDescription = descriptions[idx] || row.description;
                            const description = typeof rawDescription === 'string' && rawDescription.length > 0
                                ? neutralizeControlText(rawDescription)
                                : '';
                            const countText = count === undefined ? 'counting…' : count == null ? 'members unavailable' : `${count} member${count === 1 ? '' : 's'}`;
                            return (
                                <li key={idx}>
                                    <button
                                        type="button"
                                        className={styles.abRow}
                                        onClick={() => onSelect({
                                            actionIndex: idx,
                                            type: String(row.type),
                                            memberCount: count ?? null,
                                            ...(typeof row.name === 'string' && row.name.length > 0
                                                ? { name: row.name }
                                                : {}),
                                        })}
                                    >
                                        <span className={styles.abName}>
                                            {titleLabel}
                                            {status && status !== 'valid' ? ` (${status})` : ''}
                                        </span>
                                        <span className={styles.abAddr}>
                                            {description && count !== undefined
                                                ? `${countText} · ${description}`
                                                : countText}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </ListPage>
        </Screen>
    );
}
