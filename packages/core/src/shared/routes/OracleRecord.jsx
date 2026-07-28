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
import { Screen, PageHeader } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

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
    if (status === 'closed') return 'Betting closed';
    if (status === 'resolved') return 'Settled';
    if (status === 'resolved_void') return 'Void, refunded';
    if (status === 'cancelled') return 'Cancelled, refunded';
    if (status === 'expired') return 'Expired, refunded';
    return status ? String(status) : 'Unknown';
}

function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
}

/**
 * One betting oracle's public track record, read before you trust them with a stake.
 *
 * This is the whole of the v0 reputation system and it is NOT a safety rating:
 * there is no bond, no stake and no slashing behind a betting market, and the
 * record is keyed to an ADDRESS, which anyone can replace for free. That is why
 * the caveat below is rendered as prominently as the numbers themselves rather
 * than tucked into a footnote: a clean sheet here means unknown, not safe.
 *
 * The number that actually matters to a bettor is `expired`. An oracle who lets a
 * market run out unresolved has not stolen anything (every stake is refunded), but
 * it has taken the bettors' money out of play for the whole refund window and
 * decided nothing, so it gets counted separately and called what it is.
 *
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.address
 * @param {(chainId: string, feedIndex: string | number) => void} [props.onOpenMarket]
 * @param {() => void} props.onBack
 */
export function OracleRecord({ chainId, address, onOpenMarket, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [record, setRecord] = useState(/** @type {any} */ (null));
    const [markets, setMarkets] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

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
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load the oracle record.'); });
        return () => { cancelled = true; };
    }, [chainId, address, messaging]);

    // Their markets load separately and are allowed to fail on their own: the
    // record is the point of the page, and a listing error must not blank it.
    useEffect(() => {
        let cancelled = false;
        setMarkets(null);
        if (typeof messaging.betFeeds !== 'function') { setMarkets([]); return undefined; }
        messaging.betFeeds({ chainId, query: address, type: 'source', opts: { limit: 50 } })
            .then((resp) => { if (!cancelled) setMarkets(extractRows(resp)); })
            .catch(() => { if (!cancelled) setMarkets([]); });
        return () => { cancelled = true; };
    }, [chainId, address, messaging]);

    const header = <PageHeader onBack={onBack} title="Oracle record" />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (error) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{error}</div>
            </>,
        );
    }
    if (!record) return wrap(<p>Loading record…</p>);

    const counts = record.counts || {};
    const settled = num(counts.resolved);
    const voided = num(counts.resolved_void);
    const cancelled = num(counts.cancelled);
    const expired = num(counts.expired);
    const total = num(record.total_feeds);
    const active = num(record.active_feeds);
    const fees = Array.isArray(record.fees_earned) ? record.fees_earned : [];

    const line = (label, value, hint) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
            <span>{label}{hint ? <span className={styles.hint}> {hint}</span> : null}</span>
            <strong>{value}</strong>
        </div>
    );

    return wrap(
        <>
            <p className={styles.hint} style={{ wordBreak: 'break-all' }}>{address}</p>

            <div className={styles.card}>
                {line('Markets opened', total)}
                {line('Still running', active)}
                {line('Settled with a result', settled)}
                {line('Settled with nobody on the winning side', voided, '(everyone refunded)')}
                {line('Cancelled by the oracle', cancelled, '(everyone refunded)')}
                {/* The failure mode a bettor most needs to see, so it is named
                    plainly and never averaged into a success rate. */}
                {line('Left to expire with no result', expired, '(everyone refunded)')}
            </div>

            <h4>Fees earned</h4>
            {fees.length === 0 ? (
                <p className={styles.hint}>This address has never been paid a fee for settling a market.</p>
            ) : (
                <div className={styles.card}>
                    {fees.map((f, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                            <span>{f.tick || 'unknown token'}</span>
                            <strong>{String(f.amount)}</strong>
                        </div>
                    ))}
                    <p className={styles.hint}>
                        Taken out of the pot when a market settles, at the fee the market was created
                        with. An oracle earns nothing from a market it cancels, voids, or lets expire.
                    </p>
                </div>
            )}

            {/* Required by the spec's trust model, not optional decoration. */}
            <div role="note" className={styles.card}>
                <strong>This record is not a guarantee.</strong>
                <p className={styles.hint}>
                    Nothing is staked behind a betting market. This history belongs to one address, and
                    anyone can start again from a new one, so an empty or short record means
                    <em> unknown</em>, not <em>safe</em>. If an oracle never publishes a result you get
                    your stake back once the refund window passes, but who wins is the oracle&apos;s
                    call and nobody can overrule it.
                </p>
            </div>

            <h4>Their markets</h4>
            {!markets ? <p className={styles.hint}>Loading markets…</p> : null}
            {markets && markets.length === 0 ? (
                <p className={styles.hint}>No markets from this address on this chain.</p>
            ) : null}
            {markets && markets.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {markets.map((m) => {
                        const body = (
                            <>
                                <div><strong>{m.label || '(untitled market)'}</strong></div>
                                <div className={styles.hint}>
                                    #{String(m.action_index)} · {m.tick || 'n/a'} · {statusLabel(m.feed_status)}
                                </div>
                            </>
                        );
                        return onOpenMarket ? (
                            <button
                                key={String(m.action_index)}
                                type="button"
                                onClick={() => onOpenMarket(chainId, m.action_index)}
                                className={styles.card}
                                style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
                            >
                                {body}
                            </button>
                        ) : (
                            <div key={String(m.action_index)} className={styles.card}>{body}</div>
                        );
                    })}
                </div>
            ) : null}

        </>,
    );
}
