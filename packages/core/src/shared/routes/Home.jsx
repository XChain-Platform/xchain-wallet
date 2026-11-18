// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, Icon, ListPage, Notice, Screen, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { InPageScreen } from '@xchain-wallet/core/ui/navHistory.js';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useWalletSource } from '../hooks/useDemoGuard.jsx';
import { useEscrowedBalances } from '../hooks/useEscrowedBalances.js';
import { isNavigatorOnline } from '../hooks/useOnlineStatus.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { HideReachabilityNotice } from '../components/hideReachabilityNotice.js';
import { useWalletFilters } from '../hooks/useWalletFilters.js';
import { HomeTabs } from '../components/HomeTabs.jsx';
import { listDetailStyles } from '../components/PanelSplit.jsx';
import { buildBalanceRows, detectSpamCandidates } from '../components/BalanceList.jsx';
import { hasBackupReminderFunds } from '../../flows/backupReminder.js';
import { useScreenShortcuts } from '../keyboard/useScreenShortcuts.js';
import { SPAM_TOKEN_TOAST_KIND, useToast } from '../components/ToastHost.jsx';
import { BackupReminderCard } from '../components/BackupReminderCard.jsx';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { AddressDiscoveryNotice } from '../components/AddressDiscoveryNotice.jsx';
import { PanicFreezeNotice } from '../safety/PanicFreezeNotice.jsx';
import { Settings } from './Settings.jsx';
import { AddAddressModal } from './AddAddressModal.jsx';
import {
    pinnedTokensForWallet,
    pinnedTokensPatchForWallet,
} from '../../schemas/settings.js';
import { walletModeOf } from '../../schemas/wallet.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { humanizeError } from '../utils/humanizeError.js';
import { writeActiveWallet } from '../utils/activeWalletMemory.js';
import { takeInterruptedView } from '../utils/lastViewMemory.js';
import { isBalanceCacheFresh, readBalanceCache, writeBalanceCache } from '../utils/balanceCache.js';
import { isWalletDataFresh, readTimeOf, subscribeWalletDataStale } from '../utils/walletDataFreshness.js';
import { readHistoryCache } from '../utils/historyCache.js';
import { historyResponseRows, normalizeHistoryRow, recentActivityEntries } from '../utils/historyRow.js';
import { loadDefiPositions as readDefiPositions } from '../hooks/useDefiPositions.js';
import { explorerReadFailure, rateLimitedMessage } from '../../sdk/explorerErrors.js';
import { startVisibleInterval } from '../utils/visibleInterval.js';
import { useNativeExitRoot } from '../hooks/useNativeExitRoot.js';
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

function isSdkLoadFailure(error) {
    const message = String(error?.message || error || '');
    return /xchain-sdk (?:is not loaded yet|failed to load)/i.test(message);
}

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
// landing, a token someone else sent you), so Home asks. A saved read under
// BALANCE_MAX_AGE_MS old is shown without a request; an open Home checks every
// BALANCE_CHECK_INTERVAL_MS and on focus, and reads only once the data has
// aged past that. A broadcast or the refresh button reads at once.
//
// Defined in flows/balances.js, next to the aggregator they gate, because the
// same numbers are the wallet's sustained request rate against the public
// endpoints and tools/release/cold-open-profile.mjs has to read the real ones
// when it works out what the zone rate limits must clear.
const { BALANCE_MAX_AGE_MS, BALANCE_CHECK_INTERVAL_MS } = flowsLib;

/**
 * Home screen: landing view for an unlocked wallet. Header shows the
 * wallet name; body renders the balance card and the balance tabs.
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
 * @param {() => void} [props.onReceive]       navigate to Receive sub-route
 * @param {() => void} [props.onExchange]      navigate to the Decentralized Exchange list with BTC preselected (the empty-state Buy action)
 * @param {() => void} [props.onHistory]       navigate to the History route (§23 + §23.5 cross-chain threading)
 * @param {() => void} [props.onSignPsbt]      navigate to the PSBT-sign route (§30.4); surfaced as the marquee CTA when the active wallet is an air-gapped signer (§20 / G041)
 * @param {() => void} [props.onSignMessage]   navigate to the user-initiated message-sign route (§17.4)
 * @param {() => void} [props.onVerifySignature]   navigate to the signature-verify route (§17.5)
 * @param {() => void} [props.onOpenWalletPicker]         Settings row → host navigates to the WalletPicker route
 * @param {() => void} [props.onOpenAccountPicker]        Settings row → host navigates to the AccountPicker route
 * @param {string | null} [props.activeAccountId]          App-level active BIP44 account; when supplied, Home is read-only with respect to account selection
 * @param {(accountId: string) => void} [props.onSwitchAccount]   App-level setter for the active account (still used internally if a future inline picker lands)
 * @param {() => void} [props.onLockWallet]   locks the wallet; only shells with no header (the extension popup and side panel) pass it, and Home then shows a lock button
 * @param {number} [props.resumeKey]          changes once per unlocked native-app resume
 * @param {(item: any) => import('react').ReactNode} [props.renderDetail]  wide Home (G115): draws the selected coin, token, NFT or entry beside the list; a shell that leaves it out keeps the one-column Home at every width
 * @param {any} [props.detailSelection]       the item the shell holds as selected on wide Home (kept across a visit to Send or a form)
 * @param {(item: any) => void} [props.onDetailSelect]  a row picked on wide Home
 *
 * §40 actions are NOT a Home prop. Home used to accept an `extraActions`
 * array "for the small-mode drawer" and never rendered it, so the web
 * shell built 24 entries per render that no user could ever reach from
 * this component. Both variants route to the same dedicated
 * ActionsMenu screen instead: the "All actions" row of the wallet menu.
 * Add entries there, not here.
 */
