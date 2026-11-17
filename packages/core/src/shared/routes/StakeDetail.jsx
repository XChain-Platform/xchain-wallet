// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AddressText, Button, EmptyState, Icon, ListPage, ListRow, PageHeader, Screen, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    isDemoWallet,
    synthesizeDemoBalances,
    synthesizeDemoStaking,
    synthesizeDemoContractStakes,
    synthesizeDemoContractMeta,
} from '@xchain-wallet/core/flows';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import {
    compareDecimalStrings,
    expandDecimalNotation,
    formatWithThousands,
    multiplyDecimalStrings,
} from '../utils/amountFormat.js';
import { formatFiatAmount } from '../utils/fiatAmountFormat.js';
import { targetBlockSecondsForCoin } from '../utils/blockDateEstimate.js';
import { explorerPageUrl } from '../utils/explorerLinks.js';
import {
    unclaimedRewards,
    effectiveStakingRows,
    latestEffectiveStakingRow,
    stakingRowState,
    isPendingContractUnstake,
    ownValidatorRow,
    sumStakingAmounts,
    scalarRows,
    scalarRow,
} from '../../flows/stakingDashboard.js';
import { tickerForCoin } from '../../registry/coinTicker.js';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { Sparkline } from '../components/Sparkline.jsx';
import { BEHIND_CHART_FILL, BEHIND_CHART_STROKE, ChartRangeTabs, RANGES as CHART_RANGES, defaultRangeId, rangeWindowStart } from '../components/PortfolioChart.jsx';
import portfolioChartStyles from '../components/PortfolioChart.module.css';
import heroStyles from '../components/TotalBalanceHero.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';
import { useSettings } from '../hooks/useSettings.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { useTickFiatRate } from '../hooks/useFiatRate.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import tokenDetailStyles from './TokenDetail.module.css';
import local from './StakeDetail.module.css';

const chainRegistry = registryLib.defaultRegistry();

// The capability (validator) stake is always in the protocol token.
const STAKING_TICK = 'XCHAIN';

// Stake history uses the exact Home hero range set and ordering.
const STAKE_RANGES = CHART_RANGES;
const CHART_SAMPLES = 60;
const DAY_MS = 86_400_000;
const REWARD_ROWS_SHOWN = 25;
// The demo staking fixtures' tip: just past their last event (block 12,470),
// before the contract cooldown that is still running (block 12,650).
const DEMO_TIP_HEIGHT = 12_500;

