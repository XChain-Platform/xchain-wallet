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
import { Button, NetworkField, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useGovernanceChainIds } from '../hooks/useGovernanceAddressesPresent.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Poll lifecycle -> pill colour. open = live (amber), finalized = decided (green),
// failed_quorum = did not pass (red). No shared Badge component, so use a plain span.
function statusColor(status) {
    if (status === 'finalized') return { bg: '#1b5e20', fg: '#fff' };
    if (status === 'failed_quorum') return { bg: '#8e1c1c', fg: '#fff' };
    return { bg: '#8a6d00', fg: '#fff' };
}
// Poll lifecycle code -> plain-language pill label. Mirrors statusColor:
// open = live, finalized = decided, failed_quorum = did not pass. Unknown
// codes degrade to a Title Case humanization rather than a raw token.
function statusLabel(status) {
    if (status === 'finalized') return 'Decided';
    if (status === 'failed_quorum') return 'Did not pass';
    if (status === 'open' || !status) return 'Open';
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
 * @param {() => void} props.onBack
 */
export function GovernancePolls({ walletId, onOpenPoll, onCreate, onDelegate, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const governanceChainIds = useGovernanceChainIds();

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [noChain, setNoChain] = useState(false);
    const [governChains, setGovernChains] = useState(/** @type {string[]} */ ([]));
    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    // Resolve which governance-capable chains the wallet can act on; the
    // first (registry order) seeds the Network field, which lets the user
    // retarget across the rest.
    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const avail = governanceChainIds.filter((cid) => Array.isArray(byChain?.[cid]) && byChain[cid].length > 0);
                setGovernChains(avail);
                if (avail.length > 0) setChainId(avail[0]);
                else setNoChain(true);
            })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load addresses.'); });
        return () => { cancelled = true; };
    }, [walletId, messaging, governanceChainIds]);

    useEffect(() => {
        if (!chainId) return;
        let cancelled = false;
        setRows(null);
        setError(null);
        messaging.governancePolls({ chainId, opts: { limit: 50 } })
            .then((resp) => { if (!cancelled) setRows(extractRows(resp)); })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load polls.'); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    const header = <PageHeader onBack={onBack} title="Governance" />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (noChain) {
        return wrap(
            <>
                <p className={styles.hint}>No address on a governance-capable chain. Use Receive to generate one first.</p>
            </>,
        );
    }
    if (!chainId && !error) return wrap(<p>Loading…</p>);

    return wrap(
        <>
            <NetworkField value={chainId} onChange={setChainId} chainIds={governChains.length ? governChains : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />

            <div className={styles.actions} style={{ gap: '0.5rem' }}>
                <Button variant="primary" onClick={() => onCreate(chainId)}>Create poll</Button>
                <Button variant="ghost" onClick={() => onDelegate(chainId)}>Delegate votes</Button>
            </div>

            {error ? <StatusMessage variant="error" className={styles.error}>{error}</StatusMessage> : null}
            {chainId && !rows && !error ? <p>Loading polls…</p> : null}
            {rows && rows.length === 0 ? (
                <p className={styles.hint}>No polls on this chain yet. Create the first one.</p>
            ) : null}

            {rows && rows.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {rows.map((p) => {
                        const id = p.action_index;
                        const label = p.question || (Array.isArray(p.options) ? p.options.join(' / ') : String(p.options || ''));
                        return (
                            <button
                                key={String(id)}
                                type="button"
                                onClick={() => onOpenPoll(chainId, id)}
                                className={styles.card}
                                style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                                    <strong>#{String(id)} · {p.tick || 'n/a'}</strong>
                                    <StatusPill status={p.poll_status} />
                                </div>
                                {label ? <div className={styles.hint}>{String(label).slice(0, 100)}</div> : null}
                                <div className={styles.hint}>Closes at block {String(p.end_block ?? 'n/a')}</div>
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </>,
    );
}
