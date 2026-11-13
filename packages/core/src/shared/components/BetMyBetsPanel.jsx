// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Bet Markets' My bets tab: every bet across ALL of the wallet's addresses,
// pending first, with outcome, stake, placing address and settled block. The
// loader is shared with the market cards, which read it for "You bet" chips.

import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, ListRow, SectionHeader, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { outcomeLabelsOf, outcomePhrase, safeOutcomeLabel } from '../utils/betOutcomeLabels.js';
import { formatDecimalAmount } from '../utils/amountFormat.js';
import { addDecimals } from './BetMarketCard.jsx';
import styles from '../routes/IssueTokenForm.module.css';

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

// Same ceiling as My Bets: one market read per distinct market, capped.
const MAX_MARKET_READS = 25;

/**
 * Every bet this wallet has placed, across all of its addresses (address
 * aggregated for the same reason My Bets is: payouts credit the placing
 * address, and a sweep does not move a bet escrow).
 *
 * Takes the page's own address read (`byChain`) instead of asking for the
 * wallet's addresses a second time; null means that read is still pending.
 *
 * @returns {{ rows: any[] | null, error: string | null, reload: () => void }}
 */
export function useWalletBets({ byChain, messaging }) {
    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const loadRequestId = useRef(0);

    const load = useCallback(async () => {
        const requestId = ++loadRequestId.current;
        if (!byChain) { setRows(null); return; }
        if (typeof messaging?.bets !== 'function') {
            setRows([]); return;
        }
        setRows(null);
        setError(null);
        try {
            const chains = byChain;
            const pairs = [];
            for (const [chainId, addrs] of Object.entries(chains)) {
                for (const a of addrs || []) pairs.push({ chainId, address: a.address });
            }
            const results = await Promise.all(pairs.map((p) => Promise.resolve()
                .then(() => messaging.bets({ chainId: p.chainId, query: p.address, type: 'address', opts: { limit: 100 } }))
                .then((r) => ({ p, bets: extractRows(r) }))
                .catch(() => ({ p, bets: [], failed: true }))));
            if (requestId !== loadRequestId.current) return;
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
    }, [byChain, messaging]);

    useEffect(() => {
        load();
        return () => { loadRequestId.current += 1; };
    }, [load]);

    return { rows, error, reload: load };
}

/**
 * The card chip for this wallet's live stake in one market, or null.
 * Rejected bets staked nothing, so they never count.
 */
export function yourBetText(bets, market) {
    if (!Array.isArray(bets) || bets.length === 0) return null;
    const mine = bets.filter((b) => b.bet_status !== 'invalid');
    if (mine.length === 0) return null;
    const outcomes = [...new Set(mine.map((b) => String(b.outcome)))];
    if (outcomes.length > 1) return `You bet on ${outcomes.length} outcomes`;
    const labels = outcomeLabelsOf(market);
    const label = safeOutcomeLabel(labels[Number(outcomes[0])]) || `outcome ${outcomes[0]}`;
    const tick = mine[0].tick || market?.tick || '';
    const total = addDecimals(mine.map((b) => b.amount));
    return `You bet ${formatDecimalAmount(total)} ${tick} on ${label}`.replace(/\s+/g, ' ');
}

function statusLabel(status) {
    if (status === 'open') return 'Pending resolution';
    if (status === 'won') return 'Won';
    if (status === 'lost') return 'Lost';
    if (status === 'refunded') return 'Refunded';
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
 * @param {object} props
 * @param {any[] | null} props.rows
 * @param {string | null} props.error
 * @param {() => void} props.onRetry
 * @param {any} props.messaging
 * @param {(chainId: string, feedIndex: string | number) => void} [props.onOpenMarket]
 */
export function BetMyBetsPanel({ rows, error, onRetry, messaging, onOpenMarket }) {
    const [labelsByMarket, setLabelsByMarket] = useState(/** @type {Record<string, string[]>} */ ({}));

    // Bet rows name their outcome by index only; one market read per distinct
    // market fills in its label, best-effort and capped as on My Bets.
    useEffect(() => {
        if (!rows || rows.length === 0) return undefined;
        if (typeof messaging?.betFeed !== 'function') return undefined;
        let cancelled = false;
        const wanted = [];
        const seen = new Set();
        let asked = Object.keys(labelsByMarket).length;
        for (const b of rows) {
            const idx = b.feed_action_index;
            if (idx === undefined || idx === null) continue;
            const key = `${b.chainId}:${idx}`;
            if (seen.has(key) || Object.hasOwn(labelsByMarket, key)) continue;
            if (asked >= MAX_MARKET_READS) break;
            seen.add(key);
            wanted.push({ key, chainId: b.chainId, feedIndex: idx });
            asked += 1;
        }
        if (wanted.length === 0) return undefined;
        Promise.all(wanted.map((w) => Promise.resolve()
            .then(() => messaging.betFeed({ chainId: w.chainId, feedIndex: w.feedIndex }))
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

    if (error && (!rows || rows.length === 0)) {
        return (
            <StatusMessage variant="error" recovery={{ label: 'Try Again', onAction: onRetry }}>
                {error}
            </StatusMessage>
        );
    }
    if (!rows) {
        return (
            <div role="status" aria-label="Loading bets">
                <Skeleton.List rows={5} />
            </div>
        );
    }
    if (rows.length === 0) {
        return <EmptyState title="No bets yet" body="Bets placed from this wallet appear here." />;
    }

    const openCount = rows.filter((r) => r.bet_status === 'open').length;
    const pendingRows = rows.filter((r) => r.bet_status === 'open');
    const pastRows = rows.filter((r) => r.bet_status !== 'open');

    const betRow = (b) => {
        const c = statusColor(b.bet_status);
        const clickable = onOpenMarket && b.feed_action_index !== undefined && b.feed_action_index !== null;
        const backed = outcomePhrase(labelsByMarket[`${b.chainId}:${b.feed_action_index}`], b.outcome);
        return (
            <ListRow
                key={`${b.chainId}:${b.action_index}`}
                onClick={clickable ? () => onOpenMarket(b.chainId, b.feed_action_index) : undefined}
                className={styles.listCard}
                style={{ marginTop: 0 }}
                title={`Market #${String(b.feed_action_index)}`}
                subtitle={(
                    <>
                        <span className={`${styles.hint} ${styles.betLongText}`} style={{ display: 'block' }}>
                            {b.bet_status === 'invalid'
                                ? <>Would have backed {backed} for {String(b.amount)} {b.tick || ''} · nothing was staked, but the fees were spent</>
                                : <>Backed {backed} · staked {String(b.amount)} {b.tick || ''}</>}
                        </span>
                        <span className={`${styles.hint} ${styles.betLongText}`} style={{ display: 'block' }}>from {b.owner}</span>
                        {b.bet_status !== 'open' && b.settled_block !== undefined && b.settled_block !== null ? (
                            <span className={styles.hint} style={{ display: 'block' }}>Settled in block {String(b.settled_block)}</span>
                        ) : null}
                    </>
                )}
                trailing={(
                    <span style={{ background: c.bg, color: c.fg, borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                        {statusLabel(b.bet_status)}
                    </span>
                )}
            />
        );
    };

    return (
        <>
            {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
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
        </>
    );
}