/**
 * Stake detail (§42.7.4 drill-in): one staking position, laid out like the
 * coin page (Token Detail). The blue chart hero with the staked amount, two
 * bubbles (Claimable, Earned), then icon tabs: Actions (the shared action
 * list; a locked action is a disabled row with its reason), Rewards and Details.
 *
 * Two kinds, selected by `kind`:
 *   - 'validator': a capability (XCHAIN) stake owned by `address`. Tabs:
 *     Actions / Rewards / Details, plus Validator (uptime, score, votes) when
 *     the chain's validator roster has this address's own row.
 *   - 'contract': tokens `address` staked into contract
 *     `contractActionIndex`. No rewards accrue here, so there are no bubbles;
 *     tabs: Actions / Positions / Penalties / Details.
 *
 * Every action is a disabled row when its handler prop is absent (house
 * pattern: shells thread handlers as the flows exist), with its reason in
 * place of its description.
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
 * @param {(position?: { tick?: string, signingPubkey?: string }) => void} [props.onStakeMore]     add stake; contract kind gets the position's tick (xchain-wallet#34)
 * @param {() => void} [props.onWithdraw]       validator kind: withdraw an ended stake
 * @param {(position?: { tick?: string, signingPubkey?: string }) => void} [props.onStakeAgain]  stake again after the position ended; falls back to onStakeMore
 * @param {() => void} [props.onOpenContract]  contract kind: open ContractDetail
 * @param {() => void} [props.onBack]  the page header's Back; an embedded panel has no header
 * @param {boolean} [props.embedded] drawn as Staking's right panel beside the stake list
 *   (the DEX's embedded MarketView): no Screen or page header of its own, the card
 *   names the stake, and Share stays with the selected stake's actions
 * @param {object | null} [props.preloaded] embedded only: what the stake list already read
 *   for this stake (StakingList's stakePreload), so those reads are not made again
 * @param {(el: HTMLElement | null) => void} [props.measureRef] the page's body box for a
 *   host that measures it (the stake-detail route splits again once wide)
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
    onStakeMore,
    onWithdraw,
    onStakeAgain,
    onOpenContract,
    onBack,
    embedded = false,
    preloaded = null,
    measureRef,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { settings, error: settingsError } = useSettings();
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const locale = settings?.language || 'en-US';
    const [balanceHidden] = useBalancesHidden();
    const isDemo = isDemoWallet(walletId);
    const captionId = useId();
    const tabsId = useId();
    const chartPanelId = useId();

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    // Validator lane.
    const [stakes, setStakes] = useState(/** @type {any[]} */ ([]));
    const [delegations, setDelegations] = useState(/** @type {any[]} */ ([]));
    const [rewards, setRewards] = useState(/** @type {any[]} */ ([]));
    const [rewardClaims, setRewardClaims] = useState(/** @type {any[]} */ ([]));
    // False when the claim ledger could not be read: what is still claimable is
    // accrued minus claimed, so without it the figure is unknown, not the accrual.
    const [claimsKnown, setClaimsKnown] = useState(true);
    // The chain's validator roster; best-effort, it only adds the Validator tab.
    const [validators, setValidators] = useState(/** @type {any[]} */ ([]));
    // Contract lane.
    const [contract, setContract] = useState(/** @type {any} */ (null));
    const [contractStakes, setContractStakes] = useState(/** @type {any[]} */ ([]));
    const [contractUnstakes, setContractUnstakes] = useState(/** @type {any[]} */ ([]));
    const [slashEvents, setSlashEvents] = useState(/** @type {any[]} */ ([]));
    const [height, setHeight] = useState(/** @type {number | null} */ (null));

    // The list's reads for this stake, read at load time (the panel is keyed
    // on the stake, so a later list render never reloads it). The demo wallet
    // draws its fixtures and reads nothing either way.
    const preloadRef = useRef(preloaded);
    preloadRef.current = embedded && !isDemo ? preloaded : null;

    // Actions opens first on every position.
    const [activeTab, setActiveTab] = useState('actions');
    const [rangeId, setRangeId] = useState(defaultRangeId());
    useEffect(() => {
        setActiveTab('actions');
    }, [kind, chainId, address, contractActionIndex]);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setLoadError(null);
            setStakes([]);
            setDelegations([]);
            setRewards([]);
            setRewardClaims([]);
            setClaimsKnown(true);
            setValidators([]);
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

                const pre = preloadRef.current?.kind === kind ? preloadRef.current : null;
                if (kind === 'validator' && pre) {
                    // The stake list read this address's stakes, delegations,
                    // rewards and claims already; only the roster is new here.
                    const v = typeof messaging.getValidatorsForChain === 'function'
                        ? await messaging.getValidatorsForChain({ chainId }).catch(() => [])
                        : [];
                    if (cancelled) return;
                    setStakes(pre.stakes);
                    setDelegations(pre.delegations);
                    setRewards(pre.rewards);
                    setRewardClaims(pre.claimsKnown ? pre.rewardClaims : []);
                    setClaimsKnown(pre.claimsKnown);
                    setValidators(extractRows(v));
                } else if (kind === 'validator') {
                    const [s, d, r, c, v] = await Promise.all([
                        messaging.getStakesForAddress({ chainId, address }),
                        messaging.getDelegationsForAddress({ chainId, address }),
                        messaging.getRewardsForAddress({ chainId, address }),
                        // PC-47: the claim ledger. Without it "pending" cannot
                        // be computed at all (see splitRewards).
                        typeof messaging.getRewardClaimsForAddress === 'function'
                            ? messaging.getRewardClaimsForAddress({ chainId, address }).catch(() => undefined)
                            : Promise.resolve(undefined),
                        typeof messaging.getValidatorsForChain === 'function'
                            ? messaging.getValidatorsForChain({ chainId }).catch(() => [])
                            : Promise.resolve([]),
                    ]);
                    if (cancelled) return;
                    setStakes(extractRows(s));
                    setDelegations(extractRows(d));
                    setRewards(extractRows(r));
                    setRewardClaims(extractRows(c));
                    setClaimsKnown(c !== undefined);
                    setValidators(extractRows(v));
                } else {
                    const idx = String(contractActionIndex ?? '');
                    // Contract metadata (cooldown, slash destination) is
                    // best-effort; the position still renders without it.
                    try {
                        const c = await messaging.getContractByActionIndex({ chainId, contractActionIndex: idx });
                        if (!cancelled) setContract(scalarRow(c?.data ?? c));
                    } catch { /* metadata optional */ }
                    // Position queries are a Phase 7 follow-up for live
                    // wallets; degrade each lane silently to empty. The stake
                    // list read the stakes and unstakes already when it hands
                    // them over; the penalties are new here.
                    const [s, u, ev] = await Promise.all([
                        pre ? pre.contractStakes : messaging.getContractStakesForAddress({ chainId, address }).catch(() => []),
                        pre ? pre.contractUnstakes : messaging.getContractUnstakesForAddress({ chainId, address }).catch(() => []),
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
        // The demo fixtures sit near block 12,400, so the demo reads its tip
        // from them, not from the live chain, whose tip would date every demo
        // event years back.
        if (isDemoWallet(walletId)) {
            setHeight(DEMO_TIP_HEIGHT);
            return undefined;
        }
        // The stake list's tip for this chain, when it read one.
        const listTip = preloadRef.current?.height;
        if (Number.isFinite(listTip)) {
            setHeight(listTip);
            return undefined;
        }
        if (typeof messaging.getIndexerWatermark !== 'function') return undefined;
        messaging.getIndexerWatermark({ chainId })
            .then((result) => {
                if (!cancelled) setHeight(Number.isFinite(result?.watermark) ? result.watermark : null);
            })
            .catch(() => { if (!cancelled) setHeight(null); });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    const descriptor = chainRegistry.get(chainId);
    const blockSeconds = targetBlockSecondsForCoin(descriptor?.coin);
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
    const ownValidator = useMemo(
        () => (kind === 'validator' ? ownValidatorRow({ validators, signingPubkey: delegatedKey, address }) : null),
        [kind, validators, delegatedKey, address],
    );
    // A stake that has not reached its activation block is staked, locked, and
    // listed as such on the staking list, so the detail reports it too.
    const lockedStakes = useMemo(
        () => stakes.filter((row) => stakingRowState(row, height) === 'pending'),
        [stakes, height],
    );
    const totalValidatorStaked = useMemo(
        () => sumStakingAmounts([...activeStakes, ...lockedStakes]),
        [activeStakes, lockedStakes],
    );
    const shownStake = primaryStake || lockedStakes[0] || null;
    const { pending, lifetime } = useMemo(
        () => splitRewards(rewards, rewardClaims),
        [rewards, rewardClaims],
    );
    const totalContractStaked = useMemo(
        () => sumStakingAmounts(activeContractStakes),
        [activeContractStakes],
    );
    const contractTick = activeContractStakes[0]?.tick || pendingContractUnstakes[0]?.tick || contract?.tick || '';
    const hasContractPosition = activeContractStakes.length > 0 || pendingContractUnstakes.length > 0;

    const isValidator = kind === 'validator';
    const tick = isValidator ? (shownStake?.asset || STAKING_TICK) : contractTick;
    const stakedAmount = isValidator ? totalValidatorStaked : totalContractStaked;
    const hasPosition = isValidator ? Boolean(shownStake) : hasContractPosition;
    // Ended: the address staked here once, and nothing is staked or cooling now.
    const ended = isValidator
        ? !shownStake && stakes.length > 0
        : !hasContractPosition && (contractStakes.length > 0 || contractUnstakes.length > 0);

    // Quick actions hand the position's token + signing pubkey to the caller
    // so a shell can seed ContractStakeForm from THIS position instead of
    // letting the form fall back to its own generic defaults (XCHAIN, blank
    // pubkey) - a position on a non-XCHAIN token otherwise lands the user on
    // a form that does not match what they clicked (xchain-wallet#34).
    const contractPositionSeed = !isValidator
        ? { tick: contractTick, signingPubkey: activeContractStakes[0]?.signing_pubkey || '' }
        : null;

    // Fiat: the wallet's own price source for this token, on the same terms
    // as the coin page (mainnet or the demo wallet, not on a test network).
    // The demo wallet prices its holdings from the balance fixture.
    const fiatSupported = isDemo || (settings
        ? settings.activeNetwork !== 'testnet' && settings.activeNetwork !== 'regtest'
        : Boolean(settingsError) || descriptor?.networkKind === 'mainnet');
    const fiatAllowed = isDemo || descriptor?.networkKind === 'mainnet';
    const liveRate = useTickFiatRate({
        chainCoin: descriptor?.coin,
        tick,
        nativeTicker: descriptor?.coin ? tickerForCoin(descriptor.coin) : null,
        fiatCurrency,
        allowCoingeckoFallback: Boolean(settings) && settings?.privacy?.priceDataEnabled !== false,
        enabled: !isDemo && fiatSupported && fiatAllowed && Boolean(tick),
    });
    const demoRate = useMemo(() => (isDemo ? demoFiatRate(chainId, address, tick) : null), [isDemo, chainId, address, tick]);
    const fiatRate = fiatSupported && fiatAllowed
        ? (isDemo ? demoRate : positiveNumber(liveRate?.rate))
        : null;
    const fiatOf = (amount) => fiatText(amount, fiatRate, fiatCurrency, locale);

    // The solid line is stake principal only. Validator reward accrual and
    // valid COLLECT rows form the pending-reward balance for the dashed line.
    const stakedEvents = useMemo(() => positionEvents({
        kind, stakes, contractStakes, contractUnstakes, slashEvents, height, blockSeconds,
    }), [kind, stakes, contractStakes, contractUnstakes, slashEvents, height, blockSeconds]);
    const rewardEvents = useMemo(
        () => pendingRewardEvents({ rewards, claims: rewardClaims, height, blockSeconds }),
        [rewards, rewardClaims, height, blockSeconds],
    );
    const range = STAKE_RANGES.find((item) => item.id === rangeId) || STAKE_RANGES[0];
    const series = useMemo(() => {
        const now = Date.now();
        const staked = balanceSeries(stakedEvents, range, now);
        const pendingRewards = isValidator && claimsKnown && rewardEvents.length > 0
            ? balanceSeries(rewardEvents, range, now)
            : null;
        return {
            staked,
            stakedWithRewards: staked && pendingRewards
                ? staked.map((amount, index) => amount + pendingRewards[index])
                : null,
        };
    }, [stakedEvents, rewardEvents, range, isValidator, claimsKnown]);

    const shareUrl = explorerPageUrl({ chainId, kind: 'address', value: address, settings });
    const share = () => {
        if (!shareUrl) return;
        const nav = typeof navigator !== 'undefined' ? navigator : null;
        if (typeof nav?.share === 'function') {
            nav.share({ title: 'Stake', url: shareUrl }).catch(() => { /* the share sheet was closed */ });
        } else if (typeof nav?.clipboard?.writeText === 'function') {
            nav.clipboard.writeText(shareUrl).catch(() => { /* clipboard refused */ });
        }
    };

    const title = isValidator ? 'Validator Stake' : `Contract #${contractActionIndex} Stake`;
    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to staking"
            title={title}
            trailing={shareUrl ? (
                <Button
                    type="button"
                    size="md"
                    variant="secondary"
                    className={tokenDetailStyles.explorerButton}
                    icon={<Icon.UploadIcon />}
                    onClick={share}
                    aria-label="Share this stake"
                    title="Share this stake"
                >
                    {null}
                </Button>
            ) : null}
        />
    );
    const wrap = (children) => {
        const page = <ListPage className={tokenDetailStyles.detailPage}>{children}</ListPage>;
        // Staking's right panel sits inside the stake list's Screen, which owns
        // the page header, the scroller and the shell notices.
        if (embedded) return page;
        return (
            <Screen variant={variant} header={header}>
                {measureRef ? (
                    // The host's measured box (the stake-detail route), the
                    // stake list's own box around a page of the same width.
                    <div ref={measureRef} className={local.measureBox} data-list-detail="page">{page}</div>
                ) : page}
            </Screen>
        );
    };

    if (loading) return wrap(<StatusMessage variant="status">Loading staking position…</StatusMessage>);
    if (loadError) return wrap(<StatusMessage variant="error">{loadError}</StatusMessage>);

    const change = rangeChangeLine(series.stakedWithRewards || series.staked, { tick, fiatRate, fiatCurrency, locale });
    const chartTone = change?.direction === 'positive' ? 'up' : change?.direction === 'negative' ? 'down' : 'unchanged';
    const formatChartAmount = (value) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }).format(value)}${tick ? ` ${tick}` : ''}`;
    // An unreadable amount shows as "-", never as a guessed zero.
    const stakedText = hasPosition ? fmt(stakedAmount) : '0';
    const stakedFiat = hasPosition ? fiatOf(stakedAmount) : null;

    const tabLabel = (IconGlyph, text) => (
        <span className={homeTabsStyles.tabWithIcon}><span className={homeTabsStyles.tabIcon} aria-hidden="true"><IconGlyph /></span>{text}</span>
    );
    const tabs = isValidator
        ? [
            { id: 'actions', label: tabLabel(Icon.ZapIcon, 'Actions') },
            { id: 'rewards', label: tabLabel(Icon.CoinsIcon, 'Rewards') },
            { id: 'details', label: tabLabel(Icon.InfoIcon, 'Details') },
            // Only an address with its own roster row is a validator.
            ...(ownValidator ? [{ id: 'validator', label: tabLabel(Icon.VerifyIcon, 'Validator') }] : []),
        ]
        : [
            { id: 'actions', label: tabLabel(Icon.ZapIcon, 'Actions') },
            { id: 'positions', label: tabLabel(Icon.StakeIcon, 'Positions') },
            { id: 'slashes', label: tabLabel(Icon.ThumbsDownIcon, 'Penalties') },
            { id: 'details', label: tabLabel(Icon.InfoIcon, 'Details') },
        ];

    const tiles = [...(isValidator
        ? validatorTiles({
            onStakeMore, onUnstake, onClaimRewards, onDelegate, onRevokeDelegation, onWithdraw, onStakeAgain,
            primaryStake, lockedStakes, primaryDelegation, claimsKnown, pending, ended, height, blockSeconds,
        })
        : contractTiles({
            onStakeMore, onUnstake, onDelegate, onOpenContract, onStakeAgain, seed: contractPositionSeed,
            activeContractStakes, ended,
        })), ...(shareUrl ? [{
            id: 'share',
            label: 'Share',
            description: "Share this stake's explorer link",
            Icon: Icon.ShareIcon,
            onSelect: share,
            reason: null,
        }] : [])];

    return wrap(
        <>
            {isValidator && !claimsKnown ? (
                <StatusMessage variant="error">
                    Couldn't load your claimed rewards, so the amount you can claim is unknown. Try again later.
                </StatusMessage>
            ) : null}

            {/* The blue card, built like Home's and the coin page's: the change
                pill, the staked amount and its fiat value, the balance line
                behind them and the range chips along its foot. */}
            <div className={`${homeTabsStyles.heroStack} ${homeTabsStyles.heroStackWithChart}`}>
                {/* The page header names the stake on its own page; in Staking's
                    right panel the card's caption does, as the market card
                    names its pair beside the DEX list. */}
                <section className={embedded ? heroStyles.hero : `${heroStyles.hero} ${tokenDetailStyles.cardNoCaption}`} aria-labelledby={captionId}>
                    <div className={heroStyles.row}>
                        <span id={captionId} className={`${heroStyles.label} ${local.chartLegend}`}>
                            {embedded ? <span className={local.positionTitle}>{title}</span> : null}
                            <span className={local.legendItem}>
                                <span className={local.legendDot} data-chart-tone={chartTone} aria-hidden="true" />
                                Staked
                            </span>
                            {series.stakedWithRewards ? (
                                <span className={local.legendItem}>
                                    <span className={local.legendDash} data-chart-tone={chartTone} aria-hidden="true" />
                                    Staked + rewards
                                </span>
                            ) : isValidator && claimsKnown && compareDecimalStrings(pending, '0') === 1 && !balanceHidden ? (
                                <span className={local.unclaimedCaption}>{`+${fmt(pending)} ${tick || STAKING_TICK} unclaimed`}</span>
                            ) : null}
                        </span>
                        <div
                            className={heroStyles.amount}
                            aria-label={balanceHidden ? 'Balance hidden' : `${stakedText} ${tick} staked`.replace(/\s+/g, ' ')}
                        >
                            {balanceHidden ? (
                                <span className={heroStyles.hidden}>•••••</span>
                            ) : (
                                <>
                                    <span className={heroStyles.amountValue}>{stakedText}</span>
                                    <span className={heroStyles.amountCode}>{tick ? `${tick} staked` : 'staked'}</span>
                                </>
                            )}
                        </div>
                    </div>
                    <div className={heroStyles.meta} role="group" aria-label="Stake summary">
                        <span className={heroStyles.metaLeft}>
                            {balanceHidden ? (
                                <span className={`${heroStyles.hidden} ${heroStyles.hiddenChange}`} aria-label="Balance hidden">••••</span>
                            ) : change ? (
                                <span
                                    className={change.direction === 'positive' ? heroStyles.changePositive : change.direction === 'negative' ? heroStyles.changeNegative : heroStyles.changeNeutral}
                                    aria-label={`${range.label} change ${change.text}`}
                                >
                                    {change.text}
                                </span>
                            ) : (
                                // No history yet: an unseen pill keeps the row's height.
                                <span className={`${heroStyles.hiddenChange} ${tokenDetailStyles.cardChangeIdle}`} aria-hidden="true">••••</span>
                            )}
                        </span>
                    </div>
                    {stakedFiat && !balanceHidden ? (
                        <div className={`${tokenDetailStyles.cardSecondary} ${local.heroFiat}`}>
                            <span>{`≈ ${stakedFiat}`}</span>
                        </div>
                    ) : null}
                </section>
                <section
                    className={`${portfolioChartStyles.wrap} ${portfolioChartStyles.behind}${balanceHidden ? ` ${portfolioChartStyles.behindHidden}` : ''}`}
                    data-chart-behind="true"
                    aria-label="Staked balance chart"
                >
                    <div id={chartPanelId} role="tabpanel" aria-labelledby={`${chartPanelId}-tab-${range.id}`}>
                        <div className={portfolioChartStyles.slot}>
                            {series.staked ? (
                                <div className={portfolioChartStyles.chart}>
                                    <Sparkline
                                        series={series.staked}
                                        secondarySeries={series.stakedWithRewards}
                                        secondaryLabel="Staked + rewards"
                                        secondaryDashed
                                        stepped
                                        height="100%"
                                        strokeColor={BEHIND_CHART_STROKE}
                                        areaFill={BEHIND_CHART_FILL}
                                        edgeToEdge
                                        heroScale
                                        showScale
                                        label="Staked"
                                        rangeLabel={range.label}
                                        formatValue={formatChartAmount}
                                        formatScaleValue={formatChartAmount}
                                    />
                                </div>
                            ) : null}
                        </div>
                    </div>
                    {/* With no history the chips keep their room unseen, as on the coin page. */}
                    <ChartRangeTabs
                        panelId={chartPanelId}
                        ranges={STAKE_RANGES}
                        rangeId={range.id}
                        onSelect={setRangeId}
                        className={series.staked ? '' : tokenDetailStyles.rangesIdle}
                    />
                </section>
            </div>

            {isValidator ? (
                <div className={local.bubbles} role="group" aria-label="Rewards summary">
                    <RewardBubble
                        label="Claimable"
                        amount={claimsKnown ? pending : null}
                        fiat={claimsKnown ? fiatOf(pending) : null}
                        hidden={balanceHidden}
                    />
                    <RewardBubble
                        label="Earned"
                        amount={lifetime}
                        fiat={fiatOf(lifetime)}
                        hidden={balanceHidden}
                    />
                </div>
            ) : null}

            <Tabs
                id={tabsId}
                className={tokenDetailStyles.detailTabs}
                aria-label="Stake detail view"
                items={tabs}
                value={activeTab}
                onChange={setActiveTab}
                panelId={`${tabsId}-panel`}
            />

            <div
                id={`${tabsId}-panel`}
                className={tokenDetailStyles.tabPanel}
                role="tabpanel"
                aria-labelledby={`${tabsId}-tab-${activeTab}`}
            >
                {activeTab === 'actions' ? <StakeActionsPanel tiles={tiles} /> : null}

                {activeTab === 'rewards' ? (
                    <RewardsPanel
                        rewards={rewards}
                        claims={rewardClaims}
                        tick={tick || STAKING_TICK}
                        height={height}
                        blockSeconds={blockSeconds}
                        fiatOf={fiatOf}
                        hidden={balanceHidden}
                    />
                ) : null}

                {activeTab === 'positions' ? (
                    activeContractStakes.length === 0 && pendingContractUnstakes.length === 0 ? (
                        <EmptyState title="No contract positions" body="Staking positions for this contract appear here." />
                    ) : (
                        <ul className={local.eventList} aria-label="Contract positions">
                            {activeContractStakes.map((s, i) => (
                                <li key={`s:${String(s.action_index ?? i)}:${i}`}>
                                    <ListRow
                                        title={<span className={local.eventAmount}>{fmt(s.amount)} {detailText(s.tick)}</span>}
                                        subtitle={<span className={local.eventMeta}>
                                            key <code>{s.signing_pubkey || 'None'}</code>
                                        </span>}
                                        trailing={<span className={local.eventWhen}>staked</span>}
                                    />
                                </li>
                            ))}
                            {pendingContractUnstakes.map((u, i) => (
                                <li key={`u:${String(u.action_index ?? i)}:${i}`}>
                                    <ListRow
                                        title={<span className={local.eventAmount}>{fmt(u.amount)} {detailText(u.tick)}</span>}
                                        subtitle={<span className={local.eventMeta}>
                                            releasing, can still be penalized until block {rawNumber(u.cooldown_end_block)}
                                        </span>}
                                        trailing={<span className={local.eventWhen}>cooldown</span>}
                                    />
                                </li>
                            ))}
                        </ul>
                    )
                ) : null}

                {activeTab === 'slashes' ? (
                    slashEvents.length === 0 ? (
                        <EmptyState title="No penalties" body="Any penalty taken from this position appears here." />
                    ) : (
                        <ul className={local.eventList} aria-label="Penalties">
                            {slashEvents.slice(0, REWARD_ROWS_SHOWN).map((ev, i) => (
                                <li key={`sl:${i}`}>
                                    <ListRow
                                        title={<span className={local.slashAmount}>{ev.amount == null || ev.amount === '' ? '-' : `-${fmt(ev.amount)}`} {detailText(ev.tick)}</span>}
                                        subtitle={<span className={local.eventMeta}>
                                            to <AddressText address={detailText(ev.destination_address || ev.destination)} truncate={false} />
                                        </span>}
                                        trailing={<span className={local.eventWhen}>
                                            {ev.block_index ? `block ${rawNumber(ev.block_index)}` : '-'}
                                        </span>}
                                    />
                                </li>
                            ))}
                        </ul>
                    )
                ) : null}

                {activeTab === 'validator' && ownValidator ? (
                    <ValidatorPanel row={ownValidator} signingKey={delegatedKey} />
                ) : null}

                {activeTab === 'details' ? (
                    <ul className={local.eventList} aria-label="Stake details">
                        {isValidator ? (
                            <ValidatorDetailRows
                                shownStake={shownStake}
                                primaryStake={primaryStake}
                                primaryDelegation={primaryDelegation}
                                delegatedKey={delegatedKey}
                                height={height}
                                blockSeconds={blockSeconds}
                                valueNow={stakedFiat}
                                hidden={balanceHidden}
                            />
                        ) : (
                            <ContractDetailRows
                                contractActionIndex={contractActionIndex}
                                contract={contract}
                                firstStake={activeContractStakes[0] || null}
                                pendingUnstakes={pendingContractUnstakes}
                                height={height}
                                blockSeconds={blockSeconds}
                                valueNow={stakedFiat}
                                hidden={balanceHidden}
                            />
                        )}
                    </ul>
                ) : null}
            </div>
        </>,
    );
}

/** One of the two bubbles under the hero: label, amount (no ticker) and fiat, centred. */
function RewardBubble({ label, amount, fiat, hidden }) {
    return (
        <div className={local.bubble}>
            <span className={local.bubbleLabel}>{label}</span>
            <span className={local.bubbleAmount}>{hidden ? '••••' : ltr(amount == null ? '-' : fmt(amount))}</span>
            {fiat && !hidden ? <span className={local.bubbleFiat}>{ltr(`≈ ${fiat}`)}</span> : null}
        </div>
    );
}

/**
 * The Actions tab: the shared action list (G101), a row per action with its
 * icon, title and what it does. A locked action is a disabled row that shows
 * its reason in place of the description.
 */
function StakeActionsPanel({ tiles }) {
    return (
        <ActionList label="Stake actions">
            {tiles.map((tile) => {
                const TileIcon = tile.Icon;
                return (
                    <ActionListItem
                        key={tile.id}
                        data-action-id={tile.id}
                        icon={<TileIcon />}
                        title={tile.label}
                        description={tile.description}
                        onClick={tile.reason ? undefined : tile.onSelect}
                        disabled={Boolean(tile.reason)}
                        disabledReason={tile.reason ? sentenceStart(tile.reason) : undefined}
                    />
                );
            })}
        </ActionList>
    );
}

// The reasons read as the tail of "Unstake: nothing is staked.", so a row that
// shows one on its own starts it with a capital.
function sentenceStart(text) {
    return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

const NOT_WIRED = 'not available in this wallet yet.';

function validatorTiles({
    onStakeMore, onUnstake, onClaimRewards, onDelegate, onRevokeDelegation, onWithdraw, onStakeAgain,
    primaryStake, lockedStakes, primaryDelegation, claimsKnown, pending, ended, height, blockSeconds,
}) {
    // Leaving: an unstake (or an eviction) stamps the deactivation block, and
    // the stake still counts until then.
    const deactivation = Number(primaryStake?.deactivation_block ?? primaryStake?.DEACTIVATION_BLOCK);
    const unstaking = Number.isFinite(deactivation) && deactivation > 0 && height != null && deactivation > height;
    const cooldownReason = unstaking
        ? `locked while the stake's cooldown runs${leftText(deactivation - height, blockSeconds)}.`
        : null;
    const activation = Number(lockedStakes[0]?.activation_block ?? lockedStakes[0]?.ACTIVATION_BLOCK);
    const activationReason = !primaryStake && lockedStakes.length > 0 && Number.isFinite(activation) && height != null
        ? `the stake is locked until it activates at block ${rawNumber(activation)}${leftText(activation - height, blockSeconds)}.`
        : null;
    const noStakeReason = activationReason || (ended ? 'the stake has ended.' : 'nothing is staked.');
    const tile = (id, label, description, IconGlyph, onSelect, stateReason) => ({
        id,
        label,
        description,
        Icon: IconGlyph,
        onSelect,
        reason: typeof onSelect !== 'function' ? NOT_WIRED : stateReason,
    });
    const claimReason = !claimsKnown
        ? 'claimed rewards could not be loaded.'
        : compareDecimalStrings(pending, '0') !== 1 ? 'no rewards to claim yet.' : null;
    const tiles = [
        tile('add-stake', 'Add stake', 'Put more tokens into this stake', Icon.PlusIcon, onStakeMore ? () => onStakeMore() : undefined,
            ended ? 'the stake has ended.' : cooldownReason),
        tile('unstake', 'Unstake', 'Start the cooldown that returns your stake', Icon.UnlockIcon, onUnstake ? () => onUnstake() : undefined,
            cooldownReason || (primaryStake ? null : noStakeReason)),
        tile('claim', 'Claim', 'Collect the rewards this stake has earned', Icon.CoinsIcon, onClaimRewards, claimReason),
        tile('delegate', 'Delegate', 'Name the signing key that validates for this stake', Icon.KeyIcon, onDelegate ? () => onDelegate() : undefined,
            primaryStake ? null : noStakeReason),
        tile('revoke', 'Revoke', 'Take back the delegated signing key', Icon.UnlinkIcon, onRevokeDelegation,
            primaryDelegation ? null : 'no delegated key to revoke.'),
    ];
    if (ended) {
        const again = onStakeAgain || onStakeMore;
        // StakingForm has no withdraw action for a network stake (the chain
        // returns it on its own), so the tile shows only when a shell wires one.
        if (typeof onWithdraw === 'function') {
            tiles.push(tile('withdraw', 'Withdraw', 'Return the ended stake to your address', Icon.DownloadIcon, onWithdraw, null));
        }
        tiles.push(tile('stake-again', 'Stake again', 'Start a new stake from this address', Icon.StakeIcon, again ? () => again() : undefined, null));
    }
    return tiles;
}

