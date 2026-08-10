// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { AddressText, Button, ChainBadge, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * PC-10 "My Lists" detail page: membership + lineage + a best-effort
 * "used by" panel for one LIST action.
 *
 * Membership and fork-lineage both come from a single read,
 * `messaging.getListByActionIndex` (`sdk.getAction(actionIndex)`):
 * the explorer's LIST detail row already carries `list` (the full
 * current membership snapshot for this exact action_index, not just
 * this edit's delta) and, for a v1 fork, `edits` (the delta this fork
 * applied, each item tagged valid/invalid) plus `list_action_index`
 * (the parent it forked from).
 *
 * "Used by": AIRDROP/DISPENSER/ORDER/ISSUE all reference a list by
 * ACTION_INDEX (`list_action_index`, `allow_list`, `block_list`), but
 * the explorer exposes no reverse-lookup query (its
 * `/airdrops|dispensers|orders|issues/{query}/{type}` routes only take
 * block/address/token/source/destination, never a list index; verified
 * against xchain-explorer/src/XChainExplorer.js at HEAD). Faking a
 * client-side scan across every consumer's full history isn't a
 * substitute for a real indexed reverse lookup and would be slow and
 * easy to get wrong, so this panel says plainly what it cannot show
 * rather than pretending to.
 *
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.actionIndex
 * @param {() => void} props.onBack
 * @param {(ref: { chainId: string, actionIndex: string, type: string, items: string[] }) => void} props.onFork
 */
export function ListDetail({ chainId, actionIndex, onBack, onFork }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [data, setData] = useState(/** @type {any | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        setData(null);
        setLoadError(null);
        messaging.getListByActionIndex({ chainId, actionIndex })
            .then((row) => { if (!cancelled) setData(row || null); })
            .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Failed to load list.'); });
        return () => { cancelled = true; };
    }, [chainId, actionIndex, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const isTick = data ? String(data.type) === '1' : false;
    const isFork = data ? (data.list_action_index != null && data.list_action_index !== '') : false;
    const items = useMemo(() => (Array.isArray(data?.list) ? data.list : []), [data]);
    const edits = useMemo(() => (Array.isArray(data?.edits) ? data.edits : []), [data]);

    const header = (
        <PageHeader onBack={onBack} title={isTick ? 'Token list' : 'Address list'} />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    }
    if (!data) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    return wrap(
        <>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Chain</dt>
                <dd className={styles.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}</dd>
                <dt className={styles.detailsLabel}>List index</dt>
                <dd className={styles.detailsValue}>#{actionIndex}</dd>
                <dt className={styles.detailsLabel}>Type</dt>
                <dd className={styles.detailsValue}>{isTick ? 'Token list' : 'Address list'}</dd>
                <dt className={styles.detailsLabel}>Created by</dt>
                <dd className={styles.detailsValue}>{data.source ? <AddressText address={data.source} /> : '?'}</dd>
                <dt className={styles.detailsLabel}>Status</dt>
                <dd className={styles.detailsValue}>{data.status === 'valid' ? 'Valid' : String(data.status || '?')}</dd>
                {data.block_index != null ? (
                    <>
                        <dt className={styles.detailsLabel}>Block</dt>
                        <dd className={styles.detailsValue}>{data.block_index}</dd>
                    </>
                ) : null}
                {isFork ? (
                    <>
                        <dt className={styles.detailsLabel}>Forked from</dt>
                        <dd className={styles.detailsValue}>
                            #{data.list_action_index} ({data.edit === '2' ? 'removed items' : 'added items'})
                        </dd>
                    </>
                ) : null}
            </dl>

            <h3 className={styles.successLabel}>Current members ({items.length})</h3>
            {items.length === 0 ? (
                <p className={styles.hint}>This list has no members.</p>
            ) : (
                <ul className={styles.detailsList} style={{ display: 'block' }}>
                    {items.map((item, i) => (
                        <li key={i} style={{ padding: '2px 0' }}>
                            {isTick ? <code>{item}</code> : <AddressText address={item} truncate={false} />}
                        </li>
                    ))}
                </ul>
            )}

            {isFork && edits.length > 0 ? (
                <>
                    <h3 className={styles.successLabel}>This fork's edit</h3>
                    <ul className={styles.detailsList} style={{ display: 'block' }}>
                        {edits.map((e, i) => (
                            <li key={i} style={{ padding: '2px 0' }}>
                                <code>{e.tick ?? e.address}</code>
                                {e.status && e.status !== 'valid' ? ` (${e.status})` : ''}
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}

            <h3 className={styles.successLabel}>Used by</h3>
            <p className={styles.hint}>
                The explorer has no reverse lookup from a list index to the
                airdrops, dispensers, gates, or orders that reference it today,
                so the wallet can't show what uses this list. If you know a
                specific airdrop, dispenser, gate, or order references it,
                check that item directly.
            </p>

            <div className={styles.actions}>
                <Button
                    variant="primary"
                    onClick={() => onFork({ chainId, actionIndex, type: String(data.type), items })}
                >
                    Fork &amp; edit
                </Button>
            </div>
        </>,
    );
}
