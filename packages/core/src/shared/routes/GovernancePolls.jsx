// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import {
    Button, ChainBadge, EmptyState, Icon, ListPage, ListRow, PageHeader, Screen, Select, StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useGovernanceChainIds } from '../hooks/useGovernanceAddressesPresent.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/governance.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { pollOutcome, pollRowForDisplay } from './pollDisplay.js';
// Shared with the poll page, so a decided yes/no poll reads the same in both.
import { PollStatusPill } from './PollStatusPill.jsx';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import {
    LIST_DETAIL_MIN_WIDTH,
    ListDetailSplit,
    listDetailStyles,
    useWideContent,
} from '../components/PanelSplit.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { PollDetail } from './PollDetail.jsx';
import addMenuStyles from './AddressList.module.css';
import styles from './IssueTokenForm.module.css';
import local from './GovernancePolls.module.css';

const chainRegistry = registryLib.defaultRegistry();


// Relative time text: "Closes in 3 days", "Starts in 2 days", "Closed 5 days ago".
function whenText(row) {
    const now = Date.now() / 1000;
    const span = (secs) => {
        const a = Math.abs(secs);
        if (a < 3600) return `${Math.max(1, Math.round(a / 60))} min`;
        if (a < 86400) return `${Math.round(a / 3600)} h`;
        const d = Math.round(a / 86400);
        return `${d} day${d === 1 ? '' : 's'}`;
    };
    if (row.poll_status === 'pending' && row.start_time) return `Starts in ${span(row.start_time - now)}`;
    if (row.end_time && row.end_time > now) return `Closes in ${span(row.end_time - now)}`;
    if (row.end_time) return `Closed ${span(now - row.end_time)} ago`;
    return t('governance.closesAtBlock', { block: String(row.end_block ?? t('common.notAvailable')) });
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

/**
 * VOTE governance poll browser. Resolves the wallet's governance chain (the
 * first VOTE-capable chain it holds an address on), lists that chain's polls
 * (newest first), and is the entry point to create a poll, open a poll's
 * detail, or manage vote delegation. The resolved chainId flows up through the
 * callbacks so the authoring surfaces act on the same chain. Read-only itself
 * (calls messaging.governancePolls, an explorer read).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(chainId: string, pollIndex: string | number) => void} props.onOpenPoll
 * @param {(chainId: string) => void} props.onCreate
 * @param {(chainId: string) => void} props.onDelegate
 * @param {(chainId: string) => void} [props.onMyDelegations]  opens the address's delegations, each with Clear
 * @param {() => void} props.onBack
 */
export function GovernancePolls({ walletId, onOpenPoll, onCreate, onDelegate, onMyDelegations, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const governanceChainIds = useGovernanceChainIds();

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [noChain, setNoChain] = useState(false);
    const [governChains, setGovernChains] = useState(/** @type {string[]} */ ([]));
    const [pollState, setPollState] = useState(
        /** @type {{ walletId: string, chainId: string, rows: any[] | null, error: string | null } | null} */ (null),
    );
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [addressesReload, setAddressesReload] = useState(0);
    const [pollsReload, setPollsReload] = useState(0);
    // The standard filter's search text.
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    // Home's network filter; 'all' lists polls from every chain.
    const [networkFilter, setNetworkFilter] = useState('all');
    const [selectedPollKey, setSelectedPollKey] = useState(/** @type {string | null} */ (null));
    const [layoutRef, wideContent] = useWideContent(LIST_DETAIL_MIN_WIDTH, true);
    // The plus menu (Create poll, Delegate votes).
    const [addOpen, setAddOpen] = useState(false);
    const addRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => {
        if (!addOpen) return undefined;
        const close = (event) => { if (!addRef.current?.contains(event.target)) setAddOpen(false); };
        const onKey = (event) => { if (event.key === 'Escape') setAddOpen(false); };
        window.addEventListener('mousedown', close);
        window.addEventListener('keydown', onKey);
        return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey); };
    }, [addOpen]);

    // Resolve which governance-capable chains the wallet can act on; the
    // first (registry order) seeds the Network field, which lets the user
    // retarget across the rest.
    useEffect(() => {
        let cancelled = false;
        setChainId(null);
        setNoChain(false);
        setGovernChains([]);
        setPollState(null);
        setError(null);
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const avail = governanceChainIds.filter((cid) => Array.isArray(byChain?.[cid]) && byChain[cid].length > 0);
                setGovernChains(avail);
                if (avail.length > 0) setChainId(avail[0]);
                else setNoChain(true);
            })
            .catch((err) => {
                if (!cancelled) setError(userFacingMessage(err, t('governance.error.addresses')));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, governanceChainIds, addressesReload]);

    const shownChains = (governChains.length ? governChains : (chainId ? [chainId] : []))
        .filter((cid) => networkFilter === 'all' || coinFromChainId(cid) === networkFilter);
    const shownKey = shownChains.join(',');
    useEffect(() => {
        if (!chainId) return;
        let cancelled = false;
        setPollState({ walletId, chainId: shownKey, rows: null, error: null });
        Promise.all(shownChains.map((cid) => messaging.governancePolls({ chainId: cid, opts: { limit: 50 } })
            .then((resp) => extractRows(resp).map(pollRowForDisplay).filter(Boolean).map((row) => ({ ...row, chainId: cid })))))
            .then((lists) => {
                if (!cancelled) setPollState({ walletId, chainId: shownKey, rows: lists.flat(), error: null });
            })
            .catch((err) => {
                if (!cancelled) {
                    setPollState({ walletId, chainId: shownKey, rows: null, error: userFacingMessage(err, t('governance.error.polls')) });
                }
            });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [walletId, chainId, shownKey, messaging, pollsReload]);

    const currentPollState = pollState?.walletId === walletId && pollState?.chainId === shownKey
        ? pollState
        : null;
    const allRows = currentPollState?.rows ?? null;
    // Search matches the question, the token and the poll number.
    const q = query.trim().toLowerCase();
    const rows = allRows?.filter((p) => {
        const status = p.poll_status || 'open';
        const statusMatches = statusFilter === 'all'
            || (statusFilter === 'closed' ? status !== 'open' && status !== 'pending' : status === statusFilter);
        const queryMatches = !q
            || [p.question, p.tick, String(p.action_index ?? '')].some((v) => String(v || '').toLowerCase().includes(q));
        return statusMatches && queryMatches;
    }) ?? allRows;
    const pollError = currentPollState?.error ?? null;
    const pollKey = (poll) => `${poll?.chainId || chainId}:${String(poll?.action_index ?? '')}`;
    const shownPoll = wideContent && allRows?.length
        ? allRows.find((poll) => pollKey(poll) === selectedPollKey) || rows?.[0] || allRows[0]
        : null;
    const showPanel = Boolean(shownPoll);

    // Title line: Delegate votes, the standard filter (search, network) and a plus
    // for Create poll at the far right.
    const pollChains = governChains.length ? governChains : (chainId ? [chainId] : []);
    const header = (
        <PageHeader
            onBack={onBack}
            title={t('governance.title')}
            trailing={chainId ? (
                <>
                    <ListFilterMenu
                        query={query}
                        onQueryChange={setQuery}
                        active={statusFilter !== 'all'}
                        chainRegistry={chainRegistry}
                        coinFamilies={[...new Set(pollChains.map((cid) => coinFromChainId(cid)))]}
                        networkFilter={networkFilter}
                        onNetworkFilterChange={setNetworkFilter}
                        label={t('governance.filterPolls')}
                        searchPlaceholder={t('governance.searchPlaceholder')}
                        searchLabel={t('governance.searchLabel')}
                    >
                        <Select
                            label={t('governance.statusFilter.label')}
                            help={t('governance.statusFilter.help')}
                            size="md"
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value)}
                        >
                            <Select.Option value="all" icon={<Icon.ListIcon />}>{t('governance.statusFilter.all')}</Select.Option>
                            <Select.Option value="open" icon={<Icon.PlayIcon />}>{t('governance.statusFilter.open')}</Select.Option>
                            <Select.Option value="pending" icon={<Icon.ClockIcon />}>{t('governance.statusFilter.pending')}</Select.Option>
                            <Select.Option value="closed" icon={<Icon.LockIcon />}>{t('governance.statusFilter.closed')}</Select.Option>
                        </Select>
                    </ListFilterMenu>
                    <div className={addMenuStyles.addMenuWrap} ref={addRef}>
                        <Button
                            variant="ghost"
                            size="sm"
                            icon={<Icon.PlusIcon />}
                            onClick={() => setAddOpen((open) => !open)}
                            aria-haspopup="menu"
                            aria-expanded={addOpen}
                            aria-label={t('governance.newMenu')}
                            title={t('governance.newMenu')}
                        />
                        {addOpen ? (
                            <ul className={addMenuStyles.addMenu} role="menu">
                                <li>
                                    <Button type="button" role="menuitem" className={addMenuStyles.addMenuItem} onClick={() => { setAddOpen(false); onCreate(shownChains[0] || chainId); }}>
                                        <span className={addMenuStyles.addMenuIcon} aria-hidden="true"><Icon.PlusIcon /></span>
                                        {t('governance.createPoll')}
                                    </Button>
                                </li>
                                <li>
                                    <Button type="button" role="menuitem" className={addMenuStyles.addMenuItem} onClick={() => { setAddOpen(false); onDelegate(shownChains[0] || chainId); }}>
                                        <span className={addMenuStyles.addMenuIcon} aria-hidden="true"><Icon.UsersIcon /></span>
                                        {t('governance.delegateVotes')}
                                    </Button>
                                </li>
                                {/* The list of this address's delegations, each with Clear. */}
                                {onMyDelegations ? (
                                    <li>
                                        <Button type="button" role="menuitem" className={addMenuStyles.addMenuItem} onClick={() => { setAddOpen(false); onMyDelegations(shownChains[0] || chainId); }}>
                                            <span className={addMenuStyles.addMenuIcon} aria-hidden="true"><Icon.UnlinkIcon /></span>
                                            {t('governance.myDelegations')}
                                        </Button>
                                    </li>
                                ) : null}
                            </ul>
                        ) : null}
                    </div>
                </>
            ) : null}
        />
    );
    const wrap = (children) => {
        if (!showPanel) {
            return (
                <Screen variant={variant} header={header}>
                    <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="list">
                        {children}
                    </div>
                </Screen>
            );
        }
        const detailChainId = shownPoll.chainId || chainId;
        return (
            <Screen variant={variant} header={header} bodyClassName={listDetailStyles.twoPanelBody}>
                <ListDetailSplit
                    measureRef={layoutRef}
                    storageKey="governance"
                    resizeLabel="Resize the governance list"
                    resizeHint="Drag to resize the governance list, or press Enter to reset."
                    layoutName="two-panel"
                    list={children}
                    listLabel="Governance polls"
                    detailLabel={shownPoll.question || t('governance.pollNumber', { id: String(shownPoll.action_index) })}
                    detail={(
                        <PollDetail
                            key={pollKey(shownPoll)}
                            embedded
                            walletId={walletId}
                            chainId={detailChainId}
                            pollIndex={shownPoll.action_index}
                            onBack={() => {}}
                        />
                    )}
                />
            </Screen>
        );
    };

    if (noChain) {
        return wrap(
            <ListPage>
                <EmptyState
                    title={t('governance.noAddress.title')}
                    body={t('governance.noAddress.body')}
                />
            </ListPage>,
        );
    }
    if (!chainId && !error) {
        return wrap(
            <ListPage notices={(
                <StatusMessage variant="status" label={t('governance.loadingAddressesLabel')} busy>{t('governance.loadingAddresses')}</StatusMessage>
            )} />,
        );
    }
    if (!chainId) {
        return wrap(
            <ListPage>
                <StatusMessage
                    variant="error"
                    recovery={{ label: t('common.tryAgain'), onAction: () => setAddressesReload((value) => value + 1) }}
                >
                    {error}
                </StatusMessage>
            </ListPage>,
        );
    }

    return wrap(
        <ListPage
            notices={pollError ? (
                <StatusMessage
                    variant="error"
                    recovery={{ label: t('common.tryAgain'), onAction: () => setPollsReload((value) => value + 1) }}
                >
                    {pollError}
                </StatusMessage>
            ) : !rows ? (
                <StatusMessage variant="status" label={t('governance.loadingPollsLabel')} busy>{t('governance.loadingPolls')}</StatusMessage>
            ) : null}
        >

            {rows && rows.length === 0 ? (
                <EmptyState title={t('governance.empty.title')} body={t('governance.empty.body')} />
            ) : null}

            {rows && rows.length > 0 ? (
                /* Safari needs an explicit list role because this class removes list styling. */
                <ul className={local.pollList} role="list" data-xc-split-list={showPanel ? '' : undefined}>
                    {rows.map((p) => {
                        const id = p.action_index;
                        const label = p.question || (Array.isArray(p.options) ? p.options.join(' / ') : String(p.options || ''));
                        const selected = showPanel && pollKey(p) === pollKey(shownPoll);
                        return (
                            <li key={pollKey(p)}>
                                {/* Question first; the token under it (the leading badge
                                    is the only network indicator, U12, G61); plain time;
                                    one status; the drill-in chevron (G97). */}
                                <ListRow
                                    type="button"
                                    onClick={() => {
                                        if (wideContent) setSelectedPollKey(pollKey(p));
                                        else onOpenPoll(p.chainId || chainId, id);
                                    }}
                                    className={local.pollCard}
                                    data-xc-split-row={showPanel ? '' : undefined}
                                    aria-current={selected ? 'true' : undefined}
                                    chevron
                                    leading={(() => {
                                        const d = chainRegistry.get(p.chainId || chainId);
                                        return d ? <ChainBadge descriptor={d} size="md" showName={false} /> : <span className={local.pollIcon} aria-hidden="true"><Icon.HandshakeIcon /></span>;
                                    })()}
                                    title={<span className={local.pollTitle}>{label || t('governance.pollNumber', { id: String(id) })}</span>}
                                    subtitle={(
                                        <>
                                            <span className={`${styles.hint} ${local.pollText}`} style={{ display: 'block' }}>
                                                {p.tick || t('common.notAvailable')}
                                            </span>
                                            <span className={`${styles.hint} ${local.pollText}`} style={{ display: 'block' }}>
                                                {whenText(p)}
                                            </span>
                                        </>
                                    )}
                                    trailing={<PollStatusPill status={p.poll_status} outcome={pollOutcome(p)} />}
                                />
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </ListPage>,
    );
}