function contractTiles({ onStakeMore, onUnstake, onDelegate, onOpenContract, onStakeAgain, seed, activeContractStakes, ended }) {
    const tile = (id, label, description, IconGlyph, handler, stateReason, withSeed = true) => ({
        id,
        label,
        description,
        Icon: IconGlyph,
        onSelect: typeof handler === 'function' ? () => (withSeed ? handler(seed) : handler()) : undefined,
        reason: typeof handler !== 'function' ? NOT_WIRED : stateReason,
    });
    const noStake = activeContractStakes.length === 0 ? (ended ? 'the stake has ended.' : 'nothing is staked.') : null;
    // A contract stake has no withdraw step: the chain returns it when the
    // cooldown ends, so an ended contract position offers only Stake Again.
    const tiles = [
        tile('add-stake', 'Add stake', 'Put more tokens into this contract', Icon.PlusIcon, onStakeMore, ended ? 'the stake has ended.' : null),
        tile('unstake', 'Unstake', 'Start the cooldown that releases your tokens', Icon.UnlockIcon, onUnstake, noStake),
        tile('delegate', 'Delegate', 'Name the signing key for this position', Icon.KeyIcon, onDelegate, noStake),
        tile('view-contract', 'View contract', 'Open the contract this stake is in', Icon.ContractIcon, onOpenContract, null, false),
    ];
    if (ended) tiles.push(tile('stake-again', 'Stake again', 'Start a new stake in this contract', Icon.StakeIcon, onStakeAgain || onStakeMore, null));
    return tiles;
}

