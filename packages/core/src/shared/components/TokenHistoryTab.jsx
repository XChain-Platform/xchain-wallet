// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The asset page's History tab: this wallet's own history for one coin or
// token, inline, in the row layout Home's Activity tab and History use.
//
// Reads follow Home's Activity path: one address list read, then one
// first-page history read per address on this chain, so the read count follows
// the address count, never the rows. The rows are scoped the way History is
// when opened from this asset (historyEntryScope.js): the chain for every
// asset, plus History's own search match on the tick for a non-native one.
//
// The rows are one flat list, newest first, with no day headings (operator
// ruling 2026-11-15); each row keeps its own relative time ("2 hours ago").
// A token page reads its rows once for the hero's balance line and hands them
// in as `history`, so the tab adds no second read.

import { useEffect, useMemo, useState } from 'react';
import { EmptyState, Skeleton } from '@xchain-wallet/core/ui';
import { useWalletSource } from '../hooks/useDemoGuard.jsx';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import { readActiveAccount } from '../utils/activeAccountMemory.js';
import { historyResponseRows, normalizeHistoryRow, recentActivityEntries } from '../utils/historyRow.js';
import { applyHistoryFilters } from '../utils/historyFilter.js';
import { historyScopeForAsset } from '../utils/historyEntryScope.js';
import { ActivityEntryRow } from './HomeTabs.jsx';
import homeTabsStyles from './HomeTabs.module.css';
import styles from './TokenHistoryTab.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/tokenDetail.js';

const LOADING_ROWS = 3;

// History's search reads `tick` and `asset` but not the two sides of an order
// or swap, so an order that buys this token would drop out of its own page.
const TICK_KEYS = [
    'give_tick', 'GIVE_TICK', 'get_tick', 'GET_TICK',
    'give_asset', 'GIVE_ASSET', 'get_asset', 'GET_ASSET',
    'dividend_tick', 'DIVIDEND_TICK', 'dividend_asset', 'DIVIDEND_ASSET',
];

function namesTick(entry, tick) {
    const want = String(tick || '').toUpperCase();
    const raw = entry?.raw || {};
    return TICK_KEYS.some((k) => raw[k] != null && String(raw[k]).toUpperCase() === want);
}

/**
 * Load this wallet's rows for one asset on one chain. With `enabled` false
 * nothing is read and the entries stay null.
 *
 * @returns {{ entries: any[] | null, failed: boolean, addresses?: string[] }} entries is null while
 *   loading; addresses are this wallet's own addresses on the chain, as read
 */
