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
import { Screen, PageHeader, Icon, Skeleton } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { formatAmount } from '../components/BalanceList.jsx';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { Sparkline, synthesizeTokenChart } from '../components/Sparkline.jsx';
import { RANGES as CHART_RANGES } from '../components/PortfolioChart.jsx';
import portfolioChartStyles from '../components/PortfolioChart.module.css';
import styles from './ManageToken.module.css';

const chainRegistry = registryLib.defaultRegistry();

// PC-02: the seven independent ISSUE v3 lock flags (mirrors
// TokenAdminForm's LOCK_FLAGS keys; see ISSUE.md "Version 3 - Edit
// LOCK PARAMS"). Used only to gate the Lock action's visibility here.
const LOCK_FLAG_KEYS = ['max_supply', 'max_mint', 'mint', 'mint_supply', 'description', 'sleep', 'callback'];

/**
 * §40.5 Manage Token. Issuer-side detail page driven from the My
 * Tokens list. Distinct from §27.6 TokenDetail (which is the holder
 * POV with balance hero + send/receive). The single goal here is to
 * surface every capability §40.5 grants the issuer:
 *
 *   - Mint additional supply              (hidden when supply is locked)
 *   - Mint settings                       (edit ISSUE v2 mint-config fields; PC-01)
 *   - Destroy supply (burn)
 *   - Lock supply                         (hidden when already locked)
 *   - Update description
 *   - Transfer ownership
 *   - Create dispenser  (list for sale)
 *   - Pay dividend
 *   - Airdrop
 *   - Broadcast
 *
 * Each capability is rendered as a full-size icon button. The host
 * (web / popup / desktop App.jsx) wires each handler to the existing
 * §40 form route; back navigation returns here via the host's view
 * stack rather than via prop drilling, so the same pattern works for
 * all three shells.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick                       canonical ticker (uppercase)
 * @param {number | null} [props.divisibility]      fallback only; primary source is `assetInfo.divisibility`. Threaded from MyTokens for the (rare) case where the explorer strips decimals.
 * @param {() => void} props.onBack
 * @param {() => void} [props.onMint]
 * @param {() => void} [props.onDestroy]
 * @param {() => void} [props.onLock]
 * @param {() => void} [props.onMintSettings]         edit ISSUE v2 mint-configuration fields: MAX_MINT, MINT_SUPPLY, TRANSFER_SUPPLY, MINT_ADDRESS_MAX, MINT_START_BLOCK, MINT_STOP_BLOCK (PC-01)
 * @param {() => void} [props.onCallbackSettings]     edit ISSUE v4 callback config: CALLBACK_BLOCK / CALLBACK_TICK / CALLBACK_AMOUNT (PC-03; editable only pre-distribution)
 * @param {() => void} [props.onExecuteCallback]      force-recall all supply via CALLBACK (PC-03; owner-only, after CALLBACK_BLOCK)
 * @param {() => void} [props.onUpdateDescription]
 * @param {() => void} [props.onAttachContent]       attach on-chain artwork (FILE + owner-validated LINK)
 * @param {() => void} [props.onGatedContent]        publish token-gated encrypted files (PC-25; atomic BATCH(FILE, MESSAGE-to-self))
 * @param {() => void} [props.onManageRoster]        publish/edit the project's official-token list (LIST + owner LINK)
 * @param {() => void} [props.onTransferOwnership]
 * @param {() => void} [props.onSellOwnership]       list this token's ownership (name) for sale via an ownership SWAP
 * @param {() => void} [props.onCreateDispenser]
 * @param {() => void} [props.onPayDividend]
 * @param {() => void} [props.onAirdrop]
 * @param {() => void} [props.onBroadcast]
 * @param {() => void} [props.onBindController]      bind/unbind a guard contract over this token (Phase F)
 * @param {() => void} [props.onViewActivity]       drill into History pre-filtered to this tick
 * @param {() => void} [props.onViewHolders]        drill into the full holders list (optional)
 * @param {(chainId: string, actionIndex: string | number) => void} [props.onOpenDispenser]   drill into a dispenser's detail page
 * @param {(creator: string | null) => void} [props.onIssuerResolved]   fires once `assetInfo.creator` is known so the host can stash it for form prefill (preferred From-address)
 */
