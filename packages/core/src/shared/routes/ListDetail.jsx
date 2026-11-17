// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useMemo, useState } from 'react';
import {
    AddressText,
    Button,
    ChainBadge,
    EmptyState,
    Icon,
    ListPage,
    ListRow,
    PageHeader,
    Screen,
    StatusMessage,
    Tabs,
} from '@xchain-wallet/core/ui';
import { branding as brandingLib, registry as registryLib } from '@xchain-wallet/core';
import { EmptyStateAsLineContext } from '../../ui/Screen.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { ListLookForm } from './ListLookForm.jsx';
import { TickMemberName } from '../components/TickMemberName.jsx';
import { listTileId, readWalletTile, tileRadius, walletTileText } from '../utils/walletTile.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { currentListItems, findListOwner } from '../../flows/listMembership.js';
import { listShareEligibility } from '../../flows/listShareEligibility.js';
import { uniqueRows } from '../utils/pagedRows.js';
import { listItemStatusText, listStatusText, listStatusTitle } from '../utils/listItemStatusText.js';
import homeTabsStyles from '../components/HomeTabs.module.css';
import tokenDetailStyles from './TokenDetail.module.css';
import styles from './ListDetail.module.css';

const chainRegistry = registryLib.defaultRegistry();
const MEMBERS_PAGE_SIZE = 25;
// Source lists of a union read at once, as ListPickerScreen reads lists.
const SOURCE_READ_CONCURRENCY = 4;

/**
 * PC-10 "My Lists" detail page for one LIST action: the identity card (the
 * list's own look, which the user sets as for a wallet), then three tabs.
 * Actions (the default) holds the action list, List the entries, Details the facts.
 *
 * Membership and fork lineage both come from one read,
 * `messaging.getListByActionIndex`: `list` is what this action was published
 * with, `edits` the items it sent (each valid or invalid), `list_action_index`
 * the parent of a fork, and `state` whether list-edit resolution is active and,
 * when it is, `current_list`, the membership every reference now resolves to.
 * The List tab shows the current membership when there is one.
 *
 * A union list's items are the action indexes of its source lists; when the
 * List tab first opens, each source is read once (a union holds at most 16,
 * four reads at a time) so the tab can group its entries under the source's name.
 *
 * Actions: Edit, Share, Transfer and Fork call the shell handlers; Edit goes to
 * `onEdit` and falls back to `onFork` (the edit form) when a shell passes no
 * `onEdit`. Each owner action opens its form normally; that form resolves the
 * signing address and refuses the action if this wallet cannot perform it.
 *
 * @param {object} props
 * @param {string} [props.walletId]
 * @param {string} props.chainId
 * @param {string} props.actionIndex
 * @param {() => void} props.onBack
 * @param {(ref: ListEditRef) => void} props.onFork
 * @param {(ref: ListEditRef) => void} [props.onEdit]                           Edit; defaults to onFork
 * @param {(ref: { chainId: string, actionIndex: string }) => void} [props.onEditLook]  opens the Edit look page
 * @param {(ref: { chainId: string, actionIndex: string }) => void} [props.onShare]
 * @param {(ref: { chainId: string, actionIndex: string }) => void} [props.onTransfer]
 *
 * @typedef {{ chainId: string, actionIndex: string, type: string, items: string[], editResolutionActive: boolean | null, source: string | null, parentIndex: string | null }} ListEditRef
 */
