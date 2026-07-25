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

import { useEffect, useState } from 'react';
import { Screen, PageHeader } from '@xchain-wallet/core/ui';
import { contactsPickerStyles as styles } from './ContactsPickerScreen.jsx';

function extractListRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

// A LIST detail row exposes its current members as `list` (the
// explorer's getActionData shape). Count them tolerant of naming.
function memberCountOf(detail) {
    const members = detail?.list ?? detail?.items ?? detail?.members;
    if (Array.isArray(members)) return members.length;
    return null;
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
 * @param {string} [props.title]
 * @param {(row: { actionIndex: string, type: string, memberCount: number | null }) => void} props.onSelect
 * @param {() => void} props.onBack
 */
export function ListPickerScreen({
    variant, messaging, chainId, addresses, filterType, title = 'Choose a list', onSelect, onBack,
}) {
    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [counts, setCounts] = useState(/** @type {Record<string, number | null>} */ ({}));

    useEffect(() => {
        let cancelled = false;
        setRows(null);
        setLoadError(null);
        const addrList = (addresses || []).map((a) => a.address).filter(Boolean);
        if (addrList.length === 0) { setRows([]); return undefined; }
        Promise.all(addrList.map((addr) => messaging.getListsForSource({ chainId, address: addr })
            .then((resp) => extractListRows(resp))))
            .then((results) => {
                if (cancelled) return;
                const merged = results.flat();
                const seen = new Set();
                let uniq = merged.filter((row) => {
                    const key = String(row.action_index ?? row.tx_hash ?? JSON.stringify(row));
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                if (filterType) uniq = uniq.filter((row) => String(row.type) === String(filterType));
                uniq.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
                setRows(uniq);
            })
            .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Failed to load lists.'); });
        return () => { cancelled = true; };
    }, [chainId, addresses, messaging, filterType]);

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
                    setCounts((prev) => ({ ...prev, [idx]: memberCountOf(detail) }));
                } catch {
                    if (cancelled) return;
                    setCounts((prev) => ({ ...prev, [idx]: null }));
                }
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, chainId, messaging]);

    const header = <PageHeader onBack={onBack} title={title} />;

    if (loadError) {
        return <Screen variant={variant} header={header}><div className={styles.abEmpty} role="alert">{loadError}</div></Screen>;
    }
    if (!rows) {
        return <Screen variant={variant} header={header}><div className={styles.abEmpty}>Loading lists…</div></Screen>;
    }
    if (rows.length === 0) {
        return (
            <Screen variant={variant} header={header}>
                <div className={styles.abEmpty}>
                    {filterType === '2'
                        ? 'No address lists published from this chain’s addresses yet. Create one in My Lists first.'
                        : 'No lists published from this chain’s addresses yet.'}
                </div>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <ul className={styles.abList}>
                {rows.map((row) => {
                    const idx = String(row.action_index ?? '?');
                    const isTick = String(row.type) === '1';
                    const status = String(row.status || '');
                    const count = counts[idx];
                    return (
                        <li key={idx}>
                            <button
                                type="button"
                                className={styles.abRow}
                                onClick={() => onSelect({ actionIndex: idx, type: String(row.type), memberCount: count ?? null })}
                            >
                                <span className={styles.abName}>
                                    {isTick ? 'Token' : 'Address'} list #{idx}
                                    {status && status !== 'valid' ? ` (${status})` : ''}
                                </span>
                                <span className={styles.abAddr}>
                                    {count === undefined ? 'counting…' : count == null ? 'members unavailable' : `${count} member${count === 1 ? '' : 's'}`}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </Screen>
    );
}