/**
 * The Rewards tab: one list, newest first, of what was earned and what was
 * claimed. A claim the chain refused moved nothing, so it is not listed.
 */
function RewardsPanel({ rewards, claims, tick, height, blockSeconds, fiatOf, hidden }) {
    const rows = useMemo(() => {
        const earned = rewards.map((r, i) => ({ key: `e:${String(r.id ?? r.action_index ?? i)}:${i}`, type: 'earned', row: r }));
        const claimed = claims
            .filter((c) => String(c?.status ?? '') === 'valid')
            .map((c, i) => ({ key: `c:${String(c.action_index ?? i)}:${i}`, type: 'claimed', row: c }));
        return [...earned, ...claimed].sort((a, b) => blockOf(b.row) - blockOf(a.row));
    }, [rewards, claims]);
    if (rows.length === 0) {
        return <EmptyState title="No rewards yet" body="Rewards this stake earns and claims you make appear here." />;
    }
    const now = Date.now();
    return (
        <>
            <ul className={local.eventList} aria-label="Reward events">
                {rows.slice(0, REWARD_ROWS_SHOWN).map(({ key, type, row }) => {
                    const amount = row.amount ?? row.reward;
                    const amountText = fmt(amount);
                    const fiat = amountText === '-' ? null : fiatOf(amount);
                    return (
                        <li key={key}>
                            <ListRow
                                title={type === 'earned' ? 'Earned' : 'Claimed'}
                                subtitle={<span className={local.eventMeta}>{whenText(row, height, blockSeconds, now)}</span>}
                                trailing={(
                                    <span className={local.rewardValue}>
                                        <span className={type === 'earned' ? local.rewardEarned : local.eventAmount}>
                                            {hidden ? '••••' : ltr(`${type === 'earned' && amountText !== '-' ? '+' : ''}${amountText} ${tick}`)}
                                        </span>
                                        {fiat && !hidden ? <span className={local.rewardFiat}>{ltr(fiat)}</span> : null}
                                    </span>
                                )}
                            />
                        </li>
                    );
                })}
            </ul>
            {rows.length > REWARD_ROWS_SHOWN ? (
                <p className={local.eventMeta}>Showing the latest {REWARD_ROWS_SHOWN} of {fmt(rows.length)} reward events.</p>
            ) : null}
        </>
    );
}

