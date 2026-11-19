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
    Button, EmptyState, Icon, ListPage, PageHeader, Screen, Select, StatusMessage, Tabs,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useGovernanceChainIds } from '../hooks/useGovernanceAddressesPresent.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/governance.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { formatDecimalAmount } from '../utils/amountFormat.js';
import { latestBallotRows, pollResultSummary, pollRowForDisplay } from './pollDisplay.js';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import {
    addDecimals,
    QuestionCard,
    questionCardSlices,
} from '../components/BetMarketCard.jsx';
import {
    LIST_DETAIL_MIN_WIDTH,
    ListDetailSplit,
    listDetailStyles,
    useWideContent,
} from '../components/PanelSplit.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { PollDetail } from './PollDetail.jsx';
import addMenuStyles from './AddressList.module.css';
import cardListStyles from './BetFeedsList.module.css';
import cardStyles from '../components/BetMarketCard.module.css';
import local from './GovernancePolls.module.css';

const chainRegistry = registryLib.defaultRegistry();


// Relative time text: "Closing in 3 days", "Starts in 2 days", "Closed 5 days ago".
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
    if (row.end_time && row.end_time > now) return `Closing in ${span(row.end_time - now)}`;
    if (row.end_time) return `Closed ${span(now - row.end_time)} ago`;
    return t('governance.closesAtBlock', { block: String(row.end_block ?? t('common.notAvailable')) });
}

const votePollRef = (vote) => vote?.poll_index ?? vote?.poll_action_index ?? vote?.poll_ref;
const pollKeyFor = (chainId, pollIndex) => `${chainId}:${String(pollIndex ?? '')}`;

function voteWeightText(rows, tick) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const addresses = [...new Set(rows.map((row) => String(row?.source || '')))];
    const weights = addresses.flatMap((address) => {
        const latest = latestBallotRows(rows, address);
        const value = latest.map((row) => row?.voting_weight ?? row?.vote_weight ?? row?.weight)
            .find((weight) => /^\d+(?:\.\d+)?$/.test(String(weight ?? '').trim()));
        return value === undefined ? [] : [String(value).trim()];
    });
    if (weights.length !== addresses.length) return 'Counted at close';
    return `${formatDecimalAmount(addDecimals(weights))} ${String(tick || '').trim()}`.trim();
}

