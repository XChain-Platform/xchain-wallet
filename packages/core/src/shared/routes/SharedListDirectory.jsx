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
import { Button, ChainBadge, EmptyState, ListPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { tickerForCoin } from '../../registry/coinTicker.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import {
    bindLabel,
    orderSharedLists,
    pickableSharedLists,
    platformBadgeText,
    shortOwner,
} from '../utils/sharedListRows.js';
import styles from './IssueTokenForm.module.css';
import listStyles from './MyLists.module.css';

const chainRegistry = registryLib.defaultRegistry();
const PAGE_SIZE = 20;

function listType(type) {
    const value = String(type ?? '').toLowerCase();
    if (value === '1' || value === 'token') return 'token';
    if (value === '2' || value === 'address') return 'address';
    return value;
}

function normalizeEntry(entry) {
    return {
        ...entry,
        name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : null,
        homeChain: entry.homeChain ?? entry.home_chain,
        homeListIndex: entry.homeListIndex ?? entry.home_list_index,
        type: listType(entry.type),
        memberCount: entry.memberCount ?? entry.member_count,
        shareBlock: entry.shareBlock ?? entry.share_block,
        bindTarget: entry.bindTarget ?? entry.bind_target ?? null,
        maintainedByPlatform: entry.maintainedByPlatform ?? entry.maintained_by_platform ?? false,
    };
}

function homeDescriptor(homeChain, viewingChainId) {
    const direct = chainRegistry.get(String(homeChain));
    if (direct) return direct;

    const networkKind = chainRegistry.get(viewingChainId)?.networkKind;
    const descriptors = networkKind
        ? chainRegistry.byNetworkKind(networkKind)
        : chainRegistry.supportedChains();
    const value = String(homeChain ?? '').toUpperCase();
    return descriptors.find((descriptor) => (
        tickerForCoin(descriptor.coin).toUpperCase() === value
        || descriptor.coin.toUpperCase() === value
    )) ?? null;
}