export function ManageToken({
    walletId,
    chainId,
    tick,
    divisibility: divisibilityProp = null,
    onBack,
    onMint,
    onDestroy,
    onLock,
    onMintSettings,
    onCallbackSettings,
    onExecuteCallback,
    onUpdateDescription,
    onAttachContent,
    onGatedContent,
    onManageRoster,
    onTransferOwnership,
    onSellOwnership,
    onCreateDispenser,
    onPayDividend,
    onAirdrop,
    onBroadcast,
    onBindController,
    onViewActivity,
    onViewHolders,
    onOpenDispenser,
    onIssuerResolved,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const descriptor = chainRegistry.get(chainId);

    const assetInfo = useTokenInfo({ chainId, tick });

    const locked = !!assetInfo?.locked;
    // PC-02 lock matrix: the Lock action itself stays reachable as long
    // as at least one of the seven independent ISSUE v3 locks is still
    // open, unlike the coarse `locked` flag above (a subset of four,
    // used only for the hero pill / Mint's hiding). Every flag is
    // one-way (see TokenAdminForm's LOCK_FLAGS), so once all seven are
    // set there is nothing left for the Lock form to offer.
    const tokenLocks = assetInfo?.locks || {};
    const allLocksSet = LOCK_FLAG_KEYS.every((k) => !!tokenLocks[k]);
    const totalSupply = assetInfo?.totalSupply ?? null;
    const maxSupply = assetInfo?.maxSupply ?? null;
    const description = assetInfo?.description || null;
    const owner = assetInfo?.creator || null;
    // Prefer the indexer-supplied divisibility; fall back to whatever
    // MyTokens threaded in via props when the explorer strips it.
    const divisibility = (assetInfo?.divisibility != null && Number.isFinite(Number(assetInfo.divisibility)))
        ? Number(assetInfo.divisibility)
        : divisibilityProp;

    // Holders panel: single page, surfacing count + top 5. The full
    // list lives behind `onViewHolders` (host-routed).
    const [holders, setHolders] = useState(/** @type {any[] | null} */ (null));
    const [holdersError, setHoldersError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        if (typeof messaging?.getHoldersForToken !== 'function') return undefined;
        let cancelled = false;
        messaging.getHoldersForToken({ chainId, tick })
            .then((rows) => { if (!cancelled) setHolders(Array.isArray(rows) ? rows : []); })
            .catch((err) => { if (!cancelled) setHoldersError(err?.message || 'Failed to load holders.'); });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick]);

    // Your-balance: aggregate balance of this tick across every
    // address the wallet has on this chain. Drives the "You hold X (Y%)"
    // sub-line in the Supply card. Null = still loading; '0' = none.
    const [yourBalance, setYourBalance] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        if (typeof messaging?.getWalletBalances !== 'function') return undefined;
        let cancelled = false;
        messaging.getWalletBalances(walletId)
            .then((resp) => {
                if (cancelled) return;
                // The wallet balances payload is `{ rows: [{ chainId, tick, quantity, ... }] }`
                // in some shells and a flat array in others. Be tolerant.
                const rows = Array.isArray(resp)
                    ? resp
                    : (Array.isArray(resp?.rows) ? resp.rows : (Array.isArray(resp?.data) ? resp.data : []));
                let total = 0n;
                for (const r of rows) {
                    if (!r) continue;
                    if (r.chainId && r.chainId !== chainId) continue;
                    const rowTick = typeof r.tick === 'string' ? r.tick.toUpperCase() : null;
                    if (rowTick !== tick) continue;
                    const q = r.quantity ?? r.amount ?? r.balance ?? '0';
                    try { total += BigInt(String(q)); } catch { /* skip non-numeric */ }
                }
                setYourBalance(String(total));
            })
            .catch(() => { if (!cancelled) setYourBalance('0'); });
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId, tick]);

    // Surface the on-chain issuer to the host as soon as we know it
    // so per-form openers can default the From row to that address
    // (and the owner gate has a real address to compare against).
    useEffect(() => {
        if (typeof onIssuerResolved === 'function') onIssuerResolved(owner || null);
    }, [owner, onIssuerResolved]);

    // Owner gate: true when one of the wallet's addresses on this
    // chain matches the on-chain creator. Drives both the warning
    // banner above the action grid and the hiding of issuer-only
    // actions (Mint / Description / Transfer / Broadcast / Lock).
    // null = unknown (loading or no creator on the indexer record).
    const [isOwner, setIsOwner] = useState(/** @type {boolean | null} */ (null));
    useEffect(() => {
        if (!owner) { setIsOwner(null); return undefined; }
        if (typeof messaging?.getAddressesByChain !== 'function') { setIsOwner(null); return undefined; }
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const addrs = (byChain?.[chainId] || [])
                    .map((a) => a?.address)
                    .filter((a) => typeof a === 'string');
                setIsOwner(addrs.includes(owner));
            })
            .catch(() => { if (!cancelled) setIsOwner(null); });
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId, owner]);

    // Percentage of circulating supply the user holds. Returns null
    // when supply isn't known yet so the renderer can hide the line.
    const yourSharePct = useMemo(() => {
        if (yourBalance == null || totalSupply == null) return null;
        try {
            const held = BigInt(yourBalance);
            const supply = BigInt(String(totalSupply));
            if (supply === 0n) return null;
            // Compute share in basis-points (10000) for one decimal place
            // of precision, then divide back down.
            const bps = Number((held * 10000n) / supply);
            return bps / 100;
        } catch {
            return null;
        }
    }, [yourBalance, totalSupply]);

    // Open dispensers selling this tick FROM one of the user's
    // addresses on this chain. Two parallel fetches: addresses (to
    // know what counts as "yours") + all dispensers selling the tick
    // (the explorer doesn't filter by source for token queries, so we
    // filter client-side). Empty array → nothing listed.
    const [listings, setListings] = useState(/** @type {any[] | null} */ (null));
    const [listingsError, setListingsError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        if (typeof messaging?.getDispensersForToken !== 'function') return undefined;
        if (typeof messaging?.getAddressesByChain !== 'function') return undefined;
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            messaging.getDispensersForToken({ chainId, token: tick }),
        ])
            .then(([byChain, dispensersRaw]) => {
                if (cancelled) return;
                const mine = new Set();
                for (const a of (byChain?.[chainId] || [])) {
                    if (typeof a?.address === 'string') mine.add(a.address);
                }
                const rows = Array.isArray(dispensersRaw)
                    ? dispensersRaw
                    : (Array.isArray(dispensersRaw?.data) ? dispensersRaw.data : []);
                const open = rows.filter((d) => {
                    if (!d) return false;
                    const status = d.status ?? d.dispenser_status;
                    if (status !== undefined && Number(status) !== 0) return false;
                    const src = d.source || d.source_address || d.dispenser || d.dispenser_address;
                    return !src || mine.has(src);
                });
                setListings(open);
            })
            .catch((err) => {
                if (!cancelled) setListingsError(err?.message || 'Failed to load listings.');
            });
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId, tick]);

    // Tab content (orders / swaps / activity): loaded lazily on tab
    // activation so the page paints quickly even if any one of these
    // endpoints is slow.
    const [activeTab, setActiveTab] = useState(/** @type {'dispensers' | 'orders' | 'swaps' | 'holders' | 'activity'} */ ('dispensers'));
    const [orders, setOrders] = useState(/** @type {any[] | null} */ (null));
    const [ordersError, setOrdersError] = useState(/** @type {string | null} */ (null));
    const [swaps, setSwaps] = useState(/** @type {any[] | null} */ (null));
    const [swapsError, setSwapsError] = useState(/** @type {string | null} */ (null));
    const [activity, setActivity] = useState(/** @type {any[] | null} */ (null));
    const [activityError, setActivityError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        if (activeTab !== 'orders' || orders !== null) return undefined;
        if (typeof messaging?.getOrdersForToken !== 'function') {
            setOrders([]); return undefined;
        }
        let cancelled = false;
        messaging.getOrdersForToken({ chainId, tick })
            .then((resp) => {
                if (cancelled) return;
                const rows = Array.isArray(resp) ? resp : (Array.isArray(resp?.data) ? resp.data : []);
                setOrders(rows);
            })
            .catch((err) => { if (!cancelled) setOrdersError(err?.message || 'Failed to load orders.'); });
        return () => { cancelled = true; };
    }, [activeTab, orders, messaging, chainId, tick]);

    useEffect(() => {
        if (activeTab !== 'swaps' || swaps !== null) return undefined;
        if (typeof messaging?.getSwapsForToken !== 'function') {
            setSwaps([]); return undefined;
        }
        let cancelled = false;
        messaging.getSwapsForToken({ chainId, tick })
            .then((resp) => {
                if (cancelled) return;
                const rows = Array.isArray(resp) ? resp : (Array.isArray(resp?.data) ? resp.data : []);
                setSwaps(rows);
            })
            .catch((err) => { if (!cancelled) setSwapsError(err?.message || 'Failed to load swaps.'); });
        return () => { cancelled = true; };
    }, [activeTab, swaps, messaging, chainId, tick]);

    // Genesis (first ISSUE) + subassets: small read-only metadata
    // section below the tabs. Fetched once on mount; both calls
    // tolerate missing fields and return null/[] when the SDK lacks
    // the underlying methods (dev mock falls through to []).
    const [genesis, setGenesis] = useState(/** @type {any | null} */ (null));
    const [subassets, setSubassets] = useState(/** @type {any[] | null} */ (null));
    useEffect(() => {
        if (typeof messaging?.getGenesisForToken !== 'function') return undefined;
        let cancelled = false;
        messaging.getGenesisForToken({ chainId, tick })
            .then((row) => { if (!cancelled) setGenesis(row || null); })
            .catch(() => { if (!cancelled) setGenesis(null); });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick]);
    useEffect(() => {
        if (typeof messaging?.getSubassetsForToken !== 'function') return undefined;
        let cancelled = false;
        messaging.getSubassetsForToken({ chainId, tick })
            .then((resp) => {
                if (cancelled) return;
                const rows = Array.isArray(resp) ? resp : (Array.isArray(resp?.data) ? resp.data : []);
                setSubassets(rows);
            })
            .catch(() => { if (!cancelled) setSubassets([]); });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick]);
    const genesisInfo = useMemo(() => normalizeGenesisRow(genesis), [genesis]);
    const subassetTicks = useMemo(() => {
        if (!Array.isArray(subassets)) return [];
        const out = [];
        for (const raw of subassets) {
            if (Array.isArray(raw)) {
                if (typeof raw[3] === 'string' && raw[3]) out.push(raw[3]);
            } else if (raw && typeof raw.tick === 'string' && raw.tick) {
                out.push(raw.tick);
            }
        }
        return out;
    }, [subassets]);

    useEffect(() => {
        if (activeTab !== 'activity' || activity !== null) return undefined;
        if (typeof messaging?.getHistoryForToken !== 'function') {
            setActivity([]); return undefined;
        }
        let cancelled = false;
        messaging.getHistoryForToken({ chainId, tick })
            .then((resp) => {
                if (cancelled) return;
                const rows = Array.isArray(resp) ? resp : (Array.isArray(resp?.data) ? resp.data : []);
                setActivity(rows);
            })
            .catch((err) => { if (!cancelled) setActivityError(err?.message || 'Failed to load activity.'); });
        return () => { cancelled = true; };
    }, [activeTab, activity, messaging, chainId, tick]);

    const supplyProgress = useMemo(() => {
        const s = Number(totalSupply);
        const m = Number(maxSupply);
        if (!isFinite(s) || !isFinite(m) || m <= 0) return null;
        return Math.max(0, Math.min(1, s / m));
    }, [totalSupply, maxSupply]);

    // Price chart: mirrors Home's PortfolioChart layout: single change
    // line (▲/▼ absolute + percent) over a 40px sparkline plus the
    // range-pill strip. Sparkline is synthesized off
    // `assetInfo.marketPrice` (native-coin denominated, per the indexer)
    // so the line lands at the current market price; range selection
    // reshuffles the synthesis seed the same way PortfolioChart does.
    const [chartRangeId, setChartRangeId] = useState('30d');
    const chartRange = CHART_RANGES.find((r) => r.id === chartRangeId) || CHART_RANGES[2];
    const nativeTick = nativeTickerOf(descriptor);
    const chartSeries = useMemo(() => {
        const marketPriceNum = assetInfo?.marketPrice != null
            ? Number(assetInfo.marketPrice)
            : null;
        if (marketPriceNum == null || !Number.isFinite(marketPriceNum) || marketPriceNum <= 0) {
            return null;
        }
        const synth = synthesizeTokenChart(
            `${chainId}|${tick}|native|${chartRange.id}`,
            marketPriceNum,
            chartRange.points,
        );
        return synth.sparkline;
    }, [assetInfo, chainId, tick, chartRange.id, chartRange.points]);
    const chartChange = useMemo(() => {
        if (!Array.isArray(chartSeries) || chartSeries.length < 2) return { delta: null, pct: null };
        const start = chartSeries[0];
        const end = chartSeries[chartSeries.length - 1];
        const d = end - start;
        const p = start > 0 ? (d / start) * 100 : null;
        return { delta: d, pct: p };
    }, [chartSeries]);

    function shortAddress(a) {
        if (typeof a !== 'string' || a.length <= 14) return a || '';
        return `${a.slice(0, 6)}…${a.slice(-4)}`;
    }

    // Issuer-only vs anyone-with-balance actions. Mint / Description /
    // Transfer / Broadcast / Lock require the calling address to match
    // the on-chain creator. Dispenser / Airdrop / Destroy operate on a
    // balance and don't have that constraint.
    const blockIssuerActions = isOwner === false;
    /** @type {Array<{ id: string, label: string, Icon: any, onSelect: (() => void) | undefined, danger?: boolean }>} */
    const actions = [
        { id: 'mint', label: 'Mint', Icon: Icon.PrinterIcon, onSelect: (locked || blockIssuerActions) ? undefined : onMint },
        // Unlike Mint (which submits a MINT command and is hidden once
        // supply is locked), Mint settings edits ISSUE v2's own config
        // fields and stays reachable regardless of the coarse `locked`
        // flag: even a fully-locked token can still have an un-touched
        // MINT_ADDRESS_MAX / window pair worth reviewing, and the panel
        // itself explains + disables whichever fields their specific
        // lock flags (LOCK_MAX_MINT / LOCK_MINT / LOCK_MINT_SUPPLY)
        // actually cover (PC-01).
        { id: 'mint-settings', label: 'Mint settings', Icon: Icon.GearIcon, onSelect: blockIssuerActions ? undefined : onMintSettings },
        { id: 'dispenser', label: 'Dispenser', Icon: Icon.DollarIcon, onSelect: onCreateDispenser },
        { id: 'dividend', label: 'Dividends', Icon: Icon.TokenIcon, onSelect: blockIssuerActions ? undefined : onPayDividend },
        { id: 'airdrop', label: 'Airdrop', Icon: Icon.SendIcon, onSelect: onAirdrop },
        { id: 'description', label: 'Description', Icon: Icon.PencilIcon, onSelect: blockIssuerActions ? undefined : onUpdateDescription },
        { id: 'attach-content', label: 'Artwork', Icon: Icon.DocumentIcon, onSelect: blockIssuerActions ? undefined : onAttachContent },
        // PC-25: token-gated encrypted publishing. Owner-only by protocol
        // (the indexer rejects gated FILEs from non-owners, FILE.md).
        { id: 'gated-content', label: 'Gated content', Icon: Icon.KeyIcon, onSelect: blockIssuerActions ? undefined : onGatedContent },
        { id: 'manage-roster', label: 'Official list', Icon: Icon.BookIcon, onSelect: blockIssuerActions ? undefined : onManageRoster },
        { id: 'transfer', label: 'Transfer', Icon: Icon.HandshakeIcon, onSelect: blockIssuerActions ? undefined : onTransferOwnership },
        { id: 'sell-ownership', label: 'Sell name', Icon: Icon.MarketIcon, onSelect: blockIssuerActions ? undefined : onSellOwnership },
        { id: 'broadcast', label: 'Broadcast', Icon: Icon.BroadcastIcon, onSelect: blockIssuerActions ? undefined : onBroadcast },
        { id: 'bind-controller', label: 'Controller', Icon: Icon.LockIcon, onSelect: blockIssuerActions ? undefined : onBindController },
        // PC-03 callback config (ISSUE v4). Owner-only; stays reachable
        // regardless of the coarse `locked` flag (LOCK_CALLBACK and the
        // pre-distribution gate are enforced inside the form).
        { id: 'callback-settings', label: 'Callback settings', Icon: Icon.GearIcon, onSelect: blockIssuerActions ? undefined : onCallbackSettings },
        // PC-03 CALLBACK execution (danger): only offered once a callback
        // is actually configured (callbackTick set). The after-CALLBACK_BLOCK
        // timing gate + holder-payout preview live inside the form.
        { id: 'execute-callback', label: 'Execute callback', Icon: Icon.TrashIcon, onSelect: (blockIssuerActions || !assetInfo?.callbackTick) ? undefined : onExecuteCallback, danger: true },
        { id: 'lock', label: 'Lock', Icon: Icon.LockIcon, onSelect: (allLocksSet || blockIssuerActions) ? undefined : onLock },
        { id: 'destroy', label: 'Destroy', Icon: Icon.TrashIcon, onSelect: onDestroy, danger: true },
    ];

    const visibleActions = actions.filter((a) => typeof a.onSelect === 'function');
    const primaryActions = visibleActions.slice(0, 3);
    const overflowActions = visibleActions.slice(3);

    // "More" dropdown: mirrors Home.jsx's quickAction More pattern.
    // Close on outside click and Escape so the menu doesn't trap focus.
    const [moreOpen, setMoreOpen] = useState(false);
    const moreWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => {
        if (!moreOpen) return undefined;
        const onClick = (e) => {
            if (moreWrapRef.current?.contains(e.target)) return;
            setMoreOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [moreOpen]);

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to my tokens"
            title="Manage Token"
            titleIcon={<Icon.TokenIcon />}
        />
    );

    const tabs = [
        { id: 'dispensers', label: 'Dispensers' },
        { id: 'orders',     label: 'Orders'     },
        { id: 'swaps',      label: 'Swaps'      },
        { id: 'holders',    label: 'Holders'    },
        { id: 'activity',   label: 'Activity'   },
    ];

    return (
        <Screen variant={variant} header={header}>
            <div className={styles.body}>
                {/* Hero: identity (no Total Balance; this is the issuer view). */}
                <section className={styles.hero} aria-label="Token identity">
                    {locked ? (
                        <span className={`${styles.lockBadge} ${styles.lockBadgeLocked}`}>
                            <Icon.LockIcon />Locked
                        </span>
                    ) : (
                        <span className={`${styles.lockBadge} ${styles.lockBadgeUnlocked}`}>
                            <Icon.UnlockIcon />Unlocked
                        </span>
                    )}
                    <div className={styles.heroIconWrap}>
                        <TickerIcon chainId={chainId} tick={tick} size={64} />
                    </div>
                    <div className={styles.heroMain}>
                        <div className={styles.heroTitleRow}>
                            <h2 className={styles.heroTick}>{tick}</h2>
                        </div>
                        <div className={styles.heroSub}>
                            <span>{descriptor?.displayName || chainId}</span>
                            {owner ? (
                                <>
                                    <span className={styles.heroDot}>·</span>
                                    <span>Owned by</span>
                                    <span className={styles.heroOwner} title={owner}>{shortAddress(owner)}</span>
                                </>
                            ) : null}
                        </div>
                        {description ? (
                            <p className={styles.heroDescription}>{description}</p>
                        ) : null}
                    </div>
                </section>

                {/* "Official token" banner: on a project registry's
                    current roster (owner-attested; Project_Registry.md). */}
                {Array.isArray(assetInfo?.projects) && assetInfo.projects.length > 0 ? (
                    <p className={styles.officialBanner} role="status">
                        This token is an official token in the{' '}
                        {assetInfo.projects.map((p, i) => (
                            <span key={p} className={styles.officialBannerProject}>
                                {i > 0 ? ', ' : ''}{p}
                            </span>
                        ))}
                        {' '}project{assetInfo.projects.length === 1 ? '' : 's'}.
                    </p>
                ) : null}

                {/* Market panel: stats strip + chart placeholder. The
                    chart slot is reserved for future supply / dispense-
                    price history; today it shows an empty-state hint so
                    the layout doesn't shift when data wires up later. */}
                <section className={styles.marketPanel} aria-label="Token stats">
                    <div className={styles.statsStrip}>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Supply</span>
                            <span className={styles.statValue}>
                                {totalSupply != null ? formatSupplyValue(totalSupply, divisibility) : '-'}
                            </span>
                            <span className={styles.statSub}>
                                {maxSupply != null ? `of ${formatSupplyValue(maxSupply, divisibility)} cap` : 'no cap'}
                            </span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>You hold</span>
                            <span className={styles.statValue}>
                                {yourBalance != null ? formatAmount(yourBalance, divisibility || 0) : '-'}
                            </span>
                            {/* yourBalance comes from getWalletBalances
                                in raw atomic units, so formatAmount is
                                the correct formatter here. Supply
                                values above use formatSupplyValue since
                                the real explorer pre-formats them. */}
                            <span className={styles.statSub}>
                                {yourSharePct != null ? `${yourSharePct.toFixed(1)}% of supply` : ' '}
                            </span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Holders</span>
                            <span className={styles.statValue}>
                                {holders != null ? holders.length.toLocaleString() : '-'}
                            </span>
                            <span className={styles.statSub}>&nbsp;</span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Open offers</span>
                            <span className={styles.statValue}>
                                {listings != null ? listings.length.toLocaleString() : '-'}
                            </span>
                            <span className={styles.statSub}>&nbsp;</span>
                        </div>
                    </div>
                    {supplyProgress != null ? (
                        <div className={styles.supplyBar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(supplyProgress * 100)}>
                            <div className={styles.supplyBarFill} style={{ width: `${supplyProgress * 100}%` }} />
                        </div>
                    ) : null}

                    {/* Sparkline + change line + range pills. Same shape
                        as Home's PortfolioChart: single change row
                        above a 40px Sparkline, then the range strip. */}
                    {chartSeries ? (
                        <>
                            {chartChange.delta != null ? (
                                <div
                                    className={`${portfolioChartStyles.change} ${chartChange.delta > 0 ? portfolioChartStyles.changePositive : chartChange.delta < 0 ? portfolioChartStyles.changeNegative : portfolioChartStyles.changeNeutral}`}
                                >
                                    {chartChange.delta > 0 ? '▲' : chartChange.delta < 0 ? '▼' : '-'}{' '}
                                    {formatNativeAmount(Math.abs(chartChange.delta))} {nativeTick}
                                    {chartChange.pct != null && Number.isFinite(chartChange.pct)
                                        ? ` (${chartChange.pct > 0 ? '+' : ''}${chartChange.pct.toFixed(2)}%)`
                                        : ''}
                                </div>
                            ) : null}
                            <div className={portfolioChartStyles.chart} aria-label={`${chartRange.label} price chart`}>
                                <Sparkline series={chartSeries} height={40} />
                            </div>
                            <div className={portfolioChartStyles.ranges} role="tablist" aria-label="Chart range">
                                {CHART_RANGES.map((r) => (
                                    <button
                                        key={r.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={r.id === chartRangeId ? 'true' : 'false'}
                                        className={`${portfolioChartStyles.range} ${r.id === chartRangeId ? portfolioChartStyles.rangeActive : ''}`}
                                        onClick={() => setChartRangeId(r.id)}
                                    >
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p className={styles.chartHint}>No market data yet for this token.</p>
                    )}
                </section>

                {/* Owner-mismatch banner: surfaces when the wallet
                    holds the token but none of its addresses matches
                    the on-chain creator. Issuer-only actions are
                    auto-hidden below; the banner explains why. */}
                {isOwner === false ? (
                    <p className={styles.ownerWarning} role="status">
                        This wallet doesn't hold the token's issuer address.
                        Mint, Mint settings, Lock, Description, Artwork,
                        Transfer, Broadcast, and Dividend require signing
                        from {shortAddress(owner)}.
                    </p>
                ) : null}

                {/* Action buttons: same 3-primary + More pattern as Home. */}
                <div className={styles.manageGrid} role="group" aria-label="Manage actions">
                    {primaryActions.map((a) => (
                        <button
                            key={a.id}
                            type="button"
                            className={`${styles.manageBtn} ${a.danger ? styles.manageBtnDanger : ''}`}
                            onClick={a.onSelect}
                        >
                            <span className={styles.manageIcon} aria-hidden="true">
                                <a.Icon />
                            </span>
                            <span className={styles.manageLabel}>{a.label}</span>
                        </button>
                    ))}
                    {overflowActions.length > 0 ? (
                        <div className={styles.manageMoreWrap} ref={moreWrapRef}>
                            <button
                                type="button"
                                className={styles.manageBtn}
                                aria-haspopup="menu"
                                aria-expanded={moreOpen}
                                onClick={() => setMoreOpen((o) => !o)}
                            >
                                <span className={styles.manageIcon} aria-hidden="true">
                                    <Icon.MoreIcon />
                                </span>
                                <span className={styles.manageLabel}>More</span>
                            </button>
                            {moreOpen ? (
                                <div className={styles.manageMoreMenu} role="menu">
                                    {overflowActions.map((a) => (
                                        <button
                                            key={a.id}
                                            type="button"
                                            role="menuitem"
                                            className={`${styles.manageMoreItem} ${a.danger ? styles.manageMoreItemDanger : ''}`}
                                            onClick={() => { setMoreOpen(false); a.onSelect(); }}
                                        >
                                            <span className={styles.manageMoreItemIcon} aria-hidden="true">
                                                <a.Icon />
                                            </span>
                                            <span>{a.label}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                {/* Tab strip + panels: matches TokenDetail's tab pattern. */}
                <div className={styles.tabs} role="tablist">
                    {tabs.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === t.id}
                            className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
                            onClick={() => setActiveTab(t.id)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <div className={styles.tabPanel}>
                    {activeTab === 'dispensers' ? (
                        <DispensersPanel
                            listings={listings}
                            listingsError={listingsError}
                            tick={tick}
                            chainId={chainId}
                            onOpenDispenser={onOpenDispenser}
                            onCreateDispenser={onCreateDispenser}
                        />
                    ) : null}
                    {activeTab === 'orders' ? (
                        <OrdersPanel orders={orders} error={ordersError} tick={tick} chainId={chainId} />
                    ) : null}
                    {activeTab === 'swaps' ? (
                        <SwapsPanel swaps={swaps} error={swapsError} tick={tick} />
                    ) : null}
                    {activeTab === 'holders' ? (
                        <HoldersPanel
                            holders={holders}
                            error={holdersError}
                            onViewAll={onViewHolders}
                        />
                    ) : null}
                    {activeTab === 'activity' ? (
                        <ActivityPanel
                            activity={activity}
                            error={activityError}
                            onViewAll={onViewActivity}
                            tick={tick}
                        />
                    ) : null}
                </div>

                {/* Genesis + subassets: small read-only metadata
                    section. Hidden when neither piece of data is
                    present (dev mock returns nothing). */}
                {(genesisInfo || subassetTicks.length > 0) ? (
                    <section className={styles.genesisPanel} aria-label="Genesis and subassets">
                        <h3 className={styles.genesisHeading}>Genesis</h3>
                        {genesisInfo ? (
                            <dl className={styles.genesisList}>
                                {genesisInfo.actionIndex ? (
                                    <>
                                        <dt>Issue action</dt>
                                        <dd className={styles.genesisMono}>{genesisInfo.actionIndex}</dd>
                                    </>
                                ) : null}
                                {genesisInfo.blockIndex ? (
                                    <>
                                        <dt>Block</dt>
                                        <dd>{Number(genesisInfo.blockIndex).toLocaleString('en-US')}</dd>
                                    </>
                                ) : null}
                                {genesisInfo.timestamp ? (
                                    <>
                                        <dt>Issued</dt>
                                        <dd>{new Date(Number(genesisInfo.timestamp) * (Number(genesisInfo.timestamp) > 1e12 ? 1 : 1000)).toLocaleString()}</dd>
                                    </>
                                ) : null}
                                {genesisInfo.source ? (
                                    <>
                                        <dt>Issuer</dt>
                                        <dd className={styles.genesisMono} title={genesisInfo.source}>{shortAddress(genesisInfo.source)}</dd>
                                    </>
                                ) : null}
                            </dl>
                        ) : (
                            <p className={styles.empty}>No genesis row indexed for {tick} yet.</p>
                        )}
                        {subassetTicks.length > 0 ? (
                            <>
                                <h3 className={styles.genesisHeading}>Subassets ({subassetTicks.length})</h3>
                                <ul className={styles.subassetList} role="list">
                                    {subassetTicks.slice(0, 20).map((t) => (
                                        <li key={t} className={styles.subassetItem}>{t}</li>
                                    ))}
                                </ul>
                            </>
                        ) : null}
                    </section>
                ) : null}
            </div>
        </Screen>
    );
}

/* ───── Tab panel components (kept inline since they're tightly
   coupled to ManageToken's styles + data shapes). ───── */

function DispensersPanel({ listings, listingsError, tick, chainId, onOpenDispenser, onCreateDispenser }) {
    if (listingsError) return <p className={styles.error}>{listingsError}</p>;
    if (listings === null) return (
        <div className={styles.list}>
            <Skeleton height={72} />
            <Skeleton height={72} />
        </div>
    );
    if (listings.length === 0) {
        return (
            <p className={styles.empty}>
                No open dispensers selling {tick}.
                {typeof onCreateDispenser === 'function' ? (
                    <> <button type="button" className={styles.inlineLink} onClick={onCreateDispenser}>Create one</button>.</>
                ) : null}
            </p>
        );
    }
    return (
        <ul className={styles.list} role="list">
            {listings.map((d, i) => {
                const giveQty = d.give_quantity ?? d.give_remaining ?? null;
                const getTickRaw = d.get_tick || d.mainchainrate_tick || 'COIN';
                const getQty = d.get_quantity ?? d.mainchainrate ?? null;
                const remaining = d.give_remaining ?? d.escrow_quantity ?? null;
                const actionIndex = d.action_index || d.actionIndex || d.tx_hash || d.id;
                const onClick = typeof onOpenDispenser === 'function' && actionIndex
                    ? () => onOpenDispenser(chainId, actionIndex)
                    : undefined;
                const summary = (giveQty && getQty)
                    ? `${Number(getQty).toLocaleString()} ${getTickRaw} per ${Number(giveQty).toLocaleString()} ${tick}` +
                      (remaining != null ? ` · ${Number(remaining).toLocaleString()} ${tick} left` : '')
                    : 'Open dispenser';
                return (
                    <HistoryRow
                        key={String(actionIndex || i)}
                        as="button"
                        chainId={chainId}
                        action="DISPENSER"
                        status="open"
                        statusLabel="Open"
                        summary={summary}
                        blockIndex={d.block_index || d.blockIndex}
                        timestamp={d.timestamp || d.block_time}
                        onClick={onClick}
                        disabled={!onClick}
                    />
                );
            })}
        </ul>
    );
}

function OrdersPanel({ orders, error, tick, chainId }) {
    if (error) return <p className={styles.error}>{error}</p>;
    if (orders === null) return (
        <div className={styles.list}>
            <Skeleton height={72} />
            <Skeleton height={72} />
        </div>
    );
    if (orders.length === 0) return <p className={styles.empty}>No open orders involving {tick}.</p>;
    return (
        <ul className={styles.list} role="list">
            {orders.slice(0, 50).map((o, i) => {
                const giveTick = o.give_tick || o.giveTick || '';
                const getTick = o.get_tick || o.getTick || '';
                const giveQty = o.give_quantity ?? o.give_remaining ?? null;
                const getQty = o.get_quantity ?? o.get_remaining ?? null;
                const summary =
                    `${giveQty != null ? Number(giveQty).toLocaleString() : '?'} ${giveTick}` +
                    ' → ' +
                    `${getQty != null ? Number(getQty).toLocaleString() : '?'} ${getTick}`;
                return (
                    <HistoryRow
                        key={String(o.action_index || o.tx_hash || i)}
                        chainId={chainId}
                        tick={tick}
                        action="ORDER"
                        status="open"
                        statusLabel="Open"
                        summary={summary}
                        blockIndex={o.block_index || o.blockIndex}
                        timestamp={o.timestamp || o.block_time}
                    />
                );
            })}
        </ul>
    );
}

function SwapsPanel({ swaps, error, tick }) {
    if (error) return <p className={styles.error}>{error}</p>;
    if (swaps === null) return (
        <div className={styles.list}>
            <Skeleton height={72} />
            <Skeleton height={72} />
        </div>
    );
    if (swaps.length === 0) return <p className={styles.empty}>No recent swaps involving {tick}.</p>;
    return (
        <ul className={styles.list} role="list">
            {swaps.slice(0, 50).map((s, i) => {
                const giveTick = s.give_tick || s.giveTick || '';
                const getTick = s.get_tick || s.getTick || '';
                const giveQty = s.give_quantity ?? null;
                const getQty = s.get_quantity ?? null;
                const summary =
                    `${giveQty != null ? Number(giveQty).toLocaleString() : '?'} ${giveTick}` +
                    ' ⇄ ' +
                    `${getQty != null ? Number(getQty).toLocaleString() : '?'} ${getTick}`;
                return (
                    <HistoryRow
                        key={String(s.action_index || s.tx_hash || i)}
                        chainId={s.chainId}
                        action="SWAP"
                        status="success"
                        statusLabel="Filled"
                        summary={summary}
                        blockIndex={s.block_index || s.blockIndex}
                        timestamp={s.timestamp || s.block_time}
                    />
                );
            })}
        </ul>
    );
}

function HoldersPanel({ holders, error, onViewAll }) {
    if (error) return <p className={styles.error}>{error}</p>;
    if (holders === null) return (
        <div className={styles.list}>
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
        </div>
    );
    if (holders.length === 0) return (
        <p className={styles.empty}>No holders yet. Mint or distribute supply to start populating this list.</p>
    );
    return (
        <>
            <ul className={styles.list} role="list">
                {holders.slice(0, 10).map((h, i) => (
                    <li key={`${h.address || h.holder || i}`}>
                        <div className={styles.row}>
                            <span className={styles.rowMono}>
                                {(h.address || h.holder || '-').replace(/^(.{6}).+(.{4})$/, '$1…$2')}
                            </span>
                            <span className={styles.rowSub}>
                                {h.quantity != null ? Number(h.quantity).toLocaleString() : (h.amount != null ? Number(h.amount).toLocaleString() : '-')}
                            </span>
                        </div>
                    </li>
                ))}
            </ul>
            {typeof onViewAll === 'function' && holders.length > 10 ? (
                <button type="button" className={styles.viewAll} onClick={onViewAll}>
                    View all {holders.length} holders
                </button>
            ) : null}
        </>
    );
}

function ActivityPanel({ activity, error, onViewAll, tick }) {
    if (error) return <p className={styles.error}>{error}</p>;
    if (activity === null) return (
        <div className={styles.list}>
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
        </div>
    );
    if (activity.length === 0) return (
        <p className={styles.empty}>No activity yet for {tick}.</p>
    );
    return (
        <>
            <ul className={styles.list} role="list">
                {activity.slice(0, 20).map((a, i) => {
                    const type = a.type || a.action_type || a.kind || 'EVENT';
                    const ts = Number(a.timestamp || a.block_time || 0);
                    const when = ts > 0
                        ? new Date(ts * (ts > 1e12 ? 1 : 1000)).toLocaleString()
                        : '';
                    return (
                        <li key={String(a.action_index || a.tx_hash || i)}>
                            <div className={styles.row}>
                                <span className={styles.rowMain}>{actionDisplayLabel(type)}</span>
                                <span className={styles.rowSub}>{when}</span>
                            </div>
                        </li>
                    );
                })}
            </ul>
            {typeof onViewAll === 'function' ? (
                <button type="button" className={styles.viewAll} onClick={onViewAll}>
                    View all activity
                </button>
            ) : null}
        </>
    );
}

/* ───── History-style row used by Dispensers / Orders / Swaps panels.
   Mirrors the §23 timeline row visually: header (chain icon + ACTION
   label + status pill), source line (mono muted) or summary line, meta
   line (block + relative time). When `as="button"` and `onClick` is
   set the whole row is clickable; otherwise it renders as a div. ───── */

function HistoryRow({ as, chainId, tick, action, status, statusLabel, source, summary, blockIndex, timestamp, onClick, disabled }) {
    const d = chainId ? chainRegistry.get(chainId) : null;
    const statusClass = status === 'success' ? styles.histStatusSuccess
        : status === 'pending' ? styles.histStatusPending
        : styles.histStatusOpen;
    const blockNum = blockIndex != null ? Number(blockIndex) : null;
    const Tag = (as === 'button' && typeof onClick === 'function') ? 'button' : 'div';
    const interactiveProps = Tag === 'button'
        ? { type: 'button', onClick, disabled }
        : null;
    // When a tick is given we lead the row with a 40px TickerIcon
    // (letter avatar + chain pip): used by OrdersPanel so each row
    // visually anchors on the token being traded. The small chain icon
    // in the header is suppressed in that mode since the TickerIcon
    // already carries the chain pip.
    const showTickerIcon = !!(tick && chainId);
    const contentStack = (
        <div className={showTickerIcon ? styles.histContent : null}>
            <span className={styles.histHeader}>
                {!showTickerIcon && d ? (
                    <img
                        src={branding.chainIconSmallUrl(d.id)}
                        alt=""
                        aria-hidden="true"
                        className={styles.histChainIcon}
                        width={16}
                        height={16}
                    />
                ) : null}
                <span className={styles.histAction}>{actionDisplayLabel(action)}</span>
                {statusLabel ? (
                    <span className={`${styles.histStatus} ${statusClass}`}>{statusLabel}</span>
                ) : null}
            </span>
            {summary ? (
                <span className={styles.histSummary}>{summary}</span>
            ) : null}
            {source ? (
                <span className={styles.histSource}>{source}</span>
            ) : null}
            <span className={styles.histMeta}>
                {blockNum != null && Number.isFinite(blockNum) && blockNum > 0 ? (
                    <span>Block {blockNum.toLocaleString('en-US')}</span>
                ) : (
                    <span>unconfirmed</span>
                )}
                {timestamp ? (
                    <span className={styles.histTime}>{formatRelativeTime(timestamp)}</span>
                ) : null}
            </span>
        </div>
    );
    return (
        <li>
            <Tag
                className={`${styles.histRow} ${showTickerIcon ? styles.histRowWithIcon : ''}`}
                {...interactiveProps}
            >
                {showTickerIcon ? (
                    <span className={styles.histTickerIcon} aria-hidden="true">
                        <TickerIcon chainId={chainId} tick={tick} size={40} />
                    </span>
                ) : null}
                {contentStack}
            </Tag>
        </li>
    );
}

function nativeTickerOf(descriptor) {
    return descriptor?.coin ? descriptor.coin.toUpperCase() : '';
}

// The /issues endpoint emits rows either as keyed objects (some
// adapters) or as the explorer's collapsed array
// `[count, block_index, timestamp, source, tick, max_supply, max_mint,
//  locks, status, action_index]` (see xchain-explorer
// XChainExplorer.js line 793). Normalize either into a stable shape so
// the Genesis section can render the same fields against either path.
// Exported so tests can pin the array vs keyed paths.
export function normalizeGenesisRow(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) {
        return {
            blockIndex: raw[1] != null ? Number(raw[1]) : null,
            timestamp: raw[2] != null ? Number(raw[2]) : null,
            source: typeof raw[3] === 'string' ? raw[3] : null,
            actionIndex: raw[9] != null ? String(raw[9]) : null,
        };
    }
    return {
        blockIndex: raw.block_index != null ? Number(raw.block_index) : null,
        timestamp: raw.timestamp != null ? Number(raw.timestamp) : (raw.block_time != null ? Number(raw.block_time) : null),
        source: typeof raw.source === 'string' ? raw.source : null,
        actionIndex: raw.action_index != null ? String(raw.action_index) : (raw.actionIndex != null ? String(raw.actionIndex) : null),
    };
}

// Render a supply value tolerating two upstream shapes:
//   1. Real xchain-explorer `/api/token/{TICK}` strips `decimals` and
//      pre-formats supply via bcformat, so we get "1000.5" already.
//   2. Indexer-style raw atomic units ("125000000000000" + divisibility)
//      come through the dev mock + future explorer revisions.
// String values containing '.' are treated as case (1) and re-grouped
// with thousands separators only. Other strings get formatAmount.
function formatSupplyValue(value, divisibility) {
    const s = String(value || '');
    if (s.includes('.')) {
        const [whole, frac] = s.split('.');
        const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return frac ? `${grouped}.${frac}` : grouped;
    }
    return formatAmount(s, divisibility || 0);
}

// Format a native-coin amount (BTC / LTC / DOGE) for the chart's change
// line. Uses up to 8 decimal places, trimming trailing zeros, so small
// price moves (~0.000012 BTC) still read clearly. Mirrors the spirit of
// PortfolioChart's `formatFiat`: chart-anchored, no localized currency
// symbols since this side of the chart is native-tick-denominated.
function formatNativeAmount(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return '-';
    if (v === 0) return '0';
    const abs = Math.abs(v);
    if (abs >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
    const fixed = v.toFixed(8);
    return fixed.replace(/\.?0+$/, '');
}

function formatRelativeTime(ts) {
    const n = Number(ts);
    if (!n) return '';
    const ms = n < 1e12 ? n * 1000 : n;
    const diffSec = Math.floor((Date.now() - ms) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec} seconds ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(diffSec / 3600);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(diffSec / 86400);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
    const year = Math.floor(day / 365);
    return `${year} year${year === 1 ? '' : 's'} ago`;
}
