// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Icon, Screen, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useMessagingUnread } from '../hooks/useMessagingUnread.js';
import { useSettings } from '../hooks/useSettings.js';
import { useProofVerification } from '../hooks/useProofVerification.js';
import { HomeTabs } from '../components/HomeTabs.jsx';
import { buildBalanceRows, detectSpamCandidates } from '../components/BalanceList.jsx';
import { useScreenShortcuts } from '../keyboard/useScreenShortcuts.js';
import { useToast } from '../components/ToastHost.jsx';
import { BackupReminderCard } from '../components/BackupReminderCard.jsx';
import { DemoBanner } from '../components/DemoBanner.jsx';
import { AlertsOverlay } from '../components/AlertsOverlay.jsx';
import { PanicFreezeNotice } from '../safety/PanicFreezeNotice.jsx';
import { ResumeConfirmCard } from '../components/ResumeConfirmCard.jsx';
import { Settings } from './Settings.jsx';
import { AddAddressModal } from './AddAddressModal.jsx';
import { WALLET_MODE_DEFAULT } from '../../schemas/settings.js';
import styles from './Home.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Nothing pushes balance changes to the wallet (an incoming send, a mint
// landing, a token someone else sent you), so Home has to poll for them.
// 20s balances catching an incoming token promptly against hammering the
// SDK/indexer on every open tab; see the polling effect below, which also
// refreshes immediately on focus/visibility and pauses while hidden.
const BALANCE_POLL_INTERVAL_MS = 20000;

/**
 * Home screen: landing view for an unlocked wallet. Header shows the
 * wallet name; body renders a per-chain balance card grid; footer
 * exposes Send / Receive / Create-a-token action buttons.
 *
 * When the wallet has pending §40.9 airdrops (LIST signed but AIRDROP
 * still pending, either waiting for the LIST to be indexed or ready
 * to sign), Home surfaces a resume card above the balance grid so the
 * user can pick up where they left off.
 *
 * Locking is a shell concern, not a route concern: idle auto-lock runs
 * from each shell's AppInner via `useAutoLockPolicy`, and the manual
 * Lock affordance lives in the shell's menu + keyboard shortcut.
 *  found that wiring the idle timer here meant navigating off
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
 * @param {(session: object) => void} [props.onResumeConfirm]   §5.4: finish a confirm the popup closed on
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
 *
 * §40 actions are NOT a Home prop. Home used to accept an `extraActions`
 * array "for the small-mode drawer" and never rendered it, so the web
 * shell built 24 entries per render that no user could ever reach from
 * this component . Both variants route to the same dedicated
 * ActionsMenu screen instead: full mode via the "More actions" button in
 * the action grid below (`onActions`), small mode via the pancake menu's
 * "More actions" row (MenuRoute) or the command palette. Add entries
 * there, not here.
 */
