// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { AddressText, Button, EmptyState, Icon, ListPage, PageHeader, Screen, Select, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
// The standard list filter, on the title line.
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
// The DEX's list-and-detail split, shared: the width rule, the panels and the line.
import { LIST_DETAIL_MIN_WIDTH, ListDetailSplit, listDetailStyles, useWideContent } from '../components/PanelSplit.jsx';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '../../branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useWalletSource } from '../hooks/useDemoGuard.jsx';
import { useSupportedChains } from '../hooks/useSupportedChains.js';
import { coinFromChainId, tickerColor } from '../components/BalanceList.jsx';
import { formatWithThousands } from '../utils/amountFormat.js';
import {
    unclaimedRewards,
    cooldownStatus,
    cooldownText,
    stakingLockStatus,
    stakingLockText,
    stakingRowState,
    stakingActivationBlock,
    toBaseUnits,
    latestEffectiveStakingRow,
    isPendingContractUnstake,
    scalarRows,
} from '../../flows/stakingDashboard.js';
import buttonStyles from '../../ui/Button.module.css';
import styles from './ActionsMenu.module.css';
import local from './StakingList.module.css';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { OfflineEmptyState } from '../components/OfflineEmptyState.jsx';

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
 * pubkey, capability). The header's "+" opens the new-stake flow. Clicking a row opens StakeDetail via
 * `onOpenStake` with a ref describing the position.
 *
 * Contract-stake explorer/SDK queries are a Phase 7 follow-up and
 * still throw for live wallets; that lane degrades silently to empty
 * (same behavior the old ContractStakedPositions view had) so the
 * validator lane always renders.
 *
 * Wide content (the DEX's LIST_DETAIL_MIN_WIDTH and up, with `renderStake`
 * given): two panels, as the DEX shows its markets (MarketsList), this list
 * on the left and the picked stake's detail on the right (the first stake
 * until one is picked). A row then loads its stake in the right panel and
 * stays put; narrower, a row opens Stake detail through `onOpenStake` as
 * before. The right panel is handed what the list already read for that
 * stake (`panel.preloaded`), so showing it never reads the list's rows again.
 *
 * On the stake-detail route the host also passes `renderStakePage`: wide, the
 * route is the same two panels with `selectedStake` picked; narrow, it is
 * the Stake detail page alone, and the list reads nothing.
 *
 * @typedef {{ kind: 'validator'|'contract', chainId: string, address: string, contractActionIndex?: string, stakeId?: string }} StakeRef
 *   `stakeId` is the one stake's own identity (its id, action index, tx and vout), so two stakes on one address select separately
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.activeAccountId]  scope the address union to this account
 * @param {(ref: StakeRef) => void} props.onOpenStake
 * @param {() => void} [props.onNewStake]   opens the new-stake chooser ("+")
 * @param {() => void} props.onBack
 * @param {StakeRef | null} [props.selectedStake]
 *   the stake the right panel shows, held by the shell so it survives the stake's forms
 * @param {(ref: StakeRef) => void} [props.onSelectStake]  a row picked on wide content
 * @param {(ref: StakeRef) => void} [props.onClaim]  the "ready to claim" banner's Claim: opens the Claim form on that stake's address
 * @param {(ref: StakeRef, panel: { preloaded: object | null }) => import('react').ReactNode} [props.renderStake]
 *   the right panel's stake (an embedded StakeDetail); without it the list never splits
 * @param {(ref: StakeRef, page: { measureRef: (el: HTMLElement | null) => void }) => import('react').ReactNode} [props.renderStakePage]
 *   the stake-detail route's narrow page (a standalone StakeDetail that puts
 *   `measureRef` on its body box, so widening the window splits it again)
 */
