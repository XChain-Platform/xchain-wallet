// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddressText, Button, ChainBadge, FeeSelector, Icon, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import dashStyles from './ActionsMenu.module.css';
import formStyles from './IssueTokenForm.module.css';

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
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    /** @typedef {{ loading: boolean, rows: any[], error: string | null }} Section */
    const empty = () => ({ loading: true, rows: [], error: null });
    const [stakes, setStakes] = useState(/** @type {Section} */ (empty()));
    const [delegations, setDelegations] = useState(/** @type {Section} */ (empty()));
    const [rewards, setRewards] = useState(/** @type {Section} */ (empty()));
    const [broadcasts, setBroadcasts] = useState(/** @type {Section} */ (empty()));
    const [validators, setValidators] = useState(/** @type {Section} */ (empty()));

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
        bind(setBroadcasts, messaging.getBroadcastsForAddress({ chainId, address }));
        bind(setValidators, messaging.getValidatorsForChain({ chainId }));
        return () => { cancelled = true; };
    }, [walletId, chainId, address, messaging]);

    const primaryStake = stakes.rows[0];
    const primaryDelegation = delegations.rows[0];
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
            const v = b?.version ?? b?.VERSION;
            return v === 2 || v === '2';
        });
        v2.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
        return v2[0] || null;
    }, [broadcasts.rows]);

    const { pending, lifetime } = useMemo(() => splitRewards(rewards.rows), [rewards.rows]);
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

    const allLoading = stakes.loading || delegations.loading || rewards.loading
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
                            <li>Amount: {formatAmount(primaryStake)} XCP</li>
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
                                    {d.status ? ` · ${d.status}` : ''}
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

                <Section title="Rewards trajectory" loading={rewards.loading} error={rewards.error}>
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
                                    v{String(b.version ?? b.VERSION ?? '?')}
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

                <PublisherMode
                    walletId={walletId}
                    chainId={chainId}
                    address={address}
                    feed={latestFeed}
                    messaging={messaging}
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

/**
 * Inline v3 BROADCAST quick-compose. Pre-fills BROADCAST_ACTION_INDEX
 * from the address's most recent v2 feed-create, leaving the user a
 * single VALUE input for rapid successive updates.
 *
 * Password (or HW signer status) persists across submits within the
 * dashboard session so a publisher can fire several values without
 * re-authenticating each time. The form clears the VALUE input after
 * each successful broadcast so the next one is one keystroke + Sign.
 *
 * @param {object} props
 */