export function Home({ onReceive, onExchange, onHistory, onOpenWalletPicker, onOpenAccountPicker, onSignPsbt, onSignMessage, onVerifySignature, activeWalletId: activeWalletIdProp, activeAccountId: activeAccountIdProp, onSwitchAccount, onSelectToken, onSelectEntry, networkFilter: networkFilterProp, onNetworkFilterChange: onNetworkFilterChangeProp, tokenQuery: tokenQueryProp, onTokenQueryChange: onTokenQueryChangeProp, onCommandPalette, onOpenSettings, onLockWallet, resumeKey = 0, renderDetail, detailSelection, onDetailSelect }) {
    useNativeExitRoot();
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    // Home has no row of action buttons at any size: Send, Receive, Exchange
    // and All actions live in the navigation and the header menu.
    // A corroborated service outage is offline even when the device still has
    // a live Wi-Fi or Ethernet interface.
    const { offline } = useNetworkOffline();
    const networkActionsAvailable = !offline;
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
    const source = useWalletSource(activeWalletId);
    const { messaging } = source;
    const [interruptedAction, setInterruptedAction] = useState(
        /** @type {'send' | 'swap' | null} */ (null),
    );
    useEffect(() => {
        setInterruptedAction(null);
        if (!activeWalletId) return undefined;
        // Normal navigation back to Home clears the marker in the parent
        // route effect first. A restart does not, so only that marker survives
        // until this next task and becomes a visible note.
        const timer = setTimeout(() => {
            setInterruptedAction(takeInterruptedView(activeWalletId));
        }, 0);
        return () => clearTimeout(timer);
    }, [activeWalletId]);
    const settings = useSettings();
    const activeNetwork = settings.loading
        ? null
        : (settings.settings?.activeNetwork || 'mainnet');
    // Signing prompts wait for the active wallet's mode (§20): Home's wallet
    // list carries it, and the shell's published mode covers the wait.
    const publishedMode = useWalletMode(activeWalletId);
    const activeWalletRecord = Array.isArray(wallets)
        ? wallets.find((w) => w?.id === activeWalletId) || null
        : null;
    const walletModeReady = Boolean(activeWalletRecord) || publishedMode.walletModeKnown;
    const walletMode = activeWalletRecord ? walletModeOf(activeWalletRecord) : publishedMode.walletMode;
    const isSignerMode = walletMode === 'signer';
    const isWatcherMode = walletMode === 'watcher';
    // The wallet source says what the active wallet's data can do: sample
    // data is not live and cannot spend.
    const { live: sourceLive, canSpend } = source;
    const [accounts, setAccounts] = useState(/** @type {any[] | null} */ (null));
    // Local fallback used only when the host doesn't supply
    // `activeAccountIdProp` (e.g. desktop shell pinned to an older
    // App.jsx). When the prop is set, Home is read-only and the
    // popover delegates switching to `onSwitchAccount`.
    const [activeAccountIdLocal, setActiveAccountIdLocal] = useState(
        /** @type {string | null} */ (null),
    );
    const activeAccountId = activeAccountIdProp ?? activeAccountIdLocal;
    const initialBalanceCacheRef = useRef(/** @type {{ value: ReturnType<typeof readBalanceCache> } | undefined} */ (undefined));
    if (!initialBalanceCacheRef.current) {
        initialBalanceCacheRef.current = {
            value: readBalanceCache(activeWalletId, activeAccountId, activeNetwork),
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
    // A fresh saved copy is not refreshed on open, so it is not updating.
    const [cachedBalancesUpdating, setCachedBalancesUpdating] = useState(
        Boolean(initialBalanceCache) && isNavigatorOnline()
            && !(sourceLive && isBalanceCacheFresh(initialBalanceCache)),
    );
    const [sdkLoadFailed, setSdkLoadFailed] = useState(false);
    const balanceScopeRef = useRef({
        walletId: activeWalletId,
        accountId: activeAccountId || null,
        activeNetwork,
    });
    const balanceScopeChanged = balanceScopeRef.current.walletId !== activeWalletId
        || balanceScopeRef.current.accountId !== (activeAccountId || null)
        || balanceScopeRef.current.activeNetwork !== activeNetwork;
    if (balanceScopeChanged) {
        // React discards this render and retries with the next scope's state,
        // so a wallet, account or network switch never commits stale rows.
        balanceScopeRef.current = {
            walletId: activeWalletId,
            accountId: activeAccountId || null,
            activeNetwork,
        };
        const scopedCache = readBalanceCache(activeWalletId, activeAccountId, activeNetwork);
        setBalances(scopedCache?.balances || null);
        setActiveByChain(scopedCache?.activeByChain || {});
        setBalancesFetchedAt(scopedCache?.fetchedAt ?? null);
        setCachedBalancesUpdating(Boolean(scopedCache) && isNavigatorOnline()
            && !(sourceLive && isBalanceCacheFresh(scopedCache)));
        balancesScopeRef.current = scopedCache ? `${activeWalletId}:${activeAccountId || ''}` : null;
    }
    // What every row consumer reads: the balances plus each shown address's
    // open-offer escrow, so a token escrowed in full keeps its row.
    const balancesView = useEscrowedBalances({ balances, activeByChain, balancesFetchedAt, messaging });
    // The Activity tab's newest rows. They load when the tab opens, once per
    // wallet, account and network: History's saved snapshot paints first, then
    // one address list read and one first-page history read per address
    // replace it. The read count follows the address count, never the rows.
    const recentActivityScope = `${activeWalletId || ''}:${activeAccountId || ''}:${activeNetwork || ''}`;
    const [recentActivityState, setRecentActivityState] = useState(
        /** @type {{ scope: string, entries: any[] | null, failed: boolean } | null} */ (null),
    );
    const recentActivityRequestRef = useRef(/** @type {string | null} */ (null));
    const loadRecentActivity = useCallback(() => {
        if (!activeWalletId || !activeNetwork) return;
        if (recentActivityRequestRef.current === recentActivityScope) return;
        recentActivityRequestRef.current = recentActivityScope;
        const scope = recentActivityScope;
        const cached = readHistoryCache(activeWalletId, activeAccountId, activeNetwork);
        const cachedEntries = cached?.entries ? recentActivityEntries(cached.entries) : null;
        setRecentActivityState({ scope, entries: cachedEntries, failed: false });
        if (cachedEntries && sourceLive && isWalletDataFresh(cached.fetchedAt)) return;
        const land = (entries, failed) => {
            if (recentActivityRequestRef.current !== scope) return;
            setRecentActivityState({ scope, entries, failed });
        };
        // Sample data needs no network; a live wallet offline keeps its saved rows.
        if ((sourceLive && !isNavigatorOnline())
            || typeof messaging.getAddressesByChain !== 'function'
            || typeof messaging.getAddressHistory !== 'function') {
            land(cachedEntries, !cachedEntries);
            return;
        }
        messaging.getAddressesByChain(activeWalletId, activeAccountId)
            .then((byChain) => {
                const reads = [];
                for (const [chainId, addrs] of Object.entries(byChain || {})) {
                    if (!Array.isArray(addrs)) continue;
                    for (const a of addrs) {
                        if (!a?.address) continue;
                        reads.push(messaging.getAddressHistory({ chainId, address: a.address })
                            .then((response) => historyResponseRows(response)
                                .map((row) => normalizeHistoryRow(row, { chainId, address: a.address }))
                                .filter(Boolean)));
                    }
                }
                return Promise.allSettled(reads);
            })
            .then((results) => {
                const read = results.filter((r) => r.status === 'fulfilled');
                if (results.length > 0 && read.length === 0) {
                    land(cachedEntries, !cachedEntries);
                    return;
                }
                land(recentActivityEntries(read.flatMap((r) => r.value)), false);
            })
            .catch(() => land(cachedEntries, !cachedEntries));
    }, [activeWalletId, activeAccountId, activeNetwork, sourceLive, messaging, recentActivityScope]);
    const recentActivity = recentActivityState?.scope === recentActivityScope ? recentActivityState : null;
    // The DeFi tab follows the same lazy read model as Activity. One address
    // list read fans into a fixed set of position reads for every address.
    // Demo mode changes only `messaging`, so sample and live wallets land in
    // this state through the same loader and component.
    const defiPositionsScope = `${activeWalletId || ''}:${activeAccountId || ''}:${activeNetwork || ''}`;
    const [defiPositionsState, setDefiPositionsState] = useState(
        /** @type {{ scope: string, positions: any[] | null, failed: boolean } | null} */ (null),
    );
    const defiPositionsRequestRef = useRef(/** @type {string | null} */ (null));
    const loadDefiPositions = useCallback(() => {
        if (!activeWalletId || !activeNetwork) return;
        if (defiPositionsRequestRef.current === defiPositionsScope) return;
        defiPositionsRequestRef.current = defiPositionsScope;
        const scope = defiPositionsScope;
        setDefiPositionsState({ scope, positions: null, failed: false });
        readDefiPositions({ messaging, walletId: activeWalletId, accountId: activeAccountId })
            .then(({ positions, failed }) => {
                if (defiPositionsRequestRef.current !== scope) return;
                setDefiPositionsState({ scope, positions, failed });
            })
            .catch(() => {
                if (defiPositionsRequestRef.current !== scope) return;
                setDefiPositionsState({ scope, positions: [], failed: true });
            });
    }, [activeWalletId, activeAccountId, activeNetwork, messaging, defiPositionsScope]);
    const defiPositions = defiPositionsState?.scope === defiPositionsScope ? defiPositionsState : null;
    const backupReminderHasFunds = useMemo(() => hasBackupReminderFunds(
        buildBalanceRows(balancesView, chainRegistry, activeByChain),
    ), [balancesView, activeByChain]);
    const [multisig, setMultisig] = useState(
        /** @type {{ threshold: number, cosignerCount: number, scheme: string } | null} */ (null),
    );
    const [loadError, setLoadError] = useState(
        /** @type {string | null} */ (null),
    );
    // Balance reads resolve with per-address error entries, so loadError alone
    // cannot distinguish a failed balance refresh from another Home error.
    // This flag keeps failed data out of the loaded-zero presentation and
    // marks a retained cache as saved data until a clean read lands.
    const [balanceLoadFailed, setBalanceLoadFailed] = useState(false);
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

    const runNetworkAction = useCallback((label, action) => {
        if (typeof action !== 'function') return;
        if (!networkActionsAvailable) {
            showToast({
                message: `${label} needs a network connection.`,
                variant: 'error',
            });
            return;
        }
        action();
    }, [networkActionsAvailable, showToast]);

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
    }, [activeWalletId, activeAccountId, activeNetwork]);
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
    // The in-flight slot and the age of the balances on screen: its last
    // success is the shown read's time (walletDataFreshness.readTimeOf), so a
    // broadcast during or after that read leaves the data due. See
    // flows/pollThrottle.js.
    const pollThrottleRef = useRef(flowsLib.createPollThrottle(BALANCE_MAX_AGE_MS));
    const balancesDue = useCallback(
        () => !isWalletDataFresh(pollThrottleRef.current.lastSuccessAt()),
        [],
    );
    // A broadcast heard while a load was in flight: that load began before the
    // send, so another follows it at once.
    const refreshAfterLoadRef = useRef(false);
    const refreshNowRef = useRef(/** @type {(() => void) | null} */ (null));

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
            kind: SPAM_TOKEN_TOAST_KIND,
            message: `${fresh.length} likely-spam token${fresh.length === 1 ? '' : 's'} detected. Bulk-hide?`,
            actionLabel: `Hide ${fresh.length}`,
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

    // Load the wallets list once. The user picks the active one in Settings;
    // setActiveWalletId makes the per-wallet effect below refetch everything.
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
                if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load wallets.'));
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

    // Per-wallet load: balances, multisig indicator and pending airdrops.
    // Scope changes clear data that belongs to another wallet or account.
    // Same-scope reloads, polls and focus refreshes keep
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
        setBalanceLoadFailed(true);
        setLoadError(`Couldn't ${BALANCES_VERB}. ${rateLimitedMessage(named ? seconds : null)}`);
    }, []);

    const loadHomeData = useCallback(async (walletId, accountId, {
        reset,
        isCancelled,
        reportError = false,
        savedReadAt = null,
    }) => {
        if (!activeNetwork) return;
        // The saved copy of this pair's balances; only a clean fresh read
        // replaces it. activeForCache starts from the saved active addresses.
        let activeForCache = readBalanceCache(walletId, accountId, activeNetwork)?.activeByChain || {};
        let freshBalances = null;
        let freshFetchedAt = null;
        let freshReadAt = null;
        let freshBalancesCacheable = false;
        const requestedAt = Date.now();
        if (savedReadAt !== null) {
            // The saved copy is fresh: it stays on screen, no balance request
            // runs, and its age decides when the next one does.
            pollThrottleRef.current.reset();
            pollThrottleRef.current.succeed(savedReadAt);
            if (!isCancelled()) {
                setCachedBalancesUpdating(false);
                setBalanceLoadFailed(false);
                setLoadError(null);
            }
        } else if (offline || !isNavigatorOnline()) {
            // A device-offline signal or corroborated service outage avoids
            // work that cannot finish and keeps saved balances in place.
            pollThrottleRef.current.fail();
            if (!isCancelled()) setCachedBalancesUpdating(false);
            return;
        }
        if (savedReadAt === null) {
            if (reset) {
                const scopeKey = `${walletId}:${accountId || ''}`;
                const hasCachedBalances = balancesScopeRef.current === scopeKey;
                // A reset owns a fresh polling window even when cached rows remain
                // visible for the same wallet and account.
                pollThrottleRef.current.reset();
                // ...but the load about to run DOES take the in-flight slot, the
                // way an event-driven one does. Without it a cold open that is
                // still waiting (a 429's honoured Retry-After holds one request for
                // up to 60 s) would be joined by the check beat, which is the burst
                // the limiter counted in the first place.
                pollThrottleRef.current.start();
                setBalanceLoadFailed(false);
                if (!hasCachedBalances) {
                    setBalances(null);
                    setBalancesFetchedAt(null);
                    setActiveByChain({});
                    setCachedBalancesUpdating(false);
                    setMultisig(null);
                } else {
                    setCachedBalancesUpdating(isNavigatorOnline());
                }
                setLoadError(null);
            }

            try {
                // The selected source returns the same balance shape for sample
                // data and live data, so every downstream row follows one path.
                const b = await messaging.getWalletBalances(walletId, accountId);
                if (!isCancelled()) {
                    // A read can LAND and still be rate limited: the aggregator
                    // reports a refused address as that entry's `error` string
                    // rather than throwing, so the banner is decided from what
                    // came back, on the poll path as well as the reset one. The
                    // last complete balances stay on screen until every requested
                    // address has a usable answer.
                    const wait = rateLimitWaitFromBalances(b);
                    const hasBalanceFailure = Object.values(b || {}).some((rows) => (
                        Array.isArray(rows) && rows.some((entry) => entry?.error)
                    ));
                    if (hasBalanceFailure) {
                        const sdkFailed = Object.values(b || {}).some((rows) => (
                            Array.isArray(rows) && rows.some((entry) => isSdkLoadFailure(entry?.error))
                        ));
                        if (sdkFailed) setSdkLoadFailed(true);
                        pollThrottleRef.current.fail();
                        setBalanceLoadFailed(true);
                        if (wait) beginRateLimitWait(wait.seconds);
                        else setLoadError("Couldn't load balances. Try again.");
                        if (reportError && balancesRef.current !== null) {
                            showToast({
                                message: wait
                                    ? "Couldn't refresh balances. The service asked the wallet to slow down. Try again in a moment."
                                    : "Couldn't refresh balances. Try again.",
                                variant: 'error',
                            });
                        }
                    } else {
                        freshBalancesCacheable = true;
                        setSdkLoadFailed(false);
                        // Fresh balances restart the age, whichever path asks
                        // for them; a broadcast during the read leaves them due.
                        freshReadAt = readTimeOf(requestedAt);
                        pollThrottleRef.current.succeed(freshReadAt);
                        setBalanceLoadFailed(false);
                        balancesScopeRef.current = `${walletId}:${accountId || ''}`;
                        setBalances(b);
                        setBalancesFetchedAt(Date.now());
                        freshBalances = b;
                        freshFetchedAt = Date.now();
                    }
                    setCachedBalancesUpdating(false);
                    if (!hasBalanceFailure) {
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
                // A failed poll leaves the last complete rows in place and marks
                // them as saved data, so they cannot look freshly synchronized.
                if (!isCancelled()) {
                    setCachedBalancesUpdating(false);
                    setBalanceLoadFailed(true);
                    if (isSdkLoadFailure(err)) setSdkLoadFailed(true);
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
                    }
                    if (humanized.cause === 'rate_limited') {
                        beginRateLimitWait(humanized.retryAfterSeconds ?? null);
                    } else {
                        setLoadError(humanized.message);
                    }
                }
            }
        }

        if (refreshAfterLoadRef.current && !pollThrottleRef.current.isInFlight()) {
            refreshAfterLoadRef.current = false;
            if (!isCancelled()) setTimeout(() => refreshNowRef.current?.(), 0);
        }

        // A wallet or account switch can cancel this load while the balance
        // request is in flight. Stop before starting another request for the
        // scope that is no longer active.
        if (isCancelled()) return;

        if (typeof messaging.getActiveAddresses === 'function') {
            try {
                const active = await messaging.getActiveAddresses(walletId, accountId);
                if (!isCancelled()) {
                    activeForCache = active || {};
                    setActiveByChain(activeForCache);
                }
            } catch { /* fall back to aggregate when unavailable */ }
        }

        // The active-address read can outlive its scope too. Its result is
        // ignored above, and no later request should continue the stale load.
        if (isCancelled()) return;

        if (!isCancelled() && freshBalances && freshBalancesCacheable) {
            writeBalanceCache(walletId, accountId, {
                balances: freshBalances,
                activeByChain: activeForCache,
                fetchedAt: freshFetchedAt,
                readAt: freshReadAt,
            }, activeNetwork);
        }

        if (typeof messaging.getMultisigReceiveAddress === 'function') {
            const btcChain = chainRegistry.byCoin('bitcoin')
                .find((descriptor) => descriptor.networkKind === activeNetwork)?.id;
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

        // No coinpay scan here on purpose. Before spec row 29 one sat between
        // the multisig read and the confirm read, costing one explorer read per
        // address on every beat of this poll, duplicating the scan
        // `useCoinpayObligations` already runs for the nav badge. The resume
        // cards read that one scan through `useSharedCoinpayObligations` above.

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messaging, offline, activeNetwork]);

    // The one manual refresh on Home (the hero's button): reloads balances,
    // and with them the prices, quietly over what is on screen. A failure is a
    // toast, never a skeleton or a banner over balances that are still good.
    // A load already in flight (a poll, a focus refresh) is not doubled up.
    const refreshPortfolio = useCallback(async () => {
        if (!activeWalletId || portfolioRefreshing || offline || !isNavigatorOnline()) return;
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
    }, [activeWalletId, activeAccountId, offline, loadHomeData, portfolioRefreshing]);
    // Stable across the rate-limit countdown so the memoised portfolio tabs skip those renders.
    const refreshPortfolioOnline = useCallback(
        () => runNetworkAction('Refreshing balances', refreshPortfolio),
        [runNetworkAction, refreshPortfolio],
    );

    // Reruns when the active wallet OR active BIP44 account changes.
    // Switching either flushes stale state and refetches. When
    // `activeAccountId` is null (data layer returned no accounts for this
    // wallet, or pre-load), the calls fall back to wallet-wide aggregation.
    // A wallet, account or network switch, a resume and a remount read only
    // when this scope has no fresh saved copy. A new address forces a read.
    const lastHomeReloadKeyRef = useRef(homeReloadKey);
    useEffect(() => {
        if (!activeWalletId || !activeNetwork) return undefined;
        let cancelled = false;
        const addressAdded = lastHomeReloadKeyRef.current !== homeReloadKey;
        lastHomeReloadKeyRef.current = homeReloadKey;
        const saved = sourceLive && !addressAdded
            ? readBalanceCache(activeWalletId, activeAccountId, activeNetwork)
            : null;
        loadHomeData(activeWalletId, activeAccountId || undefined, {
            reset: true,
            isCancelled: () => cancelled,
            savedReadAt: saved && isBalanceCacheFresh(saved) ? saved.readAt : null,
        });
        return () => { cancelled = true; };
    }, [activeWalletId, activeAccountId, activeNetwork, homeReloadKey, resumeKey, loadHomeData, sourceLive]);

    // Nothing pushes balance changes to the wallet - an incoming send, a
    // mint landing, a token someone else sent you - so Home has to ask. A
    // check runs every BALANCE_CHECK_INTERVAL_MS and when the tab or window
    // regains focus or visibility, and reads only once the balances are
    // BALANCE_MAX_AGE_MS old. Paused while the document is hidden so a
    // backgrounded wallet isn't burning SDK/indexer calls for no viewer.
    useEffect(() => {
        if (!activeWalletId || !sourceLive) return undefined;
        let cancelled = false;
        const walletId = activeWalletId;
        const accountId = activeAccountId || undefined;

        const load = () => loadHomeData(walletId, accountId, {
            reset: false, isCancelled: () => cancelled,
        });

        // Gated on the in-flight slot: a load can sit for up to 60 s while
        // the SDK waits out a `Retry-After`, and a check firing through it
        // would stack wallet loads against the bucket the first is waiting on.
        // The beat and a focus or visibility return share one rule, so an
        // alt-tab (both events at once) costs at most one load.
        const check = () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            if (offline || !isNavigatorOnline()) return;
            if (pollThrottleRef.current.isInFlight()) return;
            if (!balancesDue()) return;
            // `reset()` first: `start()` alone claims the slot only once the
            // throttle's own window has aged, and the age rule here is ours.
            pollThrottleRef.current.reset();
            pollThrottleRef.current.start();
            load();
        };

        const stopPollInterval = startVisibleInterval(check, BALANCE_CHECK_INTERVAL_MS, {
            runOnVisible: false,
        });
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', check);

        // A broadcast from this device, or an address write, makes every
        // saved balance wrong at once, whatever its age.
        const refreshNow = () => {
            if (cancelled || offline || !isNavigatorOnline()) return;
            if (pollThrottleRef.current.isInFlight()) {
                refreshAfterLoadRef.current = true;
                return;
            }
            pollThrottleRef.current.reset();
            pollThrottleRef.current.start();
            load();
        };
        refreshNowRef.current = refreshNow;
        const stopStaleWatch = subscribeWalletDataStale(refreshNow);

        return () => {
            cancelled = true;
            stopPollInterval();
            stopStaleWatch();
            if (refreshNowRef.current === refreshNow) refreshNowRef.current = null;
            refreshAfterLoadRef.current = false;
            window.removeEventListener('focus', check);
            document.removeEventListener('visibilitychange', check);
        };
    }, [activeWalletId, activeAccountId, loadHomeData, offline, sourceLive, balancesDue]);

    // Reconnect immediately after either the device or wallet services recover.
    // The quiet refresh preserves cached rows until fresh data lands.
    const wasOfflineRef = useRef(offline);
    useEffect(() => {
        const reconnected = wasOfflineRef.current && !offline;
        wasOfflineRef.current = offline;
        if (!reconnected || !activeWalletId || !sourceLive) return;
        if (pollThrottleRef.current.isInFlight()) return;
        pollThrottleRef.current.reset();
        pollThrottleRef.current.start();
        let cancelled = false;
        loadHomeData(activeWalletId, activeAccountId || undefined, {
            reset: false,
            isCancelled: () => cancelled,
        });
        return () => { cancelled = true; };
    }, [offline, activeWalletId, activeAccountId, loadHomeData, sourceLive]);

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
    }, [activeWalletId, activeAccountId, activeNetwork]);

    // The rate-limit wait, ticking. While `rateLimitRetryAt` is set the banner
    // re-renders once a second off the remaining time, and when it runs out the
    // wallet re-loads BY ITSELF: "; retrying." in the copy is a promise, and a
    // user who has already been told to wait must not also have to click. The
    // re-load takes the throttle's in-flight slot the way the beat does, so the
    // next beat does not land on top of it.
    useEffect(() => {
        if (rateLimitRetryAt === null || !activeWalletId || !activeNetwork) return undefined;
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
    }, [rateLimitRetryAt, activeWalletId, activeAccountId, activeNetwork, loadHomeData]);

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
    // §7/§8: SPV proof verification. Off for a fixture source (synthetic
    // balances have no real proofs) and when the user opts out via
    // `verifyProofs` (default on). The map is keyed `chainId:tick` and
    // fills in progressively after the user opens the Tokens tab.
    const verifyProofsEnabled = settings.settings?.verifyProofs !== false && sourceLive;

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
    // Wide Home's list and detail split (G115) fills the page under the
    // overview and each panel scrolls on its own (G128): while HomeTabs shows
    // it, the Screen body stops scrolling and the page column passes the
    // body's height down to it. One column, the page scrolls as before.
    const [homeWide, setHomeWide] = useState(false);
    // The backup reminder closes the page. With balances it rides in
    // HomeTabs as its footer, so on wide Home it ends the list column and
    // the list and detail split stays the page's last block, its line
    // running to the bottom edge. Memoized so HomeTabs (memo) does not
    // re-render on every Home render. A wallet that cannot spend (the demo
    // fixtures) holds nothing to back up.
    const backupReminder = useMemo(() => (activeWalletId && canSpend ? (
        <BackupReminderCard
            walletId={activeWalletId}
            hasFunds={backupReminderHasFunds}
            walletMode={walletModeReady ? walletMode : null}
            walletFormat={activeWallet?.format}
            onAction={() => { setSettingsSubpage('backup'); setSettingsOpen(true); }}
        />
    ) : null), [activeWalletId, canSpend, backupReminderHasFunds, walletModeReady, walletMode, activeWallet?.format]);
    const accountList = Array.isArray(accounts) ? [...accounts].sort((a, b) => a.index - b.index) : [];
    const activeAccount = accountList.find((a) => a.id === activeAccountId) || null;
    if (settingsOpen) {
        // Settings opened in place over Home: Back returns to Home, so it
        // shows although Home is always a root page.
        return (
            <InPageScreen>
                <Settings
                    onBack={() => { setSettingsOpen(false); setSettingsSubpage(null); }}
                    activeWallet={activeWallet}
                    activeAccount={activeAccount}
                    onOpenWalletPicker={onOpenWalletPicker}
                    onOpenAccountPicker={onOpenAccountPicker}
                    initialSubpageId={settingsSubpage}
                />
            </InPageScreen>
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
    // Offline, the offline message above is the one message: a read that
    // failed before the offline verdict arrived says the same thing again.
    let balanceStatusText = loadErrorText;
    if (offline || sdkLoadFailed) balanceStatusText = null;
    else if (balanceLoadFailed && balances && loadErrorText) {
        balanceStatusText = `${loadErrorText} Showing saved balances from the last successful sync.`;
    }
    const retryBalanceLoad = () => {
        setRateLimitRetryAt(null);
        setHomeReloadKey((key) => key + 1);
    };

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
                <ListPage>
                    <h1 className="sr-only">{t('home.title')}</h1>
                    {balanceStatusText ? (
                        <StatusMessage
                            variant="error"
                            recovery={balanceLoadFailed ? { label: t('home.retryBalances'), onAction: retryBalanceLoad } : undefined}
                        >
                            {balanceStatusText}
                        </StatusMessage>
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
                <ListPage>
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

    const splitShown = homeWide && Boolean(balances);
    return (
        <Screen variant={variant} bodyClassName={splitShown ? listDetailStyles.splitBody : undefined}>
            <ListPage className={splitShown ? listDetailStyles.splitFill : undefined}>
                {/* Home has no PageHeader, so its one h1 is visually hidden. */}
                <h1 className="sr-only">{t('home.title')}</h1>
                {/* A notice is the first item of the page content, not a line among
                    the controls that raised it. */}
                <AddressDiscoveryNotice
                    dismissOnLeave
                    onFinished={(job) => { if (job?.found > 0) void refreshPortfolio(); }}
                />
                {interruptedAction ? (
                    <StatusMessage variant="warning">
                        {t('home.interruptedAction', { action: interruptedAction })}
                    </StatusMessage>
                ) : null}
                {/* The offline message already covers stale balances, so the
                    shell notice steps aside rather than saying it twice. */}
                {offline || sdkLoadFailed ? <HideReachabilityNotice /> : null}
                {sdkLoadFailed ? (
                    <StatusMessage
                        variant="error"
                        recovery={{
                            label: t('home.sdkLoadFailure.reload'),
                            onAction: () => window.location.reload(),
                        }}
                    >
                        {t('home.sdkLoadFailure')}
                    </StatusMessage>
                ) : null}
                {offline && !sdkLoadFailed ? (
                    <StatusMessage variant="warning">
                        {balances
                            ? t('home.offline.cached')
                            : t('home.offline.empty')}
                    </StatusMessage>
                ) : null}
                {/* Home's own balance error already says the balances could not
                    be loaded, with Retry, so the shell notice steps aside. */}
                {balanceStatusText ? <HideReachabilityNotice /> : null}
                {balanceStatusText ? (
                    <StatusMessage
                        variant="error"
                        recovery={balanceLoadFailed ? { label: t('home.retryBalances'), onAction: retryBalanceLoad } : undefined}
                    >
                        {balanceStatusText}
                    </StatusMessage>
                ) : null}

                {/* Offline, no read runs, so the saved rows are not updating:
                    the offline message above is the one message. The flag is
                    seeded from the device signal alone, before the service
                    outage verdict reaches the load that would clear it. */}
                {cachedBalancesUpdating && !offline ? (
                    <StatusMessage variant="status">{t('home.updatingBalances')}</StatusMessage>
                ) : null}

                {/* Inline notice removed; now surfaces in the Alerts panel
                    of the pancake menu instead so the main view stays
                    focused on balances + work, not status banners. */}

                {/* A pending airdrop lives behind the header bell
                  * (usePendingNoticeAlerts), not as a card on Home. */}

                {/* A payment due on a matched order lives behind the header
                  * bell (usePendingNoticeAlerts), not as a card on Home. */}

                {/*
                  * A self-armed panic freeze is announced here, above
                  * the balances, so the user learns signing is frozen BEFORE
                  * they tap Send. A duress-armed freeze renders nothing (the
                  * component owns that policy) so an observer sees no cue.
                  */}
                {walletModeReady && !isWatcherMode ? <PanicFreezeNotice surface="home" /> : null}
                {balances ? (
                    <HomeTabs
                        walletName={activeWallet?.name || ''}
                        chainRegistry={chainRegistry}
                        balances={balancesView}
                        activeByChain={activeByChain}
                        balancesFetchedAt={balancesFetchedAt}
                        walletId={activeWalletId}
                        accountId={activeAccountId || null}
                        networkFilter={networkFilter}
                        tokenQuery={tokenQuery}
                        coinFamilies={coinFamilies}
                        onNetworkFilterChange={setNetworkFilter}
                        onTokenQueryChange={setTokenQuery}
                        multisig={isBtc ? multisig : null}
                        multisigChainId={chainRegistry.byCoin('bitcoin')
                            .find((descriptor) => descriptor.networkKind === activeNetwork)?.id}
                        onReceive={onReceive}
                        onBuy={onExchange}
                        hasAddresses={Object.keys(balances).length > 0}
                        onAddAddress={handleAddAddress}
                        onHistory={onHistory}
                        recentActivity={recentActivity?.entries ?? null}
                        recentActivityFailed={recentActivity?.failed === true}
                        onActivityOpen={loadRecentActivity}
                        defiPositions={defiPositions?.positions ?? null}
                        defiPositionsFailed={defiPositions?.failed === true}
                        onDefiOpen={loadDefiPositions}
                        onSelectToken={onSelectToken}
                        onSelectEntry={onSelectEntry}
                        pinnedKeys={pinnedKeys}
                        onTogglePin={showPinAffordance ? handleTogglePin : undefined}
                        hiddenKeys={hiddenKeys}
                        onToggleHide={showHideAffordance ? handleToggleHide : undefined}
                        verifyProofsEnabled={verifyProofsEnabled}
                        hideSmallBalances={hideSmallBalances}
                        onRefresh={refreshPortfolioOnline}
                        refreshing={portfolioRefreshing}
                        // Home's own balance notice (offline, a failed or
                        // running refresh) is the page's one message, so an
                        // empty tab does not add "Fund your wallet" or a
                        // second message from balances that are only the
                        // last good load.
                        balanceNoticeShown={offline || sdkLoadFailed || Boolean(balanceStatusText) || cachedBalancesUpdating}
                        onCommandPalette={onCommandPalette}
                        // Only shells without a nav surface pass this;
                        // it renders a gear in the hero's control cluster.
                        onOpenSettings={onOpenSettings}
                        // Same rule as the gear: a lock button for shells with no header.
                        onLockWallet={onLockWallet}
                        // Wide Home (G115): the detail panel beside the list.
                        renderDetail={renderDetail}
                        detailSelection={detailSelection ?? null}
                        onDetailSelect={onDetailSelect}
                        footer={backupReminder}
                        onWideChange={setHomeWide}
                    />
                ) : offline || loadErrorText ? (
                    // Offline, or a first balance read that failed, with nothing
                    // saved yet: the notice above says the balances are
                    // unavailable; the navigation holds every action.
                    null
                ) : (
                    <HomeLoadingSkeleton />
                )}

                {/* Without balances there is no HomeTabs to carry it. */}
                {balances ? null : backupReminder}
            </ListPage>
        </Screen>
    );
}

function HomeLoadingSkeleton() {
    return (
        <div
            role="status"
            aria-label={t('home.loadingBalances')}
            aria-busy="true"
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-3)', width: '100%' }}
        >
            <Skeleton shape="card" height={86} />
            <Skeleton shape="card" height={96} />
            <Skeleton shape="text" height={45} />
            <Skeleton shape="text" width={160} height={36} style={{ alignSelf: 'flex-end' }} />
            <Skeleton.List rows={5} rowHeight={72} avatarSize={48} />
        </div>
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
            {/* The mode note is an info Notice (the Notice Standard), 8px
                above the actions (G80) by the notice's own margin. */}
            <Notice tone="info" title={t('home.signer.title')}>
                {t('home.signer.body')}
            </Notice>
            {/* The signer's actions are one ActionList (G101); a row whose
                handler the shell did not wire stays, off. */}
            <ActionList>
                <ActionListItem
                    icon={<Icon.KeyIcon />}
                    onClick={onSignPsbt}
                    disabled={!onSignPsbt}
                    title={t('home.signer.signTransaction')}
                    description={t('home.signer.signTransactionDescription')}
                />
                <ActionListItem
                    icon={<Icon.SignIcon />}
                    onClick={onSignMessage}
                    disabled={!onSignMessage}
                    title={t('home.signer.signMessage')}
                    description={t('home.signer.signMessageDescription')}
                />
                <ActionListItem
                    icon={<Icon.VerifyIcon />}
                    onClick={onVerifySignature}
                    disabled={!onVerifySignature}
                    title={t('home.signer.verifySignature')}
                    description={t('home.signer.verifySignatureDescription')}
                />
                {onOpenSettings ? (
                    <ActionListItem
                        icon={<Icon.GearIcon />}
                        onClick={onOpenSettings}
                        title={t('home.settings')}
                        description={t('home.signer.settingsDescription')}
                    />
                ) : null}
                {onLockWallet ? (
                    <ActionListItem
                        icon={<Icon.LockIcon />}
                        onClick={onLockWallet}
                        title={t('home.lockWalletAction')}
                        description={t('home.signer.lockDescription')}
                    />
                ) : null}
            </ActionList>
        </div>
    );
}
