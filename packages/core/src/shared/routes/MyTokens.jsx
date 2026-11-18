// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
    Button,
    Screen,
    PageHeader,
    IconSelect,
    Skeleton,
    Icon,
    ListPage,
    EmptyState,
    StatusMessage,
    ListRow,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import { synthesizeDemoOwnedTokens } from '../../flows/demoFixtures.js';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import {
    LIST_DETAIL_MIN_WIDTH,
    ListDetailSplit,
    listDetailStyles,
    useWideContent,
} from '../components/PanelSplit.jsx';
import { BridgeOriginTick } from './BridgeOriginBadge.jsx';
import styles from './MyTokens.module.css';

const chainRegistry = registryLib.defaultRegistry();
export const MY_TOKENS_PANEL_STORAGE_KEY = 'my-tokens';

/**
 * §40.5: "My Tokens". Lists every token one of the active wallet's
 * addresses currently OWNS, which is not the same set as the tokens it
 * issued: a TRANSFER moves ownership, so a token this wallet created and
 * handed on drops off the list, and a token someone transferred in shows
 * up here even though this wallet never issued anything (D-82,
 * where every string on the page claimed issuance). Hosts the
 * Create-token affordance, and each row drills into TokenDetail, which
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
 * @param {() => void} props.onIssue                       open token creation
 * @param {(tick: string, chainId: string, row: { divisibility: number | null, locked: boolean }) => void} props.onSelectTick    drill into TokenDetail for a row
 * @param {(row: object) => import('react').ReactNode} [props.renderToken] render the embedded manage-token page on wide content
 */
