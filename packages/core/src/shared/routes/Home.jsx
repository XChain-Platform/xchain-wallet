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
import { Button, EmptyState, Icon, ListPage, Screen, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useMessagingUnread } from '../hooks/useMessagingUnread.js';
import { useSharedCoinpayObligations } from '../hooks/useCoinpayObligations.js';
import { useSettings } from '../hooks/useSettings.js';
import { useProofVerification } from '../hooks/useProofVerification.js';
import { useEscrowedBalances } from '../hooks/useEscrowedBalances.js';
import { isNavigatorOnline, useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { useReachability } from '../hooks/useReachability.js';
import { useWalletFilters } from '../hooks/useWalletFilters.js';
import { HomeTabs } from '../components/HomeTabs.jsx';
import { buildBalanceRows, detectSpamCandidates } from '../components/BalanceList.jsx';
import { hasBackupReminderFunds } from '../../flows/backupReminder.js';
import { useScreenShortcuts } from '../keyboard/useScreenShortcuts.js';
import { useToast } from '../components/ToastHost.jsx';
import { BackupReminderCard } from '../components/BackupReminderCard.jsx';
import { DemoBanner } from '../components/DemoBanner.jsx';
import { AlertsOverlay } from '../components/AlertsOverlay.jsx';
import { buildWalletAlerts } from '../walletAlerts.js';
import { PanicFreezeNotice } from '../safety/PanicFreezeNotice.jsx';
import { ResumeConfirmCard } from '../components/ResumeConfirmCard.jsx';
import { Settings } from './Settings.jsx';
import { AddAddressModal } from './AddAddressModal.jsx';
import {
    pinnedTokensForWallet,
    pinnedTokensPatchForWallet,
    WALLET_MODE_DEFAULT,
} from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { writeActiveWallet } from '../utils/activeWalletMemory.js';
import { loadDisplayBalances } from '../utils/displayBalances.js';
import { readBalanceCache, writeBalanceCache } from '../utils/balanceCache.js';
import { explorerReadFailure, rateLimitedMessage } from '../../sdk/explorerErrors.js';
import { tickerForCoin } from '../../registry/coinTicker.js';
import { startVisibleInterval } from '../utils/visibleInterval.js';
import styles from './Home.module.css';
import { useBackHandler } from '../../ui/backStack.js';
import {
    hasAvailableChain,
    NO_CHAINS_BODY,
    NO_CHAINS_TITLE,
} from '../utils/chainAvailability.js';
import { t } from '../../i18n/index.js';

const chainRegistry = registryLib.defaultRegistry();

// The verb the balance banner is written in, in one place: the humanized
// message minted in the catch and the countdown re-rendered once a second have
// to open with the same words or the banner changes voice as it ticks.
const BALANCES_VERB = 'load balances';

// What to wait when a 429 arrives with no `Retry-After` to read (an origin that
// sent none, or the pinned SDK 0.15.1, which carries no seconds at all). One
// poll interval's worth of patience: long enough that the re-load is not
// another immediate request against a bucket that is still empty. Nothing
// counts DOWN in that case, because the wallet would be inventing the number:
// the banner says "a moment" and re-loads when this elapses.
const RATE_LIMIT_FALLBACK_SECONDS = 15;

/**
 * The rate-limit wait a LANDED balance read is asking for, if any.
 *
 * `flows/balances.js` catches every per-address failure and returns it as the
 * entry's `error` STRING with `balances: null`, deliberately, so one address
 * that could not be read does not sink the whole wallet's numbers. That means a
 * 429 never reaches the catch below: `getWalletBalances` RESOLVES, and the only
 * evidence is in the entries. Read across chains and take the LONGEST wait any
 * of them named, since a shorter one expiring first would re-load into a bucket
 * another address is still waiting on.
 *
 * An entry also carries the failure TYPED (`errorCode`, `retryAfterSeconds`),
 * copied straight off the SDK error, so those decide here and the mapper's
 * message regex is only reached for an SDK that named neither: the pinned
 * 0.15.x throws `EXPLORER_HTTP_429` with no seconds on it at all.
 *
 * @param {Record<string, Array<{ error?: string | null, errorCode?: string | null,
 *   retryAfterSeconds?: number | null }>> | null | undefined} balancesByChain
 * @returns {{ seconds: number | null } | null}  null when nothing was rate limited
 */
function rateLimitWaitFromBalances(balancesByChain) {
    if (!balancesByChain || typeof balancesByChain !== 'object') return null;
    let limited = false;
    /** @type {number | null} */
    let seconds = null;
    for (const entries of Object.values(balancesByChain)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            const message = typeof entry?.error === 'string' ? entry.error : '';
            if (!message) continue;
            // Hand the mapper the typed fields the aggregator kept alongside
            // the sentence; it keys on `code` first and the message last, so a
            // named code and a named number decide without any re-parsing.
            // `service` is stated rather than copied: a balance read is always
            // an explorer read, and the mapper's rate-limit branch wants either
            // the service or the "Explorer returned HTTP 429" prefix before it
            // trusts the code, so without it the code alone would still fall
            // back to the message.
            const read = explorerReadFailure({
                name: '',
                code: entry.errorCode ?? undefined,
                service: 'explorer',
                message,
                retryAfterSeconds: entry.retryAfterSeconds ?? undefined,
            }, BALANCES_VERB);
            if (!read || read.cause !== 'rate_limited') continue;
            limited = true;
            const named = read.retryAfterSeconds;
            if (Number.isInteger(named) && (seconds === null || named > seconds)) seconds = named;
        }
    }
    return limited ? { seconds } : null;
}

// Nothing pushes balance changes to the wallet (an incoming send, a mint
// landing, a token someone else sent you), so Home has to poll for them.
// 20s balances catching an incoming token promptly against hammering the
// SDK/indexer on every open tab; see the polling effect below, which also
// refreshes immediately on focus/visibility and pauses while hidden.
//
// Defined in flows/balances.js, next to the aggregator this re-runs, because
// the same number is the wallet's sustained request rate against the public
// endpoints and tools/release/cold-open-profile.mjs has to read the real one
// when it works out what the zone rate limits must clear.
const { BALANCE_POLL_INTERVAL_MS } = flowsLib;

/**
 * Home screen: landing view for an unlocked wallet. Header shows the
 * wallet name; body renders a per-chain balance card grid; the hero
 * exposes Send / Receive and the footer exposes supplementary actions.
 *
 * When the wallet has pending §40.9 airdrops (LIST signed but AIRDROP
 * still pending, either waiting for the LIST to be indexed or ready
 * to sign), Home surfaces a resume card above the balance grid so the
 * user can pick up where they left off.
 *
 * Locking is a shell concern, not a route concern: idle auto-lock runs
 * from each shell's AppInner via `useAutoLockPolicy`, and the manual
 * Lock affordance lives in the shell's menu + keyboard shortcut. A shell
 * with no header or menu (the extension popup) passes `onLockWallet` and
 * Home renders the button for it.
 * found that wiring the idle timer here meant navigating off
 * Home cancelled it, so a wallet left on Send or Settings never locked.
 *
 * @param {object} props
 * @param {() => void} [props.onLocked]        refresh upstream state machine
 * @param {() => void} [props.onSend]          navigate to Send sub-route
 * @param {() => void} [props.onReceive]       navigate to Receive sub-route
 * @param {() => void} [props.onSwap]          navigate to SwapForm sub-route (quick action #3)
 * @param {() => void} [props.onExchange]      navigate to the Decentralized Exchange list with BTC preselected (quick action #4)
 * @param {() => void} [props.onCreateToken]   navigate to Token Wizard sub-route (§40.1)
 * @param {() => void} [props.onActions]       navigate to the Token Actions menu (§40.2+); full mode only, see the §40 note below
 * @param {() => void} [props.onMarkets]       navigate to the Markets list (§41.2)
 * @param {(session: object) => void} [props.onResumeConfirm] §5.4: finish a confirm the popup closed on
 * @param {(id: string) => void} [props.onResumeAirdrop]  navigate to AirdropForm with a pending id
 * @param {(ref: { chainId: string, address: string, orderMatchActionIndex: string }) => void} [props.onResumeCoinpay]  navigate to CoinpayForm with a pending obligation (§41.4)
 * @param {() => void} [props.onMessaging]     navigate to the Messaging inbox (§41.7.2)
 * @param {() => void} [props.onContracts]     navigate to the Contracts list (§42.2); BTC-only, App.jsx gates the prop
 * @param {() => void} [props.onStaking]       navigate to the Staking dashboard (§42.7.4); BTC-only, App.jsx gates the prop
 * @param {() => void} [props.onHistory]       navigate to the History route (§23 + §23.5 cross-chain threading)
 * @param {() => void} [props.onSignPsbt]      navigate to the PSBT-sign route (§30.4); surfaced as the marquee CTA when `settings.walletMode === 'signer'` (§20 / G041)
 * @param {() => void} [props.onSignMessage]   navigate to the user-initiated message-sign route (§17.4)
 * @param {() => void} [props.onVerifySignature]   navigate to the signature-verify route (§17.5)
 * @param {() => void} [props.onMigrateToBip39]           navigate to the §40.13 migration wizard when the active wallet is counterwallet-legacy
 * @param {() => void} [props.onOpenWalletPicker]         Settings row → host navigates to the WalletPicker route
 * @param {() => void} [props.onOpenAccountPicker]        Settings row → host navigates to the AccountPicker route
 * @param {string | null} [props.activeAccountId]          App-level active BIP44 account; when supplied, Home is read-only with respect to account selection
 * @param {(accountId: string) => void} [props.onSwitchAccount]   App-level setter for the active account (still used internally if a future inline picker lands)
 * @param {() => void} [props.onLockWallet]   locks the wallet; only shells with no header (the extension popup and side panel) pass it, and Home then shows a lock button
 * @param {number} [props.resumeKey]          changes once per unlocked native-app resume
 *
 * §40 actions are NOT a Home prop. Home used to accept an `extraActions`
 * array "for the small-mode drawer" and never rendered it, so the web
 * shell built 24 entries per render that no user could ever reach from
 * this component. Both variants route to the same dedicated
 * ActionsMenu screen instead: full mode via the "More actions" button in
 * the action grid below (`onActions`), small mode via the pancake menu's
 * "More actions" row (MenuRoute) or the command palette. Add entries
 * there, not here.
 */
