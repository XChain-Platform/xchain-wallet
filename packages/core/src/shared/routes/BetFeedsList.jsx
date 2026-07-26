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
import {
    Screen,
    PageHeader,
    Button,
    NetworkField,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Chains whose descriptor advertises BET. Derived the same way governance
// derives its own list, so a chain gaining or losing the action needs no edit here.
export const BET_CHAIN_IDS = chainRegistry
    .supportedChains()
    .filter((d) => Array.isArray(d.supportedActions) && d.supportedActions.includes('BET'))
    .map((d) => d.id);

// Feed lifecycle -> pill colour. The wallet shows the STORED status, never a
// status recomputed from the clock, so what a user sees is what the chain thinks.
function statusColor(status) {
    if (status === 'resolved') return { bg: '#1b5e20', fg: '#fff' };
    if (status === 'cancelled' || status === 'expired') return { bg: '#8e1c1c', fg: '#fff' };
    if (status === 'resolved_void') return { bg: '#4a4a4a', fg: '#fff' };
    if (status === 'closed') return { bg: '#8a6d00', fg: '#fff' };
    return { bg: '#0d47a1', fg: '#fff' };
}

// Plain-language labels: users are not reading protocol enums (wallet audience rule).
function statusLabel(status) {
    if (status === 'open') return 'Taking bets';
    if (status === 'closed') return 'Betting closed';
    if (status === 'resolved') return 'Settled';
    if (status === 'resolved_void') return 'Void, refunded';
    if (status === 'cancelled') return 'Cancelled, refunded';
    if (status === 'expired') return 'Expired, refunded';
    if (!status) return 'Unknown';
    const words = String(status).trim().toLowerCase().replace(/[_-]+/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function StatusPill({ status }) {
    const c = statusColor(status);
    return (
        <span style={{ background: c.bg, color: c.fg, borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
            {statusLabel(status)}
        </span>
    );
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

/**
 * Betting market browser. Resolves the wallet's BET-capable chains, lists that
 * chain's markets (newest first), and is the entry point into a market's detail
 * page. Read-only itself (calls messaging.betFeeds, an explorer read).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(chainId: string, feedIndex: string | number) => void} props.onOpenMarket
 * @param {(chainId: string) => void} [props.onCreate]
 * @param {() => void} props.onBack
 */
export function BetFeedsList({ walletId, onOpenMarket, onCreate, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [noChain, setNoChain] = useState(false);
    const [betChains, setBetChains] = useState(/** @type {string[]} */ ([]));
    const [openOnly, setOpenOnly] = useState(true);
    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const avail = BET_CHAIN_IDS.filter((cid) => Array.isArray(byChain?.[cid]) && byChain[cid].length > 0);
                setBetChains(avail);
                if (avail.length > 0) setChainId(avail[0]);
                else setNoChain(true);
            })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load addresses.'); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!chainId) return;
        let cancelled = false;
        setRows(null);
        setError(null);
        // Filter on the stored feed status rather than fetching everything and
        // deciding client-side, so paging stays meaningful on a busy chain.
        const req = openOnly
            ? { chainId, query: 'open', type: 'status', opts: { limit: 50 } }
            : { chainId, opts: { limit: 50 } };
        messaging.betFeeds(req)
            .then((resp) => { if (!cancelled) setRows(extractRows(resp)); })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load markets.'); });
        return () => { cancelled = true; };
    }, [chainId, openOnly, messaging]);

    const header = <PageHeader onBack={onBack} title="Betting" />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (noChain) {
        return wrap(
            <>
                <p className={styles.hint}>No address on a chain that supports betting. Use Receive to generate one first.</p>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (!chainId && !error) return wrap(<p>Loading…</p>);

    return wrap(
        <>
            <NetworkField value={chainId} onChange={setChainId} chainIds={betChains.length ? betChains : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />

            <div className={styles.actions} style={{ gap: '0.5rem' }}>
                <Button variant={openOnly ? 'primary' : 'ghost'} onClick={() => setOpenOnly(true)}>Taking bets</Button>
                <Button variant={openOnly ? 'ghost' : 'primary'} onClick={() => setOpenOnly(false)}>All markets</Button>
                {onCreate ? <Button variant="ghost" onClick={() => onCreate(chainId)}>Create market</Button> : null}
            </div>

            {error ? <div role="alert" className={styles.error}>{error}</div> : null}
            {chainId && !rows && !error ? <p>Loading markets…</p> : null}
            {rows && rows.length === 0 ? (
                <p className={styles.hint}>
                    {openOnly ? 'No markets are taking bets on this chain right now.' : 'No markets on this chain yet.'}
                </p>
            ) : null}

            {rows && rows.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {rows.map((m) => {
                        const id = m.action_index;
                        // The market LABEL is on-chain text written by whoever created the
                        // market. React escapes it on render; it is never injected as markup.
                        const label = m.label || '(untitled market)';
                        const outcomes = typeof m.outcomes === 'string' ? m.outcomes.split(',') : [];
                        return (
                            <button
                                key={String(id)}
                                type="button"
                                onClick={() => onOpenMarket(chainId, id)}
                                className={styles.card}
                                style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                                    <strong>#{String(id)} · {m.tick || 'n/a'}</strong>
                                    <StatusPill status={m.feed_status} />
                                </div>
                                <div className={styles.hint}>{String(label).slice(0, 100)}</div>
                                {outcomes.length ? (
                                    <div className={styles.hint}>{outcomes.slice(0, 4).join(' / ')}{outcomes.length > 4 ? ' …' : ''}</div>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </>,
    );
}
