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
import { AddressText, Button, EmptyState, Icon, ListPage, PageHeader, Screen, SectionHeader, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    isDemoWallet,
    synthesizeDemoStaking,
    synthesizeDemoContractStakes,
    synthesizeDemoContractMeta,
} from '@xchain-wallet/core/flows';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import {
    compareDecimalStrings,
    formatWithThousands,
} from '../utils/amountFormat.js';
import {
    unclaimedRewards,
    effectiveStakingRows,
    latestEffectiveStakingRow,
    stakingRowState,
    isPendingContractUnstake,
    sumStakingAmounts,
} from '../../flows/stakingDashboard.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
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
 * @param {(position?: { tick?: string, signingPubkey?: string }) => void} [props.onUnstake]  contract kind gets the position's tick + signing pubkey (xchain-wallet#34)
 * @param {(position?: { tick?: string, signingPubkey?: string }) => void} [props.onDelegate]  contract kind gets the position's tick + signing pubkey (xchain-wallet#34)
 * @param {() => void} [props.onRevokeDelegation]
 * @param {() => void} [props.onClaimRewards]
 * @param {() => void} [props.onOpenOperatorDashboard]
 * @param {(position?: { tick?: string, signingPubkey?: string }) => void} [props.onStakeMore]     contract kind: add stake, gets the position's tick (xchain-wallet#34)
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

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    // Validator lane.
    const [stakes, setStakes] = useState(/** @type {any[]} */ ([]));
    const [delegations, setDelegations] = useState(/** @type {any[]} */ ([]));
    const [rewards, setRewards] = useState(/** @type {any[]} */ ([]));
    const [rewardClaims, setRewardClaims] = useState(/** @type {any[]} */ ([]));
    // Contract lane.
    const [contract, setContract] = useState(/** @type {any} */ (null));
    const [contractStakes, setContractStakes] = useState(/** @type {any[]} */ ([]));
    const [contractUnstakes, setContractUnstakes] = useState(/** @type {any[]} */ ([]));
    const [slashEvents, setSlashEvents] = useState(/** @type {any[]} */ ([]));
    const [height, setHeight] = useState(/** @type {number | null} */ (null));

    const [activeTab, setActiveTab] = useState(kind === 'validator' ? 'rewards' : 'positions');
    useEffect(() => {
        setActiveTab(kind === 'validator' ? 'rewards' : 'positions');
    }, [kind, chainId, address, contractActionIndex]);

    // Quick-action "More" popover.
    const [moreOpen, setMoreOpen] = useState(false);
    const moreWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => {
        if (!moreOpen) return undefined;
        const onDown = (e) => {
            if (moreWrapRef.current?.contains(e.target)) return;
            setMoreOpen(false);
        };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            setMoreOpen(false);
            moreWrapRef.current?.querySelector('button')?.focus();
        };
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
            setActiveTab(kind === 'validator' ? 'rewards' : 'positions');
            setMoreOpen(false);
            setStakes([]);
            setDelegations([]);
            setRewards([]);
            setRewardClaims([]);
            setContract(null);
            setContractStakes([]);
            setContractUnstakes([]);
            setSlashEvents([]);
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
                    const [s, d, r, c] = await Promise.all([
                        messaging.getStakesForAddress({ chainId, address }),
                        messaging.getDelegationsForAddress({ chainId, address }),
                        messaging.getRewardsForAddress({ chainId, address }),
                        // PC-47: the claim ledger. Without it "pending" cannot
                        // be computed at all (see splitRewards).
                        typeof messaging.getRewardClaimsForAddress === 'function'
                            ? messaging.getRewardClaimsForAddress({ chainId, address }).catch(() => null)
                            : Promise.resolve(null),
                    ]);
                    if (cancelled) return;
                    setStakes(extractRows(s));
                    setDelegations(extractRows(d));
                    setRewards(extractRows(r));
                    setRewardClaims(extractRows(c));
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
                    setLoadError(readFailureMessage(err, 'load this staking position'));
                    setLoading(false);
                }
            }
        }
        load();
        return () => { cancelled = true; };
    }, [walletId, kind, chainId, address, contractActionIndex, messaging]);

    useEffect(() => {
        let cancelled = false;
        setHeight(null);
        if (typeof messaging.getIndexerWatermark !== 'function') return undefined;
        messaging.getIndexerWatermark({ chainId })
            .then((result) => {
                if (!cancelled) setHeight(Number.isFinite(result?.watermark) ? result.watermark : null);
            })
            .catch(() => { if (!cancelled) setHeight(null); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    const descriptor = chainRegistry.get(chainId);
    const activeStakes = useMemo(() => effectiveStakingRows(stakes, height), [stakes, height]);
    const activeContractStakes = useMemo(
        () => effectiveStakingRows(contractStakes, height),
        [contractStakes, height],
    );
    const pendingContractUnstakes = useMemo(
        () => contractUnstakes.filter(isPendingContractUnstake),
        [contractUnstakes],
    );
    const primaryStake = latestEffectiveStakingRow(activeStakes, height);
    const primaryDelegation = latestEffectiveStakingRow(delegations, height);
    const delegatedKey = primaryDelegation?.signing_pubkey || primaryDelegation?.SIGNING_PUBKEY || '';
    const totalValidatorStaked = useMemo(
        () => sumStakingAmounts(activeStakes),
        [activeStakes],
    );
    const { pending, lifetime } = useMemo(
        () => splitRewards(rewards, rewardClaims),
        [rewards, rewardClaims],
    );
    const totalContractStaked = useMemo(
        () => sumStakingAmounts(activeContractStakes),
        [activeContractStakes],
    );
    const contractTick = activeContractStakes[0]?.tick || pendingContractUnstakes[0]?.tick || '';
    const inCooldown = pendingContractUnstakes.length > 0;
    const hasContractPosition = activeContractStakes.length > 0 || inCooldown;

    // Quick actions hand the position's token + signing pubkey to the caller
    // so a shell can seed ContractStakeForm from THIS position instead of
    // letting the form fall back to its own generic defaults (XCHAIN, blank
    // pubkey) - a position on a non-XCHAIN token otherwise lands the user on
    // a form that does not match what they clicked (xchain-wallet#34).
    const contractPositionSeed = kind === 'contract'
        ? { tick: contractTick, signingPubkey: activeContractStakes[0]?.signing_pubkey || '' }
        : null;

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
            <ListPage>{children}</ListPage>
        </Screen>
    );

    if (loading) return wrap(<StatusMessage variant="status">Loading staking position…</StatusMessage>);
    if (loadError) return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);

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
            <SectionHeader title="Position details" />
            {/* Hero: what's staked, where, how it's doing. */}
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Staked</dt>
                <dd className={styles.detailsValue}>
                    {kind === 'validator'
                        ? (primaryStake
                            ? `${fmt(totalValidatorStaked)} ${primaryStake.asset ?? 'XCHAIN'}`
                            : 'Nothing staked from this address')
                        : (hasContractPosition
                            ? `${compareDecimalStrings(totalContractStaked, '0') === 1 ? fmt(totalContractStaked) : '0'} ${contractTick || ''}`.trim()
                            : 'Nothing staked in this contract')}
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
                        <dd className={styles.detailsValue} style={ADDRESS_CELL_STYLE}>
                            {delegatedKey
                                ? <><code>{delegatedKey}</code>{primaryDelegation.block_index ? ` (since block ${fmt(primaryDelegation.block_index)})` : ''}</>
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
                        <span className={`${local.statusPill} ${inCooldown ? local.statusCooldown : hasContractPosition ? local.statusActive : ''}`}>
                            {inCooldown ? 'cooldown' : hasContractPosition ? 'active' : 'inactive'}
                        </span>
                    )}
                </dd>
            </dl>

            <SectionHeader title="Actions" />
            {/* Quick actions: squared 4-up grid, disabled without handlers. */}
            {kind === 'validator' ? (
                <div className={local.quickActions} role="group" aria-label="Stake actions">
                    <Button
                        variant="secondary"
                        block
                        icon={<span className={local.quickActionIcon}><Icon.DollarIcon /></span>}
                        onClick={onClaimRewards}
                        disabled={!onClaimRewards || compareDecimalStrings(pending, '0') !== 1}
                        title={compareDecimalStrings(pending, '0') === 1 ? 'Claim pending rewards' : 'No pending rewards'}
                    >
                        Claim
                    </Button>
                    <Button
                        variant="secondary"
                        block
                        icon={<span className={local.quickActionIcon}><Icon.UnlockIcon /></span>}
                        onClick={onUnstake}
                        disabled={!onUnstake || !primaryStake}
                        title="Unstake"
                    >
                        Unstake
                    </Button>
                    <Button
                        variant="secondary"
                        block
                        icon={<span className={local.quickActionIcon}><Icon.KeyIcon /></span>}
                        onClick={onDelegate}
                        disabled={!onDelegate || !primaryStake}
                        title="Delegate a new signing key"
                    >
                        Delegate
                    </Button>
                    <div className={local.quickActionMoreWrap} ref={moreWrapRef}>
                        <Button
                            variant="secondary"
                            block
                            icon={<span className={local.quickActionIcon}><Icon.MoreIcon /></span>}
                            aria-haspopup="menu"
                            aria-expanded={moreOpen}
                            onClick={() => setMoreOpen((o) => !o)}
                        >
                            More
                        </Button>
                        {moreOpen ? (
                            <div className={local.quickActionMoreMenu} role="menu">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    block
                                    icon={<Icon.UnlinkIcon />}
                                    role="menuitem"
                                    onClick={onRevokeDelegation ? () => { setMoreOpen(false); onRevokeDelegation(); } : undefined}
                                    disabled={!onRevokeDelegation || !primaryDelegation}
                                >
                                    Revoke delegation
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    block
                                    icon={<Icon.LineChartIcon />}
                                    role="menuitem"
                                    onClick={onOpenOperatorDashboard ? () => { setMoreOpen(false); onOpenOperatorDashboard(); } : undefined}
                                    disabled={!onOpenOperatorDashboard || !primaryStake}
                                >
                                    Operator view
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : (
                <div className={local.quickActions} role="group" aria-label="Stake actions">
                    <Button
                        variant="secondary"
                        block
                        icon={<span className={local.quickActionIcon}><Icon.PlusIcon /></span>}
                        onClick={() => onStakeMore?.(contractPositionSeed)}
                        disabled={!onStakeMore}
                        title="Stake more into this contract"
                    >
                        Add stake
                    </Button>
                    <Button
                        variant="secondary"
                        block
                        icon={<span className={local.quickActionIcon}><Icon.UnlockIcon /></span>}
                        onClick={() => onUnstake?.(contractPositionSeed)}
                        disabled={!onUnstake || activeContractStakes.length === 0}
                        title="Start unstaking (cooldown applies)"
                    >
                        Unstake
                    </Button>
                    <Button
                        variant="secondary"
                        block
                        icon={<span className={local.quickActionIcon}><Icon.KeyIcon /></span>}
                        onClick={() => onDelegate?.(contractPositionSeed)}
                        disabled={!onDelegate || activeContractStakes.length === 0}
                        title="Rotate the position's signing key"
                    >
                        Delegate
                    </Button>
                    <div className={local.quickActionMoreWrap} ref={moreWrapRef}>
                        <Button
                            variant="secondary"
                            block
                            icon={<span className={local.quickActionIcon}><Icon.MoreIcon /></span>}
                            aria-haspopup="menu"
                            aria-expanded={moreOpen}
                            onClick={() => setMoreOpen((o) => !o)}
                        >
                            More
                        </Button>
                        {moreOpen ? (
                            <div className={local.quickActionMoreMenu} role="menu">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    block
                                    icon={<Icon.ContractIcon />}
                                    role="menuitem"
                                    onClick={onOpenContract ? () => { setMoreOpen(false); onOpenContract(); } : undefined}
                                    disabled={!onOpenContract}
                                >
                                    View contract
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </div>
            )}

            <SectionHeader title="Position activity" />
            <div className={local.tabBar} role="tablist" aria-label="Stake detail view">
                {/* Native buttons carry tab semantics because the kit has no tab primitive. */}
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
                rewards.length === 0 ? (
                    <EmptyState title="No reward events yet" body="Reward events for this stake appear here." />
                ) : (
                    <ul className={local.eventList} aria-label="Reward events">
                        {rewards.slice(0, 25).map((r, i) => (
                        <li key={`${String(r.action_index ?? i)}:${i}`}>
                            <div className={local.eventRow}>
                                <span className={local.eventAmount}>
                                    {fmt(r.amount ?? r.reward)} XCHAIN
                                </span>
                                <span className={local.eventMeta}>{detailText(r.status)}</span>
                                <span className={local.eventWhen}>
                                    {r.block_index ? `block ${fmt(r.block_index)}` : '-'}
                                </span>
                            </div>
                        </li>
                        ))}
                    </ul>
                )
            ) : null}

            {activeTab === 'delegation' ? (
                delegations.length === 0 ? (
                    <EmptyState title="No delegated signing key" body="Signing-key delegations for this stake appear here." />
                ) : (
                    <ul className={local.eventList} aria-label="Signing-key delegations">
                        {delegations.slice(0, 25).map((d, i) => (
                        <li key={`${String(d.delegation_id ?? i)}:${i}`}>
                            <div className={local.eventRow}>
                                <span className={local.eventAmount}>
                                    <code>{d.signing_pubkey || d.SIGNING_PUBKEY || '(none)'}</code>
                                </span>
                                <span className={local.eventMeta}>{stakingRowState(d, height)}</span>
                                <span className={local.eventWhen}>
                                    {d.block_index ? `block ${fmt(d.block_index)}` : ''}
                                </span>
                            </div>
                        </li>
                        ))}
                    </ul>
                )
            ) : null}

            {activeTab === 'positions' ? (
                activeContractStakes.length === 0 && pendingContractUnstakes.length === 0 ? (
                    <EmptyState title="No contract positions" body="Staking positions for this contract appear here." />
                ) : (
                    <ul className={local.eventList} aria-label="Contract positions">
                            {activeContractStakes.map((s, i) => (
                                <li key={`s:${String(s.action_index ?? i)}:${i}`}>
                                    <div className={local.eventRow}>
                                        <span className={local.eventAmount}>{fmt(s.amount)} {detailText(s.tick)}</span>
                                        <span className={local.eventMeta}>
                                            key <code>{s.signing_pubkey || 'None'}</code>
                                        </span>
                                        <span className={local.eventWhen}>staked</span>
                                    </div>
                                </li>
                            ))}
                            {pendingContractUnstakes.map((u, i) => (
                                <li key={`u:${String(u.action_index ?? i)}:${i}`}>
                                    <div className={local.eventRow}>
                                        <span className={local.eventAmount}>{fmt(u.amount)} {detailText(u.tick)}</span>
                                        <span className={local.eventMeta}>
                                            releasing, slashable until block {fmt(u.cooldown_end_block)}
                                        </span>
                                        <span className={local.eventWhen}>cooldown</span>
                                    </div>
                                </li>
                            ))}
                    </ul>
                )
            ) : null}

            {activeTab === 'slashes' ? (
                slashEvents.length === 0 ? (
                    <EmptyState title="No slash events" body="Slash events against this position appear here." />
                ) : (
                    <ul className={local.eventList} aria-label="Slash events">
                        {slashEvents.slice(0, 25).map((ev, i) => (
                        <li key={`sl:${i}`}>
                            <div className={local.eventRow}>
                                <span className={local.slashAmount}>{ev.amount == null || ev.amount === '' ? '-' : `-${fmt(ev.amount)}`} {detailText(ev.tick)}</span>
                                <span className={local.eventMeta}>
                                    to <AddressText address={detailText(ev.destination_address || ev.destination)} truncate={false} />
                                </span>
                                <span className={local.eventWhen}>
                                    {ev.block_index ? `block ${fmt(ev.block_index)}` : '-'}
                                </span>
                            </div>
                        </li>
                        ))}
                    </ul>
                )
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
    if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return '-';
    if (/^(?:undefined|null|nan)$/i.test(String(value).trim())) return '-';
    return formatWithThousands(String(value));
}

function detailText(value) {
    if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return '-';
    const text = String(value).trim();
    return !text || /^(?:undefined|null|nan)$/i.test(text) ? '-' : text;
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

// PC-47: `pending` is accrued minus successfully-claimed, the same sum the
// indexer's getUnclaimedRewardTotal computes.
//
// It used to read a per-row `status` and count 'pending'/'unclaimed' rows.
// The validator_rewards projection has NO status column (it is a pure accrual
// ledger: id, source, signing_pubkey, reward_type, round_reference, amount,
// block_index, timestamp), so that test never matched and `pending` was always
// 0 - which left the Claim button permanently disabled for every real
// validator. The claim side lives in a separate table (reward_claims), and only
// claims the chain marked VALID subtract: a COLLECT the chain refused (an
// under-funded reward pool being the useful case) leaves a row behind but moved
// nothing, and the rewards stay claimable.
function splitRewards(rows, claimRows) {
    const totals = unclaimedRewards({ rewards: rows, claims: claimRows });
    return {
        pending: totals.unclaimed,
        lifetime: totals.accrued,
        hasRejectedClaim: totals.hasRejectedClaim,
    };
}
