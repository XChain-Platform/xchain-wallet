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
import { Button, Icon, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    isDemoWallet,
    synthesizeDemoStaking,
    synthesizeDemoContractStakes,
} from '@xchain-wallet/core/flows';
import * as branding from '../../branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { coinFromChainId, tickerColor } from '../components/BalanceList.jsx';
import { formatWithThousands } from '../utils/amountFormat.js';
import { unclaimedRewards, cooldownStatus, cooldownText } from '../../flows/stakingDashboard.js';
import styles from './ActionsMenu.module.css';
import local from './StakingList.module.css';

const chainRegistry = registryLib.defaultRegistry();

// The two staking lanes have different chain reach, so this
// list scans them separately rather than scoping the whole page to one
// coin.
//
//   - CONTRACT stakes (STAKE v3 / UNSTAKE v1 / DELEGATE v1) run on
//     every chain: the indexer dispatches those versions to their own
//     handlers before the `COIN !== 'BTC'` gate, and DEPLOY carries no
//     gate at all, so contracts and positions in them exist on
//     LTC/DOGE.
//   - VALIDATOR (capability) stakes, their delegations, and the
//     rewards/claims that COLLECT pays out stay Bitcoin-only. Those
//     versions do hit the coin gate, and COLLECT has no contract
//     variant at all.
//
// Asking a non-Bitcoin explorer for validator positions would be a
// guaranteed-empty round trip per address, so the fan-out below skips
// that lane off Bitcoin instead of relying on it to return nothing.
const VALIDATOR_COIN = 'bitcoin';

/**
 * Staking root (§42.7.4, redesigned): a unified list of the wallet's
 * staking positions across chains, following the My-dispensers list
 * pattern. Two kinds of row:
 *   - validator (capability) stakes: XCHAIN staked from one of the
 *     wallet's addresses, with delegated-pubkey / reward state behind
 *     the drill-in detail page;
 *   - contract stakes: tokens staked into a contract, including
 *     positions still releasing (cooldown) after an unstake.
 *
 * Toolbar offers free-text search (token, amount, contract, address,
 * pubkey, capability) plus the standard network filter. The header's
 * "+" opens the new-stake flow. Clicking a row opens StakeDetail via
 * `onOpenStake` with a ref describing the position.
 *
 * Contract-stake explorer/SDK queries are a Phase 7 follow-up and
 * still throw for live wallets; that lane degrades silently to empty
 * (same behavior the old ContractStakedPositions view had) so the
 * validator lane always renders.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.activeAccountId]  scope the address union to this account
 * @param {(ref: { kind: 'validator'|'contract', chainId: string, address: string, contractActionIndex?: string }) => void} props.onOpenStake
 * @param {() => void} [props.onNewStake]   opens the new-stake chooser ("+")
 * @param {() => void} props.onBack
 */