export function Home({ onLocked, onResumeConfirm, onSend, onReceive, onSwap, onExchange, onCreateToken, onActions, onMarkets, onResumeAirdrop, onResumeCoinpay, onMessaging, onContracts, onStaking, onHistory, onAddresses, onMigrateToBip39, onOpenWalletPicker, onOpenAccountPicker, onSignPsbt, onSignMessage, onVerifySignature, activeWalletId: activeWalletIdProp, activeAccountId: activeAccountIdProp, onSwitchAccount, onSelectToken, onSelectEntry, networkFilter: networkFilterProp, onNetworkFilterChange: onNetworkFilterChangeProp, tokenQuery: tokenQueryProp, onTokenQueryChange: onTokenQueryChangeProp, onCommandPalette, onOpenSettings, onLockWallet, resumeKey = 0, demoBannerInHeader = false }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const browserOnline = useOnlineStatus();
    const { overall: reachabilityOverall } = useReachability({});
    const networkActionsAvailable = browserOnline && reachabilityOverall !== 'offline';
    const { showToast } = useToast();

    const [wallets, setWallets] = useState(/** @type {any[] | null} */ (null));
    // The host owns the active wallet when it wires `activeWalletId`; Home's
    // own state is a fallback for shells that don't. Home used to own this
    // outright and only ever self-elected wallets[0], so after a switch it kept
    // rendering wallet #1 while the host handed down the NEW wallet's account -
    // a cross-wallet (walletId, accountId) pair that walletBalances rejects
    // outright ("account X does not belong to wallet Y"), blanking Home.
    const [activeWalletIdLocal, setActiveWalletIdLocal] = useState(
        /** @type {string | null} */ (null),
    );
    const activeWalletId = activeWalletIdProp ?? activeWalletIdLocal;
    const settings = useSettings();
    const walletMode = settings.settings?.walletMode || WALLET_MODE_DEFAULT;
    const isSignerMode = walletMode === 'signer';
    const isWatcherMode = walletMode === 'watcher';
    const isDemoActive = flowsLib.isDemoWallet(activeWalletId);
    const quickActionsReason = isDemoActive
        ? 'Demo wallets are read-only, so actions that receive or move funds are hidden.'
        : isWatcherMode
            ? 'Watch-only mode builds Send and Swap transactions unsigned for your signer.'
            : null;
    const [accounts, setAccounts] = useState(/** @type {any[] | null} */ (null));
    // Local fallback used only when the host doesn't supply
    // `activeAccountIdProp` (e.g. desktop shell pinned to an older
    // App.jsx). When the prop is set, Home is read-only and the
    // popover delegates switching to `onSwitchAccount`.
    const [activeAccountIdLocal, setActiveAccountIdLocal] = useState(
        /** @type {string | null} */ (null),
    );
    const activeAccountId = activeAccountIdProp ?? activeAccountIdLocal;
    // Unread-message count for the active wallet + account, surfaced as a Home
    // alert and a dot on the Messaging button (see useMessagingUnread).
    const messagingUnread = useMessagingUnread(activeWalletId, activeAccountId);
    const initialBalanceCacheRef = useRef(/** @type {{ value: ReturnType<typeof readBalanceCache> } | undefined} */ (undefined));
    if (!initialBalanceCacheRef.current) {
        initialBalanceCacheRef.current = {
            value: readBalanceCache(activeWalletId, activeAccountId),
        };
    }
    const initialBalanceCache = initialBalanceCacheRef.current.value;
    const [balances, setBalances] = useState(
        /** @type {Record<string, any[]> | null} */ (initialBalanceCache?.balances || null),
    );
    const balancesRef = useRef(/** @type {Record<string, any[]> | null} */ (null));
    balancesRef.current = balances;
    // Which wallet:account pair the balances on screen belong to; saved rows count.
    const balancesScopeRef = useRef(/** @type {string | null} */ (
        initialBalanceCache ? `${activeWalletId}:${activeAccountId || ''}` : null
    ));
    // Active (operating) address per chain. The headline balance per coin
    // reflects this address only (not the sum across all addresses).
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id: string, address: string }>} */ (initialBalanceCache?.activeByChain || {}),
    );
    // Cluster G FOLLOWUP 5: Unix-ms timestamp of the most recent
    // successful balance fetch; null until the first one completes.
    // Threaded into HomeTabs → StalenessLabel so the user can tell
    // when the balance view was last live.
    const [balancesFetchedAt, setBalancesFetchedAt] = useState(
        /** @type {number | null} */ (initialBalanceCache?.fetchedAt ?? null),
    );
    // Cached rows stay visible while their live replacement is in flight.
    // This flag distinguishes that refresh from a first load with no data.
    const [cachedBalancesUpdating, setCachedBalancesUpdating] = useState(
        Boolean(initialBalanceCache) && isNavigatorOnline(),
    );
    const balanceScopeRef = useRef({ walletId: activeWalletId, accountId: activeAccountId || null });
    const balanceScopeChanged = balanceScopeRef.current.walletId !== activeWalletId
        || balanceScopeRef.current.accountId !== (activeAccountId || null);
    if (balanceScopeChanged) {
        // React discards this render and retries with the next scope's state,
        // so a wallet switch never commits one frame of the prior wallet.
        balanceScopeRef.current = { walletId: activeWalletId, accountId: activeAccountId || null };
        const scopedCache = readBalanceCache(activeWalletId, activeAccountId);
        setBalances(scopedCache?.balances || null);
        setActiveByChain(scopedCache?.activeByChain || {});
        setBalancesFetchedAt(scopedCache?.fetchedAt ?? null);
        setCachedBalancesUpdating(Boolean(scopedCache) && isNavigatorOnline());
        balancesScopeRef.current = scopedCache ? `${activeWalletId}:${activeAccountId || ''}` : null;
    }
    // What every row consumer reads: the balances plus each shown address's
    // open-offer escrow, so a token escrowed in full keeps its row.
    const balancesView = useEscrowedBalances({ balances, activeByChain, balancesFetchedAt, messaging });
    const backupReminderHasFunds = useMemo(() => hasBackupReminderFunds(
        buildBalanceRows(balancesView, chainRegistry, activeByChain),
    ), [balancesView, activeByChain]);
    const [pendingAirdrops, setPendingAirdrops] = useState(
        /** @type {any[]} */ ([]),
    );
    // Pending COINPAY obligations behind the "Payment due" resume cards.
    // Read from the tree's shared scan rather than re-scanned here: Home used
    // to fan one explorer read per address out of every 20 s balance poll, on
    // top of the identical scan the shells' nav badge already runs (spec row
    // 29). Under a CoinpayObligationsProvider (web, desktop, mobile) these
    // rows ARE the badge's rows, refreshed on its 60 s cadence; the extension
    // popup mounts no provider, so this call runs the only instance there.
    const { obligations: pendingCoinpays } = useSharedCoinpayObligations(
        activeWalletId, activeAccountId,
    );
    // Unfinished confirms (an UNSIGNED composed PSBT the popup
    // closed on). Same slot as the two cards above; nothing here has moved
    // money, which is why the card says so in as many words.
    const [confirmSessions, setConfirmSessions] = useState(
        /** @type {any[]} */ ([]),
    );
    const [multisig, setMultisig] = useState(
        /** @type {{ threshold: number, cosignerCount: number, scheme: string } | null} */ (null),
    );
    const [loadError, setLoadError] = useState(
        /** @type {string | null} */ (null),
    );
    // A rate limit is the one load failure that comes with an end time, so it
    // is the one the banner can count down instead of leaving the user to
    // guess (rate-limits spec, M4). `rateLimitRetryAt` is the wall-clock ms the
    // wait ends at; `rateLimitTickNow` is what makes the seconds on screen
    // move, since the sentence is derived from the two rather than stored.
    const [rateLimitRetryAt, setRateLimitRetryAt] = useState(
        /** @type {number | null} */ (null),
    );
    const [rateLimitTickNow, setRateLimitTickNow] = useState(() => Date.now());
    // Whether the origin actually named the seconds. When it did not, the wait
    // still runs (a re-load has to happen) but the banner says "a moment"
    // rather than counting down a number the wallet made up.
    const [rateLimitNamedSeconds, setRateLimitNamedSeconds] = useState(false);
    const [alertsOpen, setAlertsOpen] = useState(false);
    // The full shell controls these values so its header and Home share one
    // model. Compact shells use the same per-wallet model here directly.
    const walletFilters = useWalletFilters(activeWalletId);
    const networkFilter = networkFilterProp ?? walletFilters.networkFilter;
    const setNetworkFilter = onNetworkFilterChangeProp ?? walletFilters.setNetworkFilter;
    // BTC-only gate: multisig is Bitcoin-only at launch (spec 10.3), so the
    // multisig badge data only flows when Bitcoin is in view.
    const isBtc = networkFilter === 'bitcoin' || networkFilter === 'all';
    const tokenQuery = tokenQueryProp ?? walletFilters.tokenQuery;
    const setTokenQuery = onTokenQueryChangeProp ?? walletFilters.setTokenQuery;
    const [settingsOpen, setSettingsOpen] = useState(false);

    const [homeMoreOpen, setHomeMoreOpen] = useState(false);
    // The system Back gesture closes this before it leaves the screen.
    useBackHandler(homeMoreOpen ? () => setHomeMoreOpen(false) : undefined);
    const homeMoreWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => {
        if (!homeMoreOpen) return undefined;
        const onClick = (e) => {
            if (homeMoreWrapRef.current?.contains(e.target)) return;
            setHomeMoreOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setHomeMoreOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [homeMoreOpen]);
    // The overflow menu's entries as data, so an empty list can
    // drop the "More" button itself. Every entry it holds today is
    // DEX-gated, so a build that hides the DEX wires none and used to open
    // the menu onto a dead "No additional actions" row. A future non-DEX
    // entry appends here and keeps More alive on its own.
    const runNetworkAction = useCallback((label, action) => {
        if (typeof action !== 'function') return;
        if (!networkActionsAvailable) {
            showToast({
                message: `${label} needs a network connection. Your cached balances are still available.`,
                variant: 'error',
            });
            return;
        }
        action();
    }, [networkActionsAvailable, showToast]);

    const homeMoreActions = useMemo(() => {
        const out = [];
        if (onSwap && !isDemoActive) {
            out.push({
                id: 'swap',
                label: 'Swap',
                icon: <Icon.SwapIcon />,
                onSelect: () => runNetworkAction('Swapping', onSwap),
            });
        }
        return out;
    }, [isDemoActive, onSwap, runNetworkAction]);
    const quickActionCount = (isDemoActive ? 0 : 2)
        + (onExchange ? 1 : 0)
        + (homeMoreActions.length > 0 ? 1 : 0);
    // Cluster H FOLLOWUP 7: when "Back up now" lands the user in
    // Settings, this captures which subpage to deep-link into so the
    // user doesn't land on the Settings root + have to re-find Backup.
    const [settingsSubpage, setSettingsSubpage] = useState(/** @type {string | null} */ (null));
    // The "no addresses yet" hint pointed at Receive but offered
    // no way to get there, so the emptiest possible Home was also the most
    // inert. The hint now carries an Add-address CTA; `homeReloadKey`
    // refetches balances once the address lands, so Home fills in without
    // a wallet switch.
    const [addAddressOpen, setAddAddressOpen] = useState(false);
    const [homeReloadKey, setHomeReloadKey] = useState(0);
    const [portfolioRefreshing, setPortfolioRefreshing] = useState(false);
    const portfolioRefreshIdRef = useRef(0);
    useEffect(() => {
        portfolioRefreshIdRef.current += 1;
        setPortfolioRefreshing(false);
    }, [activeWalletId, activeAccountId]);
    // §27.3 / G072: pinned tokens. Loaded from Settings on unlock; toggled
    // optimistically in the UI then persisted via messaging.updateSettings.
    const [pinnedTokens, setPinnedTokens] = useState(/** @type {string[]} */ ([]));
    // §27.4 / G073: hidden tokens. Same pattern as pinned. Hidden rows
    // collapse into the "Show N hidden tokens" footer of each tab.
    const [hiddenTokens, setHiddenTokens] = useState(/** @type {string[]} */ ([]));
    // Per-row pin / hide buttons are gated on user opt-in. Default is off
    // (keeps rows clean); enabling either is one toggle in Settings →
    // Display. The pinned/hidden lists themselves still apply when off.
    const [showPinAffordance, setShowPinAffordance] = useState(false);
    const [showHideAffordance, setShowHideAffordance] = useState(false);
    // Cluster I FOLLOWUP 2: auto-hide-spam toast. We only ever nudge
    // once per (wallet, mount) tuple. Re-prompting on every balance
    // refresh would be noisy; the user explicitly opting Hide / dismissing
    // the toast counts as "they decided" for the rest of the session.
    const spamNudgedForWalletRef = useRef(/** @type {string | null} */ (null));
    // One re-poll rule for this mount. The interval below already bounds how
    // stale a balance can be, so a focus/visibilitychange re-poll only buys
    // anything once the balances are older than that; without the rule an
    // alt-tab (which fires both events) cost two full reads of every address
    // inside one rate-limit period. See flows/pollThrottle.js.
    const pollThrottleRef = useRef(flowsLib.createPollThrottle(BALANCE_POLL_INTERVAL_MS));

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.getSettings !== 'function') return undefined;
        setPinnedTokens([]);
        messaging.getSettings().then((s) => {
            if (cancelled) return;
            const pins = pinnedTokensForWallet(s, activeWalletId)
                .filter((k) => typeof k === 'string');
            const hides = Array.isArray(s?.hiddenTokens) ? s.hiddenTokens.filter((k) => typeof k === 'string') : [];
            setPinnedTokens(pins);
            setHiddenTokens(hides);
            setShowPinAffordance(s?.showPinAffordance === true);
            setShowHideAffordance(s?.showHideAffordance === true);
        }).catch(() => { /* tolerate missing settings; empty pin list is a fine default */ });
        return () => { cancelled = true; };
    }, [messaging, activeWalletId]);

    const handleTogglePin = useCallback((key, nextPinned) => {
        if (typeof key !== 'string' || !key) return;
        setPinnedTokens((prev) => {
            const set = new Set(prev);
            if (nextPinned) set.add(key);
            else set.delete(key);
            const next = Array.from(set);
            if (typeof messaging?.updateSettings === 'function') {
                messaging.updateSettings(
                    pinnedTokensPatchForWallet(activeWalletId, next),
                ).catch(() => { /* best-effort */ });
            }
            return next;
        });
    }, [messaging, activeWalletId]);

    // §34.2 Balances context shortcuts: p / h / o act on the balance row that
    // currently has keyboard focus (rows are buttons, so Tab reaches them and
    // each carries a data-balance-key stamp). No focused row -> the handler
    // declines and the key does nothing, exactly like the spec's "selected
    // token" precondition. Pin/hide respect the same opt-in affordance gates
    // as the on-row buttons.
    const focusedBalanceRow = useCallback(() => {
        if (typeof document === 'undefined') return null;
        const el = document.activeElement?.closest?.('[data-balance-key]');
        const key = el?.getAttribute('data-balance-key');
        if (!key || !balances) return null;
        const rows = buildBalanceRows(balancesView, chainRegistry, activeByChain);
        return rows.find((r) => `${r.chainId}:${r.tick}` === key) || null;
    }, [balancesView, activeByChain]);

    useScreenShortcuts({
        enabled: !settingsOpen,
        keys: {
            p: () => {
                const row = focusedBalanceRow();
                if (!row || !showPinAffordance) return false;
                const key = `${row.chainId}:${row.tick}`;
                handleTogglePin(key, !pinnedTokens.includes(key));
                return true;
            },
            h: () => {
                const row = focusedBalanceRow();
                if (!row || !showHideAffordance) return false;
                const key = `${row.chainId}:${row.tick}`;
                handleToggleHide(key, !hiddenTokens.includes(key));
                return true;
            },
            o: () => {
                const row = focusedBalanceRow();
                if (!row || typeof onSelectToken !== 'function') return false;
                onSelectToken(row);
                return true;
            },
        },
    });

    const handleToggleHide = useCallback((key, nextHidden) => {
        if (typeof key !== 'string' || !key) return;
        setHiddenTokens((prev) => {
            const set = new Set(prev);
            if (nextHidden) set.add(key);
            else set.delete(key);
            const next = Array.from(set);
            if (typeof messaging?.updateSettings === 'function') {
                messaging.updateSettings({ hiddenTokens: next }).catch(() => { /* best-effort */ });
            }
            return next;
        });
    }, [messaging]);

    // Cluster I FOLLOWUP 2: auto-hide-spam nudge. After the first
    // balance load that yields candidate spam rows, surface a one-shot
    // toast with a Hide-all action. The candidate set excludes anything
    // the user already hid; if it's empty after that filter, we say
    // nothing. Nudge fires at most once per (wallet, mount) tuple so a
    // mid-session rebalance doesn't re-prompt.
    useEffect(() => {
        if (!balances || !activeWalletId) return;
        if (spamNudgedForWalletRef.current === activeWalletId) return;
        const rows = buildBalanceRows(balancesView, chainRegistry, activeByChain);
        const candidates = detectSpamCandidates(rows);
        const hiddenSet = new Set(hiddenTokens);
        const fresh = candidates.filter((k) => !hiddenSet.has(k));
        if (fresh.length === 0) return;
        spamNudgedForWalletRef.current = activeWalletId;
        showToast({
            message: `${fresh.length} likely-spam token${fresh.length === 1 ? '' : 's'} detected. Bulk-hide?`,
            actionLabel: `Hide ${fresh.length}`,
            durationMs: 12000,
            onAction: () => {
                setHiddenTokens((prev) => {
                    const merged = Array.from(new Set([...prev, ...fresh]));
                    if (typeof messaging?.updateSettings === 'function') {
                        messaging.updateSettings({ hiddenTokens: merged }).catch(() => { /* best-effort */ });
                    }
                    return merged;
                });
            },
        });
    }, [balancesView, activeByChain, activeWalletId, hiddenTokens, messaging, showToast]);

    // Load the wallets list once. The user picks the active one via
    // HeaderSettingsButton → onSwitchWallet → setActiveWalletId →
    // the per-wallet effect below refetches everything.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const list = await messaging.listWallets();
                if (cancelled) return;
                setWallets(list);
                if (!Array.isArray(list) || list.length === 0) {
                    setLoadError('No wallets found.');
                    return;
                }
                if (!activeWalletIdProp && !activeWalletIdLocal) setActiveWalletIdLocal(list[0].id);
            } catch (err) {
                if (!cancelled) setLoadError(err?.message || 'Failed to load wallets.');
            }
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messaging]);

    // Load BIP44 accounts for the active wallet so the gear popover can
    // render them. When the host owns `activeAccountId` (App-level), it
    // also picks the initial account; this effect only updates Home's
    // local fallback to keep the popover usable in shells that don't
    // wire the prop.
    useEffect(() => {
        if (!activeWalletId) {
            setAccounts(null);
            if (!onSwitchAccount) setActiveAccountIdLocal(null);
            return undefined;
        }
        if (typeof messaging.listAccounts !== 'function') {
            setAccounts([]);
            if (!onSwitchAccount) setActiveAccountIdLocal(null);
            return undefined;
        }
        setAccounts(null);
        let cancelled = false;
        const walletId = activeWalletId;
        messaging.listAccounts(walletId)
            .then((list) => {
                if (cancelled) return;
                const sorted = Array.isArray(list)
                    ? [...list].sort((a, b) => a.index - b.index)
                    : [];
                setAccounts(sorted);
                if (!onSwitchAccount) {
                    setActiveAccountIdLocal((prev) => {
                        if (prev && sorted.some((a) => a.id === prev)) return prev;
                        return sorted[0]?.id || null;
                    });
                }
            })
            .catch(() => {
                if (cancelled) return;
                setAccounts([]);
                if (!onSwitchAccount) setActiveAccountIdLocal(null);
            });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeWalletId, messaging]);

    // Per-wallet load: balances, multisig indicator, pending airdrops and
    // unfinished confirms. Scope changes clear data that belongs to another
    // wallet or account. Same-scope reloads, polls and focus refreshes keep
    // cached data visible until fresh data lands.
    // Start (or restart) a rate-limit wait: the banner counts down from here
    // and the effect below re-loads when it reaches zero.
    const beginRateLimitWait = useCallback((secondsOrNull) => {
        const named = Number.isInteger(secondsOrNull) && secondsOrNull > 0;
        const seconds = named ? secondsOrNull : RATE_LIMIT_FALLBACK_SECONDS;
        const now = Date.now();
        setRateLimitNamedSeconds(named);
        setRateLimitTickNow(now);
        setRateLimitRetryAt(now + seconds * 1000);
        setLoadError(`Couldn't ${BALANCES_VERB}. ${rateLimitedMessage(named ? seconds : null)}`);
    }, []);

    const loadHomeData = useCallback(async (walletId, accountId, {
        reset,
        isCancelled,
        reportError = false,
    }) => {
        // The saved copy of this pair's balances; only a clean fresh read
        // replaces it. activeForCache starts from the saved active addresses.
        let activeForCache = readBalanceCache(walletId, accountId)?.activeByChain || {};
        let freshBalances = null;
        let freshFetchedAt = null;
        let freshBalancesCacheable = false;
        // A browser offline event is definitive enough to avoid starting work
        // that cannot finish. In particular, keep the last successful balance
        // state on screen instead of replacing it with a loading skeleton.
        if (!isNavigatorOnline()) {
            pollThrottleRef.current.fail();
            if (!isCancelled()) setCachedBalancesUpdating(false);
            return;
        }
        if (reset) {
            const scopeKey = `${walletId}:${accountId || ''}`;
            const hasCachedBalances = balancesScopeRef.current === scopeKey;
            // A reset owns a fresh polling window even when cached rows remain
            // visible for the same wallet and account.
            pollThrottleRef.current.reset();
            // ...but the load about to run DOES take the in-flight slot, the
            // way an event-driven one does. Without it a cold open that is
            // still waiting (a 429's honoured Retry-After holds one request for
            // up to 60 s) would be joined by the 20 s beat, which is the burst
            // the limiter counted in the first place.
            pollThrottleRef.current.start();
            if (!hasCachedBalances) {
                setBalances(null);
                setBalancesFetchedAt(null);
                setActiveByChain({});
                setCachedBalancesUpdating(false);
                setMultisig(null);
                setPendingAirdrops([]);
                setConfirmSessions([]);
            } else {
                setCachedBalancesUpdating(isNavigatorOnline());
            }
            setLoadError(null);
        }

        try {
            // Cluster J FOLLOWUP 1: synthesize fabricated balances
            // for the demo wallet so Home / Send / Receive feel
            // populated. Uses the wallet's real address records so
            // the rest of the app sees the same address-rooted
            // shape it would for a funded wallet.
            // loadDisplayBalances holds that branch so the palette shows the same.
            const b = await loadDisplayBalances(messaging, walletId, accountId);
            if (!isCancelled()) {
                // A read can LAND and still be rate limited: the aggregator
                // reports a refused address as that entry's `error` string
                // rather than throwing, so the banner is decided from what
                // came back, on the poll path as well as the reset one. The
                // balances that did land stay on screen either way.
                const wait = rateLimitWaitFromBalances(b);
                const refreshHasFailure = reportError
                    && balancesRef.current !== null
                    && Object.values(b || {}).some((rows) => (
                        Array.isArray(rows) && rows.some((entry) => entry?.error)
                    ));
                if (refreshHasFailure) {
                    pollThrottleRef.current.fail();
                    showToast({
                        message: wait
                            ? "Couldn't refresh balances. The service asked the wallet to slow down. Try again in a moment."
                            : "Couldn't refresh balances. Try again.",
                        variant: 'error',
                    });
                } else {
                    freshBalancesCacheable = !wait;
                    // Fresh balances restart the re-poll window, whichever
                    // path asks for them.
                    pollThrottleRef.current.succeed();
                    balancesScopeRef.current = `${walletId}:${accountId || ''}`;
                    setBalances(b);
                    setBalancesFetchedAt(Date.now());
                    freshBalances = b;
                    freshFetchedAt = Date.now();
                }
                setCachedBalancesUpdating(false);
                if (wait && !refreshHasFailure) {
                    beginRateLimitWait(wait.seconds);
                } else if (!refreshHasFailure) {
                    // Balances landed clean, so whatever the last failure said
                    // is no longer true. Cleared on the poll path too: a wallet
                    // that recovered on its own used to keep the error banner
                    // over correct balances until the next switch, and the
                    // countdown promises the banner goes when the wait pays off.
                    setLoadError(null);
                    setRateLimitRetryAt(null);
                }
            }
        } catch (err) {
            // Release the window rather than move it: a blip must not pin the
            // screen to stale balances for a whole interval.
            pollThrottleRef.current.fail();
            // A silent poll that fails (e.g. a transient network blip)
            // should not stomp a screen the user is already looking at
            // with an error banner; only surface it on the reset path.
            if (!isCancelled()) {
                setCachedBalancesUpdating(false);
                // The raw SDK message used to go straight on screen here, URL
                // and all ("Explorer returned HTTP 429 for /RLTC/api/balances/
                // bcrt1q..."). humanizeError owns the wording for every shape
                // this can arrive in.
                // A THROWN failure is still possible (the vault, the messaging
                // channel, a chain-wide fault), and it is the path that used to
                // print the wire text.
                const humanized = humanizeError(err, BALANCES_VERB);
                if (reportError && balancesRef.current !== null) {
                    showToast({
                        message: humanizeError(err, 'refresh balances').message,
                        variant: 'error',
                    });
                } else if (reset && humanized.cause === 'rate_limited') {
                    beginRateLimitWait(humanized.retryAfterSeconds ?? null);
                } else if (reset) {
                    setLoadError(humanized.message);
                }
            }
        }

        if (typeof messaging.getActiveAddresses === 'function') {
            try {
                const active = await messaging.getActiveAddresses(walletId, accountId);
                if (!isCancelled()) {
                    activeForCache = active || {};
                    setActiveByChain(activeForCache);
                }
            } catch { /* fall back to aggregate when unavailable */ }
        }

        if (!isCancelled() && freshBalances && freshBalancesCacheable) {
            writeBalanceCache(walletId, accountId, {
                balances: freshBalances,
                activeByChain: activeForCache,
                fetchedAt: freshFetchedAt,
            });
        }

        if (typeof messaging.getMultisigReceiveAddress === 'function') {
            const btcChain = chainRegistry.byCoin('bitcoin')[0]?.id;
            if (btcChain) {
                messaging.getMultisigReceiveAddress({ walletId, chainId: btcChain })
                    .then((r) => {
                        if (isCancelled()) return;
                        if (r && Number.isInteger(r.threshold)) {
                            setMultisig({
                                threshold: r.threshold,
                                cosignerCount: r.cosignerCount,
                                scheme: r.scheme,
                            });
                        }
                    })
                    .catch(() => { /* no multisig configured */ });
            }
        }

        if (typeof messaging.listPendingAirdropsForWallet === 'function') {
            try {
                const records = await messaging.listPendingAirdropsForWallet({ walletId });
                if (!isCancelled()) {
                    const resumable = (records || []).filter(
                        (r) => r.stage === 'waiting-index' || r.stage === 'ready-to-airdrop',
                    );
                    setPendingAirdrops(resumable);
                }
            } catch { /* non-fatal */ }
        }

        // No coinpay scan here on purpose. Before spec row 29 one sat between
        // the airdrop read and the confirm read, costing one explorer read per
        // address on every beat of this poll, duplicating the scan
        // `useCoinpayObligations` already runs for the nav badge. The resume
        // cards read that one scan through `useSharedCoinpayObligations` above.

        // Confirms the popup closed on. Extension-only in
        // practice (the store is chrome.storage.session), and the route
        // answers with an empty list on the shells that have none, so no
        // shell check is needed here.
        if (typeof messaging.listConfirmSessions === 'function') {
            try {
                const resp = await messaging.listConfirmSessions();
                if (!isCancelled()) setConfirmSessions(resp?.sessions || []);
            } catch { /* non-fatal */ }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messaging]);

    // The one manual refresh on Home (the hero's button): reloads balances,
    // and with them the prices, quietly over what is on screen. A failure is a
    // toast, never a skeleton or a banner over balances that are still good.
    // A load already in flight (a poll, a focus refresh) is not doubled up.
    const refreshPortfolio = useCallback(async () => {
        if (!activeWalletId || portfolioRefreshing || !browserOnline || !isNavigatorOnline()) return;
        if (pollThrottleRef.current.isInFlight()) return;
        const refreshId = portfolioRefreshIdRef.current + 1;
        portfolioRefreshIdRef.current = refreshId;
        setPortfolioRefreshing(true);
        pollThrottleRef.current.reset();
        pollThrottleRef.current.start();
        try {
            await loadHomeData(activeWalletId, activeAccountId || undefined, {
                reset: false,
                reportError: true,
                isCancelled: () => portfolioRefreshIdRef.current !== refreshId,
            });
        } finally {
            if (portfolioRefreshIdRef.current === refreshId) setPortfolioRefreshing(false);
        }
    }, [activeWalletId, activeAccountId, browserOnline, loadHomeData, portfolioRefreshing]);

    // Reruns when the active wallet OR active BIP44 account changes.
    // Switching either flushes stale state and refetches. When
    // `activeAccountId` is null (data layer returned no accounts for this
    // wallet, or pre-load), the calls fall back to wallet-wide aggregation.
    useEffect(() => {
        if (!activeWalletId) return undefined;
        let cancelled = false;
        loadHomeData(activeWalletId, activeAccountId || undefined, {
            reset: true,
            isCancelled: () => cancelled,
        });
        return () => { cancelled = true; };
    }, [activeWalletId, activeAccountId, homeReloadKey, resumeKey, loadHomeData]);

    // Nothing pushes balance changes to the wallet - an incoming send, a
    // mint landing, a token someone else sent you - so Home has to ask.
    // Poll on an interval, and also refresh the moment the tab/window
    // regains focus or visibility, since that's exactly when a user goes
    // looking for a balance that "isn't showing up yet". Paused while the
    // document is hidden so a backgrounded wallet isn't burning SDK/indexer
    // calls for no viewer.
    useEffect(() => {
        if (!activeWalletId) return undefined;
        let cancelled = false;
        const walletId = activeWalletId;
        const accountId = activeAccountId || undefined;

        const load = () => loadHomeData(walletId, accountId, {
            reset: false, isCancelled: () => cancelled,
        });

        // The beat is not gated on the WINDOW: it is what keeps the window
        // moving, since loadHomeData notes the success when balances land. It
        // IS gated on the in-flight slot, and that is the whole of the change:
        // a load can now sit for up to 60 s while the SDK waits out a
        // `Retry-After`, and a 20 s beat firing through it would put three
        // whole wallet loads against the bucket the first one is waiting on,
        // which is how one 429 becomes three. Checked before `start()`, since
        // `start()` claims the slot and its false answer also means "the window
        // has not aged", which the beat must ignore.
        const poll = () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            if (!isNavigatorOnline()) return;
            if (pollThrottleRef.current.isInFlight()) return;
            // Claim the slot the reset path's way. `start()` alone marks a
            // load in flight only once the window has aged, and at beat time
            // the window is younger than the interval by the previous load's
            // own latency (the beat fires one interval after the previous
            // BEAT; `succeed()` ran later, when that load landed), so a bare
            // `start()` left the beat's load unmarked and the next beat
            // stacked a second one on it. The window is re-keyed on this
            // load's landing either way.
            pollThrottleRef.current.reset();
            pollThrottleRef.current.start();
            load();
        };

        const stopPollInterval = startVisibleInterval(poll, BALANCE_POLL_INTERVAL_MS, {
            runOnVisible: false,
        });
        // An alt-tab fires `focus` and `visibilitychange` together, so coming
        // back to the wallet used to cost two loads. The first event after the
        // balances have aged past one interval still fires at once; the rest
        // of the burst rides the data the beat already has.
        const onVisibilityOrFocus = () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            if (!isNavigatorOnline()) return;
            if (!pollThrottleRef.current.start()) return;
            load();
        };
        window.addEventListener('focus', onVisibilityOrFocus);
        document.addEventListener('visibilitychange', onVisibilityOrFocus);

        return () => {
            cancelled = true;
            stopPollInterval();
            window.removeEventListener('focus', onVisibilityOrFocus);
            document.removeEventListener('visibilitychange', onVisibilityOrFocus);
        };
    }, [activeWalletId, activeAccountId, loadHomeData]);

    // Reconnect immediately rather than waiting for the next balance poll.
    // The quiet refresh preserves cached rows until fresh data lands.
    const wasBrowserOnlineRef = useRef(browserOnline);
    useEffect(() => {
        const reconnected = !wasBrowserOnlineRef.current && browserOnline;
        wasBrowserOnlineRef.current = browserOnline;
        if (!reconnected || !activeWalletId) return;
        if (pollThrottleRef.current.isInFlight()) return;
        pollThrottleRef.current.reset();
        pollThrottleRef.current.start();
        let cancelled = false;
        loadHomeData(activeWalletId, activeAccountId || undefined, {
            reset: false,
            isCancelled: () => cancelled,
        });
        return () => { cancelled = true; };
    }, [browserOnline, activeWalletId, activeAccountId, loadHomeData]);

    // Cancellation for the re-load the countdown fires, and it deliberately
    // does NOT ride the ticking effect's own flag: reaching zero clears
    // `rateLimitRetryAt`, which tears that effect down in the same commit, so a
    // load cancelled by its own trigger would throw away the balances it just
    // asked for and leave the banner up for good. Only a wallet or account
    // switch (or an unmount) actually makes such a result stale.
    const rateLimitReloadCancelled = useRef(false);
    useEffect(() => {
        rateLimitReloadCancelled.current = false;
        return () => { rateLimitReloadCancelled.current = true; };
    }, [activeWalletId, activeAccountId]);

    // The rate-limit wait, ticking. While `rateLimitRetryAt` is set the banner
    // re-renders once a second off the remaining time, and when it runs out the
    // wallet re-loads BY ITSELF: "; retrying." in the copy is a promise, and a
    // user who has already been told to wait must not also have to click. The
    // re-load takes the throttle's in-flight slot the way the beat does, so the
    // next beat does not land on top of it.
    useEffect(() => {
        if (rateLimitRetryAt === null || !activeWalletId) return undefined;
        let stopped = false;
        const walletId = activeWalletId;
        const accountId = activeAccountId || undefined;
        const id = setInterval(() => {
            if (stopped) return;
            const now = Date.now();
            if (now < rateLimitRetryAt) {
                setRateLimitTickNow(now);
                return;
            }
            if (pollThrottleRef.current.isInFlight()) return;
            setRateLimitRetryAt(null);
            setLoadError(`Couldn't ${BALANCES_VERB}. ${rateLimitedMessage(null)}`);
            pollThrottleRef.current.reset();
            pollThrottleRef.current.start();
            loadHomeData(walletId, accountId, {
                reset: false,
                isCancelled: () => rateLimitReloadCancelled.current,
            });
        }, 1000);
        return () => { stopped = true; clearInterval(id); };
    }, [rateLimitRetryAt, activeWalletId, activeAccountId, loadHomeData]);

    // Home does not lock, in either sense. The idle timer lives
    // in each shell's AppInner via `useAutoLockPolicy`, because this
    // route unmounts the moment the user navigates to Send / Receive /
    // History / Settings, and useAutoLock's effect cleanup cancelled the
    // pending timer with it - a wallet parked on one of those screens
    // never locked. The manual lock affordance is the shell's too (the
    // pancake menu's Lock entry and the §34 keyboard shortcut), so the
    // local `handleLock` that used to sit here had exactly one consumer,
    // the auto-lock hook, and left with it. Do not re-add a
    // `useAutoLock` call to any route.
    const hasChains = hasAvailableChain(settings, chainRegistry);
    // §7/§8: SPV proof verification. Off for demo wallets (synthetic
    // balances have no real proofs) and when the user opts out via
    // `verifyProofs` (default on). The map is keyed `chainId:tick` and
    // fills in progressively; HomeTabs badges the Tokens rows from it.
    const verifyProofsEnabled = settings.settings?.verifyProofs !== false && !isDemoActive;
    const verifyMap = useProofVerification({ messaging, balances, enabled: verifyProofsEnabled });

    // `hideSmallBalances` persisted for fourteen sessions without a
    // single reader. HomeTabs forwards it to the Coins and Tokens lists,
    // which collapse dust rows into their own expandable section.
    const hideSmallBalances = settings.settings?.privacy?.hideSmallBalances === true;

    const activeWallet = wallets && activeWalletId
        ? wallets.find((w) => w.id === activeWalletId)
        : null;

    useEffect(() => {
        if (activeWallet?.id && activeWallet?.name) {
            writeActiveWallet(activeWallet.id, activeWallet.name);
        }
    }, [activeWallet?.id, activeWallet?.name]);

    // Build the wallet-level alerts from the one shared list (walletAlerts.js);
    // a new alert is added there, never here.
    const alerts = buildWalletAlerts({ activeWallet, messagingUnread }, { onMessaging, onMigrateToBip39 });

    // Coin families surfaced in the dataset, in canonical order.
    // Drives both the network filter and the per-tab "no balances on
    // this network" empty messages.
    const coinFamilies = useMemo(() => {
        const seen = new Set();
        if (balances) {
            for (const cid of Object.keys(balances)) {
                const desc = chainRegistry.get(cid);
                if (desc) seen.add(desc.coin);
            }
        }
        const ordered = ['bitcoin', 'litecoin', 'dogecoin'].filter((c) => seen.has(c));
        for (const c of seen) if (!ordered.includes(c)) ordered.push(c);
        return ordered;
    }, [balances]);

    const pinnedKeys = useMemo(() => new Set(pinnedTokens), [pinnedTokens]);
    const hiddenKeys = useMemo(() => new Set(hiddenTokens), [hiddenTokens]);
    const handleAddAddress = useCallback(() => setAddAddressOpen(true), []);
    const quickActions = useMemo(() => (
        <div>
            {quickActionsReason ? (
                <p className={styles.quickActionsReason} id="home-quick-actions-reason">
                    {quickActionsReason}
                </p>
            ) : null}
            <div
                className={`${styles.quickActions} ${quickActionCount === 1 ? styles.quickActionsSingle : ''}`}
                role="group"
                aria-label={t('home.quickActions')}
                aria-describedby={quickActionsReason ? 'home-quick-actions-reason' : undefined}
            >
                {!isDemoActive ? (
                    <SendQuickAction
                        onSend={onSend}
                        networkActionsAvailable={networkActionsAvailable}
                        onOffline={() => runNetworkAction('Sending', onSend)}
                    />
                ) : null}
                {!isDemoActive ? (
                    <button
                        type="button"
                        className={styles.quickAction}
                        onClick={onReceive}
                        disabled={!onReceive}
                    >
                        <span className={styles.quickActionIcon} aria-hidden="true"><Icon.ReceiveIcon /></span>
                        <span>{t('home.receive')}</span>
                    </button>
                ) : null}
                {onExchange ? (
                    <button
                        type="button"
                        className={styles.quickAction}
                        onClick={() => runNetworkAction('Exchange', onExchange)}
                        aria-disabled={!networkActionsAvailable ? 'true' : undefined}
                        title={!networkActionsAvailable ? t('home.exchangeOffline') : undefined}
                    >
                        <span className={styles.quickActionIcon} aria-hidden="true"><Icon.MarketIcon /></span>
                        <span>{t('home.exchange')}</span>
                    </button>
                ) : null}
                {homeMoreActions.length === 1 ? (
                    <button
                        type="button"
                        className={styles.quickAction}
                        onClick={homeMoreActions[0].onSelect}
                    >
                        <span className={styles.quickActionIcon} aria-hidden="true">{homeMoreActions[0].icon}</span>
                        <span>{homeMoreActions[0].label}</span>
                    </button>
                ) : null}
                {homeMoreActions.length > 1 ? (
                    <div className={styles.quickActionMoreWrap} ref={homeMoreWrapRef}>
                        <button
                            type="button"
                            className={styles.quickAction}
                            aria-haspopup="menu"
                            aria-expanded={homeMoreOpen}
                            onClick={() => setHomeMoreOpen((o) => !o)}
                        >
                            <span className={styles.quickActionIcon} aria-hidden="true"><Icon.MoreIcon /></span>
                            <span>{t('history.detail.more')}</span>
                        </button>
                        {homeMoreOpen ? (
                            <div className={styles.quickActionMoreMenu} role="menu">
                                {homeMoreActions.map((action) => (
                                    <button
                                        key={action.id}
                                        type="button"
                                        role="menuitem"
                                        className={styles.quickActionMoreItem}
                                        onClick={() => { setHomeMoreOpen(false); action.onSelect(); }}
                                    >
                                        {action.icon ? (
                                            <span className={styles.quickActionMoreItemIcon} aria-hidden="true">
                                                {action.icon}
                                            </span>
                                        ) : null}
                                        <span>{action.label}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    ), [
        homeMoreActions, homeMoreOpen, isDemoActive, networkActionsAvailable, onExchange,
        onReceive, onSend, quickActionCount, quickActionsReason, runNetworkAction,
    ]);

    const accountList = Array.isArray(accounts) ? [...accounts].sort((a, b) => a.index - b.index) : [];
    const activeAccount = accountList.find((a) => a.id === activeAccountId) || null;
    if (settingsOpen) {
        return (
            <Settings
                onBack={() => { setSettingsOpen(false); setSettingsSubpage(null); }}
                activeWallet={activeWallet}
                activeAccount={activeAccount}
                onOpenWalletPicker={onOpenWalletPicker}
                onOpenAccountPicker={onOpenAccountPicker}
                initialSubpageId={settingsSubpage}
            />
        );
    }

    if (addAddressOpen && activeWalletId) {
        return (
            <AddAddressModal
                walletId={activeWalletId}
                accountId={activeAccountId || undefined}
                chainIds={Object.keys(balances || {})}
                onClose={() => setAddAddressOpen(false)}
                onGenerated={() => setHomeReloadKey((k) => k + 1)}
            />
        );
    }

    // The banner text. While a rate-limit wait is running it is DERIVED, not
    // read from state: the seconds have to shrink on every tick, and one string
    // frozen in state at the moment of the failure cannot do that. The wording
    // itself comes from the same helper the two submit mappers use, so the
    // banner and the submit sentences cannot drift apart.
    const rateLimitSecondsLeft = (rateLimitRetryAt === null || !rateLimitNamedSeconds)
        ? null
        : Math.max(0, Math.ceil((rateLimitRetryAt - rateLimitTickNow) / 1000));
    const loadErrorText = rateLimitRetryAt === null
        ? loadError
        : `Couldn't ${BALANCES_VERB}. ${rateLimitedMessage(rateLimitSecondsLeft)}`;

    // §20 / G041: signer-mode home variant. The wallet only signs PSBTs
    // pasted in from a paired Watcher wallet; balances, history, send,
    // and receive are not relevant. Render a stripped-down body with the
    // sign / verify CTAs and a banner explaining the role. Header stays
    // shared so the user can still lock / switch wallets / open Settings;
    // a shell with no header passes onOpenSettings / onLockWallet and the
    // body offers both itself, since the banner sends the user to Settings.
    if (isSignerMode) {
        return (
            <Screen variant={variant}>
                <ListPage className={isFull ? styles.bodyFull : undefined}>
                    <h1 className="sr-only">{t('home.title')}</h1>
                    {loadErrorText ? (
                        <StatusMessage variant="error" className={styles.error}>{loadErrorText}</StatusMessage>
                    ) : null}
                    {/* §25.2 / Cluster J FOLLOWUP 2: shells that
                        mount the banner in their layout header say so with
                        `demoBannerInHeader`, and Home skips its own copy so
                        the disclosure never renders twice. Shells without a
                        header slot (the extension popup) get it here. */}
                    {activeWalletId && !demoBannerInHeader ? (
                        <DemoBanner
                            activeWalletId={activeWalletId}
                            onExited={onLocked}
                        />
                    ) : null}
                    <SignerHomeBody
                        onSignPsbt={onSignPsbt}
                        onSignMessage={onSignMessage}
                        onVerifySignature={onVerifySignature}
                        onOpenSettings={onOpenSettings}
                        onLockWallet={onLockWallet}
                    />
                </ListPage>
            </Screen>
        );
    }

    if (!hasChains) {
        return (
            <Screen variant={variant}>
                <ListPage className={isFull ? styles.bodyFull : undefined}>
                    <h1 className="sr-only">{t('home.title')}</h1>
                    <EmptyState
                        title={NO_CHAINS_TITLE}
                        body={NO_CHAINS_BODY}
                        actionLabel={t('common.openNetworkSettings')}
                        onAction={() => { setSettingsSubpage('network'); setSettingsOpen(true); }}
                        actionIcon={<Icon.GearIcon />}
                    />
                </ListPage>
            </Screen>
        );
    }

    return (
        <Screen variant={variant}>
            <ListPage className={isFull ? styles.bodyFull : undefined}>
                {/* Home has no PageHeader, so its one h1 is visually hidden. */}
                <h1 className="sr-only">{t('home.title')}</h1>
                {!browserOnline ? (
                    <StatusMessage variant="warning">
                        {balances
                            ? t('home.offline.cached')
                            : t('home.offline.empty')}
                    </StatusMessage>
                ) : null}
                {loadErrorText ? (
                    <StatusMessage variant="error" className={styles.error}>{loadErrorText}</StatusMessage>
                ) : null}

                {cachedBalancesUpdating ? (
                    <StatusMessage variant="status">{t('home.updatingBalances')}</StatusMessage>
                ) : null}

                {balances === null && browserOnline && !loadErrorText ? (
                    <div role="status" aria-label={t('home.loadingBalances')} aria-busy="true">
                        <Skeleton.List rows={5} rowHeight={72} avatarSize={48} />
                    </div>
                ) : null}

                {/* Inline notice removed; now surfaces in the Alerts panel
                    of the pancake menu instead so the main view stays
                    focused on balances + work, not status banners. */}

                {onResumeConfirm ? (
                    <ResumeConfirmCard
                        sessions={confirmSessions}
                        className={styles.pendingAirdropCard}
                        onResume={(id) => onResumeConfirm(confirmSessions.find((s) => s.id === id))}
                        onDiscard={async (id) => {
                            setConfirmSessions((prev) => prev.filter((s) => s.id !== id));
                            try { await messaging.clearConfirmSession({ id }); } catch { /* non-fatal */ }
                        }}
                    />
                ) : null}

                {pendingAirdrops.length > 0 && onResumeAirdrop ? (
                    <div role="group" aria-label={t('home.pendingAirdrops')}>
                        {pendingAirdrops.map((rec) => (
                            <button
                                key={rec.id}
                                type="button"
                                className={styles.pendingAirdropCard}
                                onClick={() => onResumeAirdrop(rec.id)}
                            >
                                <span className={styles.pendingAirdropTitle}>
                                    {t('home.resumeAirdrop', {
                                        amount: rec.amountPer,
                                        token: rec.token,
                                        count: rec.recipients.length,
                                    })}
                                </span>
                                <span className={styles.pendingAirdropHint}>
                                    {rec.stage === 'waiting-index'
                                        ? t('home.airdrop.waitingIndex')
                                        : t('home.airdrop.readyToSign')}
                                </span>
                            </button>
                        ))}
                    </div>
                ) : null}

                {pendingCoinpays.length > 0 && onResumeCoinpay ? (
                    <div role="group" aria-label={t('home.pendingPayments')}>
                        {pendingCoinpays.map((rec) => {
                            // rec.coinAmount is the explorer's own decimal coin
                            // figure (not base units; see obligationStatus.js), so
                            // it prints as-is - only the ticker was missing, left
                            // it reading as a bare number with no unit.
                            const chainDescriptor = chainRegistry.get(rec.chainId);
                            const ticker = chainDescriptor ? tickerForCoin(chainDescriptor.coin) : '';
                            return (
                                <button
                                    key={`${rec.chainId}-${rec.orderMatchActionIndex}`}
                                    type="button"
                                    className={styles.pendingAirdropCard}
                                    onClick={() => onResumeCoinpay({
                                        chainId: rec.chainId,
                                        address: rec.address,
                                        orderMatchActionIndex: rec.orderMatchActionIndex,
                                    })}
                                >
                                    <span className={styles.pendingAirdropTitle}>
                                        {t('home.paymentDue', {
                                            amount: rec.coinAmount,
                                            order: rec.orderMatchActionIndex,
                                        })}{ticker ? ` (${ticker})` : ''}
                                    </span>
                                    <span className={styles.pendingAirdropHint}>
                                        {t('home.paymentDue.hint')}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ) : null}

                {/*
                  * A self-armed panic freeze is announced here, above
                  * the balances, so the user learns signing is frozen BEFORE
                  * they tap Send. A duress-armed freeze renders nothing (the
                  * component owns that policy) so an observer sees no cue.
                  */}
                <PanicFreezeNotice surface="home" />
                {/* the demo disclosure sits above the balances, so a
                    first-time visitor reads "this is a demo, the forms read 0
                    because there is nothing to spend" before scrolling into a
                    seven-figure fixture portfolio. Skipped when the shell
                    already mounts it in its header (see `demoBannerInHeader`). */}
                {activeWalletId && !demoBannerInHeader ? (
                    <DemoBanner
                        activeWalletId={activeWalletId}
                        onExited={onLocked}
                    />
                ) : null}
                {balances ? (
                    <HomeTabs
                        chainRegistry={chainRegistry}
                        balances={balancesView}
                        activeByChain={activeByChain}
                        balancesFetchedAt={balancesFetchedAt}
                        walletId={activeWalletId}
                        accountId={activeAccountId}
                        networkFilter={networkFilter}
                        tokenQuery={tokenQuery}
                        coinFamilies={coinFamilies}
                        onNetworkFilterChange={setNetworkFilter}
                        onTokenQueryChange={setTokenQuery}
                        multisig={isBtc ? multisig : null}
                        multisigChainId={chainRegistry.byCoin('bitcoin')[0]?.id}
                        onReceive={onReceive}
                        onBuy={onExchange}
                        hasAddresses={Object.keys(balances).length > 0}
                        onAddAddress={handleAddAddress}
                        onHistory={onHistory}
                        onSelectToken={onSelectToken}
                        onSelectEntry={onSelectEntry}
                        pinnedKeys={pinnedKeys}
                        onTogglePin={showPinAffordance ? handleTogglePin : undefined}
                        hiddenKeys={hiddenKeys}
                        onToggleHide={showHideAffordance ? handleToggleHide : undefined}
                        verifyMap={verifyMap}
                        hideSmallBalances={hideSmallBalances}
                        onRefresh={refreshPortfolio}
                        refreshing={portfolioRefreshing}
                        onCommandPalette={onCommandPalette}
                        // Only shells without a nav surface pass this;
                        // it renders a gear in the hero's control cluster.
                        onOpenSettings={onOpenSettings}
                        // Same rule as the gear: a lock button for shells with no header.
                        onLockWallet={onLockWallet}
                        actions={quickActions}
                    />
                ) : null}

                {activeWalletId ? (
                    <BackupReminderCard
                        walletId={activeWalletId}
                        hasFunds={backupReminderHasFunds}
                        onAction={() => { setSettingsSubpage('backup'); setSettingsOpen(true); }}
                    />
                ) : null}

                {/* Supplementary action grid is full-mode only. In small mode
                    the actions live in the pancake menu, freeing the body for
                    the balance list. */}
                {isFull ? (
                <div className={styles.actionsFull}>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onCreateToken}
                        disabled={!onCreateToken}
                        icon={<Icon.TokenIcon />}
                    >
                        {t('home.createToken')}
                    </Button>
                    {/* Same rule as Exchange above: absent, not greyed, when
                        this build has no markets to open. */}
                    {onMarkets ? (
                        <Button
                            variant="secondary"
                            block={!isFull}
                            onClick={onMarkets}
                            icon={<Icon.MarketIcon />}
                        >
                            {t('home.markets')}
                        </Button>
                    ) : null}
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onMessaging}
                        disabled={!onMessaging}
                        icon={<Icon.MessageIcon />}
                    >
                        {t('home.messaging')}
                        {messagingUnread > 0 ? (
                            <span
                                aria-label={t('alerts.unreadCount', { count: messagingUnread })}
                                style={{
                                    marginInlineStart: '0.4rem',
                                    padding: '0 0.4rem',
                                    borderRadius: '999px',
                                    background: 'var(--xc-accent-primary)',
                                    color: 'var(--xc-on-accent)',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                }}
                            >
                                {messagingUnread > 99 ? '99+' : messagingUnread}
                            </span>
                        ) : null}
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onHistory}
                        disabled={!onHistory}
                        icon={<Icon.HistoryIcon />}
                    >
                        {t('history.title')}
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onAddresses}
                        disabled={!onAddresses}
                        icon={<Icon.AddressIcon />}
                    >
                        {t('home.addresses')}
                    </Button>
                    {onContracts ? (
                        <Button
                            variant="secondary"
                            block={!isFull}
                            onClick={onContracts}
                            icon={<Icon.ContractIcon />}
                        >
                            {t('home.contracts')}
                        </Button>
                    ) : null}
                    {onStaking ? (
                        <Button
                            variant="secondary"
                            block={!isFull}
                            onClick={onStaking}
                            icon={<Icon.StakeIcon />}
                        >
                            {t('home.staking')}
                        </Button>
                    ) : null}
                    <Button
                        variant="ghost"
                        block={!isFull}
                        onClick={onActions}
                        disabled={!onActions}
                        icon={<Icon.MoreIcon />}
                    >
                        {t('actionsMenu.more')}
                    </Button>
                </div>
                ) : null}
            </ListPage>
            {alertsOpen ? (
                <AlertsOverlay
                    alerts={alerts}
                    onClose={() => setAlertsOpen(false)}
                />
            ) : null}
        </Screen>
    );
}

function SendQuickAction({ onSend, networkActionsAvailable, onOffline }) {
    const content = (
        <>
            <span className={styles.quickActionIcon} aria-hidden="true"><Icon.SendIcon /></span>
            <span>{t('send.title')}</span>
        </>
    );
    if (!networkActionsAvailable && onSend) {
        return (
            <button
                type="button"
                className={styles.quickAction}
                onClick={onOffline}
                aria-disabled="true"
                title={t('home.sendOffline')}
            >
                {content}
            </button>
        );
    }
    return (
        <button
            type="button"
            className={styles.quickAction}
            onClick={onSend}
            disabled={!onSend}
        >
            {content}
        </button>
    );
}

/**
 * §20 / G041: Signer-mode landing body. Renders an explanatory banner
 * and three role-appropriate CTAs (Sign a PSBT / Sign a message / Verify
 * a signature). Send + Receive + balances are intentionally absent. A
 * signer-mode wallet doesn't broadcast, watch chains, or expose receive
 * addresses; its sole role is to sign PSBTs pasted in from a paired
 * Watcher wallet (cf. G040, Send.jsx watcher branch).
 *
 * @param {object} props
 * @param {() => void} [props.onSignPsbt]
 * @param {() => void} [props.onSignMessage]
 * @param {() => void} [props.onVerifySignature]
 */
function SignerHomeBody({ onSignPsbt, onSignMessage, onVerifySignature, onOpenSettings, onLockWallet }) {
    return (
        <div role="region" aria-label={t('home.signer.region')}>
            <div
                role="status"
                aria-live="polite"
                style={{
                    padding: 'var(--xc-space-3) var(--xc-space-4)',
                    background: 'var(--xc-surface-raised)',
                    border: '1px dashed var(--xc-border)',
                    borderRadius: 'var(--xc-radius-md)',
                    color: 'var(--xc-text-muted)',
                    fontSize: 'var(--xc-text-sm)',
                    marginBottom: 'var(--xc-space-3)',
                    lineHeight: 1.4,
                }}
            >
                <strong style={{ color: 'var(--xc-text)' }}>{t('home.signer.title')}</strong>
                <span> {t('home.signer.body')}</span>
            </div>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--xc-space-2)',
                }}
            >
                <Button
                    variant="primary"
                    onClick={onSignPsbt}
                    disabled={!onSignPsbt}
                >
                    {t('home.signer.signTransaction')}
                </Button>
                <Button
                    variant="secondary"
                    onClick={onSignMessage}
                    disabled={!onSignMessage}
                >
                    {t('home.signer.signMessage')}
                </Button>
                <Button
                    variant="ghost"
                    onClick={onVerifySignature}
                    disabled={!onVerifySignature}
                >
                    {t('home.signer.verifySignature')}
                </Button>
                {onOpenSettings ? (
                    <Button variant="ghost" onClick={onOpenSettings} icon={<Icon.GearIcon />}>
                        {t('home.settings')}
                    </Button>
                ) : null}
                {onLockWallet ? (
                    <Button variant="ghost" onClick={onLockWallet} icon={<Icon.LockIcon />}>
                        {t('home.lockWallet')}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}
