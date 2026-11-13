// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useRef, useState } from 'react';
import { Button, EmptyState, Icon, ListPage, PageHeader, Screen, SectionHeader, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
// The Copy Address action and safe market titles.
import { copyText } from '../clipboard.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import styles from './IssueTokenForm.module.css';
// The blue oracle card, the icon tabs and fact rows shared with the bet
// market page, and this page's own actions row and market rows.
import { OracleRecordHero } from './OracleRecordHero.jsx';
import { feeRangeText } from './oracleRecordSeries.js';
import betLocal from './BetFeedDetail.module.css';
import local from './OracleRecord.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';

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

function statusLabel(status) {
    if (status === 'open') return 'Taking bets';
    if (status === 'closed') return 'Awaiting result';
    if (status === 'resolved') return 'Settled';
    if (status === 'resolved_void') return 'Void, refunded';
    if (status === 'cancelled') return 'Cancelled, refunded';
    if (status === 'expired') return 'Expired, refunded';
    return status ? String(status) : 'Unknown';
}

/** One chip colour per market state. */
function chipClass(status) {
    if (status === 'open') return local.chipOpen;
    if (status === 'closed') return local.chipPending;
    if (status === 'resolved') return local.chipSettled;
    if (status === 'expired') return local.chipExpired;
    return local.chipRefunded;
}

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

/** Newest betting close first. */
const byDeadlineDesc = (a, b) => num(b?.deadline) - num(a?.deadline);

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
 * Laid out like the bet market page: a blue card with the markets
 * resolved over time, an actions row, then icon tabs (Markets, Resolutions,
 * Disputes, About), of which only the chosen one shows.
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
    const [tab, setTab] = useState('markets');
    const [copied, setCopied] = useState(/** @type {'idle' | 'copied' | 'failed'} */ ('idle'));
    const tabsId = useId();
    const openGroupRef = useRef(/** @type {HTMLElement | null} */ (null));
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

    // Their markets load separately and are allowed to fail on their own: the
    // record is the point of the page, and a listing error must not blank it.
    // This one page of markets also feeds the card's chart.
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
    // when there is one; otherwise its short address.
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

    const header = <PageHeader onBack={onBack} title="Oracle Record" />;
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

    const rows = markets || [];
    const openRows = rows.filter((m) => m.feed_status === 'open').sort(byDeadlineDesc).reverse();
    const pendingRows = rows.filter((m) => m.feed_status === 'closed').sort(byDeadlineDesc).reverse();
    const resolvedRows = rows.filter((m) => m.feed_status === 'resolved' || m.feed_status === 'resolved_void').sort(byDeadlineDesc);
    const refundedRows = rows.filter((m) => m.feed_status === 'cancelled' || m.feed_status === 'expired').sort(byDeadlineDesc);
    const partial = markets !== null && !marketsError && rows.length < total;
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

    // One market per row; the whole row opens the market.
    const marketItem = (m, { dateLabel } = {}) => {
        const date = dateLabel ? shortDate(m.deadline) : null;
        const body = (
            <>
                <span className={local.marketTitle}>
                    {neutralizeControlText(m.label, { maxLength: 250 }) || '(untitled market)'}
                </span>
                <span className={local.marketMeta}>
                    <span className={`${local.chip} ${chipClass(m.feed_status)}`}>{statusLabel(m.feed_status)}</span>
                    <span>#{String(m.action_index)} · {m.tick || 'n/a'}</span>
                    {date ? <span>{dateLabel} {date}</span> : null}
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

    // A group heading inside a tab (icon, name, count), the list's
    // loading, error and empty states, and the one-page note, shared by the
    // Markets, Resolutions and Disputes tabs.
    const groupHead = (IconGlyph, text, ref) => (
        <h3 className={local.groupHead} ref={ref} tabIndex={ref ? -1 : undefined}>
            <span className={local.groupIcon} aria-hidden="true"><IconGlyph /></span>
            {text}
        </h3>
    );

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
    const partialNote = partial ? (
        <p className={styles.hint}>Showing the latest {rows.length} of this address&apos;s {total} markets.</p>
    ) : null;

    // Markets holds the markets still live (taking bets, then
    // awaiting the oracle's result).
    const marketsPanel = (
        <>
            {listState()}
            {markets && markets.length > 0 && openRows.length === 0 && pendingRows.length === 0 ? (
                <EmptyState
                    title="No markets running"
                    body="None of this address's markets is taking bets or awaiting a result; its finished markets are under Resolutions and Disputes."
                    titleAs="p"
                />
            ) : null}
            {openRows.length > 0 ? (
                <>
                    {groupHead(Icon.ZapIcon, `Taking Bets (${openRows.length})`, openGroupRef)}
                    <ul className={local.marketList}>{openRows.map((m) => marketItem(m, { dateLabel: 'Closes' }))}</ul>
                </>
            ) : null}
            {pendingRows.length > 0 ? (
                <>
                    {groupHead(Icon.ClockIcon, `Awaiting Result (${pendingRows.length})`)}
                    <ul className={local.marketList}>{pendingRows.map((m) => marketItem(m, { dateLabel: 'Closed' }))}</ul>
                </>
            ) : null}
            {partialNote}
        </>
    );

    // Resolutions holds the settled counts and the settled markets.
    const resolutionsPanel = (
        <>
            <dl className={betLocal.facts}>
                {factRow('Settled with a result', settled)}
                {factRow('Settled with nobody on the winning side', voided, 'Everyone refunded')}
            </dl>
            {listState()}
            {markets && markets.length > 0 && resolvedRows.length === 0 ? (
                <EmptyState title="No settled markets loaded" body="Markets this address settles appear here." titleAs="p" />
            ) : null}
            {resolvedRows.length > 0 ? (
                <>
                    {groupHead(Icon.CheckIcon, `Recent Resolutions (${resolvedRows.length})`)}
                    <ul className={local.marketList}>{resolvedRows.map((m) => marketItem(m, { dateLabel: 'Betting closed' }))}</ul>
                </>
            ) : null}
            {partialNote}
        </>
    );

    // Disputes says there is no dispute process (so no dispute
    // figure exists) and holds the cancelled and expired counts and markets.
    const disputesPanel = (
        <>
            <div role="note" className={local.note}>
                <strong>Betting markets have no dispute process.</strong>
                <p>
                    Who wins is the oracle&apos;s call and nobody can overrule it. What you can check
                    is how often this address walked away from a market instead of settling it.
                </p>
            </div>
            <dl className={betLocal.facts}>
                {factRow('Cancelled by the oracle', cancelled, 'Everyone refunded')}
                {/* The failure mode a bettor most needs to see, so it is named
                    plainly and never averaged into a success rate. */}
                {factRow('Left to expire with no result', expired, 'Everyone refunded')}
            </dl>
            {refundedRows.length > 0 ? (
                <>
                    {groupHead(Icon.XIcon, `Cancelled or Expired (${refundedRows.length})`)}
                    <ul className={local.marketList}>{refundedRows.map((m) => marketItem(m, { dateLabel: 'Betting closed' }))}</ul>
                </>
            ) : null}
            {partialNote}
        </>
    );

    // About holds the address, the opened and running counts, the
    // fee, the fees earned and the not-a-guarantee caveat.
    const firstMarket = (() => {
        let first = Infinity;
        for (const m of rows) {
            const t = Number(m?.timestamp);
            if (Number.isFinite(t) && t > 0 && t < first) first = t;
        }
        return Number.isFinite(first) ? shortDate(first) : null;
    })();

    const aboutPanel = (
        <>
            <dl className={betLocal.facts}>
                {factRow('Oracle address', <span className={betLocal.factAddress}>{address}</span>)}
                {factRow('Markets opened', total)}
                {factRow('Still running', active)}
                {pending > 0 ? factRow('Awaiting its result', pending) : null}
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
                    Nothing is staked behind a betting market. This history belongs to one address, and
                    anyone can start again from a new one, so an empty or short record means
                    <em> unknown</em>, not <em>safe</em>. If an oracle never publishes a result you get
                    your stake back once the refund window passes, but who wins is the oracle&apos;s
                    call and nobody can overrule it.
                </p>
            </div>
        </>
    );

    // The actions row. Place Bet opens the one market taking bets, or
    // shows the Taking Bets group when there are several; Copy Address stands
    // in for Report (the app has no report or follow feature); Resolve shows
    // only to the oracle itself.
    const onPlaceBet = () => {
        if (openRows.length === 1 && onOpenMarket) {
            onOpenMarket(chainId, openRows[0].action_index);
            return;
        }
        setTab('markets');
        setTimeout(() => openGroupRef.current?.focus(), 0);
    };
    const onCopy = async () => {
        const { ok } = await copyText(address);
        setCopied(ok ? 'copied' : 'failed');
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied('idle'), 1500);
    };
    const actions = (
        <div className={local.actions}>
            {openRows.length > 0 && onOpenMarket ? (
                <Button variant="primary" className={local.action} icon={<Icon.ZapIcon />} onClick={onPlaceBet}>Place Bet</Button>
            ) : null}
            <Button
                variant="secondary"
                className={local.action}
                icon={copied === 'copied' ? <Icon.CheckIcon /> : <Icon.CopyIcon />}
                onClick={onCopy}
            >
                {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy Failed' : 'Copy Address'}
            </Button>
            {isOwnOracle && pending > 0 ? (
                <Button variant="secondary" className={local.action} icon={<Icon.CheckIcon />} onClick={onResolvePending}>
                    Resolve ({pending})
                </Button>
            ) : null}
        </div>
    );

    // The four icon tabs, as on the bet market page; Markets opens
    // first and only the chosen tab's panel renders.
    const tabLabel = (IconGlyph, text) => (
        <span className={homeTabsStyles.tabWithIcon}>
            <span className={homeTabsStyles.tabIcon} aria-hidden="true"><IconGlyph /></span>
            {text}
        </span>
    );
    const tabItems = [
        { id: 'markets', label: tabLabel(Icon.MarketIcon, 'Markets') },
        { id: 'resolutions', label: tabLabel(Icon.CheckIcon, 'Resolutions') },
        { id: 'disputes', label: tabLabel(Icon.ThumbsDownIcon, 'Disputes') },
        { id: 'about', label: tabLabel(Icon.InfoIcon, 'About') },
    ];

    // The blue card, the actions row, then the tabs above their panel.
    return wrap(
        <>
            <OracleRecordHero address={address} name={contactName} record={record} markets={marketsError ? [] : markets} />
            {actions}
            <Tabs
                id={tabsId}
                items={tabItems}
                value={tab}
                onChange={setTab}
                panelId={`${tabsId}-panel`}
                aria-label="Oracle sections"
                className={betLocal.sectionTabs}
            />
            <div
                id={`${tabsId}-panel`}
                role="tabpanel"
                aria-labelledby={`${tabsId}-tab-${tab}`}
                className={betLocal.panel}
            >
                {tab === 'markets' ? marketsPanel : null}
                {tab === 'resolutions' ? resolutionsPanel : null}
                {tab === 'disputes' ? disputesPanel : null}
                {tab === 'about' ? aboutPanel : null}
            </div>
        </>,
    );
}
