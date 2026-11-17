// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Fragment, useMemo, useState } from 'react';
import {
    AddressText,
    Button,
    ChainBadge,
    EmptyState,
    Icon,
    ListPage,
    PageHeader,
    Screen,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { tickerForCoin } from '../../registry/coinTicker.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { homeDescriptor, listType, useSharedListDirectory } from '../hooks/useSharedListDirectory.js';
import {
    bindLabel,
    orderSharedLists,
    pickableSharedLists,
    platformBadgeText,
    directoryText,
    DIRECTORY_NAME_MAX_CHARS,
} from '../utils/sharedListRows.js';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import styles from './IssueTokenForm.module.css';
import local from './SharedListDirectory.module.css';

const chainRegistry = registryLib.defaultRegistry();
const PAGE_SIZE = 20;

function valueOrUnknown(value) {
    return value == null || value === '' ? '?' : directoryText(value);
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
    const { directory, loadError, reload: reloadDirectory } = useSharedListDirectory({
        messaging,
        chainId,
        scopeKey: walletId,
    });
    const [query, setQuery] = useState('');
    const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

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

    // Return to the first page when the listing changes. This is done while
    // rendering rather than in an effect: an effect runs after paint, so a
    // Load more click made in that gap queued its update first and the late
    // reset then overwrote it with a single page.
    const [pageScope, setPageScope] = useState({ filterType, mode, directory });
    if (pageScope.filterType !== filterType || pageScope.mode !== mode || pageScope.directory !== directory) {
        setPageScope({ filterType, mode, directory });
        setVisibleLimit(PAGE_SIZE);
    }

    const pagedLists = matchingLists.slice(0, visibleLimit);
    // Chains that did not answer, as badges for the single notice. An unknown
    // chain id has no badge, so it is counted by the notice but not named.
    const unavailableDescriptors = (directory?.unavailable || [])
        .map((id) => chainRegistry.get(id))
        .filter(Boolean);

    // The search lives behind the title bar filter, as on every list page;
    // the page body is only the directory.
    const wrap = (children, filterMenu = null, notices = null) => (
        <Screen
            variant={variant}
            header={(
                <PageHeader
                    onBack={onBack}
                    title={mode === 'pick' ? 'Choose a Shared List' : 'Shared Lists'}
                    trailing={filterMenu}
                />
            )}
        >
            <ListPage notices={notices}>{children}</ListPage>
        </Screen>
    );

    if (loadError) {
        return wrap(
            <StatusMessage
                variant="error"
                recovery={{ label: 'Try Again', onAction: reloadDirectory }}
            >
                {loadError}
            </StatusMessage>,
        );
    }
    if (!directory) return wrap(<p className={styles.hint}>Loading shared lists…</p>);

    const filterMenu = (
        <ListFilterMenu
            query={query}
            onQueryChange={(value) => {
                setQuery(value);
                setVisibleLimit(PAGE_SIZE);
            }}
            label="Filter shared lists"
            searchPlaceholder="Search"
            searchLabel="Search shared lists"
        />
    );

    // One notice for every chain that did not answer, not one per chain.
    const unavailableNotice = directory.unavailable.length > 0 ? (
        <StatusMessage variant="error">
            Unavailable
            {unavailableDescriptors.length > 0 ? ' from ' : null}
            {unavailableDescriptors.map((descriptor, index) => (
                <Fragment key={descriptor.id || index}>
                    {index === 0 ? null : ' '}
                    <ChainBadge descriptor={descriptor} size="sm" showName={false} />
                </Fragment>
            ))}
            . Try again in a moment.
        </StatusMessage>
    ) : null;
    const unavailableOnly = directory.unavailable.length > 0 && visibleLists.length === 0;

    const filteredType = listType(filterType);
    return wrap(
        <>
            {/* With that notice up and no search typed, an empty state would be a
                second message for the same state. */}
            {matchingLists.length === 0 && directory.unavailable.length > 0 && !query.trim() ? null : matchingLists.length === 0 ? (
                <EmptyState
                    title={query.trim()
                        ? "No matching shared lists"
                        : mode === "pick" ? "No shared lists available" : "No shared lists yet"}
                    body={query.trim()
                        ? "Matching shared lists appear here after you change or clear the search."
                        : mode === "pick"
                            ? `Shared ${filteredType ? `${filteredType} ` : ""}lists appear here after you choose a network where one is published.`
                            : "Published shared lists appear here after you or someone else publishes one."}
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
                                icon={<Icon.ChevronDownIcon />}
                                onClick={() => setVisibleLimit((limit) => limit + PAGE_SIZE)}
                            >
                                Load More
                            </Button>
                        </div>
                    ) : null}
                </>
            )}
        </>,
        unavailableOnly ? null : filterMenu,
        unavailableNotice,
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

    const actions = [];
    if (pickable) {
        actions.push({
            id: 'choose',
            icon: <Icon.CheckIcon />,
            title: 'Choose list',
            description: 'Use this list for the form you came from',
            onClick: choose,
        });
    }
    if (canOpen) {
        actions.push({
            id: 'open',
            icon: <Icon.ListIcon />,
            title: 'Open list',
            description: 'See its members and details',
            onClick: () => onOpenList(descriptor.id, String(entry.homeListIndex)),
        });
    }
    const entryLabel = `${typeLabel} ${valueOrUnknown(entry.homeListIndex)}`;

    return (
        <div role="listitem" className={local.entry} aria-label={entryLabel}>
            <dl className={styles.detailsList}>
                {entry.name ? (
                    <>
                        <dt className={styles.detailsLabel}>Name</dt>
                        <dd className={styles.detailsValue}>{neutralizeControlText(entry.name, { maxLength: DIRECTORY_NAME_MAX_CHARS })}</dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Home network</dt>
                <dd className={styles.detailsValue}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName={false} /> : '?'}
                </dd>
                <dt className={styles.detailsLabel}>Home list index</dt>
                <dd className={styles.detailsValue}>{valueOrUnknown(entry.homeListIndex)}</dd>
                <dt className={styles.detailsLabel}>Type</dt>
                <dd className={styles.detailsValue}>{typeLabel}</dd>
                <dt className={styles.detailsLabel}>Members</dt>
                <dd className={styles.detailsValue}>{members}</dd>
                <dt className={styles.detailsLabel}>Owner</dt>
                <dd className={styles.detailsValue}>
                    {/* G99: the owner in full when the cell has room. */}
                    {typeof entry.owner === 'string' && entry.owner
                        ? <AddressText address={neutralizeControlText(entry.owner)} />
                        : '?'}
                </dd>
                <dt className={styles.detailsLabel}>Share block</dt>
                <dd className={styles.detailsValue}>{valueOrUnknown(entry.shareBlock)}</dd>
                <dt className={styles.detailsLabel}>On this network</dt>
                <dd className={styles.detailsValue}>{bindLabel(entry)}</dd>
                {badge ? (
                    <>
                        <dt className={styles.detailsLabel}>Maintainer</dt>
                        <dd className={styles.detailsValue}>{badge}</dd>
                    </>
                ) : null}
            </dl>
            {actions.length ? (
                // The entry's actions as the shared action list (G101), at
                // the end of the pane under its facts.
                <ActionList label={`${entryLabel} actions`}>
                    {actions.map(({ id, ...action }) => (
                        <ActionListItem key={id} data-action-id={id} {...action} />
                    ))}
                </ActionList>
            ) : null}
        </div>
    );
}
