// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, ListPage, PageHeader, Screen, SectionHeader, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { outcomeLabelsOf, outcomePhrase } from '../utils/betOutcomeLabels.js';
import styles from './IssueTokenForm.module.css';

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

function unwrap(resp) {
    if (!resp) return null;
    if (Array.isArray(resp)) return resp[0] || null;
    if (Array.isArray(resp.data)) return resp.data[0] || null;
    if (resp.data && typeof resp.data === 'object') return resp.data;
    return resp;
}

// How many distinct markets this screen will ever read for their outcome
// labels. One round trip each, so the ceiling keeps a long bet history from
// opening a request storm for what is an annotation: rows past it keep the
// index they always showed.
const MAX_MARKET_READS = 25;

function statusLabel(status) {
    if (status === 'open') return 'Pending resolution';
    if (status === 'won') return 'Won';
    if (status === 'lost') return 'Lost';
    if (status === 'refunded') return 'Refunded';
    // A bet the chain refused. The row belongs here - it was a real transaction
    // and it cost real fees - but it is not a position, and the raw word
    // `invalid` in the "waiting on a result" colour read as one.
    if (status === 'invalid') return 'Rejected by the network';
    return status ? String(status) : 'Unknown';
}

function statusColor(status) {
    if (status === 'won') return { bg: 'color-mix(in srgb, var(--xc-success) 18%, transparent)', fg: 'var(--xc-success)' };
    if (status === 'lost' || status === 'invalid') return { bg: 'var(--xc-danger-bg)', fg: 'var(--xc-danger-text)' };
    if (status === 'refunded') return { bg: 'var(--xc-bg-muted)', fg: 'var(--xc-text-muted)' };
    return { bg: 'var(--xc-accent-primary)', fg: 'var(--xc-on-accent)' };
}

/**
 * Every bet this wallet has placed, across ALL of its addresses.
 *
 * Address-aggregated rather than active-address-scoped, following the MyTokens
 * rule. That is not a stylistic choice here: bets are keyed to the address that
 * placed them and payouts credit that same address, so a per-address view would
 * quietly hide money. The sweep gotcha makes it worse, since sweeping moves a
 * spendable balance but NOT a bet escrow, so a swept-from address can still be
 * the one holding an open position.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {(chainId: string, feedIndex: string | number) => void} [props.onOpenMarket]
 * @param {() => void} props.onBack
 */
