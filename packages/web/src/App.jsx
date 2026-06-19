// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Web SPA state machine. Mirrors the extension popup's App.jsx but
// reads state from the in-page host bridge rather than chrome.runtime.
//
// Primary state (from getSessionStatus):
//   loading      -> no-wallet | locked | unlocked | error
//   locked       -> unlocked  (Locked fires onUnlocked on success)
//   unlocked     -> locked    (Home's Lock button fires onLocked)
//   no-wallet    -> locked    (Create/Import complete; host is live)
//
// Sub-routes inside `no-wallet`:  welcome | create | import
// Sub-routes inside `unlocked`:   home | send | receive
//
// A successful create/import leaves the host live; the next
// `getSessionStatus()` returns `unlocked` and the app transitions to
// Home without a separate unlock step.
//
// The ExtensionBanner renders above the whole router so routes don't
// need to know about web-only chrome. Auto-hides when `window.xchain`
// isn't injected, or when the user dismisses it for the session.

import { useCallback, useEffect, useState } from 'react';
import { useLastView } from '@xchain-wallet/core/shared/hooks/useLastView.js';
import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';
import { useSettings } from '@xchain-wallet/core/shared/hooks/useSettings.js';
import { Loading } from '@xchain-wallet/core/shared/routes/Loading.jsx';
import { Onboarding } from '@xchain-wallet/core/shared/routes/Onboarding.jsx';
import { CreateWallet } from '@xchain-wallet/core/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '@xchain-wallet/core/shared/routes/ImportWallet.jsx';
import { AddAccountForm } from '@xchain-wallet/core/shared/routes/AddAccountForm.jsx';
import { WalletPicker } from '@xchain-wallet/core/shared/routes/WalletPicker.jsx';
import { AccountPicker } from '@xchain-wallet/core/shared/routes/AccountPicker.jsx';
import { WalletDetails } from '@xchain-wallet/core/shared/routes/WalletDetails.jsx';
import { RenameWalletForm } from '@xchain-wallet/core/shared/routes/RenameWalletForm.jsx';
import { RenameAccountForm } from '@xchain-wallet/core/shared/routes/RenameAccountForm.jsx';
import { readActiveAccount, writeActiveAccount } from '@xchain-wallet/core/shared/utils/activeAccountMemory.js';
import { Locked } from '@xchain-wallet/core/shared/routes/Locked.jsx';
import { Home } from '@xchain-wallet/core/shared/routes/Home.jsx';
import { Settings } from '@xchain-wallet/core/shared/routes/Settings.jsx';
import { TokenDetail } from '@xchain-wallet/core/shared/routes/TokenDetail.jsx';
import { ToastHost, useToast } from '@xchain-wallet/core/shared/components/ToastHost.jsx';
import { NOTIFICATION_EVENT } from './notifications/webNotifyAdapter.js';
import { ReachabilityBanner } from '@xchain-wallet/core/shared/components/ReachabilityBanner.jsx';
import { isDemoWallet } from '@xchain-wallet/core/flows';
import { QueuedBroadcastBanner } from '@xchain-wallet/core/shared/components/QueuedBroadcastBanner.jsx';
import { DemoBanner } from '@xchain-wallet/core/shared/components/DemoBanner.jsx';
import { LeftNav, FullLayoutWithNav } from '@xchain-wallet/core/shared/components/LeftNav.jsx';
import { AppHeader } from '@xchain-wallet/core/shared/components/AppHeader.jsx';
import { MenuRoute } from '@xchain-wallet/core/shared/routes/MenuRoute.jsx';
import { AlertsRoute } from '@xchain-wallet/core/shared/routes/AlertsRoute.jsx';
import { registry as registryLib } from '@xchain-wallet/core';

const APP_CHAIN_REGISTRY = registryLib.defaultRegistry();
const APP_COIN_FAMILIES = ['bitcoin', 'litecoin', 'dogecoin'];
import { BottomTabBar } from '@xchain-wallet/core/shared/components/BottomTabBar.jsx';
import { uri as coreUri } from '@xchain-wallet/core';
import { Send } from '@xchain-wallet/core/shared/routes/Send.jsx';
import { SendPicker } from '@xchain-wallet/core/shared/routes/SendPicker.jsx';
import { Receive } from '@xchain-wallet/core/shared/routes/Receive.jsx';
import { ReceivePicker } from '@xchain-wallet/core/shared/routes/ReceivePicker.jsx';
import { ScanRoute } from '@xchain-wallet/core/shared/routes/ScanRoute.jsx';
import { TokenWizard } from '@xchain-wallet/core/shared/routes/TokenWizard.jsx';
import { ActionsMenu } from '@xchain-wallet/core/shared/routes/ActionsMenu.jsx';
import { MyTokens } from '@xchain-wallet/core/shared/routes/MyTokens.jsx';
import { ManageToken } from '@xchain-wallet/core/shared/routes/ManageToken.jsx';
import { MarketActivity } from '@xchain-wallet/core/shared/routes/MarketActivity.jsx';
import { IssueTokenForm } from '@xchain-wallet/core/shared/routes/IssueTokenForm.jsx';
import { MintForm } from '@xchain-wallet/core/shared/routes/MintForm.jsx';
import { DestroyForm } from '@xchain-wallet/core/shared/routes/DestroyForm.jsx';
import { TokenAdminForm } from '@xchain-wallet/core/shared/routes/TokenAdminForm.jsx';
import { BroadcastForm } from '@xchain-wallet/core/shared/routes/BroadcastForm.jsx';
import { DispenserForm } from '@xchain-wallet/core/shared/routes/DispenserForm.jsx';
import { DispensersList } from '@xchain-wallet/core/shared/routes/DispensersList.jsx';
import { DispenserDetail } from '@xchain-wallet/core/shared/routes/DispenserDetail.jsx';
import { DispenserExplorer } from '@xchain-wallet/core/shared/routes/DispenserExplorer.jsx';
import { DividendForm } from '@xchain-wallet/core/shared/routes/DividendForm.jsx';
import { AirdropForm } from '@xchain-wallet/core/shared/routes/AirdropForm.jsx';
import { AdvancedActionsForm } from '@xchain-wallet/core/shared/routes/AdvancedActionsForm.jsx';
import { MigrateToBip39 } from '@xchain-wallet/core/shared/routes/MigrateToBip39.jsx';
import { MarketsList } from '@xchain-wallet/core/shared/routes/MarketsList.jsx';
import { MarketView } from '@xchain-wallet/core/shared/routes/MarketView.jsx';
import { CoinpayForm } from '@xchain-wallet/core/shared/routes/CoinpayForm.jsx';
import { SwapForm } from '@xchain-wallet/core/shared/routes/SwapForm.jsx';
import { SellOwnershipForm } from '@xchain-wallet/core/shared/routes/SellOwnershipForm.jsx';
import { MessagingInbox } from '@xchain-wallet/core/shared/routes/MessagingInbox.jsx';
import { ComposeMessage } from '@xchain-wallet/core/shared/routes/ComposeMessage.jsx';
import { ContactsList } from '@xchain-wallet/core/shared/routes/ContactsList.jsx';
import { ContractsList } from '@xchain-wallet/core/shared/routes/ContractsList.jsx';
import { ContractDetail } from '@xchain-wallet/core/shared/routes/ContractDetail.jsx';
import { ContractStakeForm } from '@xchain-wallet/core/shared/routes/ContractStakeForm.jsx';
import { ContractStakedPositions } from '@xchain-wallet/core/shared/routes/ContractStakedPositions.jsx';
import { DeployContractForm } from '@xchain-wallet/core/shared/routes/DeployContractForm.jsx';
import { ExecuteContractForm } from '@xchain-wallet/core/shared/routes/ExecuteContractForm.jsx';
import { ContractFundsForm } from '@xchain-wallet/core/shared/routes/ContractFundsForm.jsx';
import { ControllerBindForm } from '@xchain-wallet/core/shared/routes/ControllerBindForm.jsx';
import { StakingDashboard } from '@xchain-wallet/core/shared/routes/StakingDashboard.jsx';
import { StakeForm } from '@xchain-wallet/core/shared/routes/StakeForm.jsx';
import { StakingActionForm } from '@xchain-wallet/core/shared/routes/StakingActionForm.jsx';
import { DelegationActionForm } from '@xchain-wallet/core/shared/routes/DelegationActionForm.jsx';
import { OperatorDashboard } from '@xchain-wallet/core/shared/routes/OperatorDashboard.jsx';
import { History } from '@xchain-wallet/core/shared/routes/History.jsx';
import { ActionDetail } from '@xchain-wallet/core/shared/routes/ActionDetail.jsx';
import { LinkForm } from '@xchain-wallet/core/shared/routes/LinkForm.jsx';
import { AttachContentForm } from '@xchain-wallet/core/shared/routes/AttachContentForm.jsx';
import { ProjectRosterForm } from '@xchain-wallet/core/shared/routes/ProjectRosterForm.jsx';
import { SignMessageForm } from '@xchain-wallet/core/shared/routes/SignMessageForm.jsx';
import { VerifySignatureForm } from '@xchain-wallet/core/shared/routes/VerifySignatureForm.jsx';
import { PsbtSignForm } from '@xchain-wallet/core/shared/routes/PsbtSignForm.jsx';
import { ViewPrivateKey } from '@xchain-wallet/core/shared/routes/ViewPrivateKey.jsx';
import { KeyQR } from '@xchain-wallet/core/shared/components/KeyQR.jsx';
import { ParallelComposer } from '@xchain-wallet/core/shared/routes/ParallelComposer.jsx';
import { CrossChainSwapForm } from '@xchain-wallet/core/shared/routes/CrossChainSwapForm.jsx';
import { CrossChainTemplates } from '@xchain-wallet/core/shared/routes/CrossChainTemplates.jsx';
import { MultisigCreate } from '@xchain-wallet/core/shared/routes/MultisigCreate.jsx';
import { MultisigSigningSession } from '@xchain-wallet/core/shared/routes/MultisigSigningSession.jsx';
import { AddressList } from '@xchain-wallet/core/shared/routes/AddressList.jsx';
import { PairSignerForm } from '@xchain-wallet/core/shared/routes/PairSignerForm.jsx';
import { useBtcAddressesPresent } from '@xchain-wallet/core/shared/hooks/useBtcAddressesPresent.js';
import { pairTrezorSigner } from './signers/trezorFactory.js';
import { pairLedgerSigner } from './signers/ledgerFactory.js';
import { registerSigner as registerLocalSigner } from './signerBridge.js';
import * as messaging from './messaging.js';
import { getSessionStatus, listWallets, lockWallet, listAccounts } from './messaging.js';
import { ExtensionBanner } from './components/ExtensionBanner.jsx';
import { useActiveVariant, shellForVariant } from './devVariant.js';
import { DevVariantBadge } from './DevVariantBadge.jsx';
import devShellStyles from './DevVariantShell.module.css';

