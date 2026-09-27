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
import { AddressText, ChainBadge, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import {
    unclaimedRewards,
    effectiveStakingRows,
    latestEffectiveStakingRow,
    stakingRowState,
    sumStakingAmounts,
} from '../../flows/stakingDashboard.js';
import dashStyles from './ActionsMenu.module.css';
import { OperatorPublisherMode } from '../components/OperatorPublisherMode.jsx';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Operator / validator dashboard: §42.7.5 (Devi persona).
 *
 * Read-only consolidated view for stakers operating as oracles or
 * cross-chain validators. Shows publishing activity, validator
 * performance metrics (own row out of `getValidators`), staking
 * status, delegation chain, and rewards trajectory, plus an inline
 * "Publisher mode" quick-compose for rapid PRICE-oracle BROADCAST
 * value updates (v3 feed-result shape).
 *
 * Reachable from StakeDetail via the "Operator view" action,
 * which is rendered only when there's an active stake on the chain.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.address          source address (BTC) the operator controls
 * @param {() => void} props.onBack
 */
export function OperatorDashboard({ walletId, chainId, address, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    /** @typedef {{ loading: boolean, rows: any[], error: string | null }} Section */
    const empty = () => ({ loading: true, rows: [], error: null });
    const [stakes, setStakes] = useState(/** @type {Section} */ (empty()));
    const [delegations, setDelegations] = useState(/** @type {Section} */ (empty()));
    const [rewards, setRewards] = useState(/** @type {Section} */ (empty()));
    const [rewardClaims, setRewardClaims] = useState(/** @type {Section} */ (empty()));
    const [broadcasts, setBroadcasts] = useState(/** @type {Section} */ (empty()));
    const [validators, setValidators] = useState(/** @type {Section} */ (empty()));
    const [height, setHeight] = useState(/** @type {number | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        function bind(setter, p) {
            p.then((r) => {
                if (cancelled) return;
                setter({ loading: false, rows: extractRows(r), error: null });
            }).catch((err) => {
                if (cancelled) return;
                setter({ loading: false, rows: [], error: err?.message || String(err) });
            });
        }
        bind(setStakes, messaging.getStakesForAddress({ chainId, address }));
        bind(setDelegations, messaging.getDelegationsForAddress({ chainId, address }));
        bind(setRewards, messaging.getRewardsForAddress({ chainId, address }));
        bind(setRewardClaims, messaging.getRewardClaimsForAddress({ chainId, address }));
        bind(setBroadcasts, messaging.getBroadcastsForAddress({ chainId, address }));
        bind(setValidators, messaging.getValidatorsForChain({ chainId }));
        if (typeof messaging.getIndexerWatermark === 'function') {
            messaging.getIndexerWatermark({ chainId })
                .then((result) => {
                    if (!cancelled) setHeight(Number.isFinite(result?.watermark) ? result.watermark : null);
                })
                .catch(() => { if (!cancelled) setHeight(null); });
        }
        return () => { cancelled = true; };
    }, [walletId, chainId, address, messaging]);

    const activeStakes = useMemo(
        () => effectiveStakingRows(stakes.rows, height),
        [stakes.rows, height],
    );
    const primaryStake = latestEffectiveStakingRow(activeStakes, height);
    const primaryDelegation = latestEffectiveStakingRow(delegations.rows, height);
    const totalStake = useMemo(() => sumStakingAmounts(activeStakes), [activeStakes]);
    const activePubkey = primaryDelegation?.signing_pubkey || primaryDelegation?.SIGNING_PUBKEY;
    const ownValidator = useMemo(() => {
        if (!activePubkey) return null;
        const pk = String(activePubkey).toLowerCase();
        return validators.rows.find((v) => {
            const vk = String(v?.signing_pubkey || v?.SIGNING_PUBKEY || '').toLowerCase();
            return vk === pk;
        }) || null;
    }, [validators.rows, activePubkey]);

    // Detect the most recent v2 BROADCAST feed-create; its action_index
    // is what publisher-mode v3 results reference. Sort newest first.
    const latestFeed = useMemo(() => {
        const v2 = broadcasts.rows.filter((b) => {
            const v = b?.action_format ?? b?.ACTION_FORMAT;
            return (v === 2 || v === '2') && (b.status ?? b.STATUS) === 'valid';
        });
        v2.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
        return v2[0] || null;
    }, [broadcasts.rows]);

    const { pending, lifetime } = useMemo(
        () => splitRewards(rewards.rows, rewardClaims.rows),
        [rewards.rows, rewardClaims.rows],
    );
    const recentRewards = useMemo(
        () => [...rewards.rows].sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0)).slice(0, 10),
        [rewards.rows],
    );
    const recentBroadcasts = useMemo(
        () => [...broadcasts.rows].sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0)).slice(0, 10),
        [broadcasts.rows],
    );

    const descriptor = chainRegistry.get(chainId);

    const header = (
        <PageHeader onBack={onBack} backLabel="Back to staking" title="Operator dashboard" />
    );

    const allLoading = stakes.loading || delegations.loading || rewards.loading || rewardClaims.loading
        || broadcasts.loading || validators.loading;

    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? dashStyles.listFull : dashStyles.listPopup}>
                <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="md" /> : <span>{chainId}</span>}
                    <AddressText address={address} />
                </header>

                {allLoading ? (
                    <p className={dashStyles.entryDescription}>Loading operator metrics…</p>
                ) : null}

                <Section title="Staking status" loading={stakes.loading} error={stakes.error}>
                    {primaryStake ? (
                        <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                            <li>Amount: {totalStake ?? formatAmount(primaryStake)} XCP</li>
                            {primaryStake.activation_block || primaryStake.ACTIVATION_BLOCK ? (
                                <li>Activation block: {primaryStake.activation_block || primaryStake.ACTIVATION_BLOCK}</li>
                            ) : null}
                        </ul>
                    ) : (
                        <p className={dashStyles.entryDescription}>
                            No active stake on this address. Stake first to populate the operator dashboard.
                        </p>
                    )}
                </Section>

                <Section title="Delegation chain" loading={delegations.loading} error={delegations.error}>
                    {delegations.rows.length === 0 ? (
                        <p className={dashStyles.entryDescription}>No delegations issued.</p>
                    ) : (
                        <ul style={{ margin: 0, paddingLeft: '1rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {delegations.rows.slice(0, 10).map((d, i) => (
                                <li key={i}>
                                    {shortPubkey(d.signing_pubkey || d.SIGNING_PUBKEY)}
                                    {' '}@ block {d.block_index || '?'}
                                    {' '}· {stakingRowState(d, height)}
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>

                <Section title="Validator performance" loading={validators.loading} error={validators.error}>
                    {ownValidator ? (
                        <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                            {ownValidator.uptime !== undefined ? <li>Uptime: {String(ownValidator.uptime)}</li> : null}
                            {ownValidator.score !== undefined ? <li>Score: {String(ownValidator.score)}</li> : null}
                            {ownValidator.votes !== undefined ? <li>Votes: {String(ownValidator.votes)}</li> : null}
                            {ownValidator.missed !== undefined ? <li>Missed: {String(ownValidator.missed)}</li> : null}
                            {ownValidator.last_seen_block ? <li>Last seen: block {ownValidator.last_seen_block}</li> : null}
                        </ul>
                    ) : activePubkey ? (
                        <p className={dashStyles.entryDescription}>
                            Your delegated pubkey isn't yet appearing in the hub's validator roster.
                            Validators show up after the activation window completes.
                        </p>
                    ) : (
                        <p className={dashStyles.entryDescription}>
                            No delegated signing pubkey. Delegate one before the hub will track validator metrics.
                        </p>
                    )}
                </Section>

                <Section
                    title="Rewards trajectory"
                    loading={rewards.loading || rewardClaims.loading}
                    error={rewards.error || rewardClaims.error}
                >
                    <p className={dashStyles.entryDescription} style={{ margin: 0 }}>
                        <strong>Pending:</strong> {pending} XCP · <strong>Lifetime:</strong> {lifetime} XCP
                    </p>
                    {recentRewards.length > 0 ? (
                        <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1rem' }}>
                            {recentRewards.map((r, i) => (
                                <li key={i} className={dashStyles.entryDescription}>
                                    {formatRewardAmount(r)} XCP at block {r.block_index || '?'}
                                    {r.status ? ` · ${r.status}` : ''}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </Section>

                <Section title="Publishing activity" loading={broadcasts.loading} error={broadcasts.error}>
                    {recentBroadcasts.length === 0 ? (
                        <p className={dashStyles.entryDescription}>
                            No published feed values from this address yet. Use Publisher mode below to publish one.
                        </p>
                    ) : (
                        <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                            {recentBroadcasts.map((b, i) => (
                                <li key={i} className={dashStyles.entryDescription}>
                                    v{String(b.action_format ?? b.ACTION_FORMAT ?? '?')}
                                    {' · '}
                                    {b.message || b.MESSAGE
                                        ? <span title={String(b.message || b.MESSAGE)}>"{truncate(b.message || b.MESSAGE, 32)}"</span>
                                        : (b.broadcast_action_index || b.BROADCAST_ACTION_INDEX
                                            ? <>feed #{b.broadcast_action_index || b.BROADCAST_ACTION_INDEX}</>
                                            : '(none)')}
                                    {(b.value !== undefined && b.value !== null) ? <> · value: {String(b.value)}</> : null}
                                    {' · block '}{b.block_index || '?'}
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>

                <OperatorPublisherMode
                    walletId={walletId}
                    chainId={chainId}
                    address={address}
                    feed={latestFeed}
                    messaging={messaging}
                    variant={variant}
                />

                <div className={dashStyles.actions}>
                </div>
            </div>
        </Screen>
    );
}

/**
 * @param {{ title: string, loading: boolean, error: string | null, children: React.ReactNode }} props
 */
function Section({ title, loading, error, children }) {
    return (
        <section style={{ margin: '0.75rem 0', paddingTop: '0.5rem', borderTop: '1px solid var(--border, #ddd)' }}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.25rem' }}>{title}</h3>
            {loading ? (
                <p className={dashStyles.entryDescription}>Loading…</p>
            ) : error ? (
                <StatusMessage variant="error" className={dashStyles.entryDescription}>Couldn't load: {error}</StatusMessage>
            ) : (
                children
            )}
        </section>
    );
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

function formatAmount(stake) {
    return String(stake?.amount ?? stake?.AMOUNT ?? stake?.quantity ?? 'N/A');
}

export function splitRewards(rows, claims) {
    const totals = unclaimedRewards({ rewards: rows, claims });
    return { pending: totals.unclaimed, lifetime: totals.accrued };
}

function formatRewardAmount(row) {
    return row?.amount ?? row?.AMOUNT ?? row?.reward ?? 'N/A';
}

function shortPubkey(pk) {
    if (!pk || typeof pk !== 'string') return 'N/A';
    return pk.length > 16 ? `${pk.slice(0, 8)}…${pk.slice(-4)}` : pk;
}

function truncate(s, n) {
    const str = String(s || '');
    return str.length > n ? str.slice(0, n) + '…' : str;
}
