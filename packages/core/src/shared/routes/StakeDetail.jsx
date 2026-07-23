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
import {
    Screen,
    PageHeader,
    AddressText,
    Icon,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    isDemoWallet,
    synthesizeDemoStaking,
    synthesizeDemoContractStakes,
    synthesizeDemoContractMeta,
} from '@xchain-wallet/core/flows';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import styles from './IssueTokenForm.module.css';
import local from './StakeDetail.module.css';

const chainRegistry = registryLib.defaultRegistry();

const ADDRESS_CELL_STYLE = { overflowWrap: 'anywhere' };

/**
 * Stake detail (§42.7.4 drill-in): one staking position, standard
 * detail layout. Hero stats card up top, squared quick-action grid,
 * then tabs.
 *
 * Two kinds, selected by `kind`:
 *   - 'validator': a capability (XCHAIN) stake owned by `address`.
 *     This is the validator view: Claim / Unstake / Delegate new key
 *     live here, with Revoke delegation and the Operator dashboard
 *     behind More. Tabs: Rewards / Delegation / Details.
 *   - 'contract': tokens `address` staked into contract
 *     `contractActionIndex`. Add stake / Unstake / Delegate key, with
 *     View contract behind More. Tabs: Positions / Slashes / Details.
 *
 * Every quick action renders disabled when its handler prop is absent
 * (house pattern: shells thread handlers as the flows exist).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {'validator' | 'contract'} props.kind
 * @param {string} props.chainId
 * @param {string} props.address
 * @param {string} [props.contractActionIndex]  contract kind only
 * @param {() => void} [props.onUnstake]
 * @param {() => void} [props.onDelegate]
 * @param {() => void} [props.onRevokeDelegation]
 * @param {() => void} [props.onClaimRewards]
 * @param {() => void} [props.onOpenOperatorDashboard]
 * @param {() => void} [props.onStakeMore]     contract kind: add stake
 * @param {() => void} [props.onOpenContract]  contract kind: open ContractDetail
 * @param {() => void} props.onBack
 */