export function StakingList({ walletId, activeAccountId, onOpenStake, onNewStake, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    // Chains whose protocol accepts the contract-staking lane, i.e. every
    // chain the registry advertises STAKE on (put STAKE into the
    // shared set), and the Bitcoin subset that also has the validator lane.
    const stakingChainIds = useMemo(
        () => chainRegistry.supportedChains()
            .filter((d) => Array.isArray(d.supportedActions) && d.supportedActions.includes('STAKE'))
            .map((d) => d.id),
        [],
    );
    const validatorChainIds = useMemo(
        () => new Set(chainRegistry.byCoin(VALIDATOR_COIN).map((d) => d.id)),
        [],
    );

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [addressesError, setAddressesError] = useState(
        /** @type {string | null} */ (null),
    );

    /** @typedef {{ loading: boolean, rows: any[], rewards: any[], error: string | null }} ChainState */
    const [stateByChain, setStateByChain] = useState(
        /** @type {Record<string, ChainState>} */ ({}),
    );

    // In-page filters: free-text search + network dropdown, mirroring
    // the dispensers / contacts toolbars.
    const [query, setQuery] = useState('');
    const [network, setNetwork] = useState('all');

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId, activeAccountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
            })
            .catch((err) => {
                if (!cancelled) setAddressesError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, activeAccountId]);

    const chainsWithAddresses = useMemo(() => {
        if (!addressesByChain) return [];
        return stakingChainIds.filter((cid) =>
            Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0,
        );
    }, [stakingChainIds, addressesByChain]);

    // Per active chain, fan out per-address position queries and merge
    // into unified rows. The validator lane (stakes/delegations/rewards)
    // works today; the contract lane is best-effort per call.
    useEffect(() => {
        if (chainsWithAddresses.length === 0) {
            setStateByChain({});
            return;
        }

        // Demo wallets skip the live explorer fan-out and render
        // synthesized validator + contract positions.
        if (isDemoWallet(walletId)) {
            const demoState = {};
            for (const cid of chainsWithAddresses) {
                const owner = (addressesByChain?.[cid] || [])[0]?.address || '';
                const { stakes, delegations, rewards } = synthesizeDemoStaking(cid);
                const contract = synthesizeDemoContractStakes(cid);
                demoState[cid] = {
                    loading: false,
                    rows: buildRows({
                        chainId: cid,
                        stakes: stakes.map((s) => ({ ...s, _ownerAddress: owner })),
                        delegations,
                        rewards,
                        contractStakes: contract.stakes.map((s) => ({ ...s, _ownerAddress: owner })),
                        contractUnstakes: contract.unstakes.map((u) => ({ ...u, _ownerAddress: owner })),
                    }),
                    rewards,
                    error: null,
                };
            }
            setStateByChain(demoState);
            return;
        }

        const initial = {};
        for (const cid of chainsWithAddresses) {
            initial[cid] = { loading: true, rows: [], rewards: [], rewardClaims: [], error: null };
        }
        setStateByChain(initial);

        let cancelled = false;
        for (const cid of chainsWithAddresses) {
            const addrs = (addressesByChain?.[cid] || []).map((a) => a.address);
            const perAddress = addrs.map(async (addr) => {
                const out = {
                    addr,
                    stakes: [],
                    delegations: [],
                    rewards: [],
                    rewardClaims: [],
                    contractStakes: [],
                    contractUnstakes: [],
                    errors: /** @type {string[]} */ ([]),
                };
                // Validator lane: real errors surface (non-blocking banner).
                // Skipped entirely off Bitcoin, where the capability
                // versions are coin-gated and these reads can only ever come
                // back empty.
                const isValidatorChain = validatorChainIds.has(cid);
                await Promise.all([
                    ...(isValidatorChain ? [
                        messaging.getStakesForAddress({ chainId: cid, address: addr })
                            .then((r) => { out.stakes = extractRows(r).map((row) => ({ ...row, _ownerAddress: addr })); })
                            .catch((e) => { out.errors.push(e?.message || String(e)); }),
                        messaging.getDelegationsForAddress({ chainId: cid, address: addr })
                            .then((r) => { out.delegations = extractRows(r); })
                            .catch((e) => { out.errors.push(e?.message || String(e)); }),
                        messaging.getRewardsForAddress({ chainId: cid, address: addr })
                            .then((r) => { out.rewards = extractRows(r); })
                            .catch((e) => { out.errors.push(e?.message || String(e)); }),
                        // PC-47: the claim side of the unclaimed sum. Best-effort:
                        // a build without the route degrades to "nothing claimed
                        // yet", which OVERSTATES what is claimable, so the header
                        // labels the figure as accrued-minus-claimed rather than
                        // promising it will all pay out.
                        (typeof messaging.getRewardClaimsForAddress === 'function'
                            ? messaging.getRewardClaimsForAddress({ chainId: cid, address: addr })
                            : Promise.resolve(null))
                            .then((r) => { out.rewardClaims = extractRows(r); })
                            .catch(() => {}),
                    ] : []),
                    // Contract lane: runs on EVERY staking chain.
                    // Endpoints are a Phase 7 follow-up and throw for live
                    // wallets; degrade silently to empty.
                    messaging.getContractStakesForAddress({ chainId: cid, address: addr })
                        .then((r) => { out.contractStakes = extractRows(r).map((row) => ({ ...row, _ownerAddress: addr })); })
                        .catch(() => {}),
                    messaging.getContractUnstakesForAddress({ chainId: cid, address: addr })
                        .then((r) => { out.contractUnstakes = extractRows(r).map((row) => ({ ...row, _ownerAddress: addr })); })
                        .catch(() => {}),
                ]);
                return out;
            });
            Promise.all(perAddress).then((results) => {
                if (cancelled) return;
                const merged = {
                    stakes: [], delegations: [], rewards: [], rewardClaims: [],
                    contractStakes: [], contractUnstakes: [],
                };
                const errs = [];
                for (const r of results) {
                    merged.stakes.push(...r.stakes);
                    merged.delegations.push(...r.delegations);
                    merged.rewards.push(...r.rewards);
                    merged.rewardClaims.push(...r.rewardClaims);
                    merged.contractStakes.push(...r.contractStakes);
                    merged.contractUnstakes.push(...r.contractUnstakes);
                    errs.push(...r.errors);
                }
                setStateByChain((prev) => ({
                    ...prev,
                    [cid]: {
                        loading: false,
                        rows: buildRows({ chainId: cid, ...merged }),
                        rewards: merged.rewards,
                        rewardClaims: merged.rewardClaims,
                        error: errs.length > 0 ? errs.join('; ') : null,
                    },
                }));
            });
        }
        return () => { cancelled = true; };
    }, [chainsWithAddresses, validatorChainIds, addressesByChain, messaging, walletId]);

    // PC-47: chain tip per chain, for the cooldown countdown. One cheap read
    // per chain; a failure leaves the height null and every countdown falls
    // back to the bare end-block text.
    const [heightByChain, setHeightByChain] = useState(/** @type {Record<string, number|null>} */ ({}));
    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.getIndexerWatermark !== 'function') return undefined;
        for (const cid of chainsWithAddresses) {
            messaging.getIndexerWatermark({ chainId: cid })
                .then((r) => {
                    if (cancelled) return;
                    setHeightByChain((prev) => ({ ...prev, [cid]: Number.isFinite(r?.watermark) ? r.watermark : null }));
                })
                .catch(() => { /* countdown degrades to the end block alone */ });
        }
        return () => { cancelled = true; };
    }, [chainsWithAddresses, messaging]);

    // PC-47: what every validator address on every chain can claim right now.
    const claimable = useMemo(() => {
        const rewards = [];
        const claims = [];
        for (const state of Object.values(stateByChain)) {
            rewards.push(...(state.rewards || []));
            claims.push(...(state.rewardClaims || []));
        }
        return unclaimedRewards({ rewards, claims });
    }, [stateByChain]);

    // PC-47: the Claim button deep-links to the validator detail page,
    // which already owns the COLLECT flow and its own preconditions. Picking a
    // surface rather than composing a claim here keeps one code path signing.
    const firstValidatorRef = useMemo(() => {
        for (const state of Object.values(stateByChain)) {
            const row = (state.rows || []).find((r) => r.kind === 'validator');
            if (row) return row.ref;
        }
        return null;
    }, [stateByChain]);

    // Flatten every chain's rows into one list, newest first.
    const allRows = useMemo(() => {
        /** @type {any[]} */
        const out = [];
        for (const state of Object.values(stateByChain)) out.push(...(state.rows || []));
        out.sort((a, b) => Number(b.blockIndex || 0) - Number(a.blockIndex || 0));
        return out;
    }, [stateByChain]);

    const anyLoading = useMemo(() => {
        const states = Object.values(stateByChain);
        if (states.length === 0) return chainsWithAddresses.length > 0;
        return states.some((s) => s.loading);
    }, [stateByChain, chainsWithAddresses]);

    const loadErrors = useMemo(() => (
        Object.entries(stateByChain)
            .filter(([, s]) => s.error)
            .map(([cid, s]) => `${chainRegistry.get(cid)?.displayName || cid}: ${s.error}`)
    ), [stateByChain]);

    const visibleRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return allRows.filter((row) => {
            if (network !== 'all' && coinFromChainId(row.chainId) !== network) return false;
            if (!q) return true;
            return row.searchHaystack.includes(q);
        });
    }, [allRows, query, network]);

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            titleIcon={<Icon.StakeIcon />}
            title="Staking"
            trailing={onNewStake ? (
                <button
                    type="button"
                    className={local.addBtn}
                    onClick={() => onNewStake()}
                    aria-label="New stake"
                    title="New stake"
                >
                    <Icon.PlusIcon />
                </button>
            ) : undefined}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div className={isFull ? local.wrapFull : local.wrapPopup}>
                {children}
            </div>
        </Screen>
    );

    if (addressesError) {
        return wrap(<StatusMessage variant="error" className={styles.entryDescription}>{addressesError}</StatusMessage>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.entryDescription}>Loading addresses…</p>);
    }
    if (chainsWithAddresses.length === 0) {
        return wrap(
            <p className={styles.entryDescription}>
                No addresses yet on a chain that supports staking. Use Receive
                to generate one first. Staking into a contract works on Bitcoin,
                Litecoin and Dogecoin; validator staking is Bitcoin-only.
            </p>,
        );
    }

    return wrap(
        <>
            <div className={local.toolbar}>
                <input
                    type="text"
                    className={local.search}
                    placeholder="Search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Search staking positions"
                />
                <NetworkFilterDropdown value={network} onChange={setNetwork} />
            </div>
            {Number(claimable.unclaimed) > 0 ? (
                <div className={local.claimable} role="status">
                    <div>
                        <strong>{formatWithThousands(claimable.unclaimed)} XCHAIN</strong>
                        {' '}ready to claim
                        <div className={styles.entryDescription}>
                            Rewards you have earned and not yet collected.
                            {claimable.hasRejectedClaim
                                ? ' An earlier claim was refused by the network, so those rewards are still here to claim.'
                                : ''}
                            {' '}A claim can be refused if the reward pool is short; nothing moves when that happens and you can claim again once it is topped up.
                        </div>
                    </div>
                    {firstValidatorRef ? (
                        <Button variant="primary" onClick={() => onOpenStake(firstValidatorRef)}>Claim</Button>
                    ) : null}
                </div>
            ) : null}
            {loadErrors.length > 0 ? (
                <StatusMessage variant="error" className={styles.entryDescription}>
                    Couldn't load some staking data. {loadErrors.join('; ')}
                </StatusMessage>
            ) : null}
            {anyLoading && visibleRows.length === 0 ? (
                <p className={styles.entryDescription}>Loading…</p>
            ) : visibleRows.length === 0 ? (
                <p className={styles.entryDescription}>
                    {allRows.length === 0
                        ? 'Nothing staked yet. Use the + button to create your first stake.'
                        : 'No staking positions match the current filter.'}
                </p>
            ) : (
                <div className={local.list} role="list">
                    {visibleRows.map((row) => (
                        <StakeRow
                            key={row.key}
                            row={row}
                            cooldown={cooldownText(cooldownStatus({
                                unstake: { cooldown_end_block: row.cooldownEndBlock },
                                height: heightByChain[row.chainId],
                                coin: chainRegistry.get(row.chainId)?.coin,
                            }))}
                            onSelect={() => onOpenStake(row.ref)}
                        />
                    ))}
                </div>
            )}
        </>,
    );
}

