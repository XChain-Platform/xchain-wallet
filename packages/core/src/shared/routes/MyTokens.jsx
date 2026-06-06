// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import {
    Screen,
    ScreenHeader,
    Input,
    Skeleton,
    Icon,
} from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import styles from './MyTokens.module.css';

/**
 * §40.5 — "My Tokens". Lists every token issued by one of the active
 * wallet's addresses. Hosts the Issue-new-token affordance, and each
 * row drills into TokenDetail, which carries the owner-only actions
 * (Mint, Destroy, Lock supply, …).
 *
 * Data source: messaging.getOwnedTokens({ chainId, address }) — wraps
 * xchain-sdk's `getTokens(address, 'address')`, which the explorer
 * filters by `WHERE m.owner_id = ?`.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]                       active BIP44 account; when set, only that account's addresses are queried
 * @param {() => void} props.onBack
 * @param {() => void} props.onIssue                       open the Issue-token form
 * @param {(tick: string, chainId: string, row: { divisibility: number | null, locked: boolean }) => void} props.onSelectTick    drill into TokenDetail for a row
 */
export function MyTokens({ walletId, accountId, onBack, onIssue, onSelectTick }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [tokens, setTokens] = useState(
        /** @type {Array<{ chainId: string, tick: string, totalSupply: string | null, maxSupply: string | null, description: string | null, locked: boolean, divisibility: number | null, ownerAddress: string }> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [query, setQuery] = useState('');
    // 'all' shows every issued tick; 'owned' narrows to ticks the
    // current wallet still holds supply of.
    const [mode, setMode] = useState(/** @type {'all' | 'owned'} */ ('all'));

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.getAddressesByChain !== 'function') {
            setLoadError('Address listing is not available in this shell.');
            return undefined;
        }
        messaging.getAddressesByChain(walletId, accountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging]);

    useEffect(() => {
        if (!addressesByChain) return undefined;
        if (typeof messaging?.getOwnedTokens !== 'function') {
            setTokens([]);
            return undefined;
        }
        let cancelled = false;
        const calls = [];
        for (const [chainId, addrs] of Object.entries(addressesByChain)) {
            if (!Array.isArray(addrs)) continue;
            for (const a of addrs) {
                const address = typeof a?.address === 'string' ? a.address : null;
                if (!address) continue;
                calls.push(
                    messaging.getOwnedTokens({ chainId, address })
                        .then((rows) => (Array.isArray(rows) ? rows : []).map((r) => ({
                            ...r,
                            chainId,
                            ownerAddress: address,
                        })))
                        .catch(() => []),
                );
            }
        }
        if (calls.length === 0) {
            setTokens([]);
            return undefined;
        }
        Promise.all(calls).then((batches) => {
            if (cancelled) return;
            const seen = new Set();
            const merged = [];
            for (const batch of batches) {
                for (const row of batch) {
                    const key = `${row.chainId}:${row.tick}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    merged.push(row);
                }
            }
            merged.sort((a, b) => {
                const ax = coinFromChainId(a.chainId);
                const bx = coinFromChainId(b.chainId);
                return ax.localeCompare(bx) || a.tick.localeCompare(b.tick);
            });
            setTokens(merged);
        });
        return () => { cancelled = true; };
    }, [addressesByChain, messaging]);

    const filteredTokens = useMemo(() => {
        if (!tokens) return null;
        const q = query.trim().toLowerCase();
        return tokens.filter((row) => {
            if (mode === 'owned' && !row.youOwn) return false;
            if (!q) return true;
            return (
                row.tick.toLowerCase().includes(q)
                || (row.description || '').toLowerCase().includes(q)
            );
        });
    }, [tokens, query, mode]);

    const isLoading = tokens === null && loadError === null;
    const isEmpty = tokens !== null && tokens.length === 0;
    const isFilteredEmpty = tokens !== null && tokens.length > 0
        && filteredTokens !== null && filteredTokens.length === 0;

    const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back to home"
            title="My Tokens"
            titleIcon={<Icon.TokenIcon />}
            trailing={
                <button
                    type="button"
                    className={styles.issueButton}
                    onClick={onIssue}
                    aria-label="Issue new token"
                    title="Issue new token"
                >
                    <Icon.PlusIcon />
                </button>
            }
        />
    );

    return (
        <Screen variant={variant} header={header}>
            <div className={styles.body}>
                <div className={styles.toolbar}>
                    <div className={styles.filters}>
                        <div className={styles.search}>
                            <Input
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search tokens"
                                aria-label="Search your tokens by ticker or description"
                            />
                        </div>
                        <div className={styles.chipGroup} role="radiogroup" aria-label="Filter by holdings">
                            <button
                                type="button"
                                role="radio"
                                aria-checked={mode === 'all'}
                                className={`${styles.chip} ${mode === 'all' ? styles.chipActive : ''}`}
                                onClick={() => setMode('all')}
                            >
                                All
                            </button>
                            <button
                                type="button"
                                role="radio"
                                aria-checked={mode === 'owned'}
                                className={`${styles.chip} ${mode === 'owned' ? styles.chipActive : ''}`}
                                onClick={() => setMode('owned')}
                            >
                                Owned
                            </button>
                        </div>
                    </div>
                </div>

                {loadError ? (
                    <p className={styles.error}>{loadError}</p>
                ) : null}

                {isLoading ? (
                    <div className={styles.list}>
                        <Skeleton height={64} />
                        <Skeleton height={64} />
                        <Skeleton height={64} />
                    </div>
                ) : null}

                {isEmpty ? (
                    <p className={styles.empty}>
                        You haven&apos;t issued any tokens yet. Tap
                        &ldquo;Issue new token&rdquo; to create one.
                    </p>
                ) : null}

                {isFilteredEmpty ? (
                    <p className={styles.empty}>
                        No tokens match your filter.
                    </p>
                ) : null}

                {filteredTokens && filteredTokens.length > 0 ? (
                    <ul className={styles.list} role="list">
                        {filteredTokens.map((row) => (
                            <li key={`${row.chainId}:${row.tick}`}>
                                <button
                                    type="button"
                                    className={styles.row}
                                    onClick={() => onSelectTick(row.tick, row.chainId, row)}
                                >
                                    <span className={styles.rowChain} aria-hidden="true">
                                        <TickerIcon chainId={row.chainId} tick={row.tick} size={40} />
                                    </span>
                                    <span className={styles.rowText}>
                                        <span className={styles.rowTick}>
                                            {row.tick}
                                            {row.locked ? (
                                                <span className={styles.lockedBadge} title="Supply locked">
                                                    <Icon.LockIcon />
                                                </span>
                                            ) : null}
                                        </span>
                                        {row.description ? (
                                            <span className={styles.rowDescription}>
                                                {row.description}
                                            </span>
                                        ) : null}
                                    </span>
                                    <span className={styles.rowChevron} aria-hidden="true">
                                        <Icon.ForwardIcon />
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>
        </Screen>
    );
}