export function useTokenHistory({ messaging, walletId, chainId, tick, isNative, enabled = true }) {
    const [state, setState] = useState(
        /** @type {{ entries: any[] | null, failed: boolean, addresses?: string[] }} */ ({ entries: null, failed: false }),
    );
    useEffect(() => {
        if (!enabled) return undefined;
        if (!walletId || !chainId) {
            setState({ entries: [], failed: false });
            return undefined;
        }
        if (typeof messaging?.getAddressesByChain !== 'function' || typeof messaging?.getAddressHistory !== 'function') {
            setState({ entries: [], failed: true });
            return undefined;
        }
        let cancelled = false;
        setState({ entries: null, failed: false });
        const { searchQuery } = historyScopeForAsset({ chainId, tick, kind: isNative ? 'native' : 'token' });
        let addresses = [];
        Promise.resolve(messaging.getAddressesByChain(walletId, readActiveAccount(walletId) || undefined))
            .then((byChain) => {
                const addrs = Array.isArray(byChain?.[chainId]) ? byChain[chainId] : [];
                addresses = addrs.map((a) => a?.address).filter(Boolean);
                return Promise.allSettled(addrs.filter((a) => a?.address).map((a) => (
                    Promise.resolve(messaging.getAddressHistory({ chainId, address: a.address }))
                        .then((response) => historyResponseRows(response)
                            .map((row) => normalizeHistoryRow(row, { chainId, address: a.address }))
                            .filter(Boolean))
                )));
            })
            .then((results) => {
                if (cancelled) return;
                const read = results.filter((r) => r.status === 'fulfilled');
                if (results.length > 0 && read.length === 0) {
                    setState({ entries: [], failed: true });
                    return;
                }
                const onChain = read.flatMap((r) => r.value).filter((e) => e.chainId === chainId);
                // An action read once per own address (a send between two of
                // the wallet's addresses) lists once, newest first, pending on top.
                const ordered = recentActivityEntries(onChain, Number.POSITIVE_INFINITY);
                if (!searchQuery) {
                    setState({ entries: ordered, failed: false, addresses });
                    return;
                }
                const searched = new Set(applyHistoryFilters(ordered, { searchQuery }));
                setState({
                    entries: ordered.filter((e) => searched.has(e) || namesTick(e, searchQuery)),
                    failed: false,
                    addresses,
                });
            })
            .catch(() => { if (!cancelled) setState({ entries: [], failed: true }); });
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId, tick, isNative, enabled]);
    return state;
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick
 * @param {boolean} [props.isNative]  the chain's own coin, scoped to the whole chain
 * @param {{ entries: any[] | null, failed: boolean }} [props.history]  rows the page already read;
 *   left out, the tab reads its own
 * @param {(entry: any) => void} [props.onSelectEntry] opens one row's detail
 * @param {string} [props.query] narrows notes, labels, addresses and counterparties
 */
export function TokenHistoryTab({ walletId, chainId, tick, isNative = false, history: suppliedHistory = null, onSelectEntry, query = '' }) {
    const { messaging } = useWalletSource(walletId);
    const tokenInfo = useTokenInfo({ chainId, tick, skip: isNative, demo: isDemoWallet(walletId) });
    const ownHistory = useTokenHistory({ messaging, walletId, chainId, tick, isNative, enabled: !suppliedHistory });
    const history = suppliedHistory || ownHistory;
    const divisibility = isNative ? 8 : (Number.isInteger(tokenInfo?.divisibility) ? tokenInfo.divisibility : 8);
    const imageUrl = !isNative && typeof tokenInfo?.imageUrl === 'string' && tokenInfo.imageUrl ? tokenInfo.imageUrl : null;

    const walletAddresses = useMemo(
        () => new Set((history.entries || []).map((e) => e?.address).filter(Boolean)),
        [history.entries],
    );
    const assetLookup = useMemo(() => new Map([[`${chainId}|${tick}`, {
        divisibility, imageUrl, displayName: tick,
    }]]), [chainId, tick, divisibility, imageUrl]);
    const visibleEntries = useMemo(() => {
        const entries = history.entries || [];
        const searchQuery = String(query || '').trim();
        return searchQuery ? applyHistoryFilters(entries, { searchQuery }) : entries;
    }, [history.entries, query]);

    if (history.entries === null) {
        return (
            <div className={styles.loading} role="status" aria-label={t('tokenDetail.history.loading')}>
                {Array.from({ length: LOADING_ROWS }, (_, i) => <Skeleton key={i} shape="row" />)}
            </div>
        );
    }
    if (history.entries.length === 0) {
        return history.failed ? (
            <EmptyState title={t('tokenDetail.history.failedTitle')} body={t('tokenDetail.history.failedBody')} />
        ) : (
            <EmptyState
                title={t('tokenDetail.history.emptyTitle', { tick })}
                body={t('tokenDetail.history.emptyBody', { tick })}
            />
        );
    }
    if (visibleEntries.length === 0) {
        return (
            <EmptyState
                title={t('tokenDetail.history.noMatchTitle')}
                body={t('tokenDetail.history.noMatchBody')}
            />
        );
    }
    return (
        // One list card of rows, newest first; no day headings.
        <ul
            className={`${homeTabsStyles.demoList} ${homeTabsStyles.activityList}`}
            aria-label={t('tokenDetail.history.label', { tick })}
            data-history-flat=""
        >
            {visibleEntries.map((entry) => (
                <ActivityEntryRow
                    key={entry.key}
                    entry={entry}
                    walletAddresses={walletAddresses}
                    assetLookup={assetLookup}
                    chainTip={null}
                    allowRemoteImages={Boolean(imageUrl)}
                    onSelectEntry={onSelectEntry}
                    chevron
                />
            ))}
        </ul>
    );
}
