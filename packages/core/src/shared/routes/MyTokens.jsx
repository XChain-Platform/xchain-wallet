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
    Input,
    Skeleton,
    Icon,
    ListPage,
    EmptyState,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { BridgeOriginTick } from './BridgeOriginBadge.jsx';
import styles from './MyTokens.module.css';

/**
 * §40.5: "My Tokens". Lists every token one of the active wallet's
 * addresses currently OWNS, which is not the same set as the tokens it
 * issued: a TRANSFER moves ownership, so a token this wallet created and
 * handed on drops off the list, and a token someone transferred in shows
 * up here even though this wallet never issued anything (D-82,
 * where every string on the page claimed issuance). Hosts the
 * Issue-new-token affordance, and each row drills into TokenDetail, which
 * carries the owner-only actions (Mint, Destroy, Lock supply, …).
 *
 * Data source: messaging.getOwnedTokens({ chainId, address }), wraps
 * xchain-sdk's `getTokens(address, 'address')`, which the explorer
 * filters by `WHERE m.owner_id = ?` - ownership, not issuance.
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
    const [tokensError, setTokensError] = useState(/** @type {string | null} */ (null));
    const [addressesReload, setAddressesReload] = useState(0);
    const [tokensReload, setTokensReload] = useState(0);
    const [query, setQuery] = useState('');
    // 'all' shows every tick this wallet owns; 'owned' narrows to the ones
    // it also still holds supply of (row.youOwn is a balance check, not an
    // ownership one, so the chip is labelled "Holding").
    const [mode, setMode] = useState(/** @type {'all' | 'owned'} */ ('all'));

    useEffect(() => {
        let cancelled = false;
        setAddressesByChain(null);
        setTokens(null);
        setLoadError(null);
        setTokensError(null);
        if (typeof messaging?.getAddressesByChain !== 'function') {
            setLoadError('Address listing is not available in this shell.');
            return undefined;
        }
        messaging.getAddressesByChain(walletId, accountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
            })
            .catch(() => {
                if (!cancelled) setLoadError('Could not load addresses. Try again.');
            });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, addressesReload]);

    useEffect(() => {
        if (!addressesByChain) return undefined;
        setTokens(null);
        setTokensError(null);
        if (typeof messaging?.getOwnedTokens !== 'function') {
            setTokensError('Token ownership lookup is not available in this shell.');
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
                        .then((rows) => ({
                            failed: false,
                            rows: (Array.isArray(rows) ? rows : []).map((r) => ({
                                ...r,
                                chainId,
                                ownerAddress: address,
                            })),
                        }))
                        .catch(() => ({ failed: true, rows: [] })),
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
            const failedCount = batches.filter((batch) => batch.failed).length;
            for (const batch of batches) {
                for (const row of batch.rows) {
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
            if (failedCount > 0) {
                setTokensError(failedCount === batches.length
                    ? 'Could not load your owned tokens. Try again.'
                    : 'Some owned token lists could not be loaded. Results may be incomplete.');
            }
            setTokens(merged);
        });
        return () => { cancelled = true; };
    }, [addressesByChain, messaging, tokensReload]);

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
    const isEmpty = tokens !== null && tokens.length === 0 && tokensError === null;
    const isFilteredEmpty = tokens !== null && tokens.length > 0
        && filteredTokens !== null && filteredTokens.length === 0;

    const header = (
        <PageHeader
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
            <ListPage toolbar={(
                <>
                    <div className={styles.search}>
                        <Input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search tokens"
                            aria-label="Search your tokens by ticker or description"
                        />
                    </div>
                    <div className={styles.chipGroup} role="radiogroup" aria-label="Filter by balance held">
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
                            Holding
                        </button>
                    </div>
                </>
            )}>

                {loadError ? (
                    <StatusMessage
                        variant="error"
                        recovery={{
                            label: 'Try again',
                            onAction: () => setAddressesReload((value) => value + 1),
                        }}
                    >
                        {loadError}
                    </StatusMessage>
                ) : null}

                {tokensError ? (
                    <StatusMessage
                        variant="error"
                        recovery={{
                            label: 'Try again',
                            onAction: () => setTokensReload((value) => value + 1),
                        }}
                    >
                        {tokensError}
                    </StatusMessage>
                ) : null}

                {isLoading ? (
                    <div className={styles.list} role="status" aria-label="Loading owned tokens">
                        <Skeleton.List rows={3} />
                    </div>
                ) : null}

                {isEmpty ? (
                    <EmptyState
                        title="No owned tokens yet"
                        body="Tokens this wallet owns appear here."
                        actionLabel="Issue token"
                        onAction={onIssue}
                    />
                ) : null}

                {isFilteredEmpty ? (
                    <EmptyState
                        title="No results for these filters"
                        body="Reset the filters to see all tokens."
                        actionLabel="Reset filters"
                        onAction={() => {
                            setQuery('');
                            setMode('all');
                        }}
                    />
                ) : null}

                {filteredTokens && filteredTokens.length > 0 ? (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={styles.list} role="list">
                        {filteredTokens.map((row) => (
                            <li key={`${row.chainId}:${row.tick}`}>
                                <button
                                    type="button"
                                    className={styles.row}
                                    onClick={() => onSelectTick(row.tick, row.chainId, row)}
                                    aria-label={`Open ${row.tick} token details`}
                                >
                                    <span className={styles.rowChain} aria-hidden="true">
                                        <TickerIcon chainId={row.chainId} tick={row.tick} size={40} />
                                    </span>
                                    <span className={styles.rowText}>
                                        <span className={styles.rowTick}>
                                            {/* A bridged copy reads as its bare
                                                name plus an origin badge; the
                                                rooted wire name is on hover. */}
                                            <BridgeOriginTick
                                                tick={row.tick}
                                                localCoin={coinFromChainId(row.chainId)}
                                            />
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
            </ListPage>
        </Screen>
    );
}