export function App() {
    const variantState = useActiveVariant();
    const { variant, source } = variantState;
    const shell = shellForVariant(variant);
    // Pick the page-level wrapper. Four cases:
    //   sidebar              → simulate Chrome's side panel (right-edge column)
    //   extension            → simulate the Chrome extension toolbar popup (360×600 fixed)
    //   small + forced       → frame (375×600 phone-preview)
    //   anything else        → transparent passthrough (full / auto-small)
    const wrapper = variant === 'sidebar'
        ? { page: devShellStyles.sidebarPage, frame: devShellStyles.sidebarFrame }
        : variant === 'extension'
            ? { page: devShellStyles.extensionPage, frame: devShellStyles.extensionFrame }
            : variant === 'small' && source !== 'auto'
                ? { page: devShellStyles.smallPage, frame: devShellStyles.smallFrame }
                : { page: devShellStyles.fullPage, frame: devShellStyles.fullFrame };
    return (
        <MessagingProvider shell={shell} messaging={messaging}>
            <div className={wrapper.page}>
                <div className={wrapper.frame}>
                    <ToastHost>
                        <ExtensionBanner />
                        <AppInner />
                    </ToastHost>
                </div>
                <GatedDevVariantBadge state={variantState} />
            </div>
        </MessagingProvider>
    );
}

// The dev variant switcher is a developer-only preview tool. Gate it
// behind Developer Mode plus its own "Show variant popover" toggle
// (`settings.showVariantBadge`); both default off, so it never shows in
// production unless a developer explicitly opts in.
function GatedDevVariantBadge({ state }) {
    const { settings } = useSettings();
    if (!settings?.developerMode || !settings?.showVariantBadge) return null;
    return <DevVariantBadge state={state} />;
}

