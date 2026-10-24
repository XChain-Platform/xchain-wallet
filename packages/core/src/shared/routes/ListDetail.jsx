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
    AddressText,
    Button,
    ChainBadge,
    EmptyState,
    ListPage,
    PageHeader,
    Screen,
    SectionHeader,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { TickMemberName } from '../components/TickMemberName.jsx';
import { neutralizeControlText } from '../utils/textHardening.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { listMetaSupported } from '../../flows/listFormatSupport.js';
import { findListOwner } from '../../flows/listMembership.js';
import { uniqueRows } from '../utils/pagedRows.js';
import { listItemStatusText, listStatusText, listStatusTitle } from '../utils/listItemStatusText.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const MEMBERS_PAGE_SIZE = 25;

/**
 * PC-10 "My Lists" detail page: membership + lineage + a best-effort
 * "used by" panel for one LIST action.
 *
 * Membership and fork-lineage both come from a single read,
 * `messaging.getListByActionIndex` (`sdk.getAction(actionIndex)`):
 * the explorer's LIST detail row carries `list` (the membership this
 * exact action_index was written with), `edits` (each item it sent,
 * tagged valid/invalid) plus `list_action_index` (the parent a fork
 * came from), and `state`: whether list-edit resolution is active and,
 * when it is, `current_list`, the membership every reference to this
 * list now resolves to, taken from edit `membership_action_index`.
 * Under resolution that is the current membership and `list` is only
 * what the action was created with; before it, `list` IS what a
 * reference to this index uses. An explorer without `state` is shown
 * as "members as published", which is true under either rule.
 *
 * "Used by": AIRDROP/DISPENSER/ORDER/ISSUE all reference a list by
 * ACTION_INDEX (`list_action_index`, `allow_list`, `block_list`), but
 * the explorer exposes no reverse-lookup query (its
 * `/airdrops|dispensers|orders|issues/{query}/{type}` routes only take
 * block/address/token/source/destination, never a list index; verified
 * against xchain-explorer/src/XChainExplorer.js at HEAD). Faking a
 * client-side scan across every consumer's full history isn't a
 * substitute for a real indexed reverse lookup and would be slow and
 * easy to get wrong, so this panel says plainly what it cannot show
 * rather than pretending to.
 *
 * @param {object} props
 * @param {string} [props.walletId]
 * @param {string} props.chainId
 * @param {string} props.actionIndex
 * @param {() => void} props.onBack
 * @param {(ref: { chainId: string, actionIndex: string, type: string, items: string[], editResolutionActive: boolean | null, source: string | null, parentIndex: string | null }) => void} props.onFork
 * @param {(ref: { chainId: string, actionIndex: string }) => void} [props.onShare]     shows "Share list" when passed
 * @param {(ref: { chainId: string, actionIndex: string }) => void} [props.onRename]    shows "Rename list" when passed and supported
 * @param {(ref: { chainId: string, actionIndex: string }) => void} [props.onTransfer]  shows "Transfer list" when passed
 */
