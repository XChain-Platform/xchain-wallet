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
import { AddressText, Button, ChainBadge, EmptyState, ListPage, PageHeader, Screen, SectionHeader, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { isDemoWallet, synthesizeDemoStaking } from '@xchain-wallet/core/flows';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import {
    unclaimedRewards,
    effectiveStakingRows,
    latestEffectiveStakingRow,
    stakingRowState,
    sumStakingAmounts,
} from '../../flows/stakingDashboard.js';
import { latestFeedCreateForAddress } from '../../flows/broadcastQueries.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import dashStyles from './ActionsMenu.module.css';
import styles from './OperatorDashboard.module.css';
import { OperatorPublisherMode } from '../components/OperatorPublisherMode.jsx';
import { neutralizeControlText } from '../utils/textHardening.js';
import { andList } from '../components/pageLoadFailures.jsx';

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
    const scopeKey = JSON.stringify([walletId, chainId, address]);
    return (
        <OperatorDashboardView
            key={scopeKey}
            walletId={walletId}
            chainId={chainId}
            address={address}
            onBack={onBack}
        />
    );
}

function OperatorDashboardView({ walletId, chainId, address, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    /** @typedef {{ loading: boolean, rows: any[], error: string | null }} Section */
    const empty = () => ({ loading: true, rows: [], error: null });
    const [stakes, setStakes] = useState(/** @type {Section} */ (empty()));
    const [delegations, setDelegations] = useState(/** @type {Section} */ (empty()));
    const [rewards, setRewards] = useState(/** @type {Section} */ (empty()));
    const [rewardClaims, setRewardClaims] = useState(/** @type {Section} */ (empty()));
    const [broadcasts, setBroadcasts] = useState(/** @type {Section} */ (empty()));
    const [validators, setValidators] = useState(/** @type {Section} */ (empty()));
    const [height, setHeight] = useState(/** @type {number | null} */ (null));
    const [latestFeed, setLatestFeed] = useState({ loading: true, value: null, error: null });
    const [refreshing, setRefreshing] = useState(false);
    const refreshRef = useRef(/** @type {() => void} */ (() => {}));
    const reloadRef = useRef(/** @type {() => void} */ (() => {}));

    useEffect(() => {
        let cancelled = false;
        let inFlight = false;

        function bind(setter, request, background) {
            return Promise.resolve().then(request).then((r) => {
                if (cancelled) return;
                setter({ loading: false, rows: extractRows(r), error: null });
            }).catch((err) => {
                if (cancelled) return;
                setter((current) => ({
                    loading: false,
                    rows: background ? current.rows : [],
                    error: userFacingMessage(err, 'Please try again.'),
                }));
            });
        }

        async function load(background) {
            if (inFlight) return;
            inFlight = true;
            if (background) {
                setRefreshing(true);
            } else {
                setStakes(empty());
                setDelegations(empty());
                setRewards(empty());
                setRewardClaims(empty());
                setBroadcasts(empty());
                setValidators(empty());
                setHeight(null);
                setLatestFeed({ loading: true, value: null, error: null });
            }

            const tasks = [];
            if (isDemoWallet(walletId)) {
                // The demo story is one set of rows: the stake detail shows the same
                // delegation and rewards, so this page does too.
                const demo = synthesizeDemoStaking(chainId);
                setStakes({ loading: false, rows: demo.stakes, error: null });
                setDelegations({ loading: false, rows: demo.delegations, error: null });
                setRewards({ loading: false, rows: demo.rewards, error: null });
                setRewardClaims({ loading: false, rows: [], error: null });
            } else {
                tasks.push(bind(setStakes, () => messaging.getStakesForAddress({ chainId, address }), background));
                tasks.push(bind(setDelegations, () => messaging.getDelegationsForAddress({ chainId, address }), background));
                tasks.push(bind(setRewards, () => messaging.getRewardsForAddress({ chainId, address }), background));
                tasks.push(bind(setRewardClaims, () => messaging.getRewardClaimsForAddress({ chainId, address }), background));
            }
            tasks.push(bind(setBroadcasts, () => messaging.getBroadcastsForAddress({ chainId, address }), background));
            tasks.push(bind(setValidators, () => messaging.getValidatorsForChain({ chainId }), background));
            if (typeof messaging.getIndexerWatermark === 'function') {
                tasks.push(Promise.resolve().then(() => messaging.getIndexerWatermark({ chainId }))
                    .then((result) => {
                        if (!cancelled) setHeight(Number.isFinite(result?.watermark) ? result.watermark : null);
                    })
                    .catch(() => { if (!cancelled && !background) setHeight(null); }));
            }
            tasks.push(latestFeedCreateForAddress({ messaging, chainId, address })
                .then((feed) => {
                    if (!cancelled) setLatestFeed({ loading: false, value: feed, error: null });
                })
                .catch((err) => {
                    if (cancelled) return;
                    setLatestFeed((current) => ({
                        loading: false,
                        value: background ? current.value : null,
                        error: userFacingMessage(err, "Couldn't load the latest feed. Try again."),
                    }));
                }));
            await Promise.allSettled(tasks);
            inFlight = false;
            if (!cancelled) setRefreshing(false);
        }

        refreshRef.current = () => { load(true); };
        reloadRef.current = () => { load(false); };
        load(false);
        const timer = setInterval(() => load(true), 30_000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
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

    // One page error names every section that could not load; one Try again reloads them all.
    const failedSections = [
        ['staking status', stakes],
        ['delegation chain', delegations],
        ['validator performance', validators],
        ['rewards trajectory', rewards.error ? rewards : rewardClaims],
        ['publishing activity', broadcasts],
    ].filter(([, section]) => !section.loading && section.error).map(([title]) => title);

    const allLoading = stakes.loading || delegations.loading || rewards.loading || rewardClaims.loading
        || broadcasts.loading || validators.loading;

    return (
        <Screen variant={variant} header={header}>
            <ListPage className={styles.dashboard} toolbar={(
                <Button type="button" variant="ghost" disabled={refreshing} onClick={() => refreshRef.current()}>
                    {refreshing ? 'Refreshing metrics…' : 'Refresh metrics'}
                </Button>
            )}>
                {failedSections.length > 0 ? (
                    <StatusMessage
                        variant="error"
                        recovery={{ label: 'Try again', onAction: () => reloadRef.current() }}
                    >
                        {`Couldn't load ${andList(failedSections)}.`}
                    </StatusMessage>
                ) : null}
                <header className={styles.identity}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="md" showName={false} /> : null}
                    <AddressText address={address} />
                </header>

                {allLoading ? (
                    <p className={dashStyles.entryDescription}>Loading operator metrics…</p>
                ) : null}

                <Section title="Staking status" loading={stakes.loading} error={stakes.error} showContentOnError={!!primaryStake}>
                    {primaryStake ? (
                        <ul className={styles.metricList}>
                            <li>Total amount staked: {totalStake ?? formatAmount(primaryStake)} XCHAIN</li>
                            {primaryStake.activation_block || primaryStake.ACTIVATION_BLOCK ? (
                                <li>Activation block: {metricText(primaryStake.activation_block || primaryStake.ACTIVATION_BLOCK)}</li>
                            ) : null}
                        </ul>
                    ) : (
                        <EmptyState
                            title="No active stake"
                            body="Operator metrics appear after this address has an active stake."
                            titleAs="h3"
                        />
                    )}
                </Section>

                <Section title="Delegation chain" loading={delegations.loading} error={delegations.error} showContentOnError={delegations.rows.length > 0}>
                    {delegations.rows.length === 0 ? (
                        <EmptyState title="No delegations yet" body="Signing-key delegations appear here." titleAs="h3" />
                    ) : (
                        <ul className={`${styles.metricList} ${styles.keyList}`}>
                            {delegations.rows.slice(0, 10).map((d, i) => (
                                <li key={i}>
                                    Signing key: {shortPubkey(d.signing_pubkey || d.SIGNING_PUBKEY)};
                                    {' '}recorded at block {metricText(d.block_index)};
                                    {' '}status: {plainWords(stakingRowState(d, height))}
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>

                <Section title="Validator performance" loading={validators.loading} error={validators.error} showContentOnError={!!ownValidator}>
                    {ownValidator ? (
                        <ul className={styles.metricList}>
                            {ownValidator.uptime !== undefined ? <li>Uptime: {metricText(ownValidator.uptime, 'unavailable')}</li> : null}
                            {ownValidator.score !== undefined ? <li>Validator score: {metricText(ownValidator.score, 'unavailable')}</li> : null}
                            {ownValidator.votes !== undefined ? <li>Votes recorded: {metricText(ownValidator.votes, 'unavailable')}</li> : null}
                            {ownValidator.missed !== undefined ? <li>Missed validations: {metricText(ownValidator.missed, 'unavailable')}</li> : null}
                            {ownValidator.last_seen_block ? <li>Last seen at block: {metricText(ownValidator.last_seen_block, 'unavailable')}</li> : null}
                        </ul>
                    ) : activePubkey ? (
                        <EmptyState
                            title="Validator not active yet"
                            body="Validators show up after the activation window completes."
                            titleAs="h3"
                        />
                    ) : (
                        <EmptyState
                            title="No delegated signing key"
                            body="Validator metrics appear after a signing key is delegated."
                            titleAs="h3"
                        />
                    )}
                </Section>

                <Section
                    title="Rewards trajectory"
                    loading={rewards.loading || rewardClaims.loading}
                    error={rewards.error || rewardClaims.error}
                    showContentOnError={rewards.rows.length > 0 || rewardClaims.rows.length > 0}
                >
                    <p className={dashStyles.entryDescription} style={{ margin: 0 }}>
                        <strong>Unclaimed rewards:</strong> {rewardClaims.error ? 'unavailable' : `${pending} XCHAIN`}; <strong>Total rewards earned:</strong> {lifetime} XCHAIN
                    </p>
                    {recentRewards.length > 0 ? (
                        <ul className={styles.metricList}>
                            {recentRewards.map((r, i) => (
                                <li key={i} className={dashStyles.entryDescription}>
                                    Reward amount: {formatRewardAmount(r)} XCHAIN; earned at block {metricText(r.block_index)}
                                    {r.status ? `; status: ${plainWords(r.status)}` : ''}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </Section>

                <Section title="Publishing activity" loading={broadcasts.loading} error={broadcasts.error} showContentOnError={recentBroadcasts.length > 0}>
                    {recentBroadcasts.length === 0 ? (
                        <EmptyState
                            title="No published feed values"
                            body="Feed values published from this address appear here."
                            titleAs="h3"
                        />
                    ) : (
                        <ul className={styles.metricList}>
                            {recentBroadcasts.map((b, i) => (
                                <li key={i} className={`${dashStyles.entryDescription} ${styles.activityItem}`}>
                                    Format version: {String(b.action_format ?? b.ACTION_FORMAT ?? 'unknown')};
                                    {' '}
                                    {b.message || b.MESSAGE
                                        ? <span title={String(b.message || b.MESSAGE)}>Message: "{truncate(b.message || b.MESSAGE, 32)}"</span>
                                        : (b.broadcast_action_index || b.BROADCAST_ACTION_INDEX
                                            ? <>Feed reference number: {metricText(b.broadcast_action_index || b.BROADCAST_ACTION_INDEX)}</>
                                            : 'Message or feed reference: none')}
                                    {(b.value !== undefined && b.value !== null) ? <>; published value: {metricText(b.value, 'unavailable')}</> : null}
                                    {'; published at block: '}{metricText(b.block_index)}
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>

                <OperatorPublisherMode
                    walletId={walletId}
                    chainId={chainId}
                    address={address}
                    feed={latestFeed.value}
                    feedLoading={latestFeed.loading}
                    feedError={latestFeed.error}
                    messaging={messaging}
                    variant={variant}
                />

            </ListPage>
        </Screen>
    );
}

/**
 * @param {{ title: string, loading: boolean, error: string | null, showContentOnError?: boolean, children: React.ReactNode }} props
 */
function Section({ title, loading, error, showContentOnError = false, children }) {
    return (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)', paddingTop: 'var(--xc-space-2)', borderTop: '1px solid var(--xc-border)' }}>
            <SectionHeader title={title} />
            {loading ? (
                <p className={dashStyles.entryDescription}>Loading…</p>
            ) : (
                <>
                    {/* The page names the failure once; a section with nothing to show says so plainly. */}
                    {error && !showContentOnError ? <p className={dashStyles.entryDescription}>Not loaded.</p> : null}
                    {!error || showContentOnError ? children : null}
                </>
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
    return metricText(stake?.amount ?? stake?.AMOUNT ?? stake?.quantity, 'N/A');
}

export function splitRewards(rows, claims) {
    const totals = unclaimedRewards({ rewards: rows, claims });
    return { pending: totals.unclaimed, lifetime: totals.accrued };
}

function formatRewardAmount(row) {
    return metricText(row?.amount ?? row?.AMOUNT ?? row?.reward, 'N/A');
}

function metricText(value, fallback = 'unknown') {
    const type = typeof value;
    if (value === null || value === undefined
        || !['string', 'number', 'bigint', 'boolean'].includes(type)
        || (type === 'number' && !Number.isFinite(value))) return fallback;
    return neutralizeControlText(value, { maxLength: 128 }) || fallback;
}

function shortPubkey(pk) {
    if (!pk || typeof pk !== 'string') return 'N/A';
    return pk.length > 16 ? `${pk.slice(0, 8)}…${pk.slice(-4)}` : pk;
}

function truncate(s, n) {
    const str = String(s || '');
    return str.length > n ? str.slice(0, n) + '…' : str;
}

function plainWords(value) {
    const words = String(value || 'unknown').trim().replace(/[_-]+/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}