function AppInner() {
    const { variant } = useActiveVariant();
    const isFull = variant === 'full';
    const { showToast } = useToast();
    const [status, setStatus] = useState(/** @type {any} */ ({ state: 'loading' }));
    const [onboardingStep, setOnboardingStep] = useState(
        /** @type {'welcome' | 'create' | 'import' | 'import-freewallet'} */ ('welcome'),
    );
    const [unlockedView, setUnlockedView] = useState(
        /** @type {'home' | 'send' | 'receive' | 'receive-picker' | 'wizard' | 'actions' | 'my-tokens' | 'manage-token' | 'market-activity' | 'issue' | 'mint' | 'destroy' | 'lock' | 'description' | 'transfer' | 'broadcast' | 'dispenser' | 'dispensers-list' | 'dispenser-detail' | 'dispenser-explorer' | 'dividend' | 'airdrop' | 'advanced' | 'migrate-bip39' | 'pair-signer' | 'markets' | 'markets-picker' | 'market' | 'coinpay' | 'swap' | 'sell-name' | 'messaging' | 'compose-message' | 'contacts' | 'contracts-list' | 'contract-detail' | 'contract-deploy' | 'contract-execute' | 'contract-deposit' | 'contract-withdraw' | 'controller-bind' | 'staking-dashboard' | 'stake-form' | 'staking-unstake' | 'staking-claim' | 'staking-delegate' | 'staking-revoke' | 'operator-dashboard' | 'history' | 'action-detail' | 'token-detail' | 'link-form' | 'attach-content' | 'project-roster' | 'parallel-compose' | 'cross-chain-swap' | 'cross-chain-templates' | 'multisig-create' | 'multisig-sign' | 'addresses' | 'add-wallet' | 'add-account' | 'wallet-picker' | 'account-picker' | 'wallet-details' | 'wallet-rename' | 'account-rename' | 'scan'} */ ('home'),
    );
    const [tokenDetailRef, setTokenDetailRef] = useState(
        /** @type {{ chainId: string, tick: string, kind: string, displayName: string, divisibility: number, fiatRate: number | null, quantity: string } | null} */ (null),
    );
    const [historyInitialQuery, setHistoryInitialQuery] = useState('');
    // When set, the next action form's back handler returns to this
    // view instead of the default 'actions' (Token Actions) catch-all.
    // ManageToken sets this to 'manage-token' before opening a per-
    // token form so back lands the user back on the management page.
    const [formReturnView, setFormReturnView] = useState(/** @type {string | null} */ (null));
    const formBack = () => {
        const target = formReturnView || 'actions';
        setFormReturnView(null);
        setUnlockedView(target);
    };
    // When a form was launched from ManageToken, expose the locked
    // (chainId, tick) so it can prefill + visually lock its ticker
    // field. Forms opened from ActionsMenu pass undefined and behave
    // as free-entry.
    const fromManage = formReturnView === 'manage-token';
    const prefillChainId = fromManage ? tokenDetailRef?.chainId : undefined;
    const prefillTick = fromManage ? tokenDetailRef?.tick : undefined;
    // Issuer address stashed by ManageToken via `onIssuerResolved`.
    // When set, each prefill-enabled form defaults its From row to the
    // creator address instead of the newest receive-chain HD address.
    const prefillFromAddress = fromManage ? tokenDetailRef?.issuer : undefined;
    // Coin family to scope History's chain filter to on entry (mirror
    // of popup wiring). Empty = no scoping.
    const [historyInitialChainCoin, setHistoryInitialChainCoin] = useState('');
    // Which view History's Back button returns to. Set explicitly at
    // each entry point so we don't carry stale state from a previous
    // visit (e.g. entering from TokenDetail then re-entering from the
    // home menu should return to home, not back to TokenDetail).
    const [historyReturnTo, setHistoryReturnTo] = useState(
        /** @type {'home' | 'token-detail'} */ ('home'),
    );
    // Selected entry for the standalone ActionDetail view (mirror of
    // popup wiring). Set on row click in History or in Home's Activity
    // tab; cleared on back.
    const [selectedHistoryEntry, setSelectedHistoryEntry] = useState(
        /** @type {any | null} */ (null),
    );
    // Where ActionDetail's Back returns to: 'history' when opened from
    // the History timeline, 'home' when opened from Home's Activity tab.
    const [actionDetailReturnTo, setActionDetailReturnTo] = useState(
        /** @type {'history' | 'home'} */ ('history'),
    );
    const [walletDetailsId, setWalletDetailsId] = useState(/** @type {string | null} */ (null));
    const [walletRenameTarget, setWalletRenameTarget] = useState(
        /** @type {{ id: string, name: string } | null} */ (null),
    );
    const [accountRenameTarget, setAccountRenameTarget] = useState(
        /** @type {{ id: string, name: string } | null} */ (null),
    );
    const [migrateLegacyWalletId, setMigrateLegacyWalletId] = useState(/** @type {string | null} */ (null));
    // Global header state: lifted up so the AppHeader in the layout
    // header slot can render the same filter + pancake the Home page
    // historically owned, and so flipping the filter on TokenDetail
    // affects Home and vice-versa.
    const [globalNetworkFilter, setGlobalNetworkFilter] = useState('all');
    // Free-text token filter: lifted alongside the network filter so the
    // AppHeader popover and Home's HomeTabs share one source of truth.
    const [globalTokenQuery, setGlobalTokenQuery] = useState('');
    // Asset-kind filter: surfaced via the global filter popover on the
    // send-picker route so the user can narrow the spendable list to
    // all / coins / tokens. Lifted here so the popover and SendPicker
    // share one source of truth.
    const [globalKindFilter, setGlobalKindFilter] = useState(/** @type {'all' | 'coins' | 'tokens'} */ ('all'));
    // Tracks which unlockedView the user was on when they tapped the
    // pancake. The back-button on MenuRoute returns to it; tapping the
    // pancake again from inside Menu does the same.
    const [menuBackTo, setMenuBackTo] = useState('home');
    // QR scanner overlay: available from any unlocked view via the
    // AppHeader scan button. On a `send` outcome we populate the
    // sendPrefill and navigate into Send; receive jumps to the Receive
    // route; psbt opens the PSBT-sign route. Mirrors the existing
    // dedicated 'scan' route handler.
    const [globalScannerOpen, setGlobalScannerOpen] = useState(false);
    const [resumeAirdropId, setResumeAirdropId] = useState(
        /** @type {string | null} */ (null),
    );
    // §17.7 / G027: staged address handed to <ViewPrivateKey> when the
    // user picks "Show key" from the addresses list.
    const [privateKeyAddress, setPrivateKeyAddress] = useState(
        /** @type {any | null} */ (null),
    );
    const [resumeCoinpay, setResumeCoinpay] = useState(
        /** @type {{ chainId: string, address: string, orderMatchActionIndex: string } | null} */ (null),
    );
    const [composePrefill, setComposePrefill] = useState(
        /** @type {{ chainId?: string, fromAddressId?: string, toAddress?: string } | null} */ (null),
    );
    const [activeWalletId, setActiveWalletId] = useState(
        /** @type {string | null} */ (null),
    );
    const [activeAccountId, setActiveAccountId] = useState(
        /** @type {string | null} */ (null),
    );
    // §24 Cluster Y FOLLOWUP 3: track the resolved active-wallet record
    // so LeftNav / BottomTabBar can label the wallet switcher and so
    // the new 'settings' top-level view can pass `activeWallet` through
    // to the Settings drilldown the same way Home does.
    const [walletList, setWalletList] = useState(/** @type {Array<{ id: string, name: string }>} */ ([]));
    const [dispenserRef, setDispenserRef] = useState(
        /** @type {{ chainId: string, actionIndex: string } | null} */ (null),
    );
    // Preset for the SwapForm when launched as "Sell name" from ManageToken
    // (give-ownership mode, ticker + chain prefilled). Null for a normal swap.
    // Context for the "Sell name" flow (ORDER with GIVE_OWNERSHIP=1), set by
    // ManageToken before opening the sell-name view.
    const [sellNameRef, setSellNameRef] = useState(
        /** @type {{ chainId: string, tick: string, fromAddress?: string } | null} */ (null),
    );
    const [contractRef, setContractRef] = useState(
        /** @type {{ chainId: string, contractActionIndex: string } | null} */ (null),
    );
    const [stakingRef, setStakingRef] = useState(
        /** @type {{ chainId: string, address: string } | null} */ (null),
    );
    const [parallelPrefill, setParallelPrefill] = useState(
        /** @type {Array<{ chainId: string, action: string, params: Record<string, string>, note?: string }> | null} */ (null),
    );
    const [activeMarket, setActiveMarket] = useState(
        /** @type {{ chainId: string, tick1: string, tick2: string } | null} */ (null),
    );
    // The coin/token the user picked to scope the Markets list to.
    // Carried between MarketsList and the picker (`markets-picker`) so
    // re-entering Markets restores the selection. Defaults to BTC mainnet.
    const [marketsAsset, setMarketsAsset] = useState(
        /** @type {{ chainId: string, tick: string, displayName?: string, kind?: string } | null} */ ({
            chainId: 'bitcoin-mainnet',
            tick: 'BTC',
            kind: 'native',
        }),
    );
    // §47 / Cluster L FOLLOWUP 1: deep-link prefill for Send. Populated
    // once on mount from `?uri=` in `location.search`; consumed by the
    // 'send' route below and cleared after the user submits or backs out.
    const [sendPrefill, setSendPrefill] = useState(
        /** @type {{ address?: string, amount?: string, tick?: string, chainId?: string, memo?: string } | null} */ (null),
    );
    // Which view Send should return to when the user hits Back. Defaults
    // to 'home'; SendPicker → Send sets it to 'send-picker' so backing
    // out lands on the token list the user was just browsing.
    const [sendBackTo, setSendBackTo] = useState(
        /** @type {'home' | 'send-picker' | 'token-detail'} */ ('home'),
    );
    // ReceivePicker → Receive prefill carrier; cleared when the user
    // backs out of Receive. Mirrors `sendPrefill` for the Send side.
    const [receivePrefill, setReceivePrefill] = useState(
        /** @type {{ chainId?: string, tick?: string, kind?: string, displayName?: string, imageUrl?: string | null } | null} */ (null),
    );

    const refresh = useCallback(() => {
        setStatus({ state: 'loading' });
        setOnboardingStep('welcome');
        setUnlockedView('home');
        getSessionStatus()
            .then((next) => {
                setStatus(next);
                // Settings are only decryptable once unlocked. Notify
                // useSettings instances mounted above this boundary (e.g.
                // GatedDevVariantBadge) so they re-read now that the vault
                // is open, instead of staying stuck on the locked-state
                // read failure until the next settings write.
                if (next?.state === 'unlocked' && typeof window !== 'undefined') {
                    try {
                        window.dispatchEvent(new CustomEvent('xc:session-changed'));
                    } catch { /* CustomEvent unsupported: non-fatal */ }
                }
            })
            .catch((err) =>
                setStatus({ state: 'error', error: err?.message || String(err) }),
            );
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // §47 / Cluster L FOLLOWUP 1: consume `?uri=` from location.search
    // when the SPA boots (e.g. after the user clicked an `xchain:` link
    // and the browser routed it through the protocol-handler we
    // registered at v0.191.0). Strip the param via history.replaceState
    // so a refresh doesn't re-trigger the auto-route. Runs once on
    // mount; the parser tolerates malformed input by returning
    // `{ kind: 'unknown' }` which we ignore.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('uri');
        if (!raw) return;
        try {
            const intent = coreUri.parseXchainUri(raw);
            if (intent && intent.kind === 'send') {
                setSendPrefill({
                    address: intent.address,
                    amount: intent.amount,
                    tick: intent.tick,
                    chainId: intent.chainId,
                    memo: intent.memo,
                });
                setUnlockedView('send');
            } else if (intent && intent.kind === 'receive') {
                setUnlockedView('receive');
            }
        } catch {
            // Parser surfaces unknown via kind === 'unknown'; nothing else
            // throws here. Defensive try/catch in case future parser
            // changes regress.
        } finally {
            params.delete('uri');
            const next = params.toString();
            const url = window.location.pathname + (next ? `?${next}` : '') + window.location.hash;
            window.history.replaceState(null, '', url);
        }
    }, []);

    // No auto-unlock: the password is never persisted to Web API
    // storage, so a page reload always re-locks the wallet and the
    // user re-enters their password (docs/Threat_Model.md §1, §2.1).

    useEffect(() => {
        if (status.state !== 'unlocked') {
            setActiveWalletId(null);
            setActiveAccountId(null);
            setWalletList([]);
            return;
        }
        let cancelled = false;
        listWallets()
            .then((list) => {
                if (cancelled) return;
                const arr = Array.isArray(list) ? list : [];
                setWalletList(arr);
                if (arr.length > 0) {
                    setActiveWalletId(arr[0].id);
                }
            })
            .catch(() => { /* Home surfaces load errors */ });
        return () => { cancelled = true; };
    }, [status.state]);

    // §46: surface live notifications as an in-app toast while the wallet is
    // open and focused. The hostBridge NotificationService fires a window
    // CustomEvent for every notification; when the tab is backgrounded the
    // adapter shows an OS notification instead, so we skip the toast then.
    useEffect(() => {
        if (status.state !== 'unlocked') return undefined;
        const onNotify = (event) => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            const detail = (event && event.detail) || {};
            const message = detail.title && detail.body
                ? `${detail.title}: ${detail.body}`
                : (detail.title || detail.body || 'Notification');
            showToast({ message, variant: 'default' });
        };
        window.addEventListener(NOTIFICATION_EVENT, onNotify);
        return () => window.removeEventListener(NOTIFICATION_EVENT, onNotify);
    }, [status.state, showToast]);

    // Mirror of popup App: load accounts for the active wallet and
    // auto-select the first (lowest-index) one. Reset on wallet switch.
    useEffect(() => {
        if (!activeWalletId) {
            setActiveAccountId(null);
            return undefined;
        }
        let cancelled = false;
        listAccounts(activeWalletId)
            .then((list) => {
                if (cancelled) return;
                const sorted = Array.isArray(list)
                    ? [...list].sort((a, b) => a.index - b.index)
                    : [];
                // Restore the last selected account for this wallet if it
                // still exists; otherwise fall back to the lowest index.
                const persisted = readActiveAccount(activeWalletId);
                const chosen = (persisted && sorted.some((a) => a.id === persisted))
                    ? persisted
                    : (sorted[0]?.id || null);
                setActiveAccountId(chosen);
            })
            .catch(() => { if (!cancelled) setActiveAccountId(null); });
        return () => { cancelled = true; };
    }, [activeWalletId]);

    // Switch the active account and remember it per wallet, so a reload
    // returns to it instead of snapping back to the lowest-index account.
    const handleSwitchAccount = (id) => {
        setActiveAccountId(id);
        if (activeWalletId && id) writeActiveAccount(activeWalletId, id);
    };

    // §42.2 Contracts nav: show only when a BTC wallet address exists
    // (VM actions are BTC-only at launch per BITCOIN_ACTIONS).
    const hasBtcAddress = useBtcAddressesPresent(activeWalletId);

    // Wallet-level alerts surfaced in the pancake menu's Alerts panel.
    // Mirrors Home.jsx's `alerts` array so the web MenuRoute shows the
    // same signals (the menu lives at the App level here, not in Home).
    // Computed each render from walletList; future alerts append here.
    const activeWallet = walletList.find((w) => w.id === activeWalletId) || null;
    const menuAlerts = [];
    if (activeWallet?.format === 'counterwallet-legacy') {
        menuAlerts.push({
            id: 'legacy-format',
            severity: 'info',
            title: 'Legacy FreeWallet format',
            message: 'This wallet uses the 12-word Counterwallet format. Migrate to BIP39 for broader interop and stronger derivation.',
            action: {
                label: 'Migrate to BIP39',
                onSelect: () => setUnlockedView('migrate-bip39'),
            },
        });
    }

    // §24 / G055: resume the user's last view on unlock (persisted
    // per-wallet in localStorage). Restricted to context-free views;
    // anything that needs a prefilled state object falls through to
    // Home. See `lastViewMemory.RESUMABLE_VIEWS` for the set.
    useLastView({
        walletId: activeWalletId,
        currentView: unlockedView,
        onResume: setUnlockedView,
    });

    switch (status.state) {
        case 'loading':
            return <Loading />;
        case 'error':
            return <Loading error={status.error} />;
        case 'no-wallet':
            if (onboardingStep === 'create') {
                return (
                    <CreateWallet
                        onBack={() => setOnboardingStep('welcome')}
                        onCreated={refresh}
                    />
                );
            }
            if (onboardingStep === 'import') {
                return (
                    <ImportWallet
                        onBack={() => setOnboardingStep('welcome')}
                        onImported={refresh}
                    />
                );
            }
            if (onboardingStep === 'import-freewallet') {
                return (
                    <ImportWallet
                        variant="freewallet"
                        onBack={() => setOnboardingStep('welcome')}
                        onImported={refresh}
                    />
                );
            }
            return (
                <Onboarding
                    onCreate={() => setOnboardingStep('create')}
                    onImport={() => setOnboardingStep('import')}
                    onImportFromFreeWallet={() => setOnboardingStep('import-freewallet')}
                    onDemoEntered={refresh}
                />
            );
        case 'locked':
            return <Locked onUnlocked={refresh} />;
        case 'unlocked': {
            // §24.2 / G053: wrap the unlocked-route render tree in
            // <FullLayoutWithNav> so the left nav is always visible at
            // ≥900px viewports. Existing route returns are captured by
            // the IIFE so the surrounding switch case stays readable.
            const routeNode = (() => {
            if (unlockedView === 'menu' && activeWalletId) {
                return (
                    <MenuRoute
                        onBack={() => setUnlockedView(menuBackTo)}
                        onAlerts={() => setUnlockedView('alerts')}
                        onMarkets={() => setUnlockedView('markets')}
                        onMarketActivity={() => setUnlockedView('market-activity')}
                        onDispensers={() => setUnlockedView('dispensers-list')}
                        onTokens={() => setUnlockedView('my-tokens')}
                        onMoreActions={() => setUnlockedView('actions')}
                        onMessaging={() => setUnlockedView('messaging')}
                        onCrossChain={() => setUnlockedView('cross-chain')}
                        onContacts={() => setUnlockedView('contacts')}
                        onAddresses={() => setUnlockedView('addresses')}
                        onContracts={() => setUnlockedView('contracts')}
                        onStaking={() => setUnlockedView('staking')}
                        onMultisig={() => setUnlockedView('multisig')}
                        onSwitchWallet={() => setUnlockedView('wallet-picker')}
                        onLock={() => { lockWallet().then(refresh).catch(() => refresh()); }}
                        onSettings={() => setUnlockedView('settings')}
                    />
                );
            }
            if (unlockedView === 'alerts' && activeWalletId) {
                return (
                    <AlertsRoute
                        onBack={() => setUnlockedView('menu')}
                        alerts={menuAlerts}
                    />
                );
            }
            if (unlockedView === 'send' && activeWalletId) {
                return (
                    <Send
                        walletId={activeWalletId}
                        onBack={() => {
                            setSendPrefill(null);
                            setUnlockedView(sendBackTo);
                            setSendBackTo('home');
                        }}
                        prefill={sendPrefill}
                        onChangeAsset={() => {
                            setSendPrefill(null);
                            setUnlockedView('send-picker');
                        }}
                    />
                );
            }
            if (unlockedView === 'send-picker' && activeWalletId) {
                return (
                    <SendPicker
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        networkFilter={globalNetworkFilter}
                        onNetworkFilterChange={setGlobalNetworkFilter}
                        tokenQuery={globalTokenQuery}
                        onTokenQueryChange={setGlobalTokenQuery}
                        kindFilter={globalKindFilter}
                        onKindFilterChange={setGlobalKindFilter}
                        hideOwnFilter
                        onBack={() => setUnlockedView('home')}
                        onSelect={(sel) => {
                            setSendPrefill({
                                chainId: sel.chainId,
                                tick: sel.tick,
                                kind: sel.kind,
                                displayName: sel.displayName,
                                imageUrl: sel.imageUrl,
                            });
                            setSendBackTo('send-picker');
                            setUnlockedView('send');
                        }}
                    />
                );
            }
            if (unlockedView === 'receive-picker' && activeWalletId) {
                return (
                    <ReceivePicker
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        networkFilter={globalNetworkFilter}
                        onNetworkFilterChange={setGlobalNetworkFilter}
                        tokenQuery={globalTokenQuery}
                        onTokenQueryChange={setGlobalTokenQuery}
                        kindFilter={globalKindFilter}
                        onKindFilterChange={setGlobalKindFilter}
                        hideOwnFilter
                        onBack={() => setUnlockedView('home')}
                        onSelect={(sel) => {
                            setReceivePrefill({
                                chainId: sel.chainId,
                                tick: sel.tick,
                                kind: sel.kind,
                                displayName: sel.displayName,
                                imageUrl: sel.imageUrl,
                            });
                            setUnlockedView('receive');
                        }}
                    />
                );
            }
            if (unlockedView === 'receive' && activeWalletId) {
                return (
                    <Receive
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        prefill={receivePrefill}
                        onBack={() => {
                            setReceivePrefill(null);
                            setUnlockedView(receivePrefill ? 'receive-picker' : 'home');
                        }}
                        onChangeAsset={() => {
                            setReceivePrefill(null);
                            setUnlockedView('receive-picker');
                        }}
                    />
                );
            }
            if (unlockedView === 'scan' && activeWalletId) {
                return (
                    <ScanRoute
                        onBack={() => setUnlockedView('home')}
                        onClassified={(outcome) => {
                            if (outcome.kind === 'send') {
                                setSendPrefill({
                                    address: outcome.address,
                                    amount: outcome.amount,
                                    tick: outcome.tick,
                                    chainId: outcome.chainId,
                                    memo: outcome.memo,
                                    feePriority: outcome.feePriority,
                                });
                                setUnlockedView('send');
                            } else if (outcome.kind === 'receive') {
                                setUnlockedView('receive');
                            } else if (outcome.kind === 'psbt') {
                                setUnlockedView('sign-psbt');
                            }
                        }}
                    />
                );
            }
            if (unlockedView === 'wizard' && activeWalletId) {
                return (
                    <TokenWizard
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'issue' && activeWalletId) {
                return (
                    <IssueTokenForm
                        walletId={activeWalletId}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'mint' && activeWalletId) {
                return (
                    <MintForm
                        walletId={activeWalletId}
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                    />
                );
            }
            if (unlockedView === 'destroy' && activeWalletId) {
                return (
                    <DestroyForm
                        walletId={activeWalletId}
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                    />
                );
            }
            if (
                (unlockedView === 'lock'
                    || unlockedView === 'description'
                    || unlockedView === 'transfer')
                && activeWalletId
            ) {
                return (
                    <TokenAdminForm
                        walletId={activeWalletId}
                        mode={unlockedView}
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                    />
                );
            }
            if (unlockedView === 'broadcast' && activeWalletId) {
                return (
                    <BroadcastForm
                        walletId={activeWalletId}
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                    />
                );
            }
            if (unlockedView === 'dispenser' && activeWalletId) {
                return (
                    <DispenserForm
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId}
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                    />
                );
            }
            if (unlockedView === 'controller-bind' && activeWalletId && tokenDetailRef) {
                return (
                    <ControllerBindForm
                        walletId={activeWalletId}
                        chainId={tokenDetailRef.chainId}
                        tick={tokenDetailRef.tick}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'dispensers-list' && activeWalletId) {
                return (
                    <DispensersList
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        onOpenDispenser={(chainId, actionIndex) => {
                            setDispenserRef({ chainId, actionIndex, origin: 'list' });
                            setUnlockedView('dispenser-detail');
                        }}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'dispenser-detail' && activeWalletId && dispenserRef) {
                return (
                    <DispenserDetail
                        walletId={activeWalletId}
                        chainId={dispenserRef.chainId}
                        actionIndex={dispenserRef.actionIndex}
                        onBack={() => {
                            if (dispenserRef.origin === 'explorer') return setUnlockedView('dispenser-explorer');
                            if (dispenserRef.origin === 'manage-token') return setUnlockedView('manage-token');
                            return setUnlockedView('dispensers-list');
                        }}
                    />
                );
            }
            if (unlockedView === 'dispenser-explorer' && activeWalletId) {
                return (
                    <DispenserExplorer
                        onOpenDispenser={(chainId, actionIndex) => {
                            setDispenserRef({ chainId, actionIndex, origin: 'explorer' });
                            setUnlockedView('dispenser-detail');
                        }}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'dividend' && activeWalletId) {
                return (
                    <DividendForm
                        walletId={activeWalletId}
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                    />
                );
            }
            if (unlockedView === 'airdrop' && activeWalletId) {
                return (
                    <AirdropForm
                        walletId={activeWalletId}
                        resumeId={resumeAirdropId}
                        onBack={() => {
                            setResumeAirdropId(null);
                            if (resumeAirdropId) {
                                setUnlockedView('home');
                            } else {
                                formBack();
                            }
                        }}
                        initialChainId={resumeAirdropId ? undefined : prefillChainId}
                        initialTick={resumeAirdropId ? undefined : prefillTick}
                        initialFromAddress={resumeAirdropId ? undefined : prefillFromAddress}
                    />
                );
            }
            if (unlockedView === 'advanced' && activeWalletId) {
                return (
                    <AdvancedActionsForm
                        walletId={activeWalletId}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'migrate-bip39' && (migrateLegacyWalletId || activeWalletId)) {
                const targetId = migrateLegacyWalletId || activeWalletId;
                return (
                    <MigrateToBip39
                        legacyWalletId={targetId}
                        onBack={() => {
                            setMigrateLegacyWalletId(null);
                            setUnlockedView(migrateLegacyWalletId ? 'wallet-details' : 'home');
                        }}
                        onMigrated={() => {
                            setMigrateLegacyWalletId(null);
                            refresh();
                        }}
                    />
                );
            }
            if (unlockedView === 'pair-signer' && activeWalletId) {
                return (
                    <PairSignerForm
                        walletId={activeWalletId}
                        pairTrezor={pairTrezorSigner}
                        pairLedger={pairLedgerSigner}
                        onBack={formBack}
                        onPaired={() => setUnlockedView('actions')}
                        onSignerPaired={registerLocalSigner}
                    />
                );
            }
            if (unlockedView === 'markets' && activeWalletId) {
                return (
                    <MarketsList
                        walletId={activeWalletId}
                        selectedAsset={marketsAsset}
                        onChangeAsset={() => setUnlockedView('markets-picker')}
                        onOpenMarket={(chainId, tick1, tick2) => {
                            setActiveMarket({ chainId, tick1, tick2 });
                            setUnlockedView('market');
                        }}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'markets-picker' && activeWalletId) {
                return (
                    <ReceivePicker
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        title="Select coin or token"
                        backLabel="Back to markets"
                        hideOwnFilter
                        onBack={() => setUnlockedView('markets')}
                        onSelect={(sel) => {
                            setMarketsAsset({
                                chainId: sel.chainId,
                                tick: sel.tick,
                                displayName: sel.displayName,
                                kind: sel.kind,
                            });
                            setUnlockedView('markets');
                        }}
                    />
                );
            }
            if (unlockedView === 'market' && activeMarket && activeWalletId) {
                return (
                    <MarketView
                        walletId={activeWalletId}
                        chainId={activeMarket.chainId}
                        tick1={activeMarket.tick1}
                        tick2={activeMarket.tick2}
                        onBack={() => {
                            setActiveMarket(null);
                            setUnlockedView('markets');
                        }}
                        onSwap={() => setActiveMarket({
                            chainId: activeMarket.chainId,
                            tick1: activeMarket.tick2,
                            tick2: activeMarket.tick1,
                        })}
                    />
                );
            }
            if (unlockedView === 'coinpay' && activeWalletId) {
                return (
                    <CoinpayForm
                        walletId={activeWalletId}
                        chainId={resumeCoinpay?.chainId}
                        address={resumeCoinpay?.address}
                        orderMatchActionIndex={resumeCoinpay?.orderMatchActionIndex}
                        onBack={() => {
                            const cameFromResume = resumeCoinpay !== null;
                            setResumeCoinpay(null);
                            setUnlockedView(cameFromResume ? 'home' : 'actions');
                        }}
                    />
                );
            }
            if (unlockedView === 'swap' && activeWalletId) {
                return (
                    <SwapForm
                        walletId={activeWalletId}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'sell-name' && activeWalletId && sellNameRef) {
                return (
                    <SellOwnershipForm
                        walletId={activeWalletId}
                        chainId={sellNameRef.chainId}
                        tick={sellNameRef.tick}
                        initialFromAddress={sellNameRef.fromAddress}
                        onBack={() => setUnlockedView('manage-token')}
                    />
                );
            }
            if (unlockedView === 'link-form' && activeWalletId) {
                return (
                    <LinkForm
                        walletId={activeWalletId}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'attach-content' && activeWalletId && tokenDetailRef) {
                return (
                    <AttachContentForm
                        walletId={activeWalletId}
                        chainId={tokenDetailRef.chainId}
                        tick={tokenDetailRef.tick}
                        issuerAddress={tokenDetailRef.issuer || null}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'project-roster' && activeWalletId && tokenDetailRef) {
                return (
                    <ProjectRosterForm
                        walletId={activeWalletId}
                        chainId={tokenDetailRef.chainId}
                        tick={tokenDetailRef.tick}
                        issuerAddress={tokenDetailRef.issuer || null}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'sign-message' && activeWalletId) {
                return (
                    <SignMessageForm
                        walletId={activeWalletId}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'verify-signature') {
                return (
                    <VerifySignatureForm
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'sign-psbt' && activeWalletId) {
                return (
                    <PsbtSignForm
                        walletId={activeWalletId}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'parallel-compose' && activeWalletId) {
                return (
                    <ParallelComposer
                        walletId={activeWalletId}
                        initialRows={parallelPrefill || undefined}
                        onBack={() => {
                            setParallelPrefill(null);
                            setUnlockedView('actions');
                        }}
                    />
                );
            }
            if (unlockedView === 'cross-chain-swap' && activeWalletId) {
                return (
                    <CrossChainSwapForm
                        walletId={activeWalletId}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'cross-chain-templates' && activeWalletId) {
                return (
                    <CrossChainTemplates
                        walletId={activeWalletId}
                        onLaunch={(prefill) => {
                            setParallelPrefill(prefill);
                            setUnlockedView('parallel-compose');
                        }}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'multisig-sign' && activeWalletId) {
                return (
                    <MultisigSigningSession
                        walletId={activeWalletId}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'addresses' && activeWalletId) {
                return (
                    <AddressList
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        networkFilter={globalNetworkFilter}
                        tokenQuery={globalTokenQuery}
                        onBack={() => setUnlockedView('home')}
                        onReceive={() => { setReceivePrefill(null); setUnlockedView('receive'); }}
                        onShowPrivateKey={(addr) => {
                            setPrivateKeyAddress(addr);
                            setUnlockedView('view-private-key');
                        }}
                    />
                );
            }
            if (unlockedView === 'view-private-key' && activeWalletId && privateKeyAddress) {
                return (
                    <ViewPrivateKey
                        walletId={activeWalletId}
                        address={privateKeyAddress}
                        renderQR={({ value }) => <KeyQR value={value} alt="Private key QR" />}
                        onBack={() => {
                            setPrivateKeyAddress(null);
                            setUnlockedView('addresses');
                        }}
                    />
                );
            }
            if (unlockedView === 'multisig-create' && activeWalletId) {
                return (
                    <MultisigCreate
                        walletId={activeWalletId}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'messaging' && activeWalletId) {
                return (
                    <MessagingInbox
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        onCompose={(prefill) => {
                            setComposePrefill(prefill || null);
                            setUnlockedView('compose-message');
                        }}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'compose-message' && activeWalletId) {
                return (
                    <ComposeMessage
                        walletId={activeWalletId}
                        chainId={composePrefill?.chainId}
                        fromAddressId={composePrefill?.fromAddressId}
                        toAddress={composePrefill?.toAddress}
                        onBack={() => {
                            const from = composePrefill?.__from || 'messaging';
                            setComposePrefill(null);
                            setUnlockedView(from);
                        }}
                    />
                );
            }
            if (unlockedView === 'contacts' && activeWalletId) {
                return (
                    <ContactsList
                        walletId={activeWalletId}
                        onSendMessage={(prefill) => {
                            setComposePrefill({ ...prefill, __from: 'contacts' });
                            setUnlockedView('compose-message');
                        }}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'contracts-list' && activeWalletId) {
                return (
                    <ContractsList
                        walletId={activeWalletId}
                        onOpenContract={(cid, actionIndex) => {
                            setContractRef({ chainId: cid, contractActionIndex: String(actionIndex) });
                            setUnlockedView('contract-detail');
                        }}
                        onDeploy={() => setUnlockedView('contract-deploy')}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'contract-detail' && activeWalletId && contractRef) {
                return (
                    <ContractDetail
                        walletId={activeWalletId}
                        chainId={contractRef.chainId}
                        contractActionIndex={contractRef.contractActionIndex}
                        onExecute={() => setUnlockedView('contract-execute')}
                        onDeposit={() => setUnlockedView('contract-deposit')}
                        onWithdraw={() => setUnlockedView('contract-withdraw')}
                        onStakeToContract={() => setUnlockedView('contract-stake')}
                        onBack={() => setUnlockedView('contracts-list')}
                    />
                );
            }
            if (unlockedView === 'contract-stake' && activeWalletId && contractRef) {
                return (
                    <ContractStakeForm
                        walletId={activeWalletId}
                        chainId={contractRef.chainId}
                        contractActionIndex={contractRef.contractActionIndex}
                        onBack={() => setUnlockedView('contract-detail')}
                    />
                );
            }
            if (unlockedView === 'contract-staked-positions' && activeWalletId && contractRef) {
                return (
                    <ContractStakedPositions
                        walletId={activeWalletId}
                        chainId={contractRef.chainId}
                        onStakeToContract={(ref) => {
                            setContractRef(ref);
                            setUnlockedView('contract-stake');
                        }}
                        onBack={() => setUnlockedView('contract-detail')}
                    />
                );
            }
            if (unlockedView === 'contract-deploy' && activeWalletId) {
                return (
                    <DeployContractForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('contracts-list')}
                    />
                );
            }
            if (unlockedView === 'contract-execute' && activeWalletId && contractRef) {
                return (
                    <ExecuteContractForm
                        walletId={activeWalletId}
                        chainId={contractRef.chainId}
                        contractActionIndex={contractRef.contractActionIndex}
                        onBack={() => setUnlockedView('contract-detail')}
                    />
                );
            }
            if (unlockedView === 'contract-deposit' && activeWalletId && contractRef) {
                return (
                    <ContractFundsForm
                        mode="deposit"
                        walletId={activeWalletId}
                        chainId={contractRef.chainId}
                        contractActionIndex={contractRef.contractActionIndex}
                        onBack={() => setUnlockedView('contract-detail')}
                    />
                );
            }
            if (unlockedView === 'contract-withdraw' && activeWalletId && contractRef) {
                return (
                    <ContractFundsForm
                        mode="withdraw"
                        walletId={activeWalletId}
                        chainId={contractRef.chainId}
                        contractActionIndex={contractRef.contractActionIndex}
                        onBack={() => setUnlockedView('contract-detail')}
                    />
                );
            }
            if (unlockedView === 'staking-dashboard' && activeWalletId) {
                return (
                    <StakingDashboard
                        walletId={activeWalletId}
                        onStake={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('stake-form');
                        }}
                        onUnstake={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('staking-unstake');
                        }}
                        onClaimRewards={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('staking-claim');
                        }}
                        onDelegate={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('staking-delegate');
                        }}
                        onRevokeDelegation={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('staking-revoke');
                        }}
                        onOpenOperatorDashboard={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('operator-dashboard');
                        }}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'stake-form' && activeWalletId && stakingRef) {
                return (
                    <StakeForm
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'staking-unstake' && activeWalletId && stakingRef) {
                return (
                    <StakingActionForm
                        mode="unstake"
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'staking-claim' && activeWalletId && stakingRef) {
                return (
                    <StakingActionForm
                        mode="claim-rewards"
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'staking-delegate' && activeWalletId && stakingRef) {
                return (
                    <DelegationActionForm
                        mode="delegate"
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'staking-revoke' && activeWalletId && stakingRef) {
                return (
                    <DelegationActionForm
                        mode="revoke"
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'operator-dashboard' && activeWalletId && stakingRef) {
                return (
                    <OperatorDashboard
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        address={stakingRef.address}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'history' && activeWalletId) {
                return (
                    <History
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        onBack={() => setUnlockedView(historyReturnTo)}
                        onReceive={() => { setReceivePrefill(null); setUnlockedView('receive'); }}
                        initialSearchQuery={historyInitialQuery}
                        initialChainCoin={historyInitialChainCoin}
                        onSelectEntry={(entry) => {
                            setSelectedHistoryEntry(entry);
                            setActionDetailReturnTo('history');
                            setUnlockedView('action-detail');
                        }}
                    />
                );
            }
            if (unlockedView === 'action-detail' && activeWalletId && selectedHistoryEntry) {
                return (
                    <ActionDetail
                        entry={selectedHistoryEntry}
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView(actionDetailReturnTo)}
                    />
                );
            }
            if (unlockedView === 'token-detail' && activeWalletId && tokenDetailRef) {
                return (
                    <TokenDetail
                        walletId={activeWalletId}
                        chainId={tokenDetailRef.chainId}
                        tick={tokenDetailRef.tick}
                        kind={tokenDetailRef.kind}
                        displayName={tokenDetailRef.displayName}
                        divisibility={tokenDetailRef.divisibility}
                        fiatRate={tokenDetailRef.fiatRate}
                        quantity={tokenDetailRef.quantity}
                        imageUrl={tokenDetailRef.imageUrl}
                        onBack={() => setUnlockedView('home')}
                        onSend={() => {
                            setSendPrefill({
                                chainId: tokenDetailRef.chainId,
                                tick: tokenDetailRef.tick,
                                kind: tokenDetailRef.kind,
                                displayName: tokenDetailRef.displayName,
                                imageUrl: tokenDetailRef.imageUrl,
                            });
                            setSendBackTo('token-detail');
                            setUnlockedView('send');
                        }}
                        onReceive={() => {
                            setReceivePrefill({
                                chainId: tokenDetailRef.chainId,
                                tick: tokenDetailRef.tick,
                                kind: tokenDetailRef.kind,
                                displayName: tokenDetailRef.displayName,
                                imageUrl: tokenDetailRef.imageUrl,
                            });
                            setUnlockedView('receive');
                        }}
                        onViewActivity={() => {
                            const coin = String(tokenDetailRef.chainId || '').split('-')[0] || '';
                            setHistoryInitialQuery('');
                            setHistoryInitialChainCoin(coin);
                            setHistoryReturnTo('token-detail');
                            setUnlockedView('history');
                        }}
                        onBuy={() => {
                            setMarketsAsset({
                                chainId: tokenDetailRef.chainId,
                                tick: tokenDetailRef.tick,
                                kind: tokenDetailRef.kind,
                                displayName: tokenDetailRef.displayName,
                            });
                            setUnlockedView('markets');
                        }}
                    />
                );
            }
            if (unlockedView === 'market-activity') {
                return (
                    <MarketActivity
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                        onOpenDispenser={(chainId, actionIndex) => {
                            setDispenserRef({ chainId, actionIndex, origin: 'explorer' });
                            setUnlockedView('dispenser-detail');
                        }}
                    />
                );
            }
            if (unlockedView === 'my-tokens' && activeWalletId) {
                return (
                    <MyTokens
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        onBack={() => setUnlockedView('home')}
                        onIssue={() => setUnlockedView('issue')}
                        onSelectTick={(tick, chainId, row) => {
                            setTokenDetailRef({
                                chainId,
                                tick,
                                kind: 'token',
                                divisibility: row?.divisibility ?? null,
                            });
                            setUnlockedView('manage-token');
                        }}
                    />
                );
            }
            if (unlockedView === 'manage-token' && activeWalletId && tokenDetailRef) {
                const openForm = (view) => { setFormReturnView('manage-token'); setUnlockedView(view); };
                return (
                    <ManageToken
                        walletId={activeWalletId}
                        chainId={tokenDetailRef.chainId}
                        tick={tokenDetailRef.tick}
                        divisibility={tokenDetailRef.divisibility ?? null}
                        onBack={() => setUnlockedView('my-tokens')}
                        onMint={() => openForm('mint')}
                        onDestroy={() => openForm('destroy')}
                        onLock={() => openForm('lock')}
                        onUpdateDescription={() => openForm('description')}
                        onAttachContent={() => openForm('attach-content')}
                        onManageRoster={() => openForm('project-roster')}
                        onTransferOwnership={() => openForm('transfer')}
                        onSellOwnership={() => {
                            setSellNameRef({ chainId: tokenDetailRef.chainId, tick: tokenDetailRef.tick, fromAddress: tokenDetailRef.issuer || undefined });
                            openForm('sell-name');
                        }}
                        onCreateDispenser={() => openForm('dispenser')}
                        onPayDividend={() => openForm('dividend')}
                        onAirdrop={() => openForm('airdrop')}
                        onBroadcast={() => openForm('broadcast')}
                        onBindController={() => openForm('controller-bind')}
                        onOpenDispenser={(chainId, actionIndex) => {
                            setDispenserRef({ chainId, actionIndex, origin: 'manage-token' });
                            setUnlockedView('dispenser-detail');
                        }}
                        onIssuerResolved={(creator) => {
                            setTokenDetailRef((prev) => (prev ? { ...prev, issuer: creator || null } : prev));
                        }}
                        onViewActivity={() => {
                            const coin = String(tokenDetailRef.chainId || '').split('-')[0] || '';
                            setHistoryInitialQuery('');
                            setHistoryInitialTickFilter(tokenDetailRef.tick);
                            setHistoryInitialNetworkFilter(coin || 'all');
                            setHistoryInitialFocus({ kind: 'tick', value: tokenDetailRef.tick });
                            setUnlockedView('history');
                        }}
                    />
                );
            }
            if (unlockedView === 'actions' && activeWalletId) {
                return (
                    <ActionsMenu
                        entries={buildActionEntries({
                            onIssue: () => setUnlockedView('issue'),
                            onMint: () => setUnlockedView('mint'),
                            onDestroy: () => setUnlockedView('destroy'),
                            onLock: () => setUnlockedView('lock'),
                            onUpdateDescription: () => setUnlockedView('description'),
                            onTransferOwnership: () => setUnlockedView('transfer'),
                            onBroadcast: () => setUnlockedView('broadcast'),
                            onCreateDispenser: () => setUnlockedView('dispenser'),
                            onMyDispensers: () => setUnlockedView('dispensers-list'),
                            onBrowseDispensers: () => setUnlockedView('dispenser-explorer'),
                            onPayDividend: () => setUnlockedView('dividend'),
                            onAirdrop: () => {
                                setResumeAirdropId(null);
                                setUnlockedView('airdrop');
                            },
                            onAdvanced: () => setUnlockedView('advanced'),
                            onPairSigner: () => setUnlockedView('pair-signer'),
                            onPayCoinpay: () => {
                                setResumeCoinpay(null);
                                setUnlockedView('coinpay');
                            },
                            onSwap: () => setUnlockedView('swap'),
                            onLink: () => setUnlockedView('link-form'),
                            onParallel: () => setUnlockedView('parallel-compose'),
                            onCrossChainSwap: () => setUnlockedView('cross-chain-swap'),
                            onCrossChainTemplates: () => setUnlockedView('cross-chain-templates'),
                            onMultisigCreate: hasBtcAddress ? () => setUnlockedView('multisig-create') : undefined,
                            onMultisigSign: hasBtcAddress ? () => setUnlockedView('multisig-sign') : undefined,
                            onContacts: () => setUnlockedView('contacts'),
                            onSignMessage: () => setUnlockedView('sign-message'),
                            onVerifySignature: () => setUnlockedView('verify-signature'),
                            onSignPsbt: () => setUnlockedView('sign-psbt'),
                        })}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'wallet-picker') {
                return (
                    <WalletPicker
                        activeWalletId={activeWalletId}
                        onSwitch={setActiveWalletId}
                        onAddWallet={() => {
                            setOnboardingStep('welcome');
                            setUnlockedView('add-wallet');
                        }}
                        onShowDetails={(id) => {
                            setWalletDetailsId(id);
                            setUnlockedView('wallet-details');
                        }}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'settings' || unlockedView === 'connected-sites') {
                // §24 Cluster Y FOLLOWUP 2: Settings is reachable as a
                // top-level route from LeftNav / BottomTabBar. The
                // 'connected-sites' alias deep-links straight into the
                // Connected Sites drilldown (§35.9 / G108) so the spec's
                // implied "Connected" left-nav row has somewhere to land.
                const activeWallet = walletList.find((w) => w.id === activeWalletId) || null;
                return (
                    <Settings
                        onBack={() => setUnlockedView('home')}
                        activeWallet={activeWallet}
                        activeAccount={null}
                        onOpenWalletPicker={() => setUnlockedView('wallet-picker')}
                        onOpenAccountPicker={
                            activeWalletId ? () => setUnlockedView('account-picker') : undefined
                        }
                        initialSubpageId={
                            unlockedView === 'connected-sites' ? 'connected-sites' : null
                        }
                    />
                );
            }
            if (unlockedView === 'wallet-details' && walletDetailsId) {
                return (
                    <WalletDetails
                        walletId={walletDetailsId}
                        onBack={() => {
                            setWalletDetailsId(null);
                            setUnlockedView('wallet-picker');
                        }}
                        onRename={() => {
                            setWalletRenameTarget({ id: walletDetailsId, name: '' });
                            setUnlockedView('wallet-rename');
                        }}
                        onMigrateToBip39={() => {
                            setMigrateLegacyWalletId(walletDetailsId);
                            setUnlockedView('migrate-bip39');
                        }}
                    />
                );
            }
            if (unlockedView === 'wallet-rename' && walletRenameTarget) {
                return (
                    <RenameWalletForm
                        walletId={walletRenameTarget.id}
                        initialName={walletRenameTarget.name}
                        onBack={() => {
                            setWalletRenameTarget(null);
                            setUnlockedView('wallet-picker');
                        }}
                        onRenamed={() => {
                            setWalletRenameTarget(null);
                            setUnlockedView('wallet-picker');
                        }}
                    />
                );
            }
            if (unlockedView === 'account-picker' && activeWalletId) {
                return (
                    <AccountPicker
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId}
                        onSwitch={handleSwitchAccount}
                        onAddAccount={() => setUnlockedView('add-account')}
                        onRenameAccount={(id) => {
                            setAccountRenameTarget({ id, name: '' });
                            setUnlockedView('account-rename');
                        }}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'account-rename' && accountRenameTarget) {
                return (
                    <RenameAccountForm
                        accountId={accountRenameTarget.id}
                        initialName={accountRenameTarget.name}
                        onBack={() => {
                            setAccountRenameTarget(null);
                            setUnlockedView('account-picker');
                        }}
                        onRenamed={() => {
                            setAccountRenameTarget(null);
                            setUnlockedView('account-picker');
                        }}
                    />
                );
            }
            if (unlockedView === 'add-account' && activeWalletId) {
                return (
                    <AddAccountForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                        onCreated={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'add-wallet') {
                if (onboardingStep === 'create') {
                    return (
                        <CreateWallet
                            mode="add"
                            onBack={() => setOnboardingStep('welcome')}
                            onCreated={refresh}
                        />
                    );
                }
                if (onboardingStep === 'import') {
                    return (
                        <ImportWallet
                            mode="add"
                            onBack={() => setOnboardingStep('welcome')}
                            onImported={refresh}
                        />
                    );
                }
                if (onboardingStep === 'import-freewallet') {
                    return (
                        <ImportWallet
                            mode="add"
                            variant="freewallet"
                            onBack={() => setOnboardingStep('welcome')}
                            onImported={refresh}
                        />
                    );
                }
                return (
                    <Onboarding
                        onCreate={() => setOnboardingStep('create')}
                        onImport={() => setOnboardingStep('import')}
                        onImportFromFreeWallet={() => setOnboardingStep('import-freewallet')}
                        onBack={() => {
                            setOnboardingStep('welcome');
                            setUnlockedView('wallet-picker');
                        }}
                    />
                );
            }
            // §49 / Cluster G FOLLOWUP 4: QueuedBroadcastBanner is now
            // mounted in FullLayoutWithNav.header below so it persists
            // across every unlocked view, not only Home.
            return (
                <>
                    <Home
                        networkFilter={globalNetworkFilter}
                        onNetworkFilterChange={setGlobalNetworkFilter}
                        tokenQuery={globalTokenQuery}
                        onTokenQueryChange={setGlobalTokenQuery}
                        onLocked={refresh}
                        onSend={activeWalletId ? () => {
                            setSendPrefill(null);
                            setUnlockedView('send');
                        } : undefined}
                        onReceive={activeWalletId ? () => { setReceivePrefill(null); setUnlockedView('receive'); } : undefined}
                        onSwap={activeWalletId ? () => setUnlockedView('swap') : undefined}
                        onExchange={activeWalletId ? () => {
                            setMarketsAsset({ chainId: 'bitcoin-mainnet', tick: 'BTC', kind: 'native' });
                            setUnlockedView('markets');
                        } : undefined}
                        onCreateToken={activeWalletId ? () => setUnlockedView('wizard') : undefined}
                        onActions={activeWalletId ? () => setUnlockedView('actions') : undefined}
                        onMyTokens={activeWalletId ? () => setUnlockedView('my-tokens') : undefined}
                        onMarketActivity={() => setUnlockedView('market-activity')}
                        onMarkets={activeWalletId ? () => setUnlockedView('markets') : undefined}
                        onDispensers={activeWalletId ? () => setUnlockedView('dispensers-list') : undefined}
                        onMessaging={activeWalletId ? () => setUnlockedView('messaging') : undefined}
                        onContracts={activeWalletId && hasBtcAddress ? () => setUnlockedView('contracts-list') : undefined}
                        onStaking={activeWalletId && hasBtcAddress ? () => setUnlockedView('staking-dashboard') : undefined}
                        onHistory={activeWalletId ? () => {
                            setHistoryInitialQuery('');
                            setHistoryInitialChainCoin('');
                            setHistoryReturnTo('home');
                            setUnlockedView('history');
                        } : undefined}
                        onAddresses={activeWalletId ? () => setUnlockedView('addresses') : undefined}
                        onResumeAirdrop={activeWalletId ? (id) => {
                            setResumeAirdropId(id);
                            setUnlockedView('airdrop');
                        } : undefined}
                        onResumeCoinpay={activeWalletId ? (ref) => {
                            setResumeCoinpay(ref);
                            setUnlockedView('coinpay');
                        } : undefined}
                        onMigrateToBip39={activeWalletId ? () => setUnlockedView('migrate-bip39') : undefined}
                        onCrossChain={activeWalletId ? () => setUnlockedView('cross-chain-templates') : undefined}
                        onContacts={activeWalletId ? () => setUnlockedView('contacts') : undefined}
                        onMultisig={activeWalletId && hasBtcAddress ? () => setUnlockedView('multisig-create') : undefined}
                        onSelectToken={activeWalletId ? (tok) => {
                            setTokenDetailRef(tok);
                            setUnlockedView('token-detail');
                        } : undefined}
                        onSelectEntry={activeWalletId ? (entry) => {
                            setSelectedHistoryEntry(entry);
                            setActionDetailReturnTo('home');
                            setUnlockedView('action-detail');
                        } : undefined}
                        onOpenWalletPicker={() => setUnlockedView('wallet-picker')}
                        onOpenAccountPicker={activeWalletId ? () => setUnlockedView('account-picker') : undefined}
                        onSignPsbt={activeWalletId ? () => setUnlockedView('sign-psbt') : undefined}
                        onSignMessage={activeWalletId ? () => setUnlockedView('sign-message') : undefined}
                        onVerifySignature={activeWalletId ? () => setUnlockedView('verify-signature') : undefined}
                        activeAccountId={activeAccountId}
                        onSwitchAccount={handleSwitchAccount}
                        extraActions={activeWalletId ? buildActionEntries({
                            onIssue: () => setUnlockedView('issue'),
                            onMint: () => setUnlockedView('mint'),
                            onDestroy: () => setUnlockedView('destroy'),
                            onLock: () => setUnlockedView('lock'),
                            onUpdateDescription: () => setUnlockedView('description'),
                            onTransferOwnership: () => setUnlockedView('transfer'),
                            onBroadcast: () => setUnlockedView('broadcast'),
                            onCreateDispenser: () => setUnlockedView('dispenser'),
                            onMyDispensers: () => setUnlockedView('dispensers-list'),
                            onBrowseDispensers: () => setUnlockedView('dispenser-explorer'),
                            onPayDividend: () => setUnlockedView('dividend'),
                            onAirdrop: () => {
                                setResumeAirdropId(null);
                                setUnlockedView('airdrop');
                            },
                            onAdvanced: () => setUnlockedView('advanced'),
                            onPairSigner: () => setUnlockedView('pair-signer'),
                            onPayCoinpay: () => {
                                setResumeCoinpay(null);
                                setUnlockedView('coinpay');
                            },
                            onSwap: () => setUnlockedView('swap'),
                            onLink: () => setUnlockedView('link-form'),
                            onParallel: () => setUnlockedView('parallel-compose'),
                            onCrossChainSwap: () => setUnlockedView('cross-chain-swap'),
                            onCrossChainTemplates: () => setUnlockedView('cross-chain-templates'),
                            onMultisigCreate: hasBtcAddress ? () => setUnlockedView('multisig-create') : undefined,
                            onMultisigSign: hasBtcAddress ? () => setUnlockedView('multisig-sign') : undefined,
                            onContacts: () => setUnlockedView('contacts'),
                            onSignMessage: () => setUnlockedView('sign-message'),
                            onVerifySignature: () => setUnlockedView('verify-signature'),
                            onSignPsbt: () => setUnlockedView('sign-psbt'),
                        }) : undefined}
                    />
                </>
            );
            })();
            const handleNavLock = () => {
                lockWallet()
                    .then(refresh)
                    .catch(() => refresh());
            };
            const handleOpenWalletPicker = () => setUnlockedView('wallet-picker');
            const handleOpenSettings = () => setUnlockedView('settings');
            const activeWalletName =
                walletList.find((w) => w.id === activeWalletId)?.name || undefined;
            return (
                <FullLayoutWithNav
                    nav={
                        isFull ? (
                            <LeftNav
                                currentView={unlockedView}
                                onSelect={(view) => setUnlockedView(view)}
                                onLock={handleNavLock}
                                onOpenWalletPicker={handleOpenWalletPicker}
                                onOpenSettings={handleOpenSettings}
                                walletName={activeWalletName}
                                hasBtcAddress={hasBtcAddress}
                            />
                        ) : null
                    }
                    bottomBar={
                        variant === 'small' ? (
                            <BottomTabBar
                                currentView={unlockedView}
                                onSelect={(view) => setUnlockedView(view)}
                                onLock={handleNavLock}
                                onOpenWalletPicker={handleOpenWalletPicker}
                                onOpenSettings={handleOpenSettings}
                                hasBtcAddress={hasBtcAddress}
                            />
                        ) : null
                    }
                    header={
                        activeWalletId ? (
                            <>
                                {/* Persistent global header: brand + menu /
                                    lock affordances. Mounted here so every
                                    route (Home, TokenDetail, Send, History,
                                    Settings, etc.) keeps the wallet's top-
                                    level controls visible without each route
                                    re-rendering its own copy. */}
                                <AppHeader
                                    onMenuOpen={() => {
                                        if (unlockedView === 'menu') {
                                            setUnlockedView(menuBackTo);
                                        } else {
                                            setMenuBackTo(unlockedView);
                                            setUnlockedView('menu');
                                        }
                                    }}
                                    onScan={() => setGlobalScannerOpen(true)}
                                    onManageAddresses={activeWalletId ? () => setUnlockedView('addresses') : undefined}
                                    onViewAddress={activeWalletId ? () => { setReceivePrefill(null); setUnlockedView('receive'); } : undefined}
                                    onLock={handleNavLock}
                                />
                                {/* Cluster J FOLLOWUP 2: DemoBanner persists across every
                                    unlocked view via the shared layout header slot, not
                                    just Home. */}
                                <DemoBanner activeWalletId={activeWalletId} onExited={refresh} />
                                <QueuedBroadcastBanner walletId={activeWalletId} />
                                {isDemoWallet(activeWalletId) ? null : <ReachabilityBanner />}
                            </>
                        ) : null
                    }
                >
                    {routeNode}
                    {globalScannerOpen ? (
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-label="Scan a QR code"
                            style={{
                                position: 'absolute',
                                inset: 0,
                                zIndex: 50,
                                background: 'var(--xc-bg)',
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            <ScanRoute
                                onBack={() => setGlobalScannerOpen(false)}
                                onClassified={(outcome) => {
                                    setGlobalScannerOpen(false);
                                    if (outcome.kind === 'send') {
                                        setSendPrefill({
                                            address: outcome.address,
                                            amount: outcome.amount,
                                            tick: outcome.tick,
                                            chainId: outcome.chainId,
                                            memo: outcome.memo,
                                        });
                                        setUnlockedView('send');
                                    } else if (outcome.kind === 'receive') {
                                        setUnlockedView('receive');
                                    } else if (outcome.kind === 'psbt') {
                                        setUnlockedView('sign-psbt');
                                    }
                                }}
                            />
                        </div>
                    ) : null}
                </FullLayoutWithNav>
            );
        }
        default:
            return <Loading error={`unknown state "${status.state}"`} />;
    }
}

/**
 * Build the Actions menu entries shared across both shells. Each entry
 * maps a §40.2+ authoring surface to the host's sub-route. New entries
 * land here as the standalone forms ship (MINT, DESTROY, admin, …).
 */
function buildActionEntries({
    onIssue, onMint, onDestroy,
    onLock, onUpdateDescription, onTransferOwnership,
    onBroadcast,
    onCreateDispenser,
    onMyDispensers,
    onBrowseDispensers,
    onPayDividend,
    onAirdrop,
    onAdvanced,
    onPairSigner,
    onPayCoinpay,
    onSwap,
    onLink,
    onParallel,
    onCrossChainSwap,
    onCrossChainTemplates,
    onMultisigCreate,
    onMultisigSign,
    onContacts,
    onSignMessage,
    onVerifySignature,
    onSignPsbt,
}) {
    return [
        {
            id: 'issue',
            label: 'Issue token',
            description: 'Create a new token with full control over all settings.',
            onSelect: onIssue,
        },
        {
            id: 'mint',
            label: 'Mint',
            description: 'Mint additional supply of a token you own.',
            onSelect: onMint,
        },
        {
            id: 'destroy',
            label: 'Destroy',
            description: 'Burn part of your balance. This is irreversible.',
            onSelect: onDestroy,
        },
        {
            id: 'lock',
            label: 'Lock supply',
            description: 'Freeze supply + minting for a token you own. This is permanent.',
            onSelect: onLock,
        },
        {
            id: 'description',
            label: 'Update description',
            description: 'Change a token\'s on-chain description.',
            onSelect: onUpdateDescription,
        },
        {
            id: 'transfer',
            label: 'Transfer ownership',
            description: 'Hand token ownership to another address.',
            onSelect: onTransferOwnership,
        },
        {
            id: 'broadcast',
            label: 'Post a message',
            description: 'Publish a public message or data value on-chain.',
            onSelect: onBroadcast,
        },
        {
            id: 'dispenser',
            label: 'Create dispenser',
            description: 'Open a vending machine that sells your token for coin or FIAT.',
            onSelect: onCreateDispenser,
        },
        {
            id: 'dispensers-list',
            label: 'My dispensers',
            description: 'Manage dispensers you have opened: view and cancel.',
            onSelect: onMyDispensers,
        },
        {
            id: 'dispenser-explorer',
            label: 'Browse dispensers',
            description: 'Search for open dispensers by token or address.',
            onSelect: onBrowseDispensers,
        },
        {
            id: 'dividend',
            label: 'Pay dividend',
            description: 'Pay a dividend to all holders of a token, split proportionally by how much they hold.',
            onSelect: onPayDividend,
        },
        {
            id: 'airdrop',
            label: 'Airdrop tokens',
            description: 'Distribute a token to a pasted or uploaded list of addresses.',
            onSelect: onAirdrop,
        },
        {
            id: 'coinpay',
            label: 'Complete a trade',
            description: 'Finish a trade by paying the coin amount you owe.',
            onSelect: onPayCoinpay,
        },
        {
            id: 'swap',
            label: 'Swap tokens',
            description: 'Trade one token directly for another, with no coin needed and nothing to pay later.',
            onSelect: onSwap,
        },
        {
            id: 'link',
            label: 'Link cross-chain actions',
            description: 'Anchor two existing actions across chains. Both sides thread together in History.',
            onSelect: onLink,
        },
        {
            id: 'parallel',
            label: 'Parallel cross-chain actions',
            description: 'Compose multiple independent actions across any chains and sign them sequentially. Not atomic; failures do not roll back.',
            onSelect: onParallel,
        },
        {
            id: 'cross-chain-swap',
            label: 'Cross-chain swap',
            description: 'Open a swap that gives a token on one chain and gets a token on another. Settles atomically when a counterparty fills the offer.',
            onSelect: onCrossChainSwap,
        },
        {
            id: 'cross-chain-templates',
            label: 'Cross-chain templates',
            description: 'Pre-baked multi-chain flows: launch token + metadata, bridge token pair, cross-chain airdrop. Pre-fills the Parallel composer.',
            onSelect: onCrossChainTemplates,
        },
        {
            id: 'multisig-create',
            label: 'Create multisig',
            description: 'Set up a shared wallet that requires multiple people to approve each payment. Bitcoin only at launch.',
            onSelect: onMultisigCreate,
        },
        {
            id: 'multisig-sign',
            label: 'Multisig signing',
            description: 'Collect approvals for a shared-wallet payment. Add your signature to complete or advance the signing round.',
            onSelect: onMultisigSign,
        },
        {
            id: 'contacts',
            label: 'Contacts',
            description: 'Local address book: label counterparties, quick-compose to saved recipients.',
            onSelect: onContacts,
        },
        {
            id: 'sign-message',
            label: 'Sign message',
            description: 'Sign an arbitrary message with one of your addresses to prove ownership.',
            onSelect: onSignMessage,
        },
        {
            id: 'verify-signature',
            label: 'Verify signature',
            description: 'Verify a signature from any address, your own or someone else\'s.',
            onSelect: onVerifySignature,
        },
        {
            id: 'sign-psbt',
            label: 'Sign transaction',
            description: 'Paste an unsigned transaction (hex / base64) and sign it with one of your keys.',
            onSelect: onSignPsbt,
        },
        {
            id: 'advanced',
            label: 'Advanced action',
            description: 'Power-user form for submitting any supported on-chain action type.',
            onSelect: onAdvanced,
        },
        {
            id: 'pair-signer',
            label: 'Pair hardware signer',
            description: 'Add a Trezor or Ledger to this wallet.',
            onSelect: onPairSigner,
        },
    ];
}