function StakeRow({ row, cooldown, onSelect }) {
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    return (
        <button
            type="button"
            className={local.row}
            role="listitem"
            onClick={onSelect}
            aria-label={`Open ${row.name}`}
        >
            <div className={local.iconWrap}>
                <span
                    className={local.iconLetter}
                    style={{ background: tickerColor(row.asset || '?'), color: '#FFFFFF' }}
                    aria-hidden="true"
                >
                    {(row.asset || '?').slice(0, 1)}
                </span>
                {chainIconUrl ? (
                    <img
                        src={chainIconUrl}
                        alt=""
                        aria-hidden="true"
                        title={chainRegistry.get(row.chainId)?.displayName}
                        className={local.chainOverlay}
                    />
                ) : null}
            </div>
            <div className={local.body}>
                <div className={local.name}>{row.name}</div>
                <div className={local.subtitle}>{row.subtitle}</div>
                {row.subtitle2 ? <div className={local.subtitle}>{row.subtitle2}</div> : null}
                {cooldown ? <div className={local.subtitle}>{cooldown}</div> : null}
            </div>
            <div className={local.trailing}>
                <span className={`${local.status} ${local[`status_${row.status}`] || ''}`}>
                    {row.status}
                </span>
                <span className={local.amount}>{row.amountLabel}</span>
                {row.rewardLabel ? (
                    <span className={local.rewardChip}>{row.rewardLabel}</span>
                ) : null}
            </div>
        </button>
    );
}