export function ListDetail({ chainId, actionIndex, onBack, onFork, onEdit, onEditLook, onShare, onTransfer }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const tabsId = useId();

    const [data, setData] = useState(/** @type {any | null | undefined} */ (undefined));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [owner, setOwner] = useState(/** @type {string | null | undefined} */ (undefined));
    const [sources, setSources] = useState(/** @type {Array<{ index: string, row: any }> | null | undefined} */ (null));
    const [reload, setReload] = useState(0);
    const [activeTab, setActiveTab] = useState('actions');
    const [lookOpen, setLookOpen] = useState(false);
    const [lookVersion, setLookVersion] = useState(0);
    const [pipFailed, setPipFailed] = useState(false);
    const [sourcesWanted, setSourcesWanted] = useState(false);

    useEffect(() => {
        setActiveTab('actions');
        setLookOpen(false);
        setSourcesWanted(false);
    }, [chainId, actionIndex]);
    useEffect(() => {
        if (activeTab === 'list') setSourcesWanted(true);
    }, [activeTab]);

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

    const isUnion = data ? String(data.type) === '3' : false;
    const unionIndexes = useMemo(() => {
        if (!isUnion) return [];
        // The explorer resolves only token and address memberships, so a
        // union's own rows (its source list indexes) are the published list.
        const rows = Array.isArray(data?.list) && data.list.length > 0 ? data.list : (currentListItems(data) || []);
        return uniqueRows(rows.map(sourceIndexOf).filter(Boolean), memberIdentity);
    }, [isUnion, data]);

    useEffect(() => {
        let cancelled = false;
        if (!isUnion || !sourcesWanted) {
            setSources(null);
            return () => { cancelled = true; };
        }
        setSources(undefined);
        // One read per source list (a union holds at most 16), a few at a
        // time because the explorer rate-limits a burst, and only once the
        // List tab is opened: Actions and Details need none of them.
        const rows = new Array(unionIndexes.length);
        let next = 0;
        const worker = async () => {
            while (next < unionIndexes.length) {
                const at = next;
                next += 1;
                const index = unionIndexes[at];
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const row = await messaging.getListByActionIndex({ chainId, actionIndex: index });
                    rows[at] = { index, row: row || null };
                } catch {
                    rows[at] = { index, row: undefined };
                }
            }
        };
        Promise.all(Array.from({ length: Math.min(SOURCE_READ_CONCURRENCY, unionIndexes.length) }, worker))
            .then(() => { if (!cancelled) setSources(rows); });
        return () => { cancelled = true; };
    }, [isUnion, sourcesWanted, unionIndexes, chainId, messaging]);

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
    const name = typeof data?.name === 'string' && data.name.length > 0 ? neutralizeControlText(data.name) : null;
    const description = typeof data?.description === 'string' && data.description.length > 0
        ? neutralizeControlText(data.description) : null;
    const typeLabel = isUnion ? 'Union list' : isTick ? 'Token list' : 'Address list';

    const tileId = listTileId(chainId, actionIndex);
    // lookVersion re-reads the stored look after the editor saves it.
    const look = useMemo(() => readWalletTile(tileId), [tileId, lookVersion]);
    const pipUrl = descriptor ? brandingLib.chainIconSmallUrl(descriptor.id) : null;

    const header = (
        <PageHeader onBack={onBack} title="List" />
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
                recovery={{ label: 'Try Again', onAction: () => setReload((value) => value + 1) }}
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

    const displayName = name || typeLabel;
    const tileText = walletTileText(displayName);
    const listRef = () => ({ chainId, actionIndex });
    // Edit look is its own page: a shell routes it through onEditLook; with
    // no handler the page stands in for this one until Back or Save.
    const openLook = () => (typeof onEditLook === 'function' ? onEditLook(listRef()) : setLookOpen(true));
    if (lookOpen && typeof onEditLook !== 'function') {
        return (
            <ListLookForm
                chainId={chainId}
                actionIndex={actionIndex}
                name={displayName}
                onBack={() => setLookOpen(false)}
                onDone={() => { setLookOpen(false); setLookVersion((value) => value + 1); }}
            />
        );
    }
    const editRef = () => ({
        chainId,
        actionIndex,
        type: String(data.type),
        // An edit applies to the membership a reference resolves to, so
        // start from the current members under resolution.
        items: isUnion ? unionIndexes : (currentItems || items),
        editResolutionActive: resolution,
        // Where the edit form starts its walk to the list's owner.
        source: data.source ? String(data.source) : null,
        parentIndex: isFork ? String(data.list_action_index) : null,
    });

    const actions = [];
    // An owner action the shell does not offer here is left out. Ownership is
    // checked by the action form after the user chooses the row.
    const ownerAction = (id, label, description, IconGlyph, handler, makeRef, ownReason = null) => {
        if (typeof handler !== 'function') return;
        actions.push({
            id,
            label,
            description,
            Icon: IconGlyph,
            onSelect: typeof handler === 'function' ? () => handler(makeRef()) : undefined,
            reason: ownReason,
        });
    };
    ownerAction('edit', 'Edit', 'Change the members, name or description', Icon.PencilIcon, onEdit || onFork, editRef);
    ownerAction('share', 'Share', 'Share the list with every chain', Icon.ShareIcon, onShare, listRef,
        isUnion ? listShareEligibility({ type: '3', memberCount: null, isShared: false }).reasons[0]?.text || null : null);
    ownerAction('transfer', 'Transfer', "Hand the list's ownership to another address", Icon.SendIcon, onTransfer, listRef);
    actions.push({
        id: 'fork',
        label: 'Fork',
        description: 'Publish an edit of the members at a new list index',
        Icon: Icon.ForkIcon,
        onSelect: () => onFork(editRef()),
        reason: null,
    });
    actions.push({
        id: 'look',
        label: 'Edit look',
        description: "Change the list icon's colour, shape and image",
        Icon: Icon.PaletteIcon,
        onSelect: openLook,
        reason: null,
    });

    const tabLabel = (IconGlyph, text) => (
        <span className={homeTabsStyles.tabWithIcon}><span className={homeTabsStyles.tabIcon} aria-hidden="true"><IconGlyph /></span>{text}</span>
    );

    return wrap(
        <>
            {/* The identity card: the list's own look (tap to change it), its
                network badge, its name and its type line. */}
            <section className={styles.identityCard} aria-label="List identity">
                <button
                    type="button"
                    className={styles.lookButton}
                    aria-label="Edit look"
                    title="Edit look"
                    onClick={openLook}
                >
                    <span className={styles.avatar} style={{ '--xc-avatar-shape': tileRadius(look.shape) }}>
                        <IdentityAvatar
                            name={displayName}
                            text={tileText}
                            seed={tileId}
                            context="list"
                            variant="asset"
                            tone={look.colour}
                            src={look.image || null}
                        />
                    </span>
                    {pipUrl && !pipFailed ? (
                        <img
                            className={styles.networkPip}
                            src={pipUrl}
                            width={24}
                            height={24}
                            alt=""
                            aria-hidden="true"
                            title={descriptor?.displayName}
                            decoding="async"
                            onError={() => setPipFailed(true)}
                        />
                    ) : null}
                </button>
                <h2 className={styles.identityName}>{displayName}</h2>
                <p className={styles.identityLine}>{name ? `${typeLabel} · #${actionIndex}` : `#${actionIndex}`}</p>
                {description ? <p className={styles.identityLine}>{description}</p> : null}
            </section>

            <Tabs
                id={tabsId}
                className={tokenDetailStyles.detailTabs}
                aria-label="List detail view"
                items={[
                    { id: 'actions', label: tabLabel(Icon.ZapIcon, 'Actions') },
                    { id: 'list', label: tabLabel(Icon.ListIcon, 'List') },
                    { id: 'details', label: tabLabel(Icon.InfoIcon, 'Details') },
                ]}
                value={activeTab}
                onChange={setActiveTab}
                panelId={`${tabsId}-panel`}
            />

            <div
                id={`${tabsId}-panel`}
                className={tokenDetailStyles.tabPanel}
                role="tabpanel"
                aria-labelledby={`${tabsId}-tab-${activeTab}`}
            >
                {activeTab === 'actions' ? (
                    // The shared action list (G101): a locked owner action is a
                    // disabled row that says why in place of its description.
                    <ActionList label="List actions">
                        {actions.map((action) => {
                            const ActionIcon = action.Icon;
                            return (
                                <ActionListItem
                                    key={action.id}
                                    data-action-id={action.id}
                                    icon={<ActionIcon />}
                                    title={action.label}
                                    description={action.description}
                                    onClick={action.reason ? undefined : action.onSelect}
                                    disabled={Boolean(action.reason)}
                                    disabledReason={action.reason || undefined}
                                />
                            );
                        })}
                    </ActionList>
                ) : null}

                {activeTab === 'list' ? (
                    <>
                        {isUnion ? (
                            <UnionMembers sources={sources} messaging={messaging} chainId={chainId} />
                        ) : (
                            <MemberList
                                key={`members:${actionIndex}`}
                                items={currentItems || items}
                                isTick={isTick}
                                messaging={messaging}
                                chainId={chainId}
                            />
                        )}

                        {!isFork && rejected.length > 0 ? (
                            <>
                                <p className={styles.groupLabel}>{`Left out by the network (${rejected.length})`}</p>
                                <ul className={styles.itemList}>
                                    {/* Say why in plain words; the raw verdict stays in the tooltip. */}
                                    {rejected.map((e, i) => (
                                        <li key={i} title={listStatusTitle(e.status)} className={styles.itemRow}>
                                            <code>{e.tick ?? e.address}</code>{` (${listItemStatusText(e.status)})`}
                                        </li>
                                    ))}
                                </ul>
                            </>
                        ) : null}

                        {isFork && edits.length > 0 ? (
                            <>
                                <p className={styles.groupLabel}>This fork&apos;s edit</p>
                                <ul className={styles.itemList}>
                                    {edits.map((e, i) => {
                                        const why = listItemStatusText(e.status);
                                        return (
                                            <li key={i} title={why ? listStatusTitle(e.status) : undefined} className={styles.itemRow}>
                                                <code>{e.tick ?? e.address}</code>
                                                {why ? ` (${why})` : ''}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </>
                        ) : null}
                    </>
                ) : null}

                {activeTab === 'details' ? (
                    <ul className={styles.itemList} aria-label="List details">
                        <DetailRow label="Network">
                            {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : 'Selected network'}
                        </DetailRow>
                        <DetailRow label="Type">{typeLabel}</DetailRow>
                        <DetailRow label="List index">{`#${actionIndex}`}</DetailRow>
                        {isUnion ? (
                            <DetailRow label="Built from">
                                {`${unionIndexes.length} ${unionIndexes.length === 1 ? 'list' : 'lists'}`}
                            </DetailRow>
                        ) : null}
                        <DetailRow label="Published by">
                            {data.source ? <AddressText address={String(data.source)} /> : 'Unavailable'}
                        </DetailRow>
                        {owner !== undefined ? (
                            <DetailRow label="Current owner">
                                {owner ? <AddressText address={owner} /> : 'Unavailable'}
                            </DetailRow>
                        ) : null}
                        <DetailRow label="Status" tooltip={statusWhy ? listStatusTitle(data.status) : undefined}>
                            {statusLabel}
                        </DetailRow>
                        {data.block_index != null ? (
                            <DetailRow label="Block">{String(data.block_index)}</DetailRow>
                        ) : null}
                        {isFork ? (
                            <DetailRow label="Forked from">
                                {`#${data.list_action_index} (${String(data.edit) === '2' ? 'removed items' : 'added items'})`}
                            </DetailRow>
                        ) : null}
                    </ul>
                ) : null}
            </div>

        </>,
    );
}

/** One label-left, value-right fact in the Details card. */
function DetailRow({ label, tooltip, children }) {
    return (
        <li>
            <ListRow title={label} trailing={<span className={styles.detailValue} title={tooltip}>{children}</span>} />
        </li>
    );
}

/**
 * A union's entries, grouped under each source list's name.
 *
 * @param {{ sources: Array<{ index: string, row: any }> | null | undefined, messaging: object, chainId: string }} props
 */
function UnionMembers({ sources, messaging, chainId }) {
    if (sources === undefined) {
        return <div role="status" aria-busy="true">Loading source lists…</div>;
    }
    if (!sources || sources.length === 0) {
        return (
            <EmptyStateAsLineContext.Provider value>
                <EmptyState titleAs="p" title="No source lists" body="Lists this union combines appear here." />
            </EmptyStateAsLineContext.Provider>
        );
    }
    return sources.map(({ index, row }) => {
        const members = row ? uniqueRows(currentListItems(row) || [], memberIdentity) : [];
        const sourceName = row && typeof row.name === 'string' && row.name.length > 0
            ? neutralizeControlText(row.name) : `List #${index}`;
        const count = row ? `${members.length} ${members.length === 1 ? 'member' : 'members'}` : 'members unavailable';
        return (
            <section key={index} className={styles.unionGroup} aria-label={sourceName}>
                <p className={styles.groupLabel}>
                    <Icon.TokenListIcon />
                    <strong className={styles.groupName}>{sourceName}</strong>
                    <span className={styles.groupMeta}>{`#${index} · ${count}`}</span>
                </p>
                {row ? (
                    <MemberList
                        items={members}
                        isTick={String(row.type) === '1'}
                        messaging={messaging}
                        chainId={chainId}
                    />
                ) : null}
            </section>
        );
    });
}

/**
 * One membership card: tickers by name, addresses cut in the middle.
 *
 * @param {{ items: string[], isTick: boolean, messaging: object, chainId: string }} props
 */
function MemberList({ items, isTick, messaging, chainId }) {
    const [visibleLimit, setVisibleLimit] = useState(MEMBERS_PAGE_SIZE);
    if (items.length === 0) {
        return (
            <EmptyStateAsLineContext.Provider value>
                <EmptyState
                    titleAs="p"
                    title="No list members"
                    body="Addresses added to this list appear here."
                />
            </EmptyStateAsLineContext.Provider>
        );
    }
    const visibleItems = items.slice(0, visibleLimit);
    return (
        <>
            <ul className={styles.itemList}>
                {visibleItems.map((item) => (
                    <li key={String(item)} className={styles.itemRow}>
                        {isTick
                            ? <TickMemberName item={item} messaging={messaging} chainId={chainId} />
                            : <AddressText address={String(item)} />}
                    </li>
                ))}
            </ul>
            {visibleItems.length < items.length ? (
                <Button
                    type="button"
                    variant="secondary"
                    icon={<Icon.ChevronDownIcon />}
                    onClick={() => setVisibleLimit((limit) => limit + MEMBERS_PAGE_SIZE)}
                >
                    Load More Members
                </Button>
            ) : null}
        </>
    );
}

function memberIdentity(item) {
    return item == null ? null : String(item);
}

/** A union item is a source list's action index, bare or as a row. */
function sourceIndexOf(item) {
    const index = item && typeof item === 'object' ? item.action_index ?? item.list_action_index : item;
    return index == null || index === '' ? null : String(index);
}