const VALIDATOR_METRICS = ['uptime', 'score', 'votes', 'missed', 'last_seen_block'];

/**
 * The Validator tab: this address's own roster row as label and value rows.
 * A row with no figures yet means the validator has not taken part in a round.
 */
function ValidatorPanel({ row, signingKey }) {
    const has = (field) => row[field] !== undefined && row[field] !== null && row[field] !== '';
    if (!VALIDATOR_METRICS.some(has)) {
        return (
            <EmptyState
                title="Validator not active yet"
                body="Uptime, score and votes appear once this validator takes part in a round."
            />
        );
    }
    const status = String(row.status ?? row.STATUS ?? '').trim().toLowerCase();
    const active = status ? ['active', 'valid', 'open'].includes(status) : true;
    return (
        <ul className={local.eventList} aria-label="Validator performance">
            <DetailRow label="Status">{active ? 'Active' : 'Not active yet'}</DetailRow>
            {has('uptime') ? <DetailRow label="Uptime">{metricAmountText(row.uptime)}</DetailRow> : null}
            {has('score') ? <DetailRow label="Score">{metricAmountText(row.score)}</DetailRow> : null}
            {has('votes') ? <DetailRow label="Votes recorded">{metricAmountText(row.votes)}</DetailRow> : null}
            {has('missed') ? <DetailRow label="Missed">{metricAmountText(row.missed)}</DetailRow> : null}
            {has('last_seen_block') ? <DetailRow label="Last seen block">{metricText(row.last_seen_block)}</DetailRow> : null}
            {signingKey ? (
                <DetailRow label="Signing key">
                    <AddressText address={signingKey} />
                </DetailRow>
            ) : null}
        </ul>
    );
}