export function MyBets({ walletId, accountId, onOpenMarket, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // Outcome labels per market, keyed `${chainId}:${feedActionIndex}`. Empty
    // array = asked, nothing to show (see the effect below).
    const [labelsByMarket, setLabelsByMarket] = useState(/** @type {Record<string, string[]>} */ ({}));
    const loadRequestId = useRef(0);

    const load = useCallback(async () => {
        const requestId = ++loadRequestId.current;
        if (typeof messaging?.getAddressesByChain !== 'function' || typeof messaging?.bets !== 'function') {
            setRows([]); return;
        }
        setRows(null);
        setError(null);
        try {
            const chains = (await messaging.getAddressesByChain(walletId, accountId)) || {};
            if (requestId !== loadRequestId.current) return;
            const pairs = [];
            for (const [chainId, addrs] of Object.entries(chains)) {
                for (const a of addrs || []) pairs.push({ chainId, address: a.address });
            }
            const results = await Promise.all(pairs.map((p) => messaging
                .bets({ chainId: p.chainId, query: p.address, type: 'address', opts: { limit: 100 } })
                .then((r) => ({ p, bets: extractRows(r) }))
                .catch(() => ({ p, bets: [], failed: true }))));
            if (requestId !== loadRequestId.current) return;

            // One address can appear on several chains, and a chain query returns
            // only that chain's rows, so dedupe on chain + action_index.
            const seen = new Set();
            const all = [];
            for (const r of results) {
                for (const b of r.bets) {
                    const key = `${r.p.chainId}:${b.action_index}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    all.push({ ...b, chainId: r.p.chainId, owner: r.p.address });
                }
            }
            // Open positions first (they are the ones still worth acting on), then
            // newest settled.
            all.sort((a, b) => {
                const ao = a.bet_status === 'open' ? 0 : 1;
                const bo = b.bet_status === 'open' ? 0 : 1;
                if (ao !== bo) return ao - bo;
                return Number(b.action_index || 0) - Number(a.action_index || 0);
            });
            const failures = results.filter((r) => r.failed).length;
            if (failures > 0) {
                setError(failures === results.length
                    ? 'Could not load bets for any of your addresses.'
                    : `Could not load bets for ${failures} of your addresses. The list may be incomplete.`);
            }
            setRows(all);
        } catch {
            if (requestId !== loadRequestId.current) return;
            setError('Could not load your bets. Try again.');
            setRows([]);
        }
    }, [walletId, accountId, messaging]);

    useEffect(() => {
        load();
        return () => { loadRequestId.current += 1; };
    }, [load]);

    // (c): a bet row names its outcome by INDEX only - the explorer's
    // bets query joins the wager, not the market that declared the labels - so
    // every row read "Outcome 1" while the market itself carries "Yes"/"No".
    // One market read per DISTINCT market in the list fills that in.
    //
    // Best-effort by design: a failed or slow read leaves the row on its index,
    // which is what it showed before, so the money-bearing part of the screen
    // never waits on cosmetics. Capped because this is a per-market round trip
    // and the bet list is paged at 100 per address.
    useEffect(() => {
        if (!rows || rows.length === 0) return undefined;
        if (typeof messaging?.betFeed !== 'function') return undefined;
        let cancelled = false;
        const wanted = [];
        const seen = new Set();
        // Counted across passes, not per pass: this effect re-runs on its own
        // result, so a per-pass cap would just fetch the next 25 each time.
        let asked = Object.keys(labelsByMarket).length;
        for (const b of rows) {
            const idx = b.feed_action_index;
            if (idx === undefined || idx === null) continue;
            const key = `${b.chainId}:${idx}`;
            // Attempted markets are recorded even when they came back with no
            // labels, so a market that cannot supply them is asked once rather
            // than on every render this effect's own setState triggers.
            if (seen.has(key) || Object.hasOwn(labelsByMarket, key)) continue;
            if (asked >= MAX_MARKET_READS) break;
            seen.add(key);
            wanted.push({ key, chainId: b.chainId, feedIndex: idx });
            asked += 1;
        }
        if (wanted.length === 0) return undefined;
        Promise.all(wanted.map((w) => messaging
            .betFeed({ chainId: w.chainId, feedIndex: w.feedIndex })
            .then((r) => ({ key: w.key, labels: outcomeLabelsOf(unwrap(r)) }))
            .catch(() => ({ key: w.key, labels: [] }))))
            .then((results) => {
                if (cancelled) return;
                const next = {};
                for (const r of results) next[r.key] = r.labels;
                setLabelsByMarket((prev) => ({ ...prev, ...next }));
            })
            .catch(() => { /* labels are an annotation; the index still renders */ });
        return () => { cancelled = true; };
    }, [rows, messaging, labelsByMarket]);

    const header = <PageHeader onBack={onBack} title="My bets" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>{children}</ListPage>
        </Screen>
    );

    if (error && (!rows || rows.length === 0)) {
        return wrap(
            <StatusMessage
                variant="error"
                className={styles.error}
                recovery={{ label: 'Try again', onAction: load }}
            >
                {error}
            </StatusMessage>,
        );
    }
    if (!rows) {
        return wrap(
            <div role="status" aria-label="Loading bets">
                <Skeleton.List rows={5} />
            </div>,
        );
    }
    if (rows.length === 0) {
        return wrap(
            <EmptyState
                title="No bets yet"
                body="Bets placed from this wallet appear here."
            />,
        );
    }

    const openCount = rows.filter((r) => r.bet_status === 'open').length;
    const pendingRows = rows.filter((r) => r.bet_status === 'open');
    const pastRows = rows.filter((r) => r.bet_status !== 'open');

    const betRow = (b) => {
        const c = statusColor(b.bet_status);
        const clickable = onOpenMarket && b.feed_action_index !== undefined && b.feed_action_index !== null;
        // Named by the market's own label where it is known, and by
        // the index alone where it is not. The index is always
        // shown: it is what the wager actually carries.
        const backed = outcomePhrase(labelsByMarket[`${b.chainId}:${b.feed_action_index}`], b.outcome);
        const body = (
            <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>Market #{String(b.feed_action_index)}</strong>
                    <span style={{ background: c.bg, color: c.fg, borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                        {statusLabel(b.bet_status)}
                    </span>
                </div>
                <div className={`${styles.hint} ${styles.betLongText}`}>
                    {b.bet_status === 'invalid'
                        // "staked 100 XCHAIN" is false on a rejected bet: the amount is
                        // what the transaction ASKED for, and no stake was ever taken.
                        // The fees were, which is the part worth saying.
                        ? <>Would have backed {backed} for {String(b.amount)} {b.tick || ''} · nothing was staked, but the fees were spent</>
                        : <>Backed {backed} · staked {String(b.amount)} {b.tick || ''}</>}
                </div>
                {/* Payouts credit the address that PLACED the bet, so name it:
                    a sweep does not move a bet escrow or its winnings. */}
                <div className={`${styles.hint} ${styles.betLongText}`}>from {b.owner}</div>
                {b.bet_status !== 'open' && b.settled_block !== undefined && b.settled_block !== null ? (
                    <div className={styles.hint}>Settled in block {String(b.settled_block)}</div>
                ) : null}
            </>
        );
        return clickable ? (
            <button
                key={`${b.chainId}:${b.action_index}`}
                type="button"
                onClick={() => onOpenMarket(b.chainId, b.feed_action_index)}
                className={styles.listCard}
                style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            >
                {body}
            </button>
        ) : (
            <div key={`${b.chainId}:${b.action_index}`} className={styles.listCard}>{body}</div>
        );
    };

    return wrap(
        <>
            {error ? <StatusMessage variant="error" className={styles.error}>{error}</StatusMessage> : null}
            <p className={styles.hint}>
                {rows.length} bet{rows.length === 1 ? '' : 's'} across all of your addresses
                {openCount ? `, ${openCount} still waiting on a result` : ''}.
            </p>
            {pendingRows.length > 0 ? (
                <section>
                    <SectionHeader title="Pending resolution" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {pendingRows.map(betRow)}
                    </div>
                </section>
            ) : null}
            {pastRows.length > 0 ? (
                <section>
                    <SectionHeader title="Past bets" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {pastRows.map(betRow)}
                    </div>
                </section>
            ) : null}
            <p className={styles.hint}>
                There is no claim transaction. When a market resolves, the protocol credits winnings
                or refunds automatically to the address that placed the bet. Sweeping an address moves
                its spendable balance but not its bets, so a payout can still land on an address you
                have already swept.
            </p>
        </>,
    );
}