export function StakingList({
    walletId,
    activeAccountId,
    onOpenStake,
    onNewStake,
    onBack,
    selectedStake = null,
    onSelectStake,
    onClaim,
    renderStake,
    renderStakePage,
}) {
    const { shell } = useMessaging();
    const source = useWalletSource(walletId);
    const { messaging } = source;
    const variant = screenVariantFor(shell);

    const canSplit = typeof renderStake === 'function';
    const [layoutRef, wideContent, measured] = useWideContent(LIST_DETAIL_MIN_WIDTH, canSplit);
    const twoPanel = canSplit && wideContent;
    // The stake-detail route: until the width is known neither layout mounts,
    // and narrow it is the detail page alone, so the list's reads wait.
    const detailRoute = typeof renderStakePage === 'function' && Boolean(selectedStake);
    const listShown = !detailRoute || (measured && twoPanel);
    // A pick made here, for a host that does not hold the selection itself.
    const [localPick, setLocalPick] = useState(/** @type {StakeRef | null} */ (null));

    // Chains whose protocol accepts the contract-staking lane, i.e. every
    // chain the registry advertises STAKE on (put STAKE into the
    // shared set), and the Bitcoin subset that also has the validator lane.
    // Read from the LIVE registry (re-rendered on every descriptor mutation),
    // not memoised once at mount, so a synced descriptor lands without restart.
    const supportedChains = useSupportedChains(chainRegistry);
    const stakingChainIds = useMemo(
        () => supportedChains
            .filter((d) => Array.isArray(d.supportedActions) && d.supportedActions.includes('STAKE'))
            .map((d) => d.id),
        [supportedChains],
    );
    const validatorChainIds = useMemo(
        () => new Set(supportedChains.filter((d) => d.coin === VALIDATOR_COIN).map((d) => d.id)),
        [supportedChains],
    );

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [addressesError, setAddressesError] = useState(
        /** @type {string | null} */ (null),
    );

    /** @typedef {{ loading: boolean, rows: any[], positions?: any, rewards: any[], error: string | null }} ChainState */
    const [stateByChain, setStateByChain] = useState(
        /** @type {Record<string, ChainState>} */ ({}),
    );
    const [addressesReload, setAddressesReload] = useState(0);
    const [stakingReload, setStakingReload] = useState(0);

    // In-page filters: free-text search plus a chain filter that names each
    // chain without its network kind.
    const [query, setQuery] = useState('');
    const [network, setNetwork] = useState('all');
    // Status and Sort sit with Search and Network in the title-line filter.
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortBy, setSortBy] = useState('newest');

    // Offline the explorer reads cannot finish, and each one waits out its
    // client retries before failing, so the page would sit on a skeleton for
    // a minute. It shows its offline state instead and reads once the
    // connection returns.
    const { offline, recheck } = useNetworkOffline({ walletId });

    useEffect(() => {
        if (!listShown) return undefined;
        let cancelled = false;
        setAddressesByChain(null);
        setAddressesError(null);
        messaging.getAddressesByChain(walletId, activeAccountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
            })
            .catch((err) => {
                if (!cancelled) setAddressesError(readFailureMessage(err, 'load your staking addresses'));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, activeAccountId, addressesReload, listShown]);

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

        if (offline) return;

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
                    rewardClaimsKnown: true,
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
                            .catch((e) => { out.errors.push(readFailureMessage(e, 'load validator stakes')); }),
                        // Tagged with the owner like the other lanes, so the right
                        // panel can take one address's delegations from the list.
                        messaging.getDelegationsForAddress({ chainId: cid, address: addr })
                            .then((r) => { out.delegations = extractRows(r).map((row) => ({ ...row, _ownerAddress: addr })); })
                            .catch((e) => { out.errors.push(readFailureMessage(e, 'load delegations')); }),
                        messaging.getRewardsForAddress({ chainId: cid, address: addr })
                            .then((r) => { out.rewards = extractRows(r).map((row) => ({ ...row, _ownerAddress: addr })); })
                            .catch((e) => { out.errors.push(readFailureMessage(e, 'load staking rewards')); }),
                        // PC-47: the claim side of the unclaimed sum. Best-effort:
                        // a build without the route degrades to "nothing claimed
                        // yet", which OVERSTATES what is claimable, so the header
                        // labels the figure as accrued-minus-claimed rather than
                        // promising it will all pay out.
                        (typeof messaging.getRewardClaimsForAddress === 'function'
                            ? messaging.getRewardClaimsForAddress({ chainId: cid, address: addr })
                            : Promise.resolve(null))
                            .then((r) => { out.rewardClaims = extractRows(r).map((row) => ({ ...row, _ownerAddress: addr })); })
                            .catch((e) => {
                                out.rewardClaimsKnown = false;
                                out.errors.push(readFailureMessage(e, 'load claimed staking rewards'));
                            }),
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
                // The right panel keeps the accrued rewards (its Earned figure)
                // even when the claim ledger is unknown; the list's sum does not.
                out.rewardsAll = out.rewards;
                if (!out.rewardClaimsKnown) out.rewards = [];
                return out;
            });
            Promise.all(perAddress)
                .then((results) => {
                    if (cancelled) return;
                    const merged = {
                        stakes: [], delegations: [], rewards: [], rewardClaims: [],
                        contractStakes: [], contractUnstakes: [],
                    };
                    // Per address, for the right panel: every accrued reward,
                    // whether the claim ledger was read, and whether any other
                    // validator read failed (that address's detail then reads
                    // for itself and reports its own failure).
                    const detail = { rewardsAll: [], claimsUnknown: [], failed: [] };
                    const errs = [];
                    for (const r of results) {
                        merged.stakes.push(...r.stakes);
                        merged.delegations.push(...r.delegations);
                        merged.rewards.push(...r.rewards);
                        merged.rewardClaims.push(...r.rewardClaims);
                        merged.contractStakes.push(...r.contractStakes);
                        merged.contractUnstakes.push(...r.contractUnstakes);
                        detail.rewardsAll.push(...r.rewardsAll);
                        if (!r.rewardClaimsKnown) detail.claimsUnknown.push(r.addr);
                        if (r.errors.length > (r.rewardClaimsKnown ? 0 : 1)) detail.failed.push(r.addr);
                        errs.push(...r.errors);
                    }
                    setStateByChain((prev) => ({
                        ...prev,
                        [cid]: {
                            loading: false,
                            rows: buildRows({ chainId: cid, ...merged }),
                            positions: merged,
                            detail,
                            rewards: merged.rewards,
                            rewardClaims: merged.rewardClaims,
                            error: errs.length > 0 ? errs.join('; ') : null,
                        },
                    }));
                })
                .catch((err) => {
                    if (cancelled) return;
                    setStateByChain((prev) => ({
                        ...prev,
                        [cid]: {
                            loading: false,
                            rows: [],
                            rewards: [],
                            rewardClaims: [],
                            error: readFailureMessage(err, 'load staking positions'),
                        },
                    }));
                });
        }
        return () => { cancelled = true; };
    }, [chainsWithAddresses, validatorChainIds, addressesByChain, messaging, stakingReload, offline]);

    // PC-47: chain tip per chain, for the cooldown countdown. One cheap read
    // per chain; a failure leaves the height null and every countdown falls
    // back to the bare end-block text.
    const [heightByChain, setHeightByChain] = useState(/** @type {Record<string, number|null>} */ ({}));
    useEffect(() => {
        let cancelled = false;
        if (!source.live || typeof messaging.getIndexerWatermark !== 'function') return undefined;
        for (const cid of chainsWithAddresses) {
            messaging.getIndexerWatermark({ chainId: cid })
                .then((r) => {
                    if (cancelled) return;
                    setHeightByChain((prev) => ({ ...prev, [cid]: Number.isFinite(r?.watermark) ? r.watermark : null }));
                })
                .catch(() => { /* countdown degrades to the end block alone */ });
        }
        return () => { cancelled = true; };
    }, [chainsWithAddresses, messaging, source.live]);

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

    // The Claim button opens the first address that really has rewards to
    // collect, which need not be the newest stake row (or have a stake row at
    // all: a fully unstaked validator can still be owed rewards).
    const claimRef = useMemo(() => {
        for (const [chainId, state] of Object.entries(stateByChain)) {
            const owners = new Set((state.rewards || []).map((row) => String(row?._ownerAddress || '')).filter(Boolean));
            for (const address of owners) {
                const mine = (list) => (list || []).filter((row) => String(row?._ownerAddress || '') === address);
                const { unclaimed } = unclaimedRewards({ rewards: mine(state.rewards), claims: mine(state.rewardClaims) });
                if (unclaimed !== '0') return { kind: 'validator', chainId, address };
            }
        }
        return null;
    }, [stateByChain]);

    // Flatten every chain's rows into one list, newest first.
    const allRows = useMemo(() => {
        /** @type {any[]} */
        const out = [];
        for (const [chainId, state] of Object.entries(stateByChain)) {
            const current = state.positions
                ? buildRows({ chainId, height: heightByChain[chainId], ...state.positions })
                : state.rows || [];
            out.push(...current);
        }
        out.sort((a, b) => Number(b.blockIndex || 0) - Number(a.blockIndex || 0));
        return out;
    }, [stateByChain, heightByChain]);

    // The Claim button deep-links to the validator detail page,
    // which already owns the COLLECT flow and its own preconditions. Picking a
    // surface rather than composing a claim here keeps one code path signing.
    const firstValidatorRef = useMemo(
        () => claimRef || allRows.find((row) => row.kind === 'validator')?.ref || null,
        [claimRef, allRows],
    );

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
            if (statusFilter !== 'all' && row.status !== statusFilter) return false;
            if (!q) return true;
            return row.searchHaystack.includes(q);
        });
    }, [allRows, query, network, statusFilter]);

    // Sort orders the filtered rows (Newest first is the default).
    const sortedRows = useMemo(() => {
        const rows = [...visibleRows];
        const at = (row) => Number(row.blockIndex || 0);
        if (sortBy === 'oldest') rows.sort((a, b) => at(a) - at(b));
        else if (sortBy === 'token') rows.sort((a, b) => String(a.asset || '').localeCompare(String(b.asset || '')) || (at(b) - at(a)));
        return rows;
    }, [visibleRows, sortBy]);
    const coinFamilies = useMemo(
        () => [...new Set(chainsWithAddresses.map((cid) => coinFromChainId(cid)))],
        [chainsWithAddresses],
    );

    // A second line that two rows share (one owner address under every
    // position) is shown nowhere; the position detail names the address.
    const repeatedSecondLines = useMemo(() => repeatedSecondLinesOf(visibleRows), [visibleRows]);

    // The title bar holds the filter and New stake (plus) icons; the
    // page body is only the staking list.
    const filterMenu = (
        <ListFilterMenu
            query={query}
            onQueryChange={setQuery}
            active={statusFilter !== 'all' || sortBy !== 'newest'}
            label="Filter staking"
            searchPlaceholder="Search"
            searchLabel="Search staking positions"
            chainRegistry={chainRegistry}
            coinFamilies={coinFamilies}
            networkFilter={network}
            onNetworkFilterChange={setNetwork}
        >
            <Select
                label="Status"
                help="Shows only your staking positions in the status you pick, such as active or in cooldown."
                size="md"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
            >
                <Select.Option value="all" icon={<Icon.ListIcon />}>All statuses</Select.Option>
                <Select.Option value="active" icon={<Icon.PlayIcon />}>Active</Select.Option>
                <Select.Option value="locked" icon={<Icon.LockIcon />}>Locked</Select.Option>
                <Select.Option value="pending" icon={<Icon.ClockIcon />}>Pending</Select.Option>
                <Select.Option value="cooldown" icon={<Icon.PauseIcon />}>Cooldown</Select.Option>
            </Select>
            <Select
                label="Sort"
                help="The order your staking positions are listed in: newest, oldest, or by token name."
                size="md"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
            >
                <Select.Option value="newest" icon={<Icon.HistoryIcon />}>Newest first</Select.Option>
                <Select.Option value="oldest" icon={<Icon.ClockIcon />}>Oldest first</Select.Option>
                <Select.Option value="token" icon={<Icon.TokenIcon />}>Token A to Z</Select.Option>
            </Select>
        </ListFilterMenu>
    );
    // The right panel's stake: the pick while its address is still one of
    // this wallet's staking addresses on that chain (a row's position, or an
    // address that only has rewards to claim), otherwise the first stake in
    // the list. Checked against the addresses, not the searched rows, so
    // typing a search never swaps the panel.
    const shownStake = useMemo(() => {
        if (!twoPanel || !addressesByChain) return null;
        const pick = selectedStake ?? localPick;
        if (pick && (addressesByChain[pick.chainId] || []).some((a) => a.address === pick.address)) {
            // A pick made without a stake identity (a host's older ref, or an
            // address's Claim) lands on that address's first stake row, so
            // exactly one row reads as selected.
            if (pick.stakeId == null) {
                const match = allRows.find((row) => sameStake(row.ref, { ...pick, stakeId: row.ref.stakeId }));
                if (match) return match.ref;
            }
            return pick;
        }
        // The first stake once every chain has answered, so a chain that
        // lands later with a newer stake never swaps the panel under the user.
        // A fully unstaked address can still be owed rewards; with no list row
        // its validator detail is the right panel, keeping Claim reachable.
        const first = anyLoading ? null : (sortedRows[0]?.ref || allRows[0]?.ref || claimRef);
        return first || null;
    }, [twoPanel, addressesByChain, selectedStake, localPick, sortedRows, allRows, anyLoading, claimRef]);
    const shownChain = shownStake ? stateByChain[shownStake.chainId] : null;
    const shownChainLoaded = Boolean(shownChain) && !shownChain.loading;
    // What the list already read for the shown stake, so the right panel does
    // not read it again. Built once per pick and chain load, never per row.
    const preloaded = useMemo(() => (shownStake && shownChainLoaded
        ? stakePreload({ ref: shownStake, chainState: shownChain, height: heightByChain[shownStake.chainId] })
        : null), [shownStake, shownChainLoaded, shownChain, heightByChain]);
    // Two panels while the list loads too (the right one a skeleton), so the
    // page does not jump from one layout to the other when the rows land.
    const showPanel = twoPanel && listShown && !addressesError
        && (Boolean(shownStake) || (!offline && (!addressesByChain || anyLoading)));
    // The host's pick follows the shown stake, the default first one included,
    // so the stake's forms (which read the host's pick) act on the stake the
    // right panel shows.
    useEffect(() => {
        if (showPanel && shownStake && !sameStake(shownStake, selectedStake)) onSelectStake?.(shownStake);
    }, [showPanel, shownStake, selectedStake, onSelectStake]);
    // Two panels: a row (or Claim) shows its stake in the right panel.
    const pickStake = (ref) => {
        setLocalPick(ref);
        onSelectStake?.(ref);
    };

    // On narrow layouts the summary's Claim opens the Claim form, as a stake's
    // Unstake opens the Unstake form. Wide layouts keep every action in the
    // selected stake's right-panel action list.
    const openClaim = (ref) => {
        if (typeof onClaim === 'function') onClaim(ref);
        else if (twoPanel) pickStake(ref);
        else onOpenStake(ref);
    };

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Staking"
            trailing={(
                <>
                    {filterMenu}
                    {onNewStake ? (
                        <Button variant="secondary" icon={<Icon.PlusIcon />} aria-label="New Stake" title="New Stake" onClick={() => onNewStake()}>
                            {null}
                        </Button>
                    ) : null}
                </>
            )}
        />
    );
    const shownRow = shownStake ? allRows.find((row) => sameStake(row.ref, shownStake)) : null;
    const stakePanelSkeleton = (
        <div aria-hidden="true">
            <Skeleton height={190} />
        </div>
    );
    const wrap = (children, { notices } = {}) => {
        const listPage = (
            <ListPage notices={notices}>
                {children}
            </ListPage>
        );
        if (!showPanel) {
            return (
                <Screen variant={variant} header={header}>
                    {/* The measured box: Screen's content width decides the layout. */}
                    <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="list">
                        {listPage}
                    </div>
                </Screen>
            );
        }
        return (
            <Screen variant={variant} header={header} bodyClassName={listDetailStyles.twoPanelBody}>
                <ListDetailSplit
                    measureRef={layoutRef}
                    storageKey="staking"
                    resizeLabel="Resize the staking list"
                    resizeHint="Drag to resize the staking list, or press Enter to reset."
                    layoutName="two-panel"
                    list={listPage}
                    listLabel="Staking positions"
                    detailLabel={shownRow?.name || 'Stake'}
                    detailBusy={!shownStake || !shownChainLoaded}
                    detailFallback={stakePanelSkeleton}
                    detail={shownStake && shownChainLoaded ? (
                        // Keyed on the stake alone, so the list re-rendering never reloads it.
                        <Fragment key={`${shownStake.kind}:${shownStake.chainId}:${shownStake.address}:${shownStake.contractActionIndex ?? ''}:${shownStake.stakeId ?? ''}`}>
                            {renderStake(shownStake, { preloaded })}
                        </Fragment>
                    ) : stakePanelSkeleton}
                />
            </Screen>
        );
    };

    // The stake-detail route: nothing mounts until the width is known (the
    // measuring box is never painted), and narrow it is the detail page alone,
    // which carries the measured box from then on.
    if (detailRoute && !(measured && twoPanel)) {
        if (!measured) {
            return (
                <Screen variant={variant} header={header}>
                    <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="measuring" />
                </Screen>
            );
        }
        return renderStakePage(selectedStake, { measureRef: layoutRef });
    }

    if (addressesError) {
        return wrap(null, {
            notices: (
                <StatusMessage
                    variant="error"
                    className={styles.entryDescription}
                    recovery={{
                        label: 'Try Again',
                        onAction: () => {
                            setAddressesError(null);
                            setAddressesByChain(null);
                            setAddressesReload((value) => value + 1);
                        },
                    }}
                >
                    {addressesError}
                </StatusMessage>
            ),
        });
    }
    if (!addressesByChain) {
        return wrap(
            <div role="status" aria-label="Loading staking positions">
                <Skeleton.List rows={5} />
            </div>,
        );
    }
    if (chainsWithAddresses.length === 0) {
        return wrap(
            <EmptyState
                title="No staking address"
                body="Contract staking supports Bitcoin, Litecoin, and Dogecoin; validator staking supports Bitcoin."
                titleAs="p"
            />,
        );
    }

    // Offline with nothing loaded, the page says so once in place of a
    // skeleton waiting on reads that cannot run.
    if (offline && allRows.length === 0) {
        return wrap(
            <OfflineEmptyState body="Staking positions load when the connection returns." onRetry={recheck} />,
        );
    }

    const loadErrorNotice = loadErrors.length > 0 ? (
        <StatusMessage
            variant="error"
            className={styles.entryDescription}
            recovery={{
                label: 'Try Again',
                onAction: () => {
                    setStateByChain({});
                    setStakingReload((value) => value + 1);
                },
            }}
        >
            Couldn't load some staking data. {loadErrors.join('; ')}
        </StatusMessage>
    ) : null;

    return wrap(
        <>
            {!twoPanel && Number(claimable.unclaimed) > 0 ? (
                <div className={local.claimable}>
                    <div>
                        <strong><bdi dir="ltr">{formatWithThousands(claimable.unclaimed)} XCHAIN</bdi></strong>
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
                        <Button variant="primary" onClick={() => openClaim(firstValidatorRef)}>Claim</Button>
                    ) : null}
                </div>
            ) : null}
            {anyLoading && visibleRows.length === 0 ? (
                <div role="status" aria-label="Loading staking positions">
                    <Skeleton.List rows={5} />
                </div>
            ) : loadErrors.length > 0 && allRows.length === 0 ? (
                null
            ) : visibleRows.length === 0 ? (
                <EmptyState
                    title={allRows.length === 0
                        ? (loadErrors.length > 0
                            ? "Staking positions unavailable"
                            : "Nothing staked yet")
                        : "No matching stakes"}
                    /* The empty state is text only; New stake is in the title bar. */
                    body={allRows.length === 0
                        ? (loadErrors.length > 0
                            ? "No staking positions could be loaded, so try again later."
                            : "Staking positions created by this wallet appear here.")
                        : "Try a different search."}
                    titleAs="p"
                />
            ) : (
                <div className={local.list} role="list" data-xc-split-list={showPanel ? '' : undefined}>
                    {sortedRows.map((row) => (
                        <StakeRow
                            key={row.key}
                            row={row}
                            hideSecondLine={repeatedSecondLines.has(row.subtitle2)}
                            period={row.cooldownEndBlock != null
                                ? cooldownText(cooldownStatus({
                                    unstake: { cooldown_end_block: row.cooldownEndBlock },
                                    height: heightByChain[row.chainId],
                                    coin: chainRegistry.get(row.chainId)?.coin,
                                }), row.kind)
                                : stakingLockText(stakingLockStatus({
                                    stake: { activation_block: row.lockEndBlock },
                                    height: heightByChain[row.chainId],
                                    coin: chainRegistry.get(row.chainId)?.coin,
                                }))}
                            selected={showPanel && sameStake(row.ref, shownStake)}
                            split={showPanel}
                            onSelect={() => (twoPanel ? pickStake(row.ref) : onOpenStake(row.ref))}
                        />
                    ))}
                </div>
            )}
        </>,
        { notices: loadErrorNotice },
    );
}