// A roster figure as text: control characters stripped and length capped,
// since the roster is chain data, not ours.
function metricText(value) {
    const type = typeof value;
    if (!['string', 'number', 'bigint', 'boolean'].includes(type) || (type === 'number' && !Number.isFinite(value))) return '-';
    return neutralizeControlText(value, { maxLength: 128 }) || '-';
}

function metricAmountText(value) {
    const text = metricText(value);
    const match = /^(-?\d+(?:\.\d+)?)(.*)$/.exec(text);
    return match ? `${formatWithThousands(match[1])}${match[2]}` : text;
}

function DetailRow({ label, children }) {
    return (
        <li>
            <ListRow title={label} trailing={<span className={local.detailValue}>{children}</span>} />
        </li>
    );
}

function ValidatorDetailRows({ shownStake, primaryStake, primaryDelegation, delegatedKey, height, blockSeconds, valueNow, hidden }) {
    const now = Date.now();
    const role = shownStake?.capability_label || shownStake?.capability || '';
    const stakedAt = blockDate(shownStake?.block_index, height, blockSeconds, now);
    const delegatedAt = delegatedKey ? blockDate(primaryDelegation?.block_index, height, blockSeconds, now) : null;
    const activeDays = primaryStake && stakedAt ? Math.max(0, Math.floor((now - stakedAt.getTime()) / DAY_MS)) : null;
    const activation = Number(shownStake?.activation_block ?? shownStake?.ACTIVATION_BLOCK);
    const deactivation = Number(shownStake?.deactivation_block ?? shownStake?.DEACTIVATION_BLOCK);
    const pendingActivation = !primaryStake && Number.isFinite(activation) && activation > 0;
    const unstaking = Number.isFinite(deactivation) && deactivation > 0 && height != null && deactivation > height;
    return (
        <>
            {role ? <DetailRow label="Validator">{role}</DetailRow> : null}
            {delegatedKey ? (
                <DetailRow label="Delegated to"><AddressText address={delegatedKey} /></DetailRow>
            ) : null}
            {delegatedAt ? <DetailRow label="Since">{approxDate(delegatedAt)}</DetailRow> : null}
            {stakedAt ? <DetailRow label="Staked on">{approxDate(stakedAt)}</DetailRow> : null}
            {activeDays != null ? <DetailRow label="Active days">{`about ${fmt(activeDays)}`}</DetailRow> : null}
            {valueNow ? <DetailRow label="Value now">{hidden ? '••••' : ltr(valueNow)}</DetailRow> : null}
            {pendingActivation ? <DetailRow label="Lock terms">{`Locked until block ${rawNumber(activation)}`}</DetailRow> : null}
            {unstaking ? <DetailRow label="Lock terms">{`Cooldown until block ${rawNumber(deactivation)}`}</DetailRow> : null}
            {unstaking ? (
                <DetailRow label="Cooldown left">{cooldownLeft(deactivation - height, blockSeconds)}</DetailRow>
            ) : null}
        </>
    );
}

