// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, Icon, ListPage, PageHeader, Screen, SectionHeader, Select, StatusMessage } from '@xchain-wallet/core/ui';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { ActionsDetailsToggle } from '../components/ActionsDetailsToggle.jsx';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
// The Copy Address action and safe market titles.
import { copyText } from '../clipboard.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import styles from './IssueTokenForm.module.css';
// The identity card, the fact rows shared with the bet market page, and
// this page's own market rows.
import { OracleRecordHero } from './OracleRecordHero.jsx';
import { ORACLE_MARKET_STATUSES, feeRangeText, listedMarketCount, marketStatusKind, orderedMarkets } from './oracleRecordSeries.js';
import betLocal from './BetFeedDetail.module.css';
import local from './OracleRecord.module.css';

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

function unwrap(resp) {
    const rows = extractRows(resp);
    if (rows.length) return rows[0];
    if (resp && !Array.isArray(resp) && typeof resp === 'object' && !Array.isArray(resp.data)) {
        return resp.data && typeof resp.data === 'object' ? resp.data : resp;
    }
    return null;
}

/** Each list state's pill word, Status option and icon. */
const STATUS_META = {
    open: { label: 'Open', pill: local.chipOpen, Glyph: Icon.ZapIcon },
    resolving: { label: 'Resolving', pill: local.chipPending, Glyph: Icon.ClockIcon },
    resolved: { label: 'Resolved', pill: local.chipSettled, Glyph: Icon.CheckIcon },
    refunded: { label: 'Refunded', pill: local.chipRefunded, Glyph: Icon.IncomingIcon },
};

function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
}