function listStatus(row) {
    if (row?.poll_status === 'pending') return 'Not started';
    if (row?.poll_status === 'open' || !row?.poll_status) return 'Open';
    return 'Closed';
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
    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]>} */ ({}));
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
    const [view, setView] = useState('all');
    const [votesByPoll, setVotesByPoll] = useState(/** @type {Map<string, any[]>} */ (new Map()));
    const [resultsByPoll, setResultsByPoll] = useState(/** @type {Map<string, any[]>} */ (new Map()));
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
        setAddressesByChain({});
        setPollState(null);
        setError(null);
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const avail = governanceChainIds.filter((cid) => Array.isArray(byChain?.[cid]) && byChain[cid].length > 0);
                setAddressesByChain(byChain || {});
                setGovernChains(avail);
                if (avail.length > 0) setChainId(avail[0]);
                else setNoChain(true);
            })
            .catch((err) => {
                if (!cancelled) setError(userFacingMessage(err, t('governance.error.addresses')));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, governanceChainIds, addressesReload]);

    // My votes is bounded by this wallet's addresses, never by the number of
    // polls on screen. The same vote rows already drive the poll detail.
    useEffect(() => {
        if (!governChains.length || typeof messaging.governanceVotes !== 'function') {
            setVotesByPoll(new Map());
            return undefined;
        }
        let cancelled = false;
        Promise.all(governChains.flatMap((cid) => (addressesByChain[cid] || []).map(({ address }) => (
            messaging.governanceVotes({ chainId: cid, query: address, type: 'address' })
                .then((response) => extractRows(response).map((vote) => ({
                    ...vote,
                    chainId: cid,
                    source: vote?.source || address,
                })))
                .catch(() => [])
        )))).then((lists) => {
            if (cancelled) return;
            const grouped = new Map();
            for (const vote of lists.flat()) {
                const key = pollKeyFor(vote.chainId, votePollRef(vote));
                if (key.endsWith(':')) continue;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(vote);
            }
            setVotesByPoll(grouped);
        });
        return () => { cancelled = true; };
    }, [addressesByChain, governChains, messaging]);

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
    // Frozen token-weighted results are the only truthful shares available.
    // Fetch them for closed rows so the list can draw the same answer bars as
    // prediction markets without inventing live weights before the close.
    useEffect(() => {
        if (!allRows || typeof messaging.governancePollResults !== 'function') {
            setResultsByPoll(new Map());
            return undefined;
        }
        let cancelled = false;
        const closed = allRows.filter((poll) => poll.poll_status && !['open', 'pending'].includes(poll.poll_status));
        Promise.all(closed.map((poll) => messaging.governancePollResults({
            chainId: poll.chainId || chainId,
            pollIndex: poll.action_index,
        }).then((response) => [pollKeyFor(poll.chainId || chainId, poll.action_index), extractRows(response)]).catch(() => null)))
            .then((entries) => {
                if (!cancelled) setResultsByPoll(new Map(entries.filter(Boolean)));
            });
        return () => { cancelled = true; };
    }, [allRows, chainId, messaging]);

    // Search matches the question, the token and the poll number.
    const q = query.trim().toLowerCase();
    const ownAddresses = new Set(shownChains.flatMap((cid) => (addressesByChain[cid] || []).map((address) => String(address?.address || ''))));
    const rows = allRows?.filter((p) => {
        const key = pollKeyFor(p.chainId || chainId, p.action_index);
        const viewMatches = view === 'all'
            || (view === 'votes' ? votesByPoll.has(key) : ownAddresses.has(String(p.source || '')));
        const status = p.poll_status || 'open';
        const statusMatches = statusFilter === 'all'
            || (statusFilter === 'closed' ? status !== 'open' && status !== 'pending' : status === statusFilter);
        const queryMatches = !q
            || [p.question, p.tick, String(p.action_index ?? '')].some((v) => String(v || '').toLowerCase().includes(q));
        return viewMatches && statusMatches && queryMatches;
    }) ?? allRows;
    const pollError = currentPollState?.error ?? null;
    const pollKey = (poll) => pollKeyFor(poll?.chainId || chainId, poll?.action_index);
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
    const tabsToolbar = (
        <div className={`${local.toolbarRow} ${local.toolbarActions}`}>
            <Tabs
                aria-label={t('governance.views.label')}
                items={[
                    { id: 'all', label: <span className={local.tabLabel}><Icon.GridIcon />{t('components.listPickerScreen.tabAll')}</span> },
                    { id: 'votes', label: <span className={local.tabLabel}><Icon.UserIcon />{t('governance.views.myVotes')}</span> },
                    { id: 'polls', label: <span className={local.tabLabel}><Icon.HandshakeIcon />{t('governance.views.myPolls')}</span> },
                ]}
                value={view}
                onChange={setView}
            />
        </div>
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
                    listHeader={tabsToolbar}
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

    let empty = null;
    if (rows && rows.length === 0) {
        const copy = view === 'votes'
            ? { title: 'No votes yet', body: 'Polls this wallet has voted in appear here.' }
            : view === 'polls'
                ? { title: 'No polls yet', body: 'Polls created by this wallet appear here.' }
                : { title: t('governance.empty.title'), body: t('governance.empty.body') };
        empty = <EmptyState title={copy.title} body={copy.body} />;
    }
    const questionList = rows && rows.length > 0 ? (
        <div className={cardListStyles.cardArea}>
        <ul
            className={cardListStyles.marketList}
            aria-label={t('governance.title')}
            data-xc-split-list={showPanel ? '' : undefined}
        >
            {rows.map((p) => {
                const id = p.action_index;
                const label = p.question || (Array.isArray(p.options) ? p.options.join(' / ') : String(p.options || ''));
                const selected = showPanel && pollKey(p) === pollKey(shownPoll);
                const summary = pollResultSummary(resultsByPoll.get(pollKey(p)) || p.poll_results || p.results, p.options || []);
                const sharesKnown = summary.entries.length > 0;
                const resultByOption = new Map(summary.entries.map((entry) => [entry.optionIndex, entry]));
                const gauge = questionCardSlices(
                    p.options || [],
                    sharesKnown ? (p.options || []).map((_, index) => resultByOption.get(index)?.percent ?? 0) : null,
                );
                const totalWeight = summary.entries.length
                    ? addDecimals(summary.entries.map((entry) => entry.weight))
                    : /^\d+(?:\.\d+)?$/.test(String(p.total_weight ?? '').trim()) ? String(p.total_weight).trim() : null;
                const callbackContract = p.callback_contract_index ?? p.callback_contract;
                const binding = Boolean(p.binding) || (
                    callbackContract !== null
                    && callbackContract !== undefined
                    && String(callbackContract).trim() !== ''
                );
                const yourVote = voteWeightText(votesByPoll.get(pollKey(p)), p.tick);
                return (
                    <li key={pollKey(p)}>
                        <QuestionCard
                            question={label || t('governance.pollNumber', { id: String(id) })}
                            meta={(
                                <span className={local.pollMeta} data-governance-card-status="">
                                    <span className={local.pollStatus}>{listStatus(p)}</span>
                                    <span>{whenText(p)}</span>
                                    {binding ? <span className={local.bindingBadge}>{t('governance.card.binding')}</span> : null}
                                </span>
                            )}
                            slices={gauge.slices}
                            total={gauge.total}
                            known={gauge.known}
                            emptyText={sharesKnown
                                ? t('governance.card.noVotingWeight')
                                : t('governance.detail.countedAtCloseShort')}
                            footer={(
                                <span className={cardStyles.pool} data-governance-card-weight="">
                                    <span className={cardStyles.poolIcon} aria-hidden="true"><Icon.CoinsIcon /></span>
                                    {totalWeight !== null ? (
                                        <strong>{t('governance.card.weight', {
                                            weight: formatDecimalAmount(totalWeight),
                                            tick: p.tick || '',
                                        })}</strong>
                                    ) : <>{t('governance.card.weightCountedAtClose')}</>}
                                </span>
                            )}
                            trailingChip={yourVote ? {
                                text: yourVote,
                                label: `Your vote: ${yourVote}`,
                                testId: 'governance-poll-your-vote',
                            } : null}
                            onOpen={() => {
                                if (wideContent) setSelectedPollKey(pollKey(p));
                                else onOpenPoll(p.chainId || chainId, id);
                            }}
                            selected={selected}
                            className={showPanel ? cardListStyles.splitRow : undefined}
                            dataAttribute="data-poll-index"
                            dataValue={id}
                        />
                    </li>
                );
            })}
        </ul>
        </div>
    ) : empty;

    return wrap(
        <ListPage
            toolbar={showPanel ? undefined : tabsToolbar}
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
        >{questionList}</ListPage>,
    );
}