export function ListDetail({ walletId, chainId, actionIndex, onBack, onFork, onShare, onRename, onTransfer }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [data, setData] = useState(/** @type {any | null | undefined} */ (undefined));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [metaSupported, setMetaSupported] = useState(false);
    const [owner, setOwner] = useState(/** @type {string | null | undefined} */ (undefined));
    const [walletAddresses, setWalletAddresses] = useState(/** @type {any[] | null | undefined} */ (undefined));
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setData(undefined);
        setOwner(undefined);
        setLoadError(null);
        const readList = (index) => messaging.getListByActionIndex({ chainId, actionIndex: index });
        readList(actionIndex)
            .then(async (row) => {
                const nextOwner = row ? await findListOwner({ detail: row, readList }) : null;
                if (!cancelled) {
                    setData(row || null);
                    setOwner(nextOwner);
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(readFailureMessage(err, 'load this list'));
            });
        return () => { cancelled = true; };
    }, [chainId, actionIndex, messaging, reload]);

    useEffect(() => {
        let cancelled = false;
        if (!walletId) {
            setWalletAddresses(null);
            return () => { cancelled = true; };
        }
        setWalletAddresses(undefined);
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (!cancelled) setWalletAddresses(Array.isArray(byChain?.[chainId]) ? byChain[chainId] : []);
            })
            .catch(() => { if (!cancelled) setWalletAddresses(null); });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        let cancelled = false;
        setMetaSupported(false);
        if (!chainId) return () => { cancelled = true; };
        const sdkRegistry = {
            get: () => ({
                getActionFormats: (action) => messaging.getActionFormats({ chainId, action }),
            }),
        };
        Promise.resolve().then(() => listMetaSupported({ sdkRegistry, chainId }))
            .then((supported) => { if (!cancelled) setMetaSupported(supported === true); })
            .catch(() => { if (!cancelled) setMetaSupported(false); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const isTick = data ? String(data.type) === '1' : false;
    const isFork = data ? (data.list_action_index != null && data.list_action_index !== '') : false;
    const items = useMemo(
        () => uniqueRows(Array.isArray(data?.list) ? data.list : [], memberIdentity),
        [data],
    );
    const edits = useMemo(() => (Array.isArray(data?.edits) ? data.edits : []), [data]);
    // Items the network recorded invalid and left out (an unknown TICK, a
    // malformed or wrong-network ADDRESS); the LIST itself stays valid.
    const rejected = useMemo(() => edits.filter((e) => e?.status && e.status !== 'valid'), [edits]);
    const statusWhy = listStatusText(data?.status);
    let statusLabel = 'Unavailable';
    if (statusWhy === 'pending') statusLabel = 'Pending';
    else if (statusWhy) statusLabel = `Rejected: ${statusWhy}`;
    else if (data?.status) statusLabel = 'Valid';
    // true / false from the explorer, null when it does not report the flag.
    const state = data?.state && typeof data.state === 'object' ? data.state : null;
    const resolution = state && typeof state.edit_resolution_active === 'boolean'
        ? state.edit_resolution_active : null;
    const currentItems = useMemo(
        () => (resolution === true && Array.isArray(state?.current_list)
            ? uniqueRows(state.current_list, memberIdentity)
            : null),
        [resolution, state],
    );
    const membershipIndex = state?.membership_action_index != null ? String(state.membership_action_index) : null;
    const name = typeof data?.name === 'string' && data.name.length > 0 ? data.name : null;
    const description = typeof data?.description === 'string' && data.description.length > 0
        ? data.description : null;
    const permissionCheckEnabled = Boolean(walletId);
    const walletOwnsList = Boolean(owner && walletAddresses?.some((record) => record?.address === owner));
    const canManage = !permissionCheckEnabled || walletOwnsList;
    const readOnlyReason = !permissionCheckEnabled || canManage
        ? null
        : owner === undefined || walletAddresses === undefined
            ? 'Checking whether this wallet owns the list.'
            : owner === null || walletAddresses === null
                ? 'Ownership could not be verified, so this list is read-only.'
                : 'This list is owned by another address, so it is read-only in this wallet.';

    const header = (
        <PageHeader onBack={onBack} title={isTick ? 'Token list' : 'Address list'} />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>{children}</ListPage>
        </Screen>
    );

    if (loadError) {
        return wrap(
            <StatusMessage
                variant="error"
                recovery={{ label: 'Try again', onAction: () => setReload((value) => value + 1) }}
            >
                {loadError}
            </StatusMessage>,
        );
    }
    if (data === undefined) {
        return wrap(
            <div role="status" aria-label="Loading list details" aria-busy="true">
                Loading list…
            </div>,
        );
    }
    if (data === null) {
        return wrap(<EmptyState title="List not found" body="It may have been removed or not indexed yet." />);
    }

    return wrap(
        <>
            {/* The ownership warning is the page notice, the first item of the content. */}
            {readOnlyReason ? <StatusMessage variant="warning">{readOnlyReason}</StatusMessage> : null}
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Network</dt>
                <dd className={styles.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName={false} /> : 'Selected network'}</dd>
                <dt className={styles.detailsLabel}>List index</dt>
                <dd className={styles.detailsValue}>#{actionIndex}</dd>
                {name !== null ? (
                    <>
                        <dt className={styles.detailsLabel}>Name</dt>
                        <dd className={styles.detailsValue}>{neutralizeControlText(name)}</dd>
                    </>
                ) : null}
                {description !== null ? (
                    <>
                        <dt className={styles.detailsLabel}>Description</dt>
                        <dd className={styles.detailsValue}>{neutralizeControlText(description)}</dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Type</dt>
                <dd className={styles.detailsValue}>{isTick ? 'Token list' : 'Address list'}</dd>
                <dt className={styles.detailsLabel}>Published by</dt>
                <dd className={styles.detailsValue}>{data.source ? <AddressText address={data.source} /> : '?'}</dd>
                {owner !== undefined ? (
                    <>
                        <dt className={styles.detailsLabel}>Current owner</dt>
                        <dd className={styles.detailsValue}>{owner ? <AddressText address={owner} /> : 'Unavailable'}</dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Status</dt>
                <dd className={styles.detailsValue} title={statusWhy ? listStatusTitle(data.status) : undefined}>{statusLabel}</dd>
                {data.block_index != null ? (
                    <>
                        <dt className={styles.detailsLabel}>Block</dt>
                        <dd className={styles.detailsValue}>{data.block_index}</dd>
                    </>
                ) : null}
                {isFork ? (
                    <>
                        <dt className={styles.detailsLabel}>Forked from</dt>
                        <dd className={styles.detailsValue}>
                            #{data.list_action_index} ({String(data.edit) === '2' ? 'removed items' : 'added items'})
                        </dd>
                    </>
                ) : null}
            </dl>

            {currentItems ? (
                <>
                    <SectionHeader
                        title={`Current members (${currentItems.length})`}
                        description={membershipIndex && membershipIndex !== String(actionIndex)
                            ? `From edit #${membershipIndex}, the newest valid edit of this list. Everything that references #${actionIndex} uses these members.`
                            : `No edits yet. Everything that references #${actionIndex} uses these members.`}
                    />
                    <MemberList
                        key={`current:${actionIndex}:${membershipIndex || ''}`}
                        items={currentItems}
                        isTick={isTick}
                        messaging={messaging}
                        chainId={chainId}
                    />
                    <SectionHeader
                        title={`As created (${items.length})`}
                        description="The members this action was published with."
                    />
                    <MemberList
                        key={`created:${actionIndex}`}
                        items={items}
                        isTick={isTick}
                        messaging={messaging}
                        chainId={chainId}
                    />
                </>
            ) : (
                <>
                    <SectionHeader
                        title={resolution === false ? `Current members (${items.length})` : `Members as published (${items.length})`}
                    />
                    <MemberList
                        key={`published:${actionIndex}`}
                        items={items}
                        isTick={isTick}
                        messaging={messaging}
                        chainId={chainId}
                    />
                </>
            )}

            {!isFork && rejected.length > 0 ? (
                <>
                    <SectionHeader
                        title={`Left out by the network (${rejected.length})`}
                        description="These items were sent but are not on the list: the network checks each item on its own."
                    />
                    <ul className={styles.detailsList} style={{ display: 'block', listStyle: 'none' }}>
                        {/* Say why in plain words; the raw verdict stays in the tooltip. */}
                        {rejected.map((e, i) => (
                            <li key={i} title={listStatusTitle(e.status)} style={{ padding: '2px 0', overflowWrap: 'anywhere' }}>
                                <code>{e.tick ?? e.address}</code>{` (${listItemStatusText(e.status)})`}
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}

            {isFork && edits.length > 0 ? (
                <>
                    <SectionHeader title="This fork's edit" />
                    <ul className={styles.detailsList} style={{ display: 'block', listStyle: 'none' }}>
                        {edits.map((e, i) => {
                            const why = listItemStatusText(e.status);
                            return (
                                <li key={i} title={why ? listStatusTitle(e.status) : undefined} style={{ padding: '2px 0', overflowWrap: 'anywhere' }}>
                                    <code>{e.tick ?? e.address}</code>
                                    {why ? ` (${why})` : ''}
                                </li>
                            );
                        })}
                    </ul>
                </>
            ) : null}

            <SectionHeader
                title="Used by"
                description="The explorer has no reverse lookup from a list index to the airdrops, dispensers, gates, or orders that reference it today, so the wallet can't show what uses this list. If you know a specific airdrop, dispenser, gate, or order references it, check that item directly."
            />

            <SectionHeader title="Actions" />
            {canManage ? (
                <div className={styles.actions}>
                    {onShare ? (
                        <Button variant="secondary" onClick={() => onShare({ chainId, actionIndex })}>
                            Share list
                        </Button>
                    ) : null}
                    {onTransfer ? (
                        <Button variant="secondary" onClick={() => onTransfer({ chainId, actionIndex })}>
                            Transfer list
                        </Button>
                    ) : null}
                    {onRename && metaSupported ? (
                        <Button variant="secondary" onClick={() => onRename({ chainId, actionIndex })}>
                            Rename list
                        </Button>
                    ) : null}
                    <Button
                        variant="primary"
                        onClick={() => onFork({
                            chainId,
                            actionIndex,
                            type: String(data.type),
                            // An edit applies to the membership a reference resolves
                            // to, so fork from the current members under resolution.
                            items: currentItems || items,
                            editResolutionActive: resolution,
                            // Where the fork form starts its walk to the list's owner.
                            source: data.source ? String(data.source) : null,
                            parentIndex: isFork ? String(data.list_action_index) : null,
                        })}
                    >
                        Fork &amp; edit
                    </Button>
                </div>
            ) : null}
        </>,
    );
}

/**
 * One membership block: ticks as code, addresses in full.
 *
 * @param {{ items: string[], isTick: boolean, messaging: object, chainId: string }} props
 */
function MemberList({ items, isTick, messaging, chainId }) {
    const [visibleLimit, setVisibleLimit] = useState(MEMBERS_PAGE_SIZE);
    if (items.length === 0) {
        // A plain line, not a page message: the page's notice is the ownership warning.
        return (
            <p style={{ margin: 0, color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                No list members. Addresses added to this list appear here.
            </p>
        );
    }
    const visibleItems = items.slice(0, visibleLimit);
    return (
        <>
            <ul className={styles.detailsList} style={{ display: 'block', listStyle: 'none' }}>
                {visibleItems.map((item) => (
                    <li key={String(item)} style={{ padding: '2px 0' }}>
                        {isTick
                            ? <TickMemberName item={item} messaging={messaging} chainId={chainId} />
                            : <AddressText address={item} truncate={false} />}
                    </li>
                ))}
            </ul>
            {visibleItems.length < items.length ? (
                <div className={styles.actions}>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setVisibleLimit((limit) => limit + MEMBERS_PAGE_SIZE)}
                    >
                        Load more members
                    </Button>
                </div>
            ) : null}
        </>
    );
}

function memberIdentity(item) {
    return item == null ? null : String(item);
}