/** A short local date for a unix-seconds time, or null. */
function shortDate(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return null;
    try {
        return new Date(n * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return null;
    }
}

/**
 * One betting oracle's public track record, read before you trust them with a stake.
 *
 * This is the whole of the v0 reputation system and it is NOT a safety rating:
 * there is no bond, no stake and no slashing behind a betting market, and the
 * record is keyed to an ADDRESS, which anyone can replace for free. That is why
 * the caveat is rendered in full rather than tucked into a footnote: a clean
 * sheet here means unknown, not safe.
 *
 * The number that actually matters to a bettor is `expired`. An oracle who lets a
 * market run out unresolved has not stolen anything (every stake is refunded), but
 * it has taken the bettors' money out of play for the whole refund window and
 * decided nothing, so it gets counted separately and called what it is.
 *
 * Laid out as a detail page with no chart (G16): the white identity card,
 * then the Actions, Markets and Details toggle (G102), of which only the
 * chosen tab shows. Actions opens first and holds the action list (G101).
 * Markets is every loaded market of this oracle in one list with a status
 * pill each; the header's filter icon searches and filters it by status, and
 * shows only while Markets is chosen.
 *
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.address
 * @param {(chainId: string, feedIndex: string | number) => void} [props.onOpenMarket]
 * @param {() => void} props.onBack
 * @param {string} [props.walletId]               Lets the page tell whether the viewer IS this oracle
 * @param {() => void} [props.onResolvePending]   Opens My betting markets to resolve the pending ones
 */
export function OracleRecord({ chainId, address, onOpenMarket, onBack, walletId, onResolvePending }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [record, setRecord] = useState(/** @type {any} */ (null));
    const [markets, setMarkets] = useState(/** @type {any[] | null} */ (null));
    const [marketsError, setMarketsError] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // A saved contact's name for this address, and whether one of
    // this wallet's addresses is the oracle (each one read, never per market).
    const [contactName, setContactName] = useState(/** @type {string | null} */ (null));
    const [isOwnOracle, setIsOwnOracle] = useState(false);
    // Actions opens first (G102). The page owns the chosen tab so the header
    // filter can show on Markets alone and Place bet can move to Markets.
    const [view, setView] = useState('actions');
    // The Markets filter lives here, not in the panel, so it outlives a tab switch.
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [copied, setCopied] = useState(/** @type {'idle' | 'copied' | 'failed'} */ ('idle'));
    const listRef = useRef(/** @type {HTMLElement | null} */ (null));
    const copyTimerRef = useRef(/** @type {any} */ (null));

    useEffect(() => {
        let cancelled = false;
        setRecord(null);
        setError(null);
        if (typeof messaging.betOracle !== 'function') {
            setError('This wallet build cannot read oracle records.');
            return undefined;
        }
        messaging.betOracle({ chainId, address })
            .then((resp) => { if (!cancelled) setRecord(unwrap(resp) || {}); })
            .catch((err) => {
                if (!cancelled) setError(userFacingMessage(err, 'Failed to load the oracle record.'));
            });
        return () => { cancelled = true; };
    }, [chainId, address, messaging]);

    // Their markets load separately, in one read, and are allowed to fail on
    // their own: the record is the point of the page, and a listing error
    // must not blank it. Search and the Status filter work over this one page.
    useEffect(() => {
        let cancelled = false;
        setMarkets(null);
        setMarketsError(false);
        if (typeof messaging.betFeeds !== 'function') { setMarkets([]); return undefined; }
        messaging.betFeeds({ chainId, query: address, type: 'source', opts: { limit: 50 } })
            .then((resp) => { if (!cancelled) setMarkets(extractRows(resp)); })
            .catch(() => {
                if (cancelled) return;
                setMarkets([]);
                setMarketsError(true);
            });
        return () => { cancelled = true; };
    }, [chainId, address, messaging]);

    // The card's title is the contact name saved for this address,
    // when there is one; otherwise its address.
    useEffect(() => {
        let cancelled = false;
        setContactName(null);
        if (typeof messaging.listContacts !== 'function') return undefined;
        Promise.resolve(messaging.listContacts())
            .then((rows) => {
                if (cancelled || !Array.isArray(rows)) return;
                for (const c of rows) {
                    const hit = (Array.isArray(c?.entries) ? c.entries : []).some((e) => String(e?.address) === String(address));
                    if (hit && c?.name) { setContactName(String(c.name)); return; }
                }
            })
            .catch(() => { /* a name is a nicety; the address stands in */ });
        return () => { cancelled = true; };
    }, [address, messaging]);

    // The Resolve action shows only to the oracle itself, and only
    // where the shell wires both the wallet and the way to My betting markets.
    const canResolve = typeof onResolvePending === 'function';
    useEffect(() => {
        let cancelled = false;
        setIsOwnOracle(false);
        if (!walletId || !canResolve || typeof messaging.getAddressesByChain !== 'function') return undefined;
        Promise.resolve(messaging.getAddressesByChain(walletId))
            .then((byChain) => {
                if (cancelled) return;
                const rows = Array.isArray(byChain?.[chainId]) ? byChain[chainId] : [];
                setIsOwnOracle(rows.some((a) => String(a?.address) === String(address)));
            })
            .catch(() => { /* the action stays hidden */ });
        return () => { cancelled = true; };
    }, [walletId, chainId, address, canResolve, messaging]);

    useEffect(() => () => clearTimeout(copyTimerRef.current), []);

    const rows = useMemo(() => orderedMarkets(markets || []), [markets]);
    const statusCounts = useMemo(() => {
        const counts = { all: rows.length, open: 0, resolving: 0, resolved: 0, refunded: 0 };
        for (const m of rows) {
            const kind = marketStatusKind(m?.feed_status);
            if (kind) counts[kind] += 1;
        }
        return counts;
    }, [rows]);
    const visibleRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return rows.filter((m) => {
            if (statusFilter !== 'all' && marketStatusKind(m?.feed_status) !== statusFilter) return false;
            if (!q) return true;
            return [m?.label, String(m?.action_index ?? ''), m?.tick]
                .some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
        });
    }, [rows, query, statusFilter]);

    // The header filter (search, then Status) shows only on the Markets tab;
    // the other tabs have nothing for it to narrow.
    const filterMenu = view === 'markets' && record && !error ? (
        <ListFilterMenu
            query={query}
            onQueryChange={setQuery}
            active={statusFilter !== 'all'}
            label="Filter markets"
            searchPlaceholder="Search"
            searchLabel="Search markets"
        >
            {/* The themed dropdown with an icon per option, never radios (G119). */}
            <Select
                label="Status"
                size="md"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
            >
                <Select.Option value="all" icon={<Icon.ListIcon />}>{`All statuses (${statusCounts.all})`}</Select.Option>
                {ORACLE_MARKET_STATUSES.map((kind) => {
                    const { label, Glyph } = STATUS_META[kind];
                    return (
                        <Select.Option key={kind} value={kind} icon={<Glyph />}>{`${label} (${statusCounts[kind]})`}</Select.Option>
                    );
                })}
            </Select>
        </ListFilterMenu>
    ) : null;

    const header = <PageHeader onBack={onBack} title="Oracle Record" trailing={filterMenu} />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>{children}</ListPage>
        </Screen>
    );

    if (error) {
        return wrap(
            <>
                <StatusMessage variant="error">{error}</StatusMessage>
            </>,
        );
    }
    if (!record) return wrap(<p>Loading record…</p>);

    const counts = record.counts || {};
    const settled = num(counts.resolved);
    const voided = num(counts.resolved_void);
    const cancelled = num(counts.cancelled);
    const expired = num(counts.expired);
    const pending = num(counts.closed);
    const total = num(record.total_feeds);
    const active = num(record.active_feeds);
    const fees = Array.isArray(record.fees_earned) ? record.fees_earned : [];

    const openRows = rows.filter((m) => m.feed_status === 'open');
    const listed = listedMarketCount(record);
    const partial = markets !== null && !marketsError && rows.length < listed;
    const feeText = markets ? feeRangeText(rows) : null;

    // One fact per row (label, value), as on the bet market page.
    const factRow = (label, value, hint) => (
        <div className={betLocal.factRow}>
            <dt className={betLocal.factLabel}>
                {label}
                {hint ? <span className={local.factHint}>{hint}</span> : null}
            </dt>
            <dd className={betLocal.factValue}>{value}</dd>
        </div>
    );

    // One market per row with its status pill; the whole row opens the market.
    const marketItem = (m) => {
        const kind = marketStatusKind(m.feed_status);
        const meta = kind ? STATUS_META[kind] : null;
        const date = shortDate(m.deadline);
        const body = (
            <>
                <span className={local.marketTitle}>
                    {neutralizeControlText(m.label, { maxLength: 250 }) || '(untitled market)'}
                </span>
                <span className={local.marketMeta}>
                    <span className={`${local.chip} ${meta ? meta.pill : local.chipRefunded}`} data-market-status={kind || 'unknown'}>
                        {meta ? meta.label : (m.feed_status ? String(m.feed_status) : 'Unknown')}
                    </span>
                    <span>#{String(m.action_index)} · {m.tick || 'n/a'}</span>
                    {date ? <span>{kind === 'open' ? 'Closes' : 'Closed'} {date}</span> : null}
                </span>
            </>
        );
        return (
            <li key={String(m.action_index)} className={local.marketItem}>
                {onOpenMarket ? (
                    <button type="button" className={local.marketRow} onClick={() => onOpenMarket(chainId, m.action_index)}>
                        {body}
                    </button>
                ) : (
                    <div className={local.marketRow}>{body}</div>
                )}
            </li>
        );
    };

    // The list's loading, error and empty states.
    const listState = () => {
        if (marketsError) {
            return (
                <StatusMessage variant="error">
                    Could not load this address&apos;s markets.
                </StatusMessage>
            );
        }
        if (!markets) return <p className={styles.hint}>Loading markets…</p>;
        if (markets.length === 0) {
            return <EmptyState title="No markets yet" body="Markets created by this address on this network appear here." titleAs="p" />;
        }
        return null;
    };

    // Markets: every loaded market in one list, narrowed by the header filter.
    const marketsPanel = listState() || (
        <>
            {visibleRows.length === 0 ? (
                <EmptyState title="No matching markets" body="Change the search or the Status filter to see more." titleAs="p" />
            ) : (
                <ul className={local.marketList} aria-label="Oracle markets" ref={listRef}>
                    {visibleRows.map((m) => marketItem(m))}
                </ul>
            )}
            {partial ? (
                <p className={styles.hint}>Showing the latest {rows.length} of this address&apos;s {listed} markets.</p>
            ) : null}
        </>
    );

    // Details holds the address, every count (expired on its own line), the
    // fee, the fees earned and the not-a-guarantee caveat.
    const firstMarket = (() => {
        let first = Infinity;
        for (const m of rows) {
            const t = Number(m?.timestamp);
            if (Number.isFinite(t) && t > 0 && t < first) first = t;
        }
        return Number.isFinite(first) ? shortDate(first) : null;
    })();

    const detailsPanel = (
        <>
            <dl className={betLocal.facts}>
                {factRow('Oracle address', <span className={betLocal.factAddress}>{address}</span>)}
                {factRow('Markets opened', total)}
                {factRow('Still running', active)}
                {pending > 0 ? factRow('Awaiting its result', pending) : null}
                {factRow('Settled with a result', settled)}
                {factRow('Settled with nobody on the winning side', voided, 'Everyone refunded')}
                {factRow('Cancelled by the oracle', cancelled, 'Everyone refunded')}
                {/* The failure mode a bettor most needs to see, so it is named
                    plainly and never averaged into a success rate. */}
                {factRow('Left to expire with no result', expired, 'Everyone refunded')}
                {firstMarket ? factRow(partial ? 'Oldest loaded market' : 'First market', firstMarket) : null}
                {feeText ? factRow('Oracle fee', `${feeText} of the pot`) : null}
            </dl>

            <SectionHeader title="Fees earned" />
            {fees.length === 0 ? (
                <EmptyState
                    title="No settlement fees yet"
                    body="Fees paid to this address for settling markets appear here."
                    titleAs="p"
                />
            ) : (
                <>
                    <dl className={betLocal.facts}>
                        {fees.map((f, i) => (
                            <div key={i} className={betLocal.factRow}>
                                <dt className={betLocal.factLabel}>{f.tick || 'unknown token'}</dt>
                                <dd className={betLocal.factValue}>{String(f.amount)}</dd>
                            </div>
                        ))}
                    </dl>
                    <p className={styles.hint}>
                        Taken out of the pot when a market settles, at the fee the market was created
                        with. An oracle earns nothing from a market it cancels, voids, or lets expire.
                    </p>
                </>
            )}

            {/* Required by the spec's trust model, not optional decoration. */}
            <div role="note" className={local.note}>
                <strong>This record is not a guarantee.</strong>
                <p>
                    Nothing is staked behind a prediction market. This history belongs to one address, and
                    anyone can start again from a new one, so an empty or short record means
                    <em> unknown</em>, not <em>safe</em>. If an oracle never publishes a result you get
                    your stake back once the refund window passes, but who wins is the oracle&apos;s
                    call and nobody can overrule it.
                </p>
            </div>
        </>
    );

    // The action list (G101), the Actions tab's panel. Place bet opens the
    // one market taking bets, or shows Markets narrowed to the open ones when
    // there are several; Copy address stands in for Report (the app has no
    // report or follow feature); Resolve shows only to the oracle itself.
    const onPlaceBet = () => {
        if (openRows.length === 1 && onOpenMarket) {
            onOpenMarket(chainId, openRows[0].action_index);
            return;
        }
        setQuery('');
        setStatusFilter('open');
        setView('markets');
        setTimeout(() => listRef.current?.querySelector('button')?.focus(), 0);
    };
    const onCopy = async () => {
        const { ok } = await copyText(address);
        setCopied(ok ? 'copied' : 'failed');
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied('idle'), 1500);
    };
    const actionsPanel = (
        <ActionList label="Oracle actions">
            {openRows.length > 0 && onOpenMarket ? (
                <ActionListItem
                    icon={<Icon.ZapIcon />}
                    title="Buy a position"
                    description={openRows.length === 1
                        ? 'Open the market offering positions'
                        : `Choose one of ${openRows.length} markets offering positions`}
                    onClick={onPlaceBet}
                />
            ) : null}
            <ActionListItem
                icon={copied === 'copied' ? <Icon.CheckIcon /> : <Icon.CopyIcon />}
                title={copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy address'}
                description="Copy this oracle's address"
                onClick={onCopy}
                chevron={false}
            />
            {isOwnOracle && pending > 0 ? (
                <ActionListItem
                    icon={<Icon.CheckIcon />}
                    title={`Resolve (${pending})`}
                    description={`Post the result of ${pending === 1 ? 'the market' : `${pending} markets`} awaiting it`}
                    onClick={onResolvePending}
                />
            ) : null}
        </ActionList>
    );

    // The identity card, then the toggle above its one chosen panel.
    return wrap(
        <>
            <OracleRecordHero chainId={chainId} address={address} name={contactName} record={record} markets={marketsError ? [] : markets} />
            <ActionsDetailsToggle
                label="Oracle sections"
                view={view}
                onViewChange={setView}
                actions={actionsPanel}
                extra={{ id: 'markets', label: 'Markets', icon: <Icon.MarketIcon />, panel: marketsPanel }}
                details={detailsPanel}
            />
        </>,
    );
}