/**
 * Merge one chain's validator + contract lanes into unified display
 * rows. Each row carries the `ref` handed to `onOpenStake` and a
 * prebuilt lowercase search haystack.
 */
function buildRows({ chainId, stakes, delegations, rewards, contractStakes, contractUnstakes }) {
    /** @type {any[]} */
    const rows = [];

    // Pending (unclaimed) rewards surface as a per-row chip on the
    // validator rows they belong to; rewards are validator-specific so
    // the list root itself stays kind-neutral.
    let pendingRewards = 0;
    for (const r of (rewards || [])) {
        const amt = Number(r.amount ?? r.AMOUNT ?? r.reward ?? 0);
        if (!Number.isFinite(amt)) continue;
        const status = String(r.status || '').toLowerCase();
        if (status === 'pending' || status === 'unclaimed') pendingRewards += amt;
    }
    const rewardLabel = pendingRewards > 0
        ? `+${formatWithThousands(String(pendingRewards))} XCHAIN reward`
        : null;

    const primaryDelegation = (delegations || [])[0];
    for (const s of (stakes || [])) {
        const amt = fmtAmount(s.amount ?? s.AMOUNT ?? s.quantity);
        const asset = s.asset ?? s.ASSET ?? 'XCHAIN';
        const label = s.capability_label || s.capability || 'Validator stake';
        const status = normalizeStatus(s.status) || 'active';
        const addr = String(s._ownerAddress || '');
        rows.push({
            key: `v:${chainId}:${String(s.stake_id ?? s.action_index ?? addr)}`,
            kind: 'validator',
            chainId,
            asset,
            name: label === 'Validator stake' ? label : `Validator stake · ${label}`,
            subtitle: `${amt} ${asset}`,
            subtitle2: short(addr),
            amountLabel: `${amt} ${asset}`,
            rewardLabel,
            status,
            blockIndex: s.block_index,
            ref: { kind: 'validator', chainId, address: addr },
            searchHaystack: [
                'validator', label, asset, String(amt), addr, status,
                s.signing_pubkey, primaryDelegation?.signing_pubkey,
            ].filter((v) => typeof v === 'string' || typeof v === 'number')
                .join(' ').toLowerCase(),
        });
    }

    for (const s of (contractStakes || [])) {
        const idx = String(s.target_contract_index ?? '?');
        const addr = String(s._ownerAddress || '');
        const tick = s.tick || '?';
        // A matching unstake still before its cooldown end means part of
        // this position is releasing; flag the whole row as cooldown.
        const matchingUnstakes = (contractUnstakes || []).filter(
            (u) => String(u.target_contract_index ?? '') === idx,
        );
        const inCooldown = matchingUnstakes.length > 0;
        // Soonest maturity wins: it is the next thing that becomes withdrawable.
        const cooldownEndBlock = matchingUnstakes
            .map((u) => Number(u.cooldown_end_block))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => a - b)[0] ?? null;
        rows.push({
            key: `c:${chainId}:${idx}:${String(s.action_index ?? addr)}`,
            kind: 'contract',
            chainId,
            asset: tick,
            name: `Contract #${idx} stake`,
            subtitle: `${fmtAmount(s.amount)} ${tick}`,
            subtitle2: short(addr),
            amountLabel: `${fmtAmount(s.amount)} ${tick}`,
            status: inCooldown ? 'cooldown' : 'active',
            cooldownEndBlock,
            blockIndex: s.block_index,
            ref: { kind: 'contract', chainId, address: addr, contractActionIndex: idx },
            searchHaystack: [
                'contract', `#${idx}`, idx, tick, String(s.amount ?? ''), addr,
                s.signing_pubkey,
            ].filter((v) => typeof v === 'string' || typeof v === 'number')
                .join(' ').toLowerCase(),
        });
    }

    // Unstakes whose stake row is already gone (fully releasing
    // positions) still deserve a row until cooldown ends.
    for (const u of (contractUnstakes || [])) {
        const idx = String(u.target_contract_index ?? '?');
        const hasStakeRow = (contractStakes || []).some(
            (s) => String(s.target_contract_index ?? '') === idx,
        );
        if (hasStakeRow) continue;
        const addr = String(u._ownerAddress || '');
        const tick = u.tick || '?';
        rows.push({
            key: `u:${chainId}:${idx}:${String(u.action_index ?? addr)}`,
            kind: 'contract',
            chainId,
            asset: tick,
            name: `Contract #${idx} stake`,
            subtitle: `${fmtAmount(u.amount)} ${tick} releasing`,
            subtitle2: u.cooldown_end_block ? `until block ${formatWithThousands(String(u.cooldown_end_block))}` : short(addr),
            cooldownEndBlock: u.cooldown_end_block ?? null,
            amountLabel: `${fmtAmount(u.amount)} ${tick}`,
            status: 'cooldown',
            blockIndex: u.block_index,
            ref: { kind: 'contract', chainId, address: addr, contractActionIndex: idx },
            searchHaystack: [
                'contract', 'cooldown', `#${idx}`, idx, tick,
                String(u.amount ?? ''), addr,
            ].filter((v) => typeof v === 'string' || typeof v === 'number')
                .join(' ').toLowerCase(),
        });
    }

    return rows;
}

// Comma-grouped display amount; non-numeric input (missing amounts)
// falls back to "?".
function fmtAmount(value) {
    if (value == null || value === '' || value === '?') return '?';
    return formatWithThousands(String(value));
}

function normalizeStatus(status) {
    const s = String(status || '').toLowerCase();
    if (!s) return null;
    if (s === 'active' || s === 'valid' || s === 'open') return 'active';
    if (s === 'cooldown' || s === 'unbonding' || s === 'releasing') return 'cooldown';
    if (s === 'pending' || s === 'unconfirmed') return 'pending';
    return s;
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

function short(addr) {
    if (!addr || typeof addr !== 'string') return '';
    return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
