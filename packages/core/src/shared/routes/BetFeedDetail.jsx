// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { Screen, PageHeader, Button } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

function unwrap(resp) {
    if (!resp) return null;
    if (Array.isArray(resp)) return resp[0] || null;
    if (Array.isArray(resp.data)) return resp.data[0] || null;
    if (resp.data && typeof resp.data === 'object') return resp.data;
    return resp;
}

function statusLabel(status) {
    if (status === 'open') return 'Taking bets';
    if (status === 'closed') return 'Betting closed, waiting on the result';
    if (status === 'resolved') return 'Settled';
    if (status === 'resolved_void') return 'Void, everyone refunded';
    if (status === 'cancelled') return 'Cancelled, everyone refunded';
    if (status === 'expired') return 'Expired unresolved, everyone refunded';
    return status ? String(status) : 'Unknown';
}

function fmtTime(unix) {
    if (unix === null || unix === undefined) return 'n/a';
    const n = Number(unix);
    if (!Number.isFinite(n)) return 'n/a';
    return new Date(n * 1000).toLocaleString();
}

/**
 * One betting market: its terms, the current pool split, and its status history.
 *
 * The pool figures come from the explorer's open-bets-only sum, which is the same
 * predicate settlement uses, so the split shown here is the split the payout math
 * will actually work from. It is still NOT a locked-in price: this is a
 * parimutuel market, so every later bet moves everyone's share.
 *
 * @param {object} props
 * @param {string} props.chainId
 * @param {string | number} props.feedIndex
 * @param {(chainId: string, address: string) => void} [props.onOpenOracle]
 * @param {() => void} props.onBack
 */
export function BetFeedDetail({ chainId, feedIndex, onOpenOracle, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [feed, setFeed] = useState(/** @type {any} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        setFeed(null);
        setError(null);
        messaging.betFeed({ chainId, feedIndex })
            .then((resp) => { if (!cancelled) setFeed(unwrap(resp)); })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load the market.'); });
        return () => { cancelled = true; };
    }, [chainId, feedIndex, messaging]);

    const header = <PageHeader onBack={onBack} title="Market" />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (error) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{error}</div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (!feed) return wrap(<p>Loading market…</p>);

    const outcomes = Array.isArray(feed.outcome_labels)
        ? feed.outcome_labels
        : (typeof feed.outcomes === 'string' ? feed.outcomes.split(',') : []);
    const pools = Array.isArray(feed.pools) ? feed.pools : [];
    const byOutcome = {};
    for (const p of pools) byOutcome[Number(p.outcome)] = p;
    const total = pools.reduce((a, p) => a + Number(p.pool || 0), 0);
    const timeline = Array.isArray(feed.timeline) ? feed.timeline : [];

    return wrap(
        <>
            <h3 style={{ marginBottom: '0.25rem' }}>{feed.label || '(untitled market)'}</h3>
            <p className={styles.hint}>
                #{String(feed.action_index)} · {feed.tick || 'n/a'} · {statusLabel(feed.feed_status)}
            </p>

            <div className={styles.card}>
                <div><strong>Betting closes</strong>: {fmtTime(feed.deadline)}</div>
                <div><strong>Refunds if unresolved by</strong>: {fmtTime(feed.expire_at)}</div>
                <div><strong>Oracle fee</strong>: {feed.fee ?? '0'}% of the pot</div>
                {feed.min_amount ? <div><strong>Minimum bet</strong>: {String(feed.min_amount)}</div> : null}
                {feed.source ? (
                    <div>
                        <strong>Run by</strong>:{' '}
                        {onOpenOracle
                            ? <a href="#" onClick={(e) => { e.preventDefault(); onOpenOracle(chainId, feed.source); }}>{feed.source}</a>
                            : feed.source}
                    </div>
                ) : null}
                {(feed.allow_list || feed.block_list) ? (
                    <div className={styles.hint}>
                        This market is restricted to a list of addresses. If you are blocked, your bet is
                        rejected and nothing is taken from your balance.
                    </div>
                ) : null}
            </div>

            <h4>Current split</h4>
            {outcomes.length === 0 ? <p className={styles.hint}>No outcomes recorded.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {outcomes.map((label, i) => {
                        const p = byOutcome[i] || { pool: 0, bet_count: 0 };
                        const share = total > 0 ? ((Number(p.pool || 0) / total) * 100).toFixed(1) + '%' : 'no bets yet';
                        return (
                            <div key={i} className={styles.card} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                                <span>{i}: {label}</span>
                                <span>{String(p.pool || 0)} ({share}, {String(p.bet_count || 0)} bets)</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* The three things that actually surprise people, stated plainly. */}
            <p className={styles.hint}>
                This is a parimutuel market: everyone backing the winning outcome shares the whole pot,
                so the split above is only how things stand right now and every later bet changes it.
                Bets are final once placed, and payouts round down, so a very small stake can win and
                still pay nothing.
            </p>

            <h4>History</h4>
            {timeline.length === 0 ? <p className={styles.hint}>No history yet.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {timeline.map((t, i) => (
                        <div key={i} className={styles.hint}>
                            {statusLabel(t.status)} · block {String(t.block_index ?? 'n/a')}
                            {/* The close is recorded by the chain rather than caused by anyone's
                                transaction, so it is labelled instead of shown as an action. */}
                            {t.synthetic ? ' (automatic, when the deadline passed)' : ''}
                        </div>
                    ))}
                </div>
            )}

            <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
        </>,
    );
}