function ContractDetailRows({ contractActionIndex, contract, firstStake, pendingUnstakes, height, blockSeconds, valueNow, hidden }) {
    const now = Date.now();
    const stakedAt = blockDate(firstStake?.block_index, height, blockSeconds, now);
    const cooldownBlocks = Number(contract?.cooldown_blocks);
    const releaseBlock = pendingUnstakes.reduce((max, u) => {
        const end = Number(u?.cooldown_end_block);
        return Number.isFinite(end) && end > max ? end : max;
    }, 0);
    const cooling = releaseBlock > 0 && height != null && releaseBlock > height;
    return (
        <>
            <DetailRow label="Contract">#{contractActionIndex}</DetailRow>
            {contract?.tick ? <DetailRow label="Contract token">{contract.tick}</DetailRow> : null}
            {stakedAt ? <DetailRow label="Staked on">{approxDate(stakedAt)}</DetailRow> : null}
            {valueNow ? <DetailRow label="Value now">{hidden ? '••••' : ltr(valueNow)}</DetailRow> : null}
            {Number.isFinite(cooldownBlocks) && contract?.cooldown_blocks != null ? (
                <DetailRow label="Lock terms">
                    {`${fmt(cooldownBlocks)} block cooldown to unstake${leftText(cooldownBlocks, blockSeconds, '')}`}
                </DetailRow>
            ) : null}
            {cooling ? <DetailRow label="Cooldown left">{cooldownLeft(releaseBlock - height, blockSeconds)}</DetailRow> : null}
            {contract?.slash_destination ? (
                <DetailRow label="Penalty destination">
                    <AddressText address={String(contract.slash_destination)} truncate={false} />
                </DetailRow>
            ) : null}
        </>
    );
}