export function Home({ onLocked, onResumeConfirm, onSend, onReceive, onSwap, onExchange, onCreateToken, onActions, onMarkets, onResumeAirdrop, onResumeCoinpay, onMessaging, onContracts, onStaking, onHistory, onAddresses, onMigrateToBip39, onOpenWalletPicker, onOpenAccountPicker, onSignPsbt, onSignMessage, onVerifySignature, activeWalletId: activeWalletIdProp, activeAccountId: activeAccountIdProp, onSwitchAccount, onSelectToken, onSelectEntry, networkFilter: networkFilterProp, onNetworkFilterChange: onNetworkFilterChangeProp, tokenQuery: tokenQueryProp, onTokenQueryChange: onTokenQueryChangeProp, onCommandPalette, onOpenSettings }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

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
    const setActiveWalletId = setActiveWalletIdLocal;
    const [accounts, setAccounts] = useState(/** @type {any[] | null} */ (null));
    // Local fallback used only when the host doesn't supply
    // `activeAccountIdProp` (e.g. desktop shell pinned to an older
    // App.jsx). When the prop is set, Home is read-only and the
    // popover delegates switching to `onSwitchAccount`.
    const [activeAccountIdLocal, setActiveAccountIdLocal] = useState(
        /** @type {string | null} */ (null),
    );
    const activeAccountId = activeAccountIdProp ?? activeAccountIdLocal;
    const setActiveAccountId = onSwitchAccount ?? setActiveAccountIdLocal;
    // Unread-message count for the active wallet + account, surfaced as a Home
    // alert and a dot on the Messaging button (see useMessagingUnread).
    const messagingUnread = useMessagingUnread(activeWalletId, activeAccountId);
    const [balances, setBalances] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // Active (operating) address per chain. The headline balance per coin
    // reflects this address only (not the sum across all addresses).
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id: string, address: string }>} */ ({}),
    );
    // Cluster G FOLLOWUP 5: Unix-ms timestamp of the most recent
    // successful balance fetch; null until the first one completes.
    // Threaded into HomeTabs → StalenessLabel so the user can tell
    // when the balance view was last live.
    const [balancesFetchedAt, setBalancesFetchedAt] = useState(
        /** @type {number | null} */ (null),
    );
    const [pendingAirdrops, setPendingAirdrops] = useState(
        /** @type {any[]} */ ([]),
    );
    const [pendingCoinpays, setPendingCoinpays] = useState(
        /** @type {any[]} */ ([]),
    );
    //  §5.4: unfinished confirms (an UNSIGNED composed PSBT the popup
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
    const [alertsOpen, setAlertsOpen] = useState(false);
    // Network filter can be controlled by the parent shell (web AppHeader
    // owns the toolbar filter button) or self-managed when the parent
    // doesn't pass props (popup renders its own filter button inline).
    const [networkFilterLocal, setNetworkFilterLocal] = useState('all');
    const networkFilter = networkFilterProp ?? networkFilterLocal;
    const setNetworkFilter = onNetworkFilterChangeProp ?? setNetworkFilterLocal;
    // BTC-only gate: multisig is Bitcoin-only at launch (spec 10.3), so the
    // multisig badge data only flows when Bitcoin is in view.
    const isBtc = networkFilter === 'bitcoin' || networkFilter === 'all';
    // Free-text token filter follows the same parent-vs-local pattern as
    // the network filter; popped into the header's filter popover.
    const [tokenQueryLocal, setTokenQueryLocal] = useState('');
    const tokenQuery = tokenQueryProp ?? tokenQueryLocal;
    const setTokenQuery = onTokenQueryChangeProp ?? setTokenQueryLocal;
    const [settingsOpen, setSettingsOpen] = useState(false);

    const [homeMoreOpen, setHomeMoreOpen] = useState(false);
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
    // Cluster H FOLLOWUP 7: when "Back up now" lands the user in
    // Settings, this captures which subpage to deep-link into so the
    // user doesn't land on the Settings root + have to re-find Backup.
    const [settingsSubpage, setSettingsSubpage] = useState(/** @type {string | null} */ (null));
    // : the "no addresses yet" hint pointed at Receive but offered
    // no way to get there, so the emptiest possible Home was also the most
    // inert. The hint now carries an Add-address CTA; `homeReloadKey`
    // refetches balances once the address lands, so Home fills in without
    // a wallet switch.
    const [addAddressOpen, setAddAddressOpen] = useState(false);
    const [homeReloadKey, setHomeReloadKey] = useState(0);
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
    const { showToast } = useToast();
    // Cluster I FOLLOWUP 2: auto-hide-spam toast. We only ever nudge
    // once per (wallet, mount) tuple. Re-prompting on every balance
    // refresh would be noisy; the user explicitly opting Hide / dismissing
    // the toast counts as "they decided" for the rest of the session.
    const spamNudgedForWalletRef = useRef(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.getSettings !== 'function') return undefined;
        messaging.getSettings().then((s) => {
            if (cancelled) return;
            const pins = Array.isArray(s?.pinnedTokens) ? s.pinnedTokens.filter((k) => typeof k === 'string') : [];
            const hides = Array.isArray(s?.hiddenTokens) ? s.hiddenTokens.filter((k) => typeof k === 'string') : [];
            setPinnedTokens(pins);
            setHiddenTokens(hides);
            setShowPinAffordance(s?.showPinAffordance === true);
            setShowHideAffordance(s?.showHideAffordance === true);
        }).catch(() => { /* tolerate missing settings; empty pin list is a fine default */ });
        return () => { cancelled = true; };
    }, [messaging]);

    const handleTogglePin = useCallback((key, nextPinned) => {
        if (typeof key !== 'string' || !key) return;
        setPinnedTokens((prev) => {
            const set = new Set(prev);
            if (nextPinned) set.add(key);
            else set.delete(key);
            const next = Array.from(set);
            if (typeof messaging?.updateSettings === 'function') {
                messaging.updateSettings({ pinnedTokens: next }).catch(() => { /* best-effort */ });
            }
            return next;
        });
    }, [messaging]);

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
        const rows = buildBalanceRows(balances, chainRegistry, activeByChain);
        return rows.find((r) => `${r.chainId}:${r.tick}` === key) || null;
    }, [balances, activeByChain]);

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
        const rows = buildBalanceRows(balances, chainRegistry, activeByChain);
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
    }, [balances, activeByChain, activeWalletId, hiddenTokens, messaging, showToast]);

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

    // Per-wallet load: balances, multisig indicator, pending airdrops,
    // pending COINPAY obligations. `reset: true` (wallet/account switch,
    // manual reload key) flushes state to the loading-skeleton first;
    // `reset: false` (poll / focus refresh below) fetches quietly in the
    // background and only swaps state in once fresh data lands, so an
    // incoming token doesn't flash the whole screen back to a skeleton.
    const loadHomeData = useCallback(async (walletId, accountId, { reset, isCancelled }) => {
        if (reset) {
            setBalances(null);
            setBalancesFetchedAt(null);
            setActiveByChain({});
            setMultisig(null);
            setPendingAirdrops([]);
            setPendingCoinpays([]);
            setConfirmSessions([]);
            setLoadError(null);
        }

        try {
            let b;
            // Cluster J FOLLOWUP 1: synthesize fabricated balances
            // for the demo wallet so Home / Send / Receive feel
            // populated. Uses the wallet's real address records so
            // the rest of the app sees the same address-rooted
            // shape it would for a funded wallet.
            if (flowsLib.isDemoWallet(walletId) && typeof messaging.getAddressesByChain === 'function') {
                const byChain = await messaging.getAddressesByChain(walletId, accountId);
                b = flowsLib.synthesizeDemoBalances(byChain);
            } else {
                b = await messaging.getWalletBalances(walletId, accountId);
            }
            if (!isCancelled()) {
                setBalances(b);
                setBalancesFetchedAt(Date.now());
            }
        } catch (err) {
            // A silent poll that fails (e.g. a transient network blip)
            // should not stomp a screen the user is already looking at
            // with an error banner; only surface it on the reset path.
            if (!isCancelled() && reset) setLoadError(err?.message || 'Failed to load balances.');
        }

        if (typeof messaging.getActiveAddresses === 'function') {
            try {
                const active = await messaging.getActiveAddresses(walletId, accountId);
                if (!isCancelled()) setActiveByChain(active || {});
            } catch { /* fall back to aggregate when unavailable */ }
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

        if (typeof messaging.getCoinpayObligationsForAddress === 'function') {
            try {
                const byChain = await messaging.getAddressesByChain(walletId, accountId);
                const pairs = [];
                for (const [cId, addrs] of Object.entries(byChain || {})) {
                    for (const a of addrs) pairs.push({ chainId: cId, address: a.address });
                }
                const results = await Promise.all(pairs.map((p) =>
                    messaging.getCoinpayObligationsForAddress({
                        chainId: p.chainId, address: p.address,
                    })
                        .then((resp) => ({ ...p, rows: extractObligationRows(resp) }))
                        .catch(() => ({ ...p, rows: [] }))
                ));
                if (isCancelled()) return;
                const obligations = [];
                for (const r of results) {
                    for (const row of r.rows) {
                        if (!isPendingForPayer(row, r.address)) continue;
                        obligations.push({
                            chainId: r.chainId,
                            address: r.address,
                            orderMatchActionIndex: String(row.action_index ?? row.actionIndex),
                            coinAmount: row.coin_amount,
                            payeeAddress: row.payee_address || row.payeeAddress,
                            expiration: row.expiration,
                        });
                    }
                }
                setPendingCoinpays(obligations);
            } catch { /* non-fatal */ }
        }

        //  §5.4: confirms the popup closed on. Extension-only in
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
    }, [activeWalletId, activeAccountId, homeReloadKey, loadHomeData]);

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

        const poll = () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            loadHomeData(walletId, accountId, { reset: false, isCancelled: () => cancelled });
        };

        const intervalId = setInterval(poll, BALANCE_POLL_INTERVAL_MS);
        const onVisibilityOrFocus = () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            poll();
        };
        window.addEventListener('focus', onVisibilityOrFocus);
        document.addEventListener('visibilitychange', onVisibilityOrFocus);

        return () => {
            cancelled = true;
            clearInterval(intervalId);
            window.removeEventListener('focus', onVisibilityOrFocus);
            document.removeEventListener('visibilitychange', onVisibilityOrFocus);
        };
    }, [activeWalletId, activeAccountId, loadHomeData]);

    // : Home does not lock, in either sense. The idle timer lives
    // in each shell's AppInner via `useAutoLockPolicy`, because this
    // route unmounts the moment the user navigates to Send / Receive /
    // History / Settings, and useAutoLock's effect cleanup cancelled the
    // pending timer with it - a wallet parked on one of those screens
    // never locked. The manual lock affordance is the shell's too (the
    // pancake menu's Lock entry and the §34 keyboard shortcut), so the
    // local `handleLock` that used to sit here had exactly one consumer,
    // the auto-lock hook, and left with it. Do not re-add a
    // `useAutoLock` call to any route.
    const settings = useSettings();
    // §20 / G041: wallet-mode aware. The hook's return is the wrapper
    // `{ settings, loading, error, refresh, update }`, so the actual
    // Settings record lives at `.settings`. Read with the explicit
    // default so v2 records without the field behave like 'full'.
    const walletMode = settings.settings?.walletMode || WALLET_MODE_DEFAULT;
    const isSignerMode = walletMode === 'signer';
    // Demo-wallet detection stays here for the proof-verification gate
    // below (synthetic balances have no real SPV proofs). The auto-lock
    // side of this check moved to useAutoLockPolicy with the rest.
    const isDemoActive = flowsLib.isDemoWallet(activeWalletId);

    // §7/§8: SPV proof verification. Off for demo wallets (synthetic
    // balances have no real proofs) and when the user opts out via
    // `verifyProofs` (default on). The map is keyed `chainId:tick` and
    // fills in progressively; HomeTabs badges the Tokens rows from it.
    const verifyProofsEnabled = settings.settings?.verifyProofs !== false && !isDemoActive;
    const verifyMap = useProofVerification({ messaging, balances, enabled: verifyProofsEnabled });

    // : `hideSmallBalances` persisted for fourteen sessions without a
    // single reader. HomeTabs forwards it to the Coins and Tokens lists,
    // which collapse dust rows into their own expandable section.
    const hideSmallBalances = settings.settings?.privacy?.hideSmallBalances === true;

    const activeWallet = wallets && activeWalletId
        ? wallets.find((w) => w.id === activeWalletId)
        : null;

    // Wallet-level alerts surfaced in the pancake's Alerts panel.
    // Computed each render from the available signals; future alerts
    // (incoming message, order match settled, MuSig2 round needs
    // attention, etc.) drop into this array as they wire through
    // their own sources.
    const alerts = [];
    if (messagingUnread > 0 && onMessaging) {
        alerts.push({
            id: 'unread-messages',
            severity: 'info',
            title: 'Unread messages',
            message: messagingUnread === 1
                ? 'You have 1 conversation with unread messages.'
                : `You have ${messagingUnread} conversations with unread messages.`,
            action: { label: 'Open Messaging', onSelect: onMessaging },
        });
    }
    if (activeWallet?.format === 'counterwallet-legacy' && onMigrateToBip39) {
        alerts.push({
            id: 'legacy-format',
            severity: 'info',
            title: 'Legacy FreeWallet format',
            message: 'This wallet uses the 12-word Counterwallet format. Migrate to BIP39 for wider compatibility with other wallets and stronger security.',
            action: { label: 'Migrate to BIP39', onSelect: onMigrateToBip39 },
        });
    }

    // Coin families surfaced in the dataset, in canonical order.
    // Drives both the network filter and the per-tab "no balances on
    // this network" empty messages.
    const coinFamilies = (() => {
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
    })();

    const accountList = Array.isArray(accounts) ? [...accounts].sort((a, b) => a.index - b.index) : [];
    const activeAccount = accountList.find((a) => a.id === activeAccountId) || null;
    const walletList = Array.isArray(wallets) ? wallets : [];
    const walletNonDefault = walletList.length > 1 && walletList[0] && activeWalletId !== walletList[0].id;
    const accountNonDefault = accountList.length > 1
        && accountList[0]
        && activeAccountId
        && activeAccountId !== accountList[0].id;


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

    // §20 / G041: signer-mode home variant. The wallet only signs PSBTs
    // pasted in from a paired Watcher wallet; balances, history, send,
    // and receive are not relevant. Render a stripped-down body with the
    // sign / verify CTAs and a banner explaining the role. Header stays
    // shared so the user can still lock / switch wallets / open Settings.
    if (isSignerMode) {
        return (
            <Screen variant={variant}>
                <div className={isFull ? styles.bodyFull : styles.bodyPopup}>
                    {loadError ? (
                        <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
                    ) : null}
                    {/* §25.2 / Cluster J FOLLOWUP 2: banner gated to popup
                        shells. Web + desktop mount the same banner inside
                        FullLayoutWithNav.header so it persists across
                        every unlocked view, not just Home. */}
                    {activeWalletId && shell === 'popup' ? (
                        <DemoBanner
                            activeWalletId={activeWalletId}
                            onExited={onLocked}
                        />
                    ) : null}
                    <SignerHomeBody
                        onSignPsbt={onSignPsbt}
                        onSignMessage={onSignMessage}
                        onVerifySignature={onVerifySignature}
                    />
                </div>
            </Screen>
        );
    }

    return (
        <Screen variant={variant}>
            <div className={isFull ? styles.bodyFull : styles.bodyPopup}>
                {loadError ? (
                    <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
                ) : null}

                {balances === null && !loadError ? (
                    <div role="status" aria-label="Loading balances">
                        <Skeleton.List rows={5} />
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
                    <div role="group" aria-label="Pending airdrops">
                        {pendingAirdrops.map((rec) => (
                            <button
                                key={rec.id}
                                type="button"
                                className={styles.pendingAirdropCard}
                                onClick={() => onResumeAirdrop(rec.id)}
                            >
                                <span className={styles.pendingAirdropTitle}>
                                    Resume airdrop: {rec.amountPer} {rec.token} × {rec.recipients.length}
                                </span>
                                <span className={styles.pendingAirdropHint}>
                                    {rec.stage === 'waiting-index'
                                        ? 'Recipient list sent, waiting to be indexed'
                                        : 'Ready to sign the airdrop'}
                                </span>
                            </button>
                        ))}
                    </div>
                ) : null}

                {pendingCoinpays.length > 0 && onResumeCoinpay ? (
                    <div role="group" aria-label="Pending payments due">
                        {pendingCoinpays.map((rec) => (
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
                                    Payment due: pay {rec.coinAmount} to complete matched order #{rec.orderMatchActionIndex}
                                </span>
                                <span className={styles.pendingAirdropHint}>
                                    Sign to finish paying for your matched order.
                                </span>
                            </button>
                        ))}
                    </div>
                ) : null}

                {/*
                  * : a self-armed panic freeze is announced here, above
                  * the balances, so the user learns signing is frozen BEFORE
                  * they tap Send. A duress-armed freeze renders nothing (the
                  * component owns that policy) so an observer sees no cue.
                  */}
                <PanicFreezeNotice surface="home" />
                {activeWalletId ? (
                    <DemoBanner
                        activeWalletId={activeWalletId}
                        onExited={onLocked}
                    />
                ) : null}
                {activeWalletId ? (
                    <BackupReminderCard
                        walletId={activeWalletId}
                        walletCreatedAt={activeWallet?.createdAt}
                        onAction={() => { setSettingsSubpage('backup'); setSettingsOpen(true); }}
                    />
                ) : null}

                {balances ? (
                    <HomeTabs
                        chainRegistry={chainRegistry}
                        balances={balances}
                        activeByChain={activeByChain}
                        balancesFetchedAt={balancesFetchedAt}
                        walletId={activeWalletId}
                        networkFilter={networkFilter}
                        tokenQuery={tokenQuery}
                        coinFamilies={coinFamilies}
                        onNetworkFilterChange={setNetworkFilter}
                        onTokenQueryChange={setTokenQuery}
                        multisig={isBtc ? multisig : null}
                        multisigChainId={chainRegistry.byCoin('bitcoin')[0]?.id}
                        onReceive={onReceive}
                        onSelectToken={onSelectToken}
                        onSelectEntry={onSelectEntry}
                        pinnedKeys={new Set(pinnedTokens)}
                        onTogglePin={showPinAffordance ? handleTogglePin : undefined}
                        hiddenKeys={new Set(hiddenTokens)}
                        onToggleHide={showHideAffordance ? handleToggleHide : undefined}
                        verifyMap={verifyMap}
                        hideSmallBalances={hideSmallBalances}
                        onCommandPalette={onCommandPalette}
                        // : only shells without a nav surface pass this;
                        // it renders a gear in the hero's control cluster.
                        onOpenSettings={onOpenSettings}
                        actions={(
                            <div className={styles.quickActions} role="group" aria-label="Quick actions">
                                <button
                                    type="button"
                                    className={styles.quickAction}
                                    onClick={onSend}
                                    disabled={!onSend}
                                >
                                    <span className={styles.quickActionIcon} aria-hidden="true"><Icon.SendIcon /></span>
                                    <span>Send</span>
                                </button>
                                <button
                                    type="button"
                                    className={styles.quickAction}
                                    onClick={onReceive}
                                    disabled={!onReceive}
                                >
                                    <span className={styles.quickActionIcon} aria-hidden="true"><Icon.ReceiveIcon /></span>
                                    <span>Receive</span>
                                </button>
                                {/* Not rendered at all when the shell wires no
                                    handler: a build can have compiled the DEX
                                    surface out , and a greyed-out
                                    Exchange button still advertises an
                                    exchange. Locked-wallet states pass a
                                    handler and disable elsewhere. */}
                                {onExchange ? (
                                    <button
                                        type="button"
                                        className={styles.quickAction}
                                        onClick={onExchange}
                                    >
                                        <span className={styles.quickActionIcon} aria-hidden="true"><Icon.MarketIcon /></span>
                                        <span>Exchange</span>
                                    </button>
                                ) : null}
                                <div className={styles.quickActionMoreWrap} ref={homeMoreWrapRef}>
                                    <button
                                        type="button"
                                        className={styles.quickAction}
                                        aria-haspopup="menu"
                                        aria-expanded={homeMoreOpen}
                                        onClick={() => setHomeMoreOpen((o) => !o)}
                                    >
                                        <span className={styles.quickActionIcon} aria-hidden="true"><Icon.MoreIcon /></span>
                                        <span>More</span>
                                    </button>
                                    {homeMoreOpen ? (
                                        <div className={styles.quickActionMoreMenu} role="menu">
                                            {onSwap ? (
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    className={styles.quickActionMoreItem}
                                                    onClick={() => { setHomeMoreOpen(false); onSwap(); }}
                                                >
                                                    <span className={styles.quickActionMoreItemIcon} aria-hidden="true">
                                                        <Icon.SwapIcon />
                                                    </span>
                                                    <span>Swap</span>
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    className={styles.quickActionMoreItem}
                                                    disabled
                                                >
                                                    <span>No additional actions</span>
                                                </button>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        )}
                    />
                ) : null}


                {balances && Object.keys(balances).length === 0 ? (
                    <div className={styles.emptyState}>
                        <p className={styles.hint}>
                            No addresses yet. Generate one to start receiving.
                        </p>
                        <Button
                            variant="primary"
                            size="md"
                            onClick={() => setAddAddressOpen(true)}
                            icon={<Icon.PlusIcon />}
                        >
                            Generate an address
                        </Button>
                    </div>
                ) : null}

                {/* Action button grid is full-mode only. In small mode the
                    actions live in the pancake menu, freeing the body for
                    the balance list. */}
                {isFull ? (
                <div className={styles.actionsFull}>
                    <Button
                        variant="primary"
                        block={!isFull}
                        onClick={onSend}
                        disabled={!onSend}
                        icon={<Icon.SendIcon />}
                    >
                        Send
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onReceive}
                        disabled={!onReceive}
                        icon={<Icon.ReceiveIcon />}
                    >
                        Receive
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onCreateToken}
                        disabled={!onCreateToken}
                        icon={<Icon.TokenIcon />}
                    >
                        Create token
                    </Button>
                    {/* Same rule as Exchange above: absent, not greyed, when
                        this build has no markets to open . */}
                    {onMarkets ? (
                        <Button
                            variant="secondary"
                            block={!isFull}
                            onClick={onMarkets}
                            icon={<Icon.MarketIcon />}
                        >
                            Markets
                        </Button>
                    ) : null}
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onMessaging}
                        disabled={!onMessaging}
                        icon={<Icon.MessageIcon />}
                    >
                        Messaging
                        {messagingUnread > 0 ? (
                            <span
                                aria-label={`${messagingUnread} unread`}
                                style={{
                                    marginInlineStart: '0.4rem',
                                    padding: '0 0.4rem',
                                    borderRadius: '999px',
                                    background: 'var(--xc-accent-primary, #0b84ff)',
                                    color: '#fff',
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
                        History
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onAddresses}
                        disabled={!onAddresses}
                        icon={<Icon.AddressIcon />}
                    >
                        Addresses
                    </Button>
                    {onContracts ? (
                        <Button
                            variant="secondary"
                            block={!isFull}
                            onClick={onContracts}
                            icon={<Icon.ContractIcon />}
                        >
                            Contracts
                        </Button>
                    ) : null}
                    {onStaking ? (
                        <Button
                            variant="secondary"
                            block={!isFull}
                            onClick={onStaking}
                            icon={<Icon.StakeIcon />}
                        >
                            Staking
                        </Button>
                    ) : null}
                    <Button
                        variant="ghost"
                        block={!isFull}
                        onClick={onActions}
                        disabled={!onActions}
                        icon={<Icon.MoreIcon />}
                    >
                        More actions
                    </Button>
                </div>
                ) : null}
            </div>
            {alertsOpen ? (
                <AlertsOverlay
                    alerts={alerts}
                    onClose={() => setAlertsOpen(false)}
                />
            ) : null}
        </Screen>
    );
}

function isPendingForPayer(row, address) {
    if (!row || typeof row !== 'object') return false;
    const status = String(row.coinpay_status || row.status || '').toLowerCase();
    if (status !== 'pending_coinpay') return false;
    const payer = row.payer_address || row.payerAddress;
    return typeof payer === 'string' && payer === address;
}

function extractObligationRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.obligations)) return resp.obligations;
    if (Array.isArray(resp.coinpay_obligations)) return resp.coinpay_obligations;
    return [];
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
function SignerHomeBody({ onSignPsbt, onSignMessage, onVerifySignature }) {
    return (
        <div role="region" aria-label="Signer-mode home">
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
                <strong style={{ color: 'var(--xc-text)' }}>Signer mode</strong>
                <span> This wallet only signs transactions from a paired Watcher
                wallet. Send / Receive / balances are not available.
                Switch the wallet's mode in Settings → Wallet Mode if you
                want full-wallet behaviour back.</span>
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
                    Sign a transaction
                </Button>
                <Button
                    variant="secondary"
                    onClick={onSignMessage}
                    disabled={!onSignMessage}
                >
                    Sign a message
                </Button>
                <Button
                    variant="ghost"
                    onClick={onVerifySignature}
                    disabled={!onVerifySignature}
                >
                    Verify a signature
                </Button>
            </div>
        </div>
    );
}