function PublisherMode({ walletId, chainId, address, feed, messaging }) {
    const [open, setOpen] = useState(false);
    const [feedActionIndex, setFeedActionIndex] = useState('');
    const [value, setValue] = useState('');
    const [password, setPassword] = useState('');
    const [submitState, setSubmitState] = useState(/** @type {'idle' | 'submitting'} */ ('idle'));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [lastTxid, setLastTxid] = useState(/** @type {string | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        if (!feedActionIndex && feed) {
            const idx = feed.action_index || feed.ACTION_INDEX;
            if (idx) setFeedActionIndex(String(idx));
        }
    }, [feed, feedActionIndex]);

    // Address record needed for the from object. We don't have it here
    // (parent only passes the address string), so fetch it on demand.
    const [fromAddress, setFromAddress] = useState(null);
    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId).then((byChain) => {
            if (cancelled) return;
            const addrs = byChain?.[chainId] || [];
            const match = addrs.find((a) => a.address === address);
            if (match) setFromAddress(match);
        }).catch(() => { /* the dashboard already showed the chain; ignore */ });
        return () => { cancelled = true; };
    }, [walletId, chainId, address, messaging]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor
        ? ({ bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' }[descriptor.coin] || '')
        : '';
    const signerReady = useSignerReady(walletId);

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices each rapid-entry publish broadcast.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId, chainRegistry }),
        [chainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [chainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    async function handleSubmit(event) {
        event.preventDefault();
        if (submitState === 'submitting') return;
        if (!fromAddress) { setError('Source address not loaded yet.'); return; }
        if (!feedActionIndex.trim()) { setError('Feed reference number is required.'); return; }
        if (!value.trim()) { setError('Value is required.'); return; }
        if (!isHwSource && (!signerReady && password.length === 0)) { setError('Password is required.'); return; }
        if (isHwSource && hwStatus !== 'available') { setError('Hardware signer is not ready.'); return; }
        setSubmitState('submitting');
        setError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                params: {
                    VERSION: '3',
                    BROADCAST_ACTION_INDEX: String(feedActionIndex).trim(),
                    VALUE: String(value).trim(),
                },
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            const fn = isHwSource ? messaging.broadcastActionHw : messaging.broadcastAction;
            const args = isHwSource
                ? { ...base, signerId: fromAddress.signerId }
                : { ...base, password };
            const res = await fn(args);
            setLastTxid(res?.txid || res?.tx_hash || '(none)');
            setValue('');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setError(isBadPassword ? 'Incorrect password.' : err?.message || 'Publish failed.');
        } finally {
            setSubmitState('idle');
        }
    }

    return (
        <section style={{ margin: '0.75rem 0', paddingTop: '0.5rem', borderTop: '1px solid var(--border, #ddd)' }}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.25rem' }}>
                Publisher mode
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}
                >
                    {open ? 'Hide' : 'Show'}
                </button>
            </h3>
            {!open ? (
                <p className={dashStyles.entryDescription}>
                    Rapid-entry quick-compose for publishing feed values. Pre-fills your most recent feed reference number, so you can enter successive values without re-typing it.
                </p>
            ) : (
                <form onSubmit={handleSubmit} noValidate>
                    <Input
                        label="Feed reference number"
                        hint={feed
                            ? 'Pre-filled from the most recent feed you created. Override it to publish to a different feed.'
                            : 'No feed found for this address. Enter its reference number, or create a feed first.'}
                        value={feedActionIndex}
                        onChange={(e) => setFeedActionIndex(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                    />
                    <Input
                        label="Value"
                        hint="The feed value to publish. The previous value clears on success; the next value is one keystroke away."
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        autoComplete="off"
                    />
                    {fromAddress ? (
                        <SignCredentials
                        unlocked={signerReady}
                            fromAddress={fromAddress}
                            chainId={chainId}
                            password={password}
                            onPasswordChange={(v) => {
                                setPassword(v);
                                if (error) setError(null);
                            }}
                            onStatusChange={onHwStatusChange}
                            passwordRef={passwordRef}
                            submitError={null}
                            disabled={submitState === 'submitting'}
                            getSignerStatus={messaging.getSignerStatus}
                        />
                    ) : (
                        <p className={dashStyles.entryDescription}>Loading source address…</p>
                    )}
                    {feeTiers ? (
                        <FeeSelector
                            label="Network fee"
                            coinTicker={coinTicker}
                            tiers={feeTiers}
                            value={feePick}
                            onChange={setFeePick}
                            customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                        />
                    ) : null}
                    {error ? <StatusMessage variant="error" className={formStyles.error}>{error}</StatusMessage> : null}
                    {lastTxid ? (
                        <p className={dashStyles.entryDescription}>
                            Last published: txid {String(lastTxid).slice(0, 16)}…
                        </p>
                    ) : null}
                    <div className={formStyles.actions}>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={submitState === 'submitting'}
                            disabled={
                                !fromAddress
                                || !feedActionIndex.trim()
                                || !value.trim()
                                || (isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0))
                            }
                        >
                            {isHwSource ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}` : 'Publish value'}
                        </Button>
                    </div>
                </form>
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

function splitRewards(rows) {
    let pending = 0;
    let lifetime = 0;
    for (const r of rows) {
        const amt = Number(r.amount ?? r.AMOUNT ?? r.reward ?? 0);
        if (!Number.isFinite(amt)) continue;
        const status = String(r.status || '').toLowerCase();
        if (status === 'pending' || status === 'unclaimed') pending += amt;
        lifetime += amt;
    }
    return { pending, lifetime };
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