export function MyTokens({ walletId, accountId, onBack, onIssue, onSelectTick, renderToken }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const canSplit = typeof renderToken === 'function';
    const [layoutRef, wideContent] = useWideContent(LIST_DETAIL_MIN_WIDTH, canSplit);
    const twoPanel = canSplit && wideContent;
    const [selectedTokenKey, setSelectedTokenKey] = useState(null);

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
    // "Holding" narrows ownership to tokens whose supply the wallet still
    // holds; row.youOwn is a balance check, not an ownership check.
    const [mode, setMode] = useState(
        /** @type {'all' | 'holding' | 'locked' | 'unlocked'} */ ('all'),
    );
    // 'all' or a coin family (bitcoin, litecoin, dogecoin), as on Home.
    const [networkFilter, setNetworkFilter] = useState('all');

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
        // A demo wallet's addresses never go to an explorer (issue #82), so its
        // issued tokens come from the fixtures.
        if (isDemoWallet(walletId)) {
            const owned = [];
            for (const [chainId, addrs] of Object.entries(addressesByChain)) {
                const ownerAddress = Array.isArray(addrs) && typeof addrs[0]?.address === 'string' ? addrs[0].address : '';
                for (const row of synthesizeDemoOwnedTokens(chainId)) owned.push({ ...row, chainId, ownerAddress });
            }
            setTokens(owned);
            return undefined;
        }
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
    }, [walletId, addressesByChain, messaging, tokensReload]);

    const filteredTokens = useMemo(() => {
        if (!tokens) return null;
        const q = query.trim().toLowerCase();
        return tokens.filter((row) => {
            if (networkFilter !== 'all' && coinFromChainId(row.chainId) !== networkFilter) return false;
            if (mode === 'holding' && !row.youOwn) return false;
            if (mode === 'locked' && row.locked !== true) return false;
            if (mode === 'unlocked' && row.locked !== false) return false;
            if (!q) return true;
            return (
                row.tick.toLowerCase().includes(q)
                || (row.description || '').toLowerCase().includes(q)
            );
        });
    }, [tokens, query, mode, networkFilter]);
    // The networks the wallet has addresses on, for Home's network picker in
    // the filter panel (G04: search, then network, then the page's pickers).
    const coinFamilies = useMemo(
        () => [...new Set(Object.keys(addressesByChain || {}).map((chainId) => coinFromChainId(chainId)).filter(Boolean))],
        [addressesByChain],
    );

    const isLoading = tokens === null && loadError === null;
    const isEmpty = tokens !== null && tokens.length === 0 && tokensError === null;
    const isFilteredEmpty = tokens !== null && tokens.length > 0
        && filteredTokens !== null && filteredTokens.length === 0;
    const shownToken = filteredTokens?.find(
        (row) => `${row.chainId}:${row.tick}` === selectedTokenKey,
    ) || filteredTokens?.[0] || null;

    const openToken = (row) => {
        if (twoPanel) {
            setSelectedTokenKey(`${row.chainId}:${row.tick}`);
            return;
        }
        onSelectTick(row.tick, row.chainId, row);
    };

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            title="My Tokens"
            trailing={(
                <>
                {/* The standard filter (search, then network, then type) on the
                    title line, left of Create token. */}
                <ListFilterMenu
                    query={query}
                    onQueryChange={setQuery}
                    chainRegistry={chainRegistry}
                    coinFamilies={coinFamilies}
                    networkFilter={networkFilter}
                    onNetworkFilterChange={setNetworkFilter}
                    active={mode !== 'all'}
                    label="Filter tokens"
                    searchPlaceholder="Search tokens..."
                    searchLabel="Search your tokens by ticker or description"
                >
                    <IconSelect
                        size="md"
                        aria-label="Filter tokens by type"
                        value={mode}
                        onChange={(value) => setMode(
                            /** @type {'all' | 'holding' | 'locked' | 'unlocked'} */ (value),
                        )}
                        options={[
                            { value: 'all', label: 'All tokens', icon: <Icon.TokenListIcon /> },
                            { value: 'holding', label: 'Holding', icon: <Icon.CoinsIcon /> },
                            { value: 'locked', label: 'Locked', icon: <Icon.LockIcon /> },
                            { value: 'unlocked', label: 'Unlocked', icon: <Icon.UnlockIcon /> },
                        ]}
                    />
                </ListFilterMenu>
                <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon.PlusIcon />}
                    onClick={onIssue}
                    aria-label="Create Token"
                    title="Create Token"
                />
                </>
            )}
        />
    );

    const listPage = (
        <ListPage className={styles.page} notices={loadError || tokensError ? (
                <>
                    {loadError ? (
                        <StatusMessage
                            variant="error"
                            recovery={{
                                label: 'Try Again',
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
                                label: 'Try Again',
                                onAction: () => setTokensReload((value) => value + 1),
                            }}
                        >
                            {tokensError}
                        </StatusMessage>
                    ) : null}
                </>
            ) : null}>

                {isLoading ? (
                    <div className={styles.loading} role="status" aria-label="Loading owned tokens">
                        <Skeleton.List rows={3} />
                    </div>
                ) : null}

                {isEmpty ? (
                    <EmptyState
                        title="No owned tokens yet"
                        body="Tokens this wallet owns appear here."
                        actionLabel="Create Token"
                        actionIcon={<Icon.PlusIcon />}
                        onAction={onIssue}
                    />
                ) : null}

                {isFilteredEmpty ? (
                    <EmptyState
                        title="No results for these filters"
                        body="Reset the filters to see all tokens."
                        actionLabel="Reset Filters"
                        actionIcon={<Icon.RefreshIcon />}
                        onAction={() => {
                            setQuery('');
                            setMode('all');
                            setNetworkFilter('all');
                        }}
                    />
                ) : null}

                {filteredTokens && filteredTokens.length > 0 ? (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={styles.list} role="list" data-xc-split-list={twoPanel ? '' : undefined}>
                        {filteredTokens.map((row) => (
                            <li key={`${row.chainId}:${row.tick}`}>
                                <ListRow
                                    onClick={() => openToken(row)}
                                    data-xc-split-row={twoPanel ? '' : undefined}
                                    aria-current={twoPanel && row === shownToken ? 'true' : undefined}
                                    aria-label={`Open ${row.tick} token details`}
                                    leading={<span className={styles.rowChain} aria-hidden="true">
                                        <TickerIcon chainId={row.chainId} tick={row.tick} size={40} imageUrl={row.imageUrl || null} />
                                    </span>}
                                    title={(
                                        <span className={styles.rowTick}>
                                            {/* A bridged copy reads as its bare
                                                name plus an origin badge; the
                                                rooted wire name is on hover. */}
                                            <span className={styles.rowTickName} title={row.tick}>
                                                <BridgeOriginTick
                                                    tick={row.tick}
                                                    localCoin={coinFromChainId(row.chainId)}
                                                />
                                            </span>
                                            <span
                                                className={styles.supplyStatus}
                                                role="img"
                                                aria-label={row.locked ? 'Supply locked' : 'Supply unlocked'}
                                                title={row.locked ? 'Supply locked' : 'Supply unlocked'}
                                            >
                                                {row.locked ? <Icon.LockIcon /> : <Icon.UnlockIcon />}
                                            </span>
                                        </span>
                                    )}
                                    subtitle={row.description ? (
                                        <span className={styles.rowDescription}>
                                            {row.description}
                                        </span>
                                    ) : undefined}
                                    chevron
                                />
                            </li>
                        ))}
                    </ul>
                ) : null}
        </ListPage>
    );

    const detailKey = shownToken ? `${shownToken.chainId}:${shownToken.tick}` : 'loading';
    const detailFallback = (
        <div className={styles.loading} aria-hidden="true">
            <Skeleton height={190} />
        </div>
    );

    return (
        <Screen
            variant={variant}
            header={header}
            bodyClassName={twoPanel ? listDetailStyles.twoPanelBody : undefined}
        >
            {twoPanel ? (
                <ListDetailSplit
                    measureRef={layoutRef}
                    storageKey={MY_TOKENS_PANEL_STORAGE_KEY}
                    resizeLabel="Resize the token list"
                    resizeHint="Drag, use Left and Right, or press Enter to reset"
                    layoutName="my-tokens-two-panel"
                    list={listPage}
                    listLabel="My tokens"
                    detail={shownToken ? (
                        <Fragment key={detailKey}>{renderToken(shownToken)}</Fragment>
                    ) : detailFallback}
                    detailLabel={shownToken ? `${shownToken.tick} token management` : 'Token management'}
                    detailBusy={!shownToken}
                    detailFallback={detailFallback}
                />
            ) : (
                <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="my-tokens-list">
                    {listPage}
                </div>
            )}
        </Screen>
    );
}