// An amount with its unit reads left to right inside a right-to-left page, so
// the number stays in front of the unit.
function ltr(text) {
    return <bdi dir="ltr">{text}</bdi>;
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

// Block heights and indexes are identifiers, so they keep raw digits.
function rawNumber(value) {
    return detailText(value);
}

function positiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

// The demo wallet prices its tokens from its own balance fixture.
function demoFiatRate(chainId, address, tick) {
    if (!tick) return null;
    const rows = synthesizeDemoBalances({ [chainId]: [{ address, label: '', addressType: '', derivationPath: null }] })?.[chainId];
    const token = rows?.[0]?.balances?.tokens?.find((row) => row.tick === tick);
    return positiveNumber(token?.fiatRate);
}

function fiatText(amount, rate, currency, locale) {
    if (rate == null || amount == null || amount === '') return null;
    const value = multiplyDecimalStrings(expandDecimalNotation(String(amount)), expandDecimalNotation(String(rate)));
    if (value == null) return null;
    return formatFiatAmount(value, currency, locale) || null;
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return scalarRows(resp);
    if (Array.isArray(resp.data)) return scalarRows(resp.data);
    if (Array.isArray(resp.rows)) return scalarRows(resp.rows);
    return [];
}

function blockOf(row) {
    const n = Number(row?.block_index);
    return Number.isFinite(n) ? n : -Infinity;
}

// Wall-clock time of a block, projected from the indexed tip at the chain's
// target block interval; null when either height is unknown.
function blockTimeMs(block, height, blockSeconds, now) {
    const b = Number(block);
    if (!blockSeconds || block == null || block === '' || !Number.isFinite(b) || b <= 0) return null;
    if (height == null || !Number.isFinite(Number(height))) return null;
    return now + (b - Number(height)) * blockSeconds * 1000;
}

function blockDate(block, height, blockSeconds, now) {
    const ms = blockTimeMs(block, height, blockSeconds, now);
    return ms == null ? null : new Date(ms);
}

// A projected date is marked with a tilde: block times vary around the target.
function approxDate(date) {
    return `~${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// Line 2 of a reward row: the row's own time when it has one, else its
// block's projected date, else the block.
function whenText(row, height, blockSeconds, now) {
    const stamp = row?.timestamp ?? row?.block_time;
    if (stamp != null && stamp !== '') {
        const n = Number(stamp);
        const ms = Number.isFinite(n) && n > 0 ? (n > 1e12 ? n : n * 1000) : Date.parse(String(stamp));
        if (Number.isFinite(ms)) {
            return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        }
    }
    const date = blockDate(row?.block_index, height, blockSeconds, now);
    if (date) return approxDate(date);
    return row?.block_index ? `Block ${rawNumber(row.block_index)}` : '-';
}

// "about 1 day 6 hours" for a block count at the chain's target interval.
function durationText(blocks, blockSeconds) {
    if (!blockSeconds || !Number.isFinite(blocks) || blocks <= 0) return null;
    const minutes = Math.max(1, Math.round((blocks * blockSeconds) / 60));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    const part = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
    if (days > 0) return `about ${part(days, 'day')}${hours > 0 ? ` ${part(hours, 'hour')}` : ''}`;
    if (hours > 0) return `about ${part(hours, 'hour')}`;
    return `about ${part(mins, 'minute')}`;
}

function leftText(blocks, blockSeconds, suffix = ' left') {
    const text = durationText(blocks, blockSeconds);
    return text ? `, ${text}${suffix}` : '';
}

function cooldownLeft(blocks, blockSeconds) {
    const plural = blocks === 1 ? 'block' : 'blocks';
    const text = durationText(blocks, blockSeconds);
    return text ? `${fmt(blocks)} ${plural} (${text})` : `${fmt(blocks)} ${plural}`;
}

/**
 * Principal-changing events for the position at each block's projected time:
 * stakes in and deactivated stakes out for validators; stakes in, unstakes and
 * penalties out for contracts. Rewards never change stake principal.
 */
function positionEvents({ kind, stakes, contractStakes, contractUnstakes, slashEvents, height, blockSeconds }) {
    const now = Date.now();
    const out = [];
    const add = (block, amount, sign) => {
        const ms = blockTimeMs(block, height, blockSeconds, now);
        const value = Number(amount);
        if (ms == null || !Number.isFinite(value) || value <= 0) return;
        out.push({ ms, delta: sign * value });
    };
    const refused = (row) => /^(invalid|rejected)/i.test(String(row?.status ?? row?.STATUS ?? ''));
    if (kind === 'validator') {
        for (const s of stakes) {
            if (refused(s)) continue;
            const amount = s.amount ?? s.AMOUNT ?? s.quantity;
            add(s.block_index, amount, 1);
            const end = Number(s.deactivation_block ?? s.DEACTIVATION_BLOCK);
            if (Number.isFinite(end) && end > 0 && height != null && end <= height) add(end, amount, -1);
        }
    } else {
        for (const s of contractStakes) if (!refused(s)) add(s.block_index, s.amount, 1);
        for (const u of contractUnstakes) if (!refused(u)) add(u.block_index, u.amount, -1);
        for (const ev of slashEvents) add(ev.block_index, ev.amount, -1);
    }
    return out.sort((a, b) => a.ms - b.ms);
}

/** Pending reward history: accrual adds and only valid COLLECT rows subtract. */
function pendingRewardEvents({ rewards, claims, height, blockSeconds }) {
    const now = Date.now();
    const out = [];
    const add = (row, sign) => {
        const ms = blockTimeMs(row?.block_index, height, blockSeconds, now);
        const value = Number(row?.amount ?? row?.reward);
        if (ms == null || !Number.isFinite(value) || value <= 0) return;
        out.push({ ms, delta: sign * value });
    };
    for (const reward of rewards) add(reward, 1);
    for (const claim of claims) if (String(claim?.status ?? '') === 'valid') add(claim, -1);
    return out.sort((a, b) => a.ms - b.ms);
}

/**
 * The position's balance sampled evenly across one range window, or null
 * when there is nothing to draw (no dated events, or a zero balance all along).
 */
function balanceSeries(events, range, now) {
    if (!Array.isArray(events) || events.length === 0) return null;
    let start = range.id === '1w' ? now - 7 * DAY_MS : rangeWindowStart(range.id, now);
    if (range.id === 'all' || !Number.isFinite(start)) start = Math.min(events[0].ms, now - DAY_MS);
    if (!(start < now)) return null;
    const values = [];
    let running = 0;
    let next = 0;
    for (let k = 0; k < CHART_SAMPLES; k += 1) {
        const at = start + ((now - start) * k) / (CHART_SAMPLES - 1);
        while (next < events.length && events[next].ms <= at) {
            running += events[next].delta;
            next += 1;
        }
        values.push(Math.max(0, running));
    }
    return values.some((v) => v > 0) ? values : null;
}

/** The change pill: the window's change in coin, and in fiat when priced. */
function rangeChangeLine(series, { tick, fiatRate, fiatCurrency, locale }) {
    if (!Array.isArray(series) || series.length < 2) return null;
    const delta = series[series.length - 1] - series[0];
    const size = Math.abs(delta) < 1e-12 ? 0 : Math.abs(delta);
    const direction = size === 0 ? 'neutral' : delta > 0 ? 'positive' : 'negative';
    const arrow = direction === 'positive' ? '▲ ' : direction === 'negative' ? '▼ ' : '';
    const sign = direction === 'negative' ? '-' : '+';
    const coin = new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }).format(size);
    const fiat = fiatRate != null ? formatFiatAmount(expandDecimalNotation(String(size * fiatRate)), fiatCurrency, locale) : '';
    return {
        direction,
        text: `${arrow}${sign}${coin}${tick ? ` ${tick}` : ''}${fiat ? ` · ${sign}${fiat}` : ''}`,
    };
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