export function StakeDetail({
    walletId,
    kind,
    chainId,
    address,
    contractActionIndex,
    onUnstake,
    onDelegate,
    onRevokeDelegation,
    onClaimRewards,
    onOpenOperatorDashboard,
    onStakeMore,
    onOpenContract,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    // Validator lane.
    const [stakes, setStakes] = useState(/** @type {any[]} */ ([]));
    const [delegations, setDelegations] = useState(/** @type {any[]} */ ([]));
    const [rewards, setRewards] = useState(/** @type {any[]} */ ([]));
    // Contract lane.
    const [contract, setContract] = useState(/** @type {any} */ (null));
    const [contractStakes, setContractStakes] = useState(/** @type {any[]} */ ([]));
    const [contractUnstakes, setContractUnstakes] = useState(/** @type {any[]} */ ([]));
    const [slashEvents, setSlashEvents] = useState(/** @type {any[]} */ ([]));

    const [activeTab, setActiveTab] = useState(kind === 'validator' ? 'rewards' : 'positions');

    // Quick-action "More" popover.
    const [moreOpen, setMoreOpen] = useState(false);
    const moreWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => {
        if (!moreOpen) return undefined;
        const onDown = (e) => {
            if (moreWrapRef.current?.contains(e.target)) return;
            setMoreOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [moreOpen]);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setLoadError(null);
            try {
                if (isDemoWallet(walletId)) {
                    if (kind === 'validator') {
                        const demo = synthesizeDemoStaking(chainId);
                        if (cancelled) return;
                        setStakes(demo.stakes);
                        setDelegations(demo.delegations);
                        setRewards(demo.rewards);
                    } else {
                        const demo = synthesizeDemoContractStakes(chainId);
                        const idx = String(contractActionIndex ?? '');
                        if (cancelled) return;
                        setContract(synthesizeDemoContractMeta(chainId, idx));
                        setContractStakes(demo.stakes.filter((s) => String(s.target_contract_index) === idx));
                        setContractUnstakes(demo.unstakes.filter((u) => String(u.target_contract_index) === idx));
                        setSlashEvents(demo.slashEvents.filter((e) => String(e.target_contract_index) === idx));
                    }
                    setLoading(false);
                    return;
                }

                if (kind === 'validator') {
                    const [s, d, r] = await Promise.all([
                        messaging.getStakesForAddress({ chainId, address }),
                        messaging.getDelegationsForAddress({ chainId, address }),
                        messaging.getRewardsForAddress({ chainId, address }),
                    ]);
                    if (cancelled) return;
                    setStakes(extractRows(s));
                    setDelegations(extractRows(d));
                    setRewards(extractRows(r));
                } else {
                    const idx = String(contractActionIndex ?? '');
                    // Contract metadata (cooldown, slash destination) is
                    // best-effort; the position still renders without it.
                    try {
                        const c = await messaging.getContractByActionIndex({ chainId, contractActionIndex: idx });
                        if (!cancelled) setContract(c?.data ?? c ?? null);
                    } catch { /* metadata optional */ }
                    // Position queries are a Phase 7 follow-up for live
                    // wallets; degrade each lane silently to empty.
                    const [s, u, ev] = await Promise.all([
                        messaging.getContractStakesForAddress({ chainId, address }).catch(() => []),
                        messaging.getContractUnstakesForAddress({ chainId, address }).catch(() => []),
                        messaging.getSlashEventsForAddress({ chainId, address }).catch(() => []),
                    ]);
                    if (cancelled) return;
                    setContractStakes(extractRows(s).filter((row) => String(row.target_contract_index) === idx));
                    setContractUnstakes(extractRows(u).filter((row) => String(row.target_contract_index) === idx));
                    setSlashEvents(extractRows(ev).filter((row) => String(row.target_contract_index) === idx));
                }
                setLoading(false);
            } catch (err) {
                if (!cancelled) {
                    setLoadError(err?.message || 'Failed to load staking position.');
                    setLoading(false);
                }
            }
        }
        load();
        return () => { cancelled = true; };
    }, [walletId, kind, chainId, address, contractActionIndex, messaging]);

    const descriptor = chainRegistry.get(chainId);
    const primaryStake = stakes[0];
    const primaryDelegation = delegations[0];
    const { pending, lifetime } = useMemo(() => splitRewards(rewards), [rewards]);
    const totalContractStaked = useMemo(() => {
        let sum = 0;
        for (const s of contractStakes) {
            const n = Number(s.amount ?? 0);
            if (Number.isFinite(n)) sum += n;
        }
        return sum;
    }, [contractStakes]);
    const contractTick = contractStakes[0]?.tick || contractUnstakes[0]?.tick || '';
    const inCooldown = contractUnstakes.length > 0;

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to staking"
            titleIcon={<Icon.StakeIcon />}
            title={kind === 'validator' ? 'Validator stake' : `Contract #${contractActionIndex} stake`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loading) return wrap(<p className={styles.hint}>Loading…</p>);
    if (loadError) return wrap(<div role="alert" className={styles.error}>{loadError}</div>);

    const tabs = kind === 'validator'
        ? [
            { id: 'rewards', label: 'Rewards' },
            { id: 'delegation', label: 'Delegation' },
            { id: 'details', label: 'Details' },
        ]
        : [
            { id: 'positions', label: 'Positions' },
            { id: 'slashes', label: 'Slashes' },
            { id: 'details', label: 'Details' },
        ];

    return wrap(
        <>
            {/* Hero: what's staked, where, how it's doing. */}
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Staked</dt>
                <dd className={styles.detailsValue}>
                    {kind === 'validator'
                        ? (primaryStake
                            ? `${fmt(primaryStake.amount ?? primaryStake.quantity)} ${primaryStake.asset ?? 'XCHAIN'}`
                            : 'Nothing staked from this address')
                        : `${totalContractStaked ? fmt(totalContractStaked) : '?'} ${contractTick || ''}`.trim()}
                </dd>
                {kind === 'validator' && (primaryStake?.capability_label || primaryStake?.capability) ? (
                    <>
                        <dt className={styles.detailsLabel}>Role</dt>
                        <dd className={styles.detailsValue}>
                            {primaryStake.capability_label || primaryStake.capability}
                        </dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Network</dt>
                <dd className={styles.detailsValue}>{descriptor?.displayName || chainId}</dd>
                <dt className={styles.detailsLabel}>Address</dt>
                <dd className={styles.detailsValue} style={ADDRESS_CELL_STYLE}>
                    <AddressText address={address} truncate={false} />
                </dd>
                {kind === 'validator' ? (
                    <>
                        <dt className={styles.detailsLabel}>Delegated key</dt>
                        <dd className={styles.detailsValue}>
                            {primaryDelegation
                                ? `${shortPubkey(primaryDelegation.signing_pubkey || primaryDelegation.SIGNING_PUBKEY)}${primaryDelegation.block_index ? ` (since block ${fmt(primaryDelegation.block_index)})` : ''}`
                                : 'None'}
                        </dd>
                        <dt className={styles.detailsLabel}>Pending rewards</dt>
                        <dd className={styles.detailsValue}>{fmt(pending)} XCHAIN</dd>
                        <dt className={styles.detailsLabel}>Lifetime rewards</dt>
                        <dd className={styles.detailsValue}>{fmt(lifetime)} XCHAIN</dd>
                    </>
                ) : (
                    <>
                        {contract?.cooldown_blocks != null ? (
                            <>
                                <dt className={styles.detailsLabel}>Cooldown</dt>
                                <dd className={styles.detailsValue}>
                                    {fmt(contract.cooldown_blocks)} blocks after unstaking
                                </dd>
                            </>
                        ) : null}
                        {contract?.slash_destination ? (
                            <>
                                <dt className={styles.detailsLabel}>Slash destination</dt>
                                <dd className={styles.detailsValue} style={ADDRESS_CELL_STYLE}>
                                    <AddressText address={String(contract.slash_destination)} truncate={false} />
                                </dd>
                            </>
                        ) : null}
                    </>
                )}
                <dt className={styles.detailsLabel}>Status</dt>
                <dd className={styles.detailsValue}>
                    {kind === 'validator' ? (
                        <span className={`${local.statusPill} ${primaryStake ? local.statusActive : ''}`}>
                            {primaryStake ? (primaryStake.status || 'active') : 'inactive'}
                        </span>
                    ) : (
                        <span className={`${local.statusPill} ${inCooldown ? local.statusCooldown : local.statusActive}`}>
                            {inCooldown ? 'cooldown' : 'active'}
                        </span>
                    )}
                </dd>
            </dl>

            {/* Quick actions: squared 4-up grid, disabled without handlers. */}
            {kind === 'validator' ? (
                <div className={local.quickActions} role="group" aria-label="Stake actions">
                    <button
                        type="button"
                        className={local.quickAction}
                        onClick={onClaimRewards}
                        disabled={!onClaimRewards || pending <= 0}
                        title={pending > 0 ? 'Claim pending rewards' : 'No pending rewards'}
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.DollarIcon /></span>
                        <span>Claim</span>
                    </button>
                    <button
                        type="button"
                        className={local.quickAction}
                        onClick={onUnstake}
                        disabled={!onUnstake || !primaryStake}
                        title="Unstake"
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.UnlockIcon /></span>
                        <span>Unstake</span>
                    </button>
                    <button
                        type="button"
                        className={local.quickAction}
                        onClick={onDelegate}
                        disabled={!onDelegate || !primaryStake}
                        title="Delegate a new signing key"
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.KeyIcon /></span>
                        <span>Delegate</span>
                    </button>
                    <div className={local.quickActionMoreWrap} ref={moreWrapRef}>
                        <button
                            type="button"
                            className={local.quickAction}
                            aria-haspopup="menu"
                            aria-expanded={moreOpen}
                            onClick={() => setMoreOpen((o) => !o)}
                        >
                            <span className={local.quickActionIcon} aria-hidden="true"><Icon.MoreIcon /></span>
                            <span>More</span>
                        </button>
                        {moreOpen ? (
                            <div className={local.quickActionMoreMenu} role="menu">
                                <button
                                    type="button"
                                    role="menuitem"
                                    className={local.quickActionMoreItem}
                                    onClick={onRevokeDelegation ? () => { setMoreOpen(false); onRevokeDelegation(); } : undefined}
                                    disabled={!onRevokeDelegation || !primaryDelegation}
                                >
                                    <span aria-hidden="true"><Icon.UnlinkIcon /></span>
                                    <span>Revoke delegation</span>
                                </button>
                                <button
                                    type="button"
                                    role="menuitem"
                                    className={local.quickActionMoreItem}
                                    onClick={onOpenOperatorDashboard ? () => { setMoreOpen(false); onOpenOperatorDashboard(); } : undefined}
                                    disabled={!onOpenOperatorDashboard || !primaryStake}
                                >
                                    <span aria-hidden="true"><Icon.LineChartIcon /></span>
                                    <span>Operator view</span>
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : (
                <div className={local.quickActions} role="group" aria-label="Stake actions">
                    <button
                        type="button"
                        className={local.quickAction}
                        onClick={onStakeMore}
                        disabled={!onStakeMore}
                        title="Stake more into this contract"
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.PlusIcon /></span>
                        <span>Add stake</span>
                    </button>
                    <button
                        type="button"
                        className={local.quickAction}
                        onClick={onUnstake}
                        disabled={!onUnstake || contractStakes.length === 0}
                        title="Start unstaking (cooldown applies)"
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.UnlockIcon /></span>
                        <span>Unstake</span>
                    </button>
                    <button
                        type="button"
                        className={local.quickAction}
                        onClick={onDelegate}
                        disabled={!onDelegate || contractStakes.length === 0}
                        title="Rotate the position's signing key"
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.KeyIcon /></span>
                        <span>Delegate</span>
                    </button>
                    <div className={local.quickActionMoreWrap} ref={moreWrapRef}>
                        <button
                            type="button"
                            className={local.quickAction}
                            aria-haspopup="menu"
                            aria-expanded={moreOpen}
                            onClick={() => setMoreOpen((o) => !o)}
                        >
                            <span className={local.quickActionIcon} aria-hidden="true"><Icon.MoreIcon /></span>
                            <span>More</span>
                        </button>
                        {moreOpen ? (
                            <div className={local.quickActionMoreMenu} role="menu">
                                <button
                                    type="button"
                                    role="menuitem"
                                    className={local.quickActionMoreItem}
                                    onClick={onOpenContract ? () => { setMoreOpen(false); onOpenContract(); } : undefined}
                                    disabled={!onOpenContract}
                                >
                                    <span aria-hidden="true"><Icon.ContractIcon /></span>
                                    <span>View contract</span>
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            )}

            <div className={local.tabBar} role="tablist" aria-label="Stake detail view">
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === t.id ? 'true' : 'false'}
                        className={`${local.tab} ${activeTab === t.id ? local.tabActive : ''}`}
                        onClick={() => setActiveTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {activeTab === 'rewards' ? (
                <ul className={local.eventList}>
                    {rewards.length === 0 ? (
                        <li><div className={local.eventEmpty}>No reward events yet.</div></li>
                    ) : rewards.slice(0, 25).map((r, i) => (
                        <li key={`${String(r.action_index ?? i)}:${i}`}>
                            <div className={local.eventRow}>
                                <span className={local.eventAmount}>
                                    {fmt(r.amount ?? r.reward ?? '0')} XCHAIN
                                </span>
                                <span className={local.eventMeta}>{r.status || ''}</span>
                                <span className={local.eventWhen}>
                                    {r.block_index ? `block ${fmt(r.block_index)}` : ''}
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : null}

            {activeTab === 'delegation' ? (
                <ul className={local.eventList}>
                    {delegations.length === 0 ? (
                        <li><div className={local.eventEmpty}>No signing key delegated. Use Delegate to add one.</div></li>
                    ) : delegations.slice(0, 25).map((d, i) => (
                        <li key={`${String(d.delegation_id ?? i)}:${i}`}>
                            <div className={local.eventRow}>
                                <span className={local.eventAmount}>
                                    {shortPubkey(d.signing_pubkey || d.SIGNING_PUBKEY)}
                                </span>
                                <span className={local.eventMeta}>{d.status || ''}</span>
                                <span className={local.eventWhen}>
                                    {d.block_index ? `block ${fmt(d.block_index)}` : ''}
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : null}

            {activeTab === 'positions' ? (
                <ul className={local.eventList}>
                    {contractStakes.length === 0 && contractUnstakes.length === 0 ? (
                        <li><div className={local.eventEmpty}>No positions found for this contract.</div></li>
                    ) : (
                        <>
                            {contractStakes.map((s, i) => (
                                <li key={`s:${String(s.action_index ?? i)}:${i}`}>
                                    <div className={local.eventRow}>
                                        <span className={local.eventAmount}>{fmt(s.amount)} {s.tick}</span>
                                        <span className={local.eventMeta}>
                                            key {shortPubkey(s.signing_pubkey)}
                                        </span>
                                        <span className={local.eventWhen}>staked</span>
                                    </div>
                                </li>
                            ))}
                            {contractUnstakes.map((u, i) => (
                                <li key={`u:${String(u.action_index ?? i)}:${i}`}>
                                    <div className={local.eventRow}>
                                        <span className={local.eventAmount}>{fmt(u.amount)} {u.tick}</span>
                                        <span className={local.eventMeta}>
                                            releasing, slashable until block {fmt(u.cooldown_end_block ?? '?')}
                                        </span>
                                        <span className={local.eventWhen}>cooldown</span>
                                    </div>
                                </li>
                            ))}
                        </>
                    )}
                </ul>
            ) : null}

            {activeTab === 'slashes' ? (
                <ul className={local.eventList}>
                    {slashEvents.length === 0 ? (
                        <li><div className={local.eventEmpty}>No slash events against this position.</div></li>
                    ) : slashEvents.slice(0, 25).map((ev, i) => (
                        <li key={`sl:${i}`}>
                            <div className={local.eventRow}>
                                <span className={local.slashAmount}>-{fmt(ev.amount)} {ev.tick}</span>
                                <span className={local.eventMeta}>
                                    to {String(ev.destination_address || ev.destination || '?')}
                                </span>
                                <span className={local.eventWhen}>
                                    {ev.block_index ? `block ${fmt(ev.block_index)}` : ''}
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : null}

            {activeTab === 'details' ? (
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Network</dt>
                    <dd className={styles.detailsValue}>{descriptor?.displayName || chainId}</dd>
                    <dt className={styles.detailsLabel}>Address</dt>
                    <dd className={styles.detailsValue} style={ADDRESS_CELL_STYLE}>
                        <AddressText address={address} truncate={false} />
                    </dd>
                    {kind === 'validator' ? (
                        <>
                            {primaryStake?.block_index ? (
                                <>
                                    <dt className={styles.detailsLabel}>Staked at block</dt>
                                    <dd className={styles.detailsValue}>{fmt(primaryStake.block_index)}</dd>
                                </>
                            ) : null}
                            {stakes.length > 1 ? (
                                <>
                                    <dt className={styles.detailsLabel}>Stake entries</dt>
                                    <dd className={styles.detailsValue}>{stakes.length}</dd>
                                </>
                            ) : null}
                        </>
                    ) : (
                        <>
                            <dt className={styles.detailsLabel}>Contract</dt>
                            <dd className={styles.detailsValue}>#{contractActionIndex}</dd>
                            {contract?.tick ? (
                                <>
                                    <dt className={styles.detailsLabel}>Contract token</dt>
                                    <dd className={styles.detailsValue}>{contract.tick}</dd>
                                </>
                            ) : null}
                        </>
                    )}
                </dl>
            ) : null}
        </>,
    );
}

// Comma-grouped display number; non-numeric input passes through
// unchanged (formatWithThousands only groups plain digit strings).
function fmt(value) {
    if (value == null || value === '') return '?';
    return formatWithThousands(String(value));
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
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

function shortPubkey(pk) {
    if (!pk || typeof pk !== 'string') return '(none)';
    return pk.length > 16 ? `${pk.slice(0, 8)}…${pk.slice(-4)}` : pk;
}