function valueOrUnknown(value) {
    return value == null || value === '' ? '?' : String(value);
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {'browse' | 'pick'} props.mode
 * @param {'token' | 'address'} [props.filterType]
 * @param {(selection: { actionIndex: unknown, homeChain: unknown, homeListIndex: unknown, memberCount: unknown, name?: string }) => void} props.onSelect
 * @param {(chainId: string, actionIndex: string) => void} [props.onOpenList]
 * @param {() => void} props.onBack
 */
export function SharedListDirectory({ walletId, chainId, mode, filterType, onSelect, onOpenList, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [directory, setDirectory] = useState(/** @type {{ lists: any[], unavailable: string[] } | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [query, setQuery] = useState('');
    const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

    useEffect(() => {
        let cancelled = false;
        setDirectory(null);
        setLoadError(null);
        messaging.getSharedLists({ chainId })
            .then((response) => {
                if (cancelled) return;
                setDirectory({
                    lists: Array.isArray(response?.lists) ? response.lists.map(normalizeEntry) : [],
                    unavailable: Array.isArray(response?.unavailable) ? response.unavailable : [],
                });
            })
            .catch((error) => {
                if (!cancelled) setLoadError(error?.message || 'Failed to load shared lists.');
            });
        return () => { cancelled = true; };
    }, [chainId, messaging, walletId]);

    const visibleLists = useMemo(() => {
        if (!directory) return [];
        return mode === 'pick'
            ? pickableSharedLists(directory.lists, listType(filterType))
            : orderSharedLists(directory.lists);
    }, [directory, filterType, mode]);

    const matchingLists = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return visibleLists;
        return visibleLists.filter((entry) => {
            const descriptor = homeDescriptor(entry.homeChain, chainId);
            return [
                entry.name,
                entry.owner,
                entry.homeChain,
                descriptor?.displayName,
                tickerForCoin(descriptor?.coin),
                entry.homeListIndex,
                entry.bindTarget,
                entry.type === 'token' ? 'token list' : 'address list',
                platformBadgeText(entry),
            ].some((value) => String(value ?? '').toLowerCase().includes(needle));
        });
    }, [chainId, query, visibleLists]);

    useEffect(() => {
        setVisibleLimit(PAGE_SIZE);
    }, [query, filterType, mode, directory]);

    const pagedLists = matchingLists.slice(0, visibleLimit);

    const header = (
        <PageHeader
            onBack={onBack}
            title={mode === 'pick' ? 'Choose a shared list' : 'Shared lists'}
        />
    );
    const wrap = (children, toolbar) => (
        <Screen variant={variant} header={header}>
            <ListPage toolbar={toolbar}>{children}</ListPage>
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    }
    if (!directory) return wrap(<p className={styles.hint}>Loading shared lists…</p>);

    const toolbar = (
        <input
            type="search"
            className={listStyles.search}
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Search shared lists"
        />
    );

    const filteredType = listType(filterType);
    return wrap(
        <>
            {directory.unavailable.map((unavailableChain) => {
                const descriptor = chainRegistry.get(unavailableChain);
                return (
                    <p className={styles.error} key={unavailableChain}>
                        Shared lists unavailable from {descriptor?.displayName || unavailableChain}.
                    </p>
                );
            })}

            {matchingLists.length === 0 ? (
                <EmptyState
                    title={query.trim() || mode === 'pick' ? 'No matching shared lists' : 'No shared lists yet'}
                    body={query.trim()
                        ? 'Try a different search.'
                        : mode === 'pick'
                            ? `Shared ${filteredType ? `${filteredType} ` : ''}lists available on this chain appear here.`
                            : 'Published shared lists appear here.'}
                />
            ) : (
                <>
                    <div role="list" aria-label="Shared lists">
                        {pagedLists.map((entry) => (
                            <SharedListRow
                                key={`${entry.homeChain}:${entry.homeListIndex}`}
                                entry={entry}
                                chainId={chainId}
                                pickable={mode === 'pick'}
                                onSelect={onSelect}
                                onOpenList={onOpenList}
                            />
                        ))}
                    </div>
                    {pagedLists.length < matchingLists.length ? (
                        <div className={styles.actions}>
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setVisibleLimit((limit) => limit + PAGE_SIZE)}
                            >
                                Load more
                            </Button>
                        </div>
                    ) : null}
                </>
            )}
        </>,
        toolbar,
    );
}

function SharedListRow({ entry, chainId, pickable, onSelect, onOpenList }) {
    const descriptor = homeDescriptor(entry.homeChain, chainId);
    const badge = platformBadgeText(entry);
    const typeLabel = entry.type === 'token' ? 'Token list' : 'Address list';
    const memberCount = Number(entry.memberCount);
    const members = entry.memberCount != null && entry.memberCount !== '' && Number.isFinite(memberCount)
        ? `${entry.memberCount} member${memberCount === 1 ? '' : 's'}`
        : 'member count unavailable';

    const choose = () => onSelect({
        actionIndex: entry.bindTarget,
        homeChain: entry.homeChain,
        homeListIndex: entry.homeListIndex,
        memberCount: entry.memberCount,
        ...(entry.name ? { name: entry.name } : {}),
    });
    const canOpen = !pickable && typeof onOpenList === 'function'
        && descriptor?.id && entry.homeListIndex != null;

    return (
        <dl
            role="listitem"
            className={styles.detailsList}
            aria-label={`${typeLabel} ${valueOrUnknown(entry.homeListIndex)} on ${valueOrUnknown(entry.homeChain)}`}
        >
            {entry.name ? (
                <>
                    <dt className={styles.detailsLabel}>Name</dt>
                    <dd className={styles.detailsValue}>{neutralizeControlText(entry.name)}</dd>
                </>
            ) : null}
            <dt className={styles.detailsLabel}>Home chain</dt>
            <dd className={styles.detailsValue}>
                {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : valueOrUnknown(entry.homeChain)}
            </dd>
            <dt className={styles.detailsLabel}>Home list index</dt>
            <dd className={styles.detailsValue}>{valueOrUnknown(entry.homeListIndex)}</dd>
            <dt className={styles.detailsLabel}>Type</dt>
            <dd className={styles.detailsValue}>{typeLabel}</dd>
            <dt className={styles.detailsLabel}>Members</dt>
            <dd className={styles.detailsValue}>{members}</dd>
            <dt className={styles.detailsLabel}>Owner</dt>
            <dd className={styles.detailsValue}>{shortOwner(entry.owner) || '?'}</dd>
            <dt className={styles.detailsLabel}>Share block</dt>
            <dd className={styles.detailsValue}>{valueOrUnknown(entry.shareBlock)}</dd>
            <dt className={styles.detailsLabel}>On this chain</dt>
            <dd className={styles.detailsValue}>{bindLabel(entry)}</dd>
            {badge ? (
                <>
                    <dt className={styles.detailsLabel}>Maintainer</dt>
                    <dd className={styles.detailsValue}>{badge}</dd>
                </>
            ) : null}
            {pickable ? (
                <>
                    <dt className={styles.detailsLabel}>Select</dt>
                    <dd className={styles.detailsValue}>
                        <Button type="button" variant="secondary" onClick={choose}>Choose list</Button>
                    </dd>
                </>
            ) : null}
            {canOpen ? (
                <>
                    <dt className={styles.detailsLabel}>Details</dt>
                    <dd className={styles.detailsValue}>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => onOpenList(descriptor.id, String(entry.homeListIndex))}
                        >
                            Open list
                        </Button>
                    </dd>
                </>
            ) : null}
        </dl>
    );
}