/**
 * The second-line texts that more than one row carries.
 *
 * @param {Array<{ subtitle2?: string | null }>} rows
 * @returns {Set<string>}
 */
export function repeatedSecondLinesOf(rows) {
    const counts = new Map();
    for (const row of rows) {
        if (row.subtitle2) counts.set(row.subtitle2, (counts.get(row.subtitle2) || 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([text]) => text));
}

/**
 * The accessible name of a stake row: the position, its amount and its
 * owner, so two positions under one validator or contract read apart.
 *
 * @param {{ name: string, subtitle?: string | null, subtitle2?: string | null }} row
 * @returns {string}
 */
export function stakeRowLabel(row) {
    return ['Open ' + row.name, row.subtitle, row.subtitle2].filter(Boolean).join(', ');
}

/** A status word in sentence case for the row's pill ("active" -> "Active"). */
export function stakeStatusLabel(status) {
    const text = String(status || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/**
 * What the list already read for one stake, in the shapes Stake detail reads
 * them in, so the right panel can show it without reading those rows again.
 * Null when the list's reads for that address failed (the detail then reads
 * for itself and reports its own failure).
 *
 * @param {{ ref: { kind: string, chainId: string, address: string, contractActionIndex?: string }, chainState: any, height?: number | null }} args
 */
export function stakePreload({ ref, chainState, height }) {
    const positions = chainState?.positions;
    const detail = chainState?.detail;
    if (!positions || !detail) return null;
    const address = String(ref.address || '');
    const owned = (list) => (Array.isArray(list) ? list : [])
        .filter((row) => String(row?._ownerAddress || '') === address)
        .map(({ _ownerAddress: _owner, ...row }) => row);
    const tip = Number.isFinite(height) ? height : null;
    if (ref.kind === 'validator') {
        if (detail.failed.includes(address)) return null;
        return {
            kind: 'validator',
            stakes: owned(positions.stakes),
            delegations: owned(positions.delegations),
            rewards: owned(detail.rewardsAll),
            rewardClaims: owned(positions.rewardClaims),
            claimsKnown: !detail.claimsUnknown.includes(address),
            height: tip,
        };
    }
    const idx = String(ref.contractActionIndex ?? '');
    const inContract = (list) => owned(list).filter((row) => String(row.target_contract_index) === idx);
    return {
        kind: 'contract',
        contractStakes: inContract(positions.contractStakes),
        contractUnstakes: inContract(positions.contractUnstakes),
        height: tip,
    };
}

function StakeRow({ row, period, hideSecondLine = false, selected = false, split = false, onSelect }) {
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    return (
        /* The list item holds one native button, which is the complete clickable row.
           Two panels: the row whose stake the right panel shows reads as the
           DEX's selected market row. */
        <div
            role="listitem"
            className={local.rowItem}
            data-xc-split-item={split ? '' : undefined}
            data-selected={selected ? 'true' : undefined}
        >
            <button
                type="button"
                className={`${buttonStyles.btn} ${buttonStyles.ghost} ${buttonStyles.lg} ${local.row}`}
                onClick={onSelect}
                aria-label={stakeRowLabel(row)}
                aria-current={selected ? 'true' : undefined}
                data-xc-split-row={split ? '' : undefined}
            >
                <div className={local.iconWrap}>
                    <span
                        className={local.iconLetter}
                        style={{ background: tickerColor(row.asset || '?') }}
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
                    {/* Line two holds the amount, then the period, the reward
                        chip and the status pill. The text truncates first;
                        the chip and pill never shrink or wrap, so a row is
                        never taller than three lines. The amount repeats
                        only when it says something else (U18). */}
                    <div className={local.statusLine}>
                        <div className={`${local.subtitle} ${local.statusLineText}`}>
                            <bdi dir="ltr">{row.subtitle}</bdi>
                            {row.amountLabel && row.amountLabel !== row.subtitle
                                ? <>{' · '}<bdi dir="ltr" className={local.amount}>{row.amountLabel}</bdi></>
                                : null}
                            {period ? <>{' · '}<bdi dir="auto" className={local.duration}>{period}</bdi></> : null}
                        </div>
                        {row.rewardLabel ? (
                            <span className={local.rewardChip}>{row.rewardLabel}</span>
                        ) : null}
                        <span className={`${local.status} ${local[`status_${row.status}`] || ''}`}>
                            {stakeStatusLabel(row.status)}
                        </span>
                    </div>
                    {row.subtitle2 && !hideSecondLine ? (
                        <div className={local.subtitle}>
                            {/* The owner address in full when it fits (G99). */}
                            {row.subtitle2Address
                                ? <AddressText address={row.subtitle2Address} fit focusable={false} />
                                : row.subtitle2}
                        </div>
                    ) : null}
                </div>
                <span className={local.rowChevron} data-row-chevron aria-hidden="true"><Icon.ForwardIcon /></span>
            </button>
        </div>
    );
}

/**
 * Merge one chain's validator + contract lanes into unified display
 * rows. Each row carries the `ref` handed to `onOpenStake` and a
 * prebuilt lowercase search haystack.
 */
export function buildRows({
    chainId,
    height,
    stakes,
    delegations,
    rewards,
    rewardClaims,
    contractStakes,
    contractUnstakes,
}) {
    /** @type {any[]} */
    const rows = [];

    // Pending (unclaimed) rewards surface as a chip on the validator row of
    // the address they belong to, once per address; rewards are
    // validator-specific so the list root itself stays kind-neutral. Rows
    // that carry no owner (the demo fixtures) all belong to one address.
    const pendingByAddress = new Map();
    const pendingFor = (addr) => {
        if (!pendingByAddress.has(addr)) {
            const owned = (list) => (Array.isArray(list) ? list : [])
                .filter((row) => !row?._ownerAddress || String(row._ownerAddress) === addr);
            pendingByAddress.set(addr, unclaimedRewards({
                rewards: owned(rewards),
                claims: owned(rewardClaims),
            }).unclaimed);
        }
        return pendingByAddress.get(addr);
    };
    const labelledAddresses = new Set();

    const primaryDelegation = latestEffectiveStakingRow(delegations, height);
    const visibleStakes = visibleStakingRows(stakes, height);
    for (const [stakeIndex, s] of visibleStakes.entries()) {
        const amt = fmtAmount(s.amount ?? s.AMOUNT ?? s.quantity);
        const asset = tickText(s.asset ?? s.ASSET, 'XCHAIN');
        const label = s.capability_label || s.capability || 'Validator stake';
        const state = stakingRowState(s, height);
        const status = state === 'pending' ? 'locked' : normalizeStatus(s.status ?? s.STATUS) || 'active';
        const addr = String(s._ownerAddress || '');
        const pendingRewards = pendingFor(addr);
        const rewardLabel = pendingRewards !== '0' && !labelledAddresses.has(addr)
            ? `+${formatWithThousands(String(pendingRewards))} XCHAIN reward`
            : null;
        labelledAddresses.add(addr);
        // Two stakes on one address share `address`, so each carries its own
        // identity in its ref: the stake's id, else its action index, else its
        // tx and vout, else its place in the list.
        const stakeId = stakeIdentity(s, `${addr}#${stakeIndex}`);
        rows.push({
            key: `v:${chainId}:${stakeId}`,
            kind: 'validator',
            chainId,
            asset,
            name: label === 'Validator stake' ? label : `Validator stake · ${label}`,
            subtitle: `${amt} ${asset}`,
            subtitle2: short(addr),
            subtitle2Address: addr || null,
            amountLabel: `${amt} ${asset}`,
            rewardLabel,
            status,
            lockEndBlock: state === 'pending' ? stakingActivationBlock(s) : null,
            blockIndex: s.block_index,
            ref: { kind: 'validator', chainId, address: addr, stakeId },
            searchHaystack: [
                'validator', label, asset, String(amt), addr, status,
                s.signing_pubkey, primaryDelegation?.signing_pubkey,
            ].filter((v) => typeof v === 'string' || typeof v === 'number')
                .join(' ').toLowerCase(),
        });
    }

    const activeContractStakes = visibleStakingRows(contractStakes, height);
    for (const [contractStakeIndex, s] of activeContractStakes.entries()) {
        const idx = String(s.target_contract_index ?? '?');
        const addr = String(s._ownerAddress || '');
        const tick = tickText(s.tick, '?');
        const matchingUnstakes = (contractUnstakes || []).filter(
            (u) => String(u.target_contract_index ?? '') === idx,
        );
        // The indexer marks an unstake `completed` once the block-end sweep has
        // credited the coins back, so a completed row describes a release that
        // has ALREADY happened. Counting those as cooldown pinned a finished
        // position at "Ready to withdraw" forever, and the stake row it sat on
        // still carried the original amount, so the list claimed coins were
        // staked that were already spendable.
        const releasing = matchingUnstakes.filter(isPendingContractUnstake);
        const released = matchingUnstakes.filter(isReleasedUnstake);
        // Nothing still releasing and the completed rows account for the whole
        // position: it is over. The explorer keeps serving the stake row (its
        // own status stays `valid` and its amount unchanged), so dropping it
        // here is the only way the list stops showing a stake that is not one.
        // Anything short of full coverage keeps the row, because a partial
        // release leaves a real remaining stake.
        const hasLifecycle = s.activation_block != null || s.ACTIVATION_BLOCK != null
            || s.deactivation_block != null || s.DEACTIVATION_BLOCK != null;
        if (!hasLifecycle && releasing.length === 0 && released.length > 0
            && coversWholeStake(released, s.amount)) continue;
        // A matching unstake still before its cooldown end means part of
        // this position is releasing; flag the whole row as cooldown.
        const inCooldown = releasing.length > 0;
        // Soonest maturity wins: it is the next thing that becomes withdrawable.
        const cooldownEndBlock = releasing
            .map((u) => Number(u.cooldown_end_block))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => a - b)[0] ?? null;
        const stakeId = stakeIdentity(s, `${addr}#${contractStakeIndex}`);
        rows.push({
            key: `c:${chainId}:${idx}:${stakeId}`,
            kind: 'contract',
            chainId,
            asset: tick,
            name: `Contract #${idx} stake`,
            subtitle: `${fmtAmount(s.amount)} ${tick}`,
            subtitle2: short(addr),
            subtitle2Address: addr || null,
            amountLabel: `${fmtAmount(s.amount)} ${tick}`,
            status: inCooldown
                ? 'cooldown'
                : stakingRowState(s, height) === 'pending'
                    ? 'locked'
                    : normalizeStatus(s.status ?? s.STATUS) || 'active',
            cooldownEndBlock,
            lockEndBlock: stakingRowState(s, height) === 'pending'
                ? stakingActivationBlock(s)
                : null,
            blockIndex: s.block_index,
            ref: { kind: 'contract', chainId, address: addr, contractActionIndex: idx, stakeId },
            searchHaystack: [
                'contract', `#${idx}`, idx, tick, String(s.amount ?? ''), addr,
                s.signing_pubkey,
            ].filter((v) => typeof v === 'string' || typeof v === 'number')
                .join(' ').toLowerCase(),
        });
    }

    // Unstakes whose stake row is already gone (fully releasing
    // positions) still deserve a row until cooldown ends.
    for (const [unstakeIndex, u] of (contractUnstakes || []).filter(isPendingContractUnstake).entries()) {
        const idx = String(u.target_contract_index ?? '?');
        const hasStakeRow = activeContractStakes.some(
            (s) => String(s.target_contract_index ?? '') === idx,
        );
        if (hasStakeRow) continue;
        const addr = String(u._ownerAddress || '');
        const tick = tickText(u.tick, '?');
        const stakeId = `u:${stakeIdentity(u, `${addr}#${unstakeIndex}`)}`;
        rows.push({
            key: `u:${chainId}:${idx}:${stakeId.slice(2)}`,
            kind: 'contract',
            chainId,
            asset: tick,
            name: `Contract #${idx} stake`,
            subtitle: `${fmtAmount(u.amount)} ${tick} releasing`,
            subtitle2: u.cooldown_end_block ? `until block ${String(u.cooldown_end_block)}` : short(addr),
            // With no cooldown block the line is the address: drawn in full when it fits (G99).
            subtitle2Address: u.cooldown_end_block ? null : (addr || null),
            cooldownEndBlock: u.cooldown_end_block ?? null,
            amountLabel: `${fmtAmount(u.amount)} ${tick}`,
            status: 'cooldown',
            blockIndex: u.block_index,
            ref: { kind: 'contract', chainId, address: addr, contractActionIndex: idx, stakeId },
            searchHaystack: [
                'contract', 'cooldown', `#${idx}`, idx, tick,
                String(u.amount ?? ''), addr,
            ].filter((v) => typeof v === 'string' || typeof v === 'number')
                .join(' ').toLowerCase(),
        });
    }

    return rows;
}

function visibleStakingRows(rows, height) {
    return (Array.isArray(rows) ? rows : []).filter((row) => (
        ['active', 'unknown', 'pending', 'unexpected'].includes(stakingRowState(row, height))
    ));
}

/**
 * Has this unstake already been swept back to the owner?
 *
 * `completed` is the indexer's own verdict after the block-end sweep, not a
 * countdown the wallet has to run itself. Per contract-staking.md release is
 * automatic and "there is no intermediate 'release' action", so a completed
 * row means the coins are spendable again and nothing is owed to the user.
 *
 * @param {{ status?: unknown } | null | undefined} unstake
 */
function isReleasedUnstake(unstake) {
    return String(unstake?.status || '').toLowerCase() === 'completed';
}

/**
 * Do these completed unstakes account for the whole staked amount?
 *
 * Compared in base units so a decimal string never rounds its way to a false
 * "fully released". Fails CLOSED: any amount that cannot be parsed exactly
 * returns false and the position keeps its row, because hiding a stake that
 * still exists is far worse than showing one that has ended.
 *
 * @param {Array<{ amount?: unknown }>} completed
 * @param {unknown} stakeAmount
 */
function coversWholeStake(completed, stakeAmount) {
    const staked = toBaseUnits(stakeAmount);
    if (staked === null) return false;
    let sum = 0n;
    for (const u of completed) {
        const units = toBaseUnits(u?.amount);
        if (units === null) return false;
        sum += units;
    }
    return sum >= staked;
}

// A token ticker from the explorer, or the fallback when it is missing or not
// text (a row of the wrong shape must not take the whole list down).
function tickText(value, fallback) {
    return typeof value === 'string' && value.trim() ? value : fallback;
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
    if (Array.isArray(resp)) return scalarRows(resp);
    if (Array.isArray(resp.data)) return scalarRows(resp.data);
    if (Array.isArray(resp.rows)) return scalarRows(resp.rows);
    return [];
}

/** Whether two stake refs name the same position. */
function sameStake(a, b) {
    return Boolean(a && b) && a.kind === b.kind && a.chainId === b.chainId
        && a.address === b.address && String(a.contractActionIndex ?? '') === String(b.contractActionIndex ?? '')
        && String(a.stakeId ?? '') === String(b.stakeId ?? '');
}

/**
 * The identity one stake row carries in its ref, so two stakes on one address
 * never read as the same selection: the stake's id, else its action index,
 * else its tx and vout, else `fallback` (its address and place in the list).
 *
 * @param {any} row
 * @param {string} fallback
 */
function stakeIdentity(row, fallback) {
    const id = row?.stake_id ?? row?.action_index;
    if (id != null && id !== '') return String(id);
    const tx = row?.tx_hash ?? row?.txid ?? row?.tx_index;
    if (tx != null && tx !== '') return `${tx}:${row?.vout ?? row?.output_index ?? 0}`;
    return fallback;
}

function short(addr) {
    if (!addr || typeof addr !== 'string') return '';
    return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
