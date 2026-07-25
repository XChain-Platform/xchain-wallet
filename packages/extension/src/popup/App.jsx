// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Popup top-level state machine.
//
// Primary state (from the background):
//   loading      -> no-wallet | locked | unlocked | error
//   locked       -> unlocked
//   unlocked     -> locked
//   no-wallet    -> locked  (onboarding → create/import → unlock)
//
// Sub-routes:
//   no-wallet   : welcome | create | import
//   unlocked    : home | send | receive
//
// All routes render from @xchain-wallet/core/shared/routes/* via the
// MessagingProvider context (shell="popup"). Popup-local wiring boils
// down to session-state polling and sub-route navigation.

import { useCallback, useEffect, useRef, useState } from 'react';
import { uri as coreUri } from '@xchain-wallet/core';
import { registry as registryLib } from '@xchain-wallet/core';

// Resolves coin-code URIs (xchain:TBTC/...) to chainIds in the boot-time
// deep-link parse; same instance pattern as the web shell's App.jsx.
const APP_CHAIN_REGISTRY = registryLib.defaultRegistry();
import { useLastView } from '@xchain-wallet/core/shared/hooks/useLastView.js';
import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';
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
import { CommandPalette } from '@xchain-wallet/core/shared/commandPalette/CommandPalette.jsx';
import { useCommandPalette } from '@xchain-wallet/core/shared/commandPalette/useCommandPalette.js';
import { buildCommands, contactsToCommands, parseFreeformCommands, balancesToCommands, helpToCommands } from '@xchain-wallet/core/shared/commandPalette/commandRegistry.js';
import { buildBalanceRows } from '@xchain-wallet/core/shared/components/BalanceList.jsx';
import { useSettings } from '@xchain-wallet/core/shared/hooks/useSettings.js';
import { useKeyboardShortcuts } from '@xchain-wallet/core/shared/keyboard/useKeyboardShortcuts.js';
import { ShortcutHelp } from '@xchain-wallet/core/shared/keyboard/ShortcutHelp.jsx';
import { TokenDetail } from '@xchain-wallet/core/shared/routes/TokenDetail.jsx';
import { ToastHost } from '@xchain-wallet/core/shared/components/ToastHost.jsx';
import { ReachabilityBanner } from '@xchain-wallet/core/shared/components/ReachabilityBanner.jsx';
import { QueuedBroadcastBanner } from '@xchain-wallet/core/shared/components/QueuedBroadcastBanner.jsx';
import { Receive } from '@xchain-wallet/core/shared/routes/Receive.jsx';
import { Send } from '@xchain-wallet/core/shared/routes/Send.jsx';
import { SendPicker } from '@xchain-wallet/core/shared/routes/SendPicker.jsx';
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
import { CallbackForm } from '@xchain-wallet/core/shared/routes/CallbackForm.jsx';
import { SleepForm } from '@xchain-wallet/core/shared/routes/SleepForm.jsx';
import { BroadcastForm } from '@xchain-wallet/core/shared/routes/BroadcastForm.jsx';
import { DispenserForm } from '@xchain-wallet/core/shared/routes/DispenserForm.jsx';
import { DispensersList } from '@xchain-wallet/core/shared/routes/DispensersList.jsx';
import { DispenserDetail } from '@xchain-wallet/core/shared/routes/DispenserDetail.jsx';
import { DispenserExplorer } from '@xchain-wallet/core/shared/routes/DispenserExplorer.jsx';
import { DividendForm } from '@xchain-wallet/core/shared/routes/DividendForm.jsx';
import { AirdropForm } from '@xchain-wallet/core/shared/routes/AirdropForm.jsx';
import { AdvancedActionsForm } from '@xchain-wallet/core/shared/routes/AdvancedActionsForm.jsx';
import { MigrateToBip39 } from '@xchain-wallet/core/shared/routes/MigrateToBip39.jsx';
import { SweepForm } from '@xchain-wallet/core/shared/routes/SweepForm.jsx';
import { MarketsList } from '@xchain-wallet/core/shared/routes/MarketsList.jsx';
import { MarketView } from '@xchain-wallet/core/shared/routes/MarketView.jsx';
import { CreateOrderForm } from '@xchain-wallet/core/shared/routes/CreateOrderForm.jsx';
import { MyOrdersView } from '@xchain-wallet/core/shared/routes/MyOrdersView.jsx';
import { CoinpayForm } from '@xchain-wallet/core/shared/routes/CoinpayForm.jsx';
import { SwapForm } from '@xchain-wallet/core/shared/routes/SwapForm.jsx';
import { SellOwnershipForm } from '@xchain-wallet/core/shared/routes/SellOwnershipForm.jsx';
import { MessagingInbox } from '@xchain-wallet/core/shared/routes/MessagingInbox.jsx';
import { NoticeModal } from '@xchain-wallet/core/shared/components/NoticeModal.jsx';
import { ComposeMessage } from '@xchain-wallet/core/shared/routes/ComposeMessage.jsx';
import { ContactsList } from '@xchain-wallet/core/shared/routes/ContactsList.jsx';
import { ContractsList } from '@xchain-wallet/core/shared/routes/ContractsList.jsx';
import { ContractDetail } from '@xchain-wallet/core/shared/routes/ContractDetail.jsx';
import { DeployContractForm } from '@xchain-wallet/core/shared/routes/DeployContractForm.jsx';
import { ExecuteContractForm } from '@xchain-wallet/core/shared/routes/ExecuteContractForm.jsx';
import { ContractFundsForm } from '@xchain-wallet/core/shared/routes/ContractFundsForm.jsx';
import { ControllerBindForm } from '@xchain-wallet/core/shared/routes/ControllerBindForm.jsx';
import { ContractStakeForm } from '@xchain-wallet/core/shared/routes/ContractStakeForm.jsx';
import { StakingList } from '@xchain-wallet/core/shared/routes/StakingList.jsx';
import { StakeDetail } from '@xchain-wallet/core/shared/routes/StakeDetail.jsx';
import { StakeNew } from '@xchain-wallet/core/shared/routes/StakeNew.jsx';
import { StakeForm } from '@xchain-wallet/core/shared/routes/StakeForm.jsx';
import { StakingActionForm } from '@xchain-wallet/core/shared/routes/StakingActionForm.jsx';
import { DelegationActionForm } from '@xchain-wallet/core/shared/routes/DelegationActionForm.jsx';
import { GovernancePolls } from '@xchain-wallet/core/shared/routes/GovernancePolls.jsx';
import { CreatePollForm } from '@xchain-wallet/core/shared/routes/CreatePollForm.jsx';
import { PollDetail } from '@xchain-wallet/core/shared/routes/PollDetail.jsx';
import { DelegateVoteForm } from '@xchain-wallet/core/shared/routes/DelegateVoteForm.jsx';
import { OperatorDashboard } from '@xchain-wallet/core/shared/routes/OperatorDashboard.jsx';
import { History } from '@xchain-wallet/core/shared/routes/History.jsx';
import { ActionDetail } from '@xchain-wallet/core/shared/routes/ActionDetail.jsx';
import { LinkForm } from '@xchain-wallet/core/shared/routes/LinkForm.jsx';
import { AttachContentForm } from '@xchain-wallet/core/shared/routes/AttachContentForm.jsx';
import { GatedPublishForm } from '@xchain-wallet/core/shared/routes/GatedPublishForm.jsx';
import { PublishFileForm } from '@xchain-wallet/core/shared/routes/PublishFileForm.jsx';
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
import { CoSignerAccountList } from '@xchain-wallet/core/shared/routes/CoSignerAccountList.jsx';
import { CoSignerProvision } from '@xchain-wallet/core/shared/routes/CoSignerProvision.jsx';
import { CoSignerAccountDetail } from '@xchain-wallet/core/shared/routes/CoSignerAccountDetail.jsx';
import { AddressList } from '@xchain-wallet/core/shared/routes/AddressList.jsx';
import { PairSignerForm } from '@xchain-wallet/core/shared/routes/PairSignerForm.jsx';
import { useBtcAddressesPresent } from '@xchain-wallet/core/shared/hooks/useBtcAddressesPresent.js';
import { useGovernanceAddressesPresent } from '@xchain-wallet/core/shared/hooks/useGovernanceAddressesPresent.js';
// Trezor is intentionally NOT offered in the extension shell: MV3 bans
// remotely-hosted code, so the only way to bundle Trezor Connect here
// would be the T-RSL-licensed `@trezor/connect-web` npm package, whose
// license forbids redistribution. The web + desktop shells load Trezor
// Connect from Trezor's hosted script instead; the extension ships
// Ledger (WebHID) + software signing only. PairSignerForm renders the
// Trezor option disabled when `pairTrezor` is null.
import { pairLedgerSigner } from '../signers/ledgerFactory.js';
import { registerSigner as registerLocalSigner } from './signerBridge.js';
import * as messaging from './messaging.js';
import { getSessionStatus, listWallets, listAccounts } from './messaging.js';

export function App() {
    return (
        <MessagingProvider shell="popup" messaging={messaging}>
            <ToastHost>
                <ReachabilityBanner />
                <AppInner />
            </ToastHost>
        </MessagingProvider>
    );
}

function AppInner() {
    const [status, setStatus] = useState(/** @type {any} */ ({ state: 'loading' }));
    const [onboardingStep, setOnboardingStep] = useState(
        /** @type {'welcome' | 'create' | 'import' | 'import-freewallet'} */ ('welcome'),
    );
    const [unlockedView, setUnlockedView] = useState(
        /** @type {'home' | 'send' | 'receive' | 'receive-picker' | 'wizard' | 'actions' | 'my-tokens' | 'manage-token' | 'market-activity' | 'issue' | 'mint' | 'destroy' | 'sweep' | 'lock' | 'mint-settings' | 'callback-settings' | 'execute-callback' | 'access-lists' | 'pause-token' | 'lock-address' | 'description' | 'transfer' | 'broadcast' | 'dispenser' | 'dispensers-list' | 'dispenser-detail' | 'dispenser-explorer' | 'dividend' | 'airdrop' | 'advanced' | 'migrate-bip39' | 'pair-signer' | 'markets' | 'market' | 'create-order' | 'my-orders' | 'coinpay' | 'swap' | 'sell-name' | 'messaging' | 'compose-message' | 'contacts' | 'contracts-list' | 'contract-detail' | 'contract-deploy' | 'contract-execute' | 'contract-deposit' | 'contract-withdraw' | 'controller-bind' | 'staking-dashboard' | 'stake-detail' | 'stake-new' | 'stake-form' | 'staking-unstake' | 'staking-claim' | 'staking-delegate' | 'staking-revoke' | 'operator-dashboard' | 'history' | 'action-detail' | 'token-detail' | 'link-form' | 'attach-content' | 'gated-publish' | 'publish-file' | 'project-roster' | 'parallel-compose' | 'cross-chain-swap' | 'cross-chain-templates' | 'multisig-create' | 'multisig-sign' | 'cosigner-accounts' | 'cosigner-provision' | 'cosigner-detail' | 'addresses' | 'add-wallet' | 'add-account' | 'wallet-picker' | 'account-picker' | 'wallet-details' | 'wallet-rename' | 'account-rename' | 'scan'} */ ('home'),
    );
    const [tokenDetailRef, setTokenDetailRef] = useState(
        /** @type {{ chainId: string, tick: string, kind: string, displayName: string, divisibility: number, fiatRate: number | null, quantity: string } | null} */ (null),
    );
    // Tracks which view to return to from a form. Default `null` keeps
    // the existing actions-menu return behaviour; ManageToken sets it
    // to 'manage-token' before opening a form so Back returns there.
    const [formReturnView, setFormReturnView] = useState(/** @type {string | null} */ (null));
    const formBack = () => {
        const target = formReturnView || 'actions';
        setFormReturnView(null);
        setUnlockedView(target);
    };
    // Prefill helpers: surface (chainId, tick) to forms when launched
    // from ManageToken so the LockedTokenContext chip renders instead
    // of the ticker / chain picker.
    const fromManage = formReturnView === 'manage-token';
    const prefillChainId = fromManage ? tokenDetailRef?.chainId : undefined;
    const prefillTick = fromManage ? tokenDetailRef?.tick : undefined;
    const prefillFromAddress = fromManage ? tokenDetailRef?.issuer : undefined;
    const [historyInitialQuery, setHistoryInitialQuery] = useState('');
    // Coin family to scope History's chain filter to on entry (e.g.
    // arriving from the Bitcoin TokenDetail). Empty = no scoping; the
    // remembered chain-filter applies instead.
    const [historyInitialChainCoin, setHistoryInitialChainCoin] = useState('');
    // Which view History's Back button returns to. Set explicitly at
    // each entry point so we don't carry stale state from a previous
    // visit (e.g. entering from TokenDetail then re-entering from the
    // home menu should return to home, not back to TokenDetail).
    const [historyReturnTo, setHistoryReturnTo] = useState(
        /** @type {'home' | 'token-detail'} */ ('home'),
    );
    // Selected entry for the standalone ActionDetail view. Set when the
    // user clicks a row in History or in Home's Activity tab; cleared
    // on back-navigation.
    const [selectedHistoryEntry, setSelectedHistoryEntry] = useState(
        /** @type {any | null} */ (null),
    );
    // Where ActionDetail's Back returns to.
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
    // PC-34: SweepForm context. Free-entry sweeps leave it null (form
    // defaults to the active wallet); the migrate lane prefills the
    // legacy wallet + locked destination.
    const [sweepCtx, setSweepCtx] = useState(
        /** @type {{ walletId: string, chainId: string, fromAddress: string, destination: string, migrateTo: { walletId: string, address: string, name?: string } } | null} */ (null),
    );
    const [resumeAirdropId, setResumeAirdropId] = useState(
        /** @type {string | null} */ (null),
    );
    // §17.7 / G027: staged address handed to <ViewPrivateKey> when the
    // user picks "Show key" from the addresses list.
    const [privateKeyAddress, setPrivateKeyAddress] = useState(
        /** @type {any | null} */ (null),
    );
    const [coSignerAccountId, setCoSignerAccountId] = useState(
        /** @type {string | null} */ (null),
    );
    const [resumeCoinpay, setResumeCoinpay] = useState(
        /** @type {{ chainId: string, address: string, orderMatchActionIndex: string } | null} */ (null),
    );
    const [composePrefill, setComposePrefill] = useState(
        /** @type {{ chainId?: string, fromAddressId?: string, toAddress?: string } | null} */ (null),
    );
    // Conversation to reopen when the messaging inbox next mounts (set when
    // backing out of a compose form launched from that thread's composer).
    const [messagingThread, setMessagingThread] = useState(
        /** @type {string | null} */ (null),
    );
    // View to return to when backing out of My Dispensers (recorded at
    // each navigation into the list; back otherwise loses the origin).
    const [dispensersBackTo, setDispensersBackTo] = useState('home');
    // Quick "Message sent" confirmation modal, shown over the view the user
    // is returned to after a compose-form send succeeds.
    const [messageSentNotice, setMessageSentNotice] = useState(false);
    // §47 / Cluster L FOLLOWUP 2: `web+xchain:` deep links arriving via
    // the manifest's `protocol_handlers` route to popup.html?uri=<uri>.
    // Parsed on mount, prefill goes into the Send route, then the param
    // is stripped via history.replaceState.
    const [sendPrefill, setSendPrefill] = useState(
        /** @type {{ address?: string, amount?: string, tick?: string, chainId?: string, memo?: string } | null} */ (null),
    );
    // Deep-link prefill for contract EXECUTE (explorer Write-tab links,
    // xchain:{COIN}/execute?...). Mirrors `sendPrefill`; consumed by the
    // 'contract-execute' route and cleared when the user backs out.
    const [executePrefill, setExecutePrefill] = useState(
        /** @type {{ method?: string, paramsText?: string, gasLimit?: string } | null} */ (null),
    );
    // Which view Send should return to when the user hits Back. Defaults
    // to 'home'; SendPicker → Send sets it to 'send-picker' so backing
    // out lands on the token list the user was just browsing.
    const [sendBackTo, setSendBackTo] = useState(
        /** @type {'home' | 'send-picker' | 'token-detail' | 'contacts'} */ ('home'),
    );
    // ReceivePicker → Receive prefill carrier; cleared when the user
    // backs out of Receive. Mirrors `sendPrefill` for the Send side.
    const [receivePrefill, setReceivePrefill] = useState(
        /** @type {{ chainId?: string, tick?: string, kind?: string, displayName?: string, imageUrl?: string | null } | null} */ (null),
    );
    const [activeWalletId, setActiveWalletId] = useState(
        /** @type {string | null} */ (null),
    );
    const [activeAccountId, setActiveAccountId] = useState(
        /** @type {string | null} */ (null),
    );
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
    // `origin` remembers which flow opened the contract-stake form so its
    // back button returns there ('contracts-browse' when reached via normal
    // contract browsing, 'stake-picker' from the new-stake chooser,
    // 'stake-detail' from a staking position's Add stake / Unstake).
    const [contractRef, setContractRef] = useState(
        /** @type {{ chainId: string, contractActionIndex: string, origin?: 'contracts-browse' | 'stake-picker' | 'stake-detail', initialMode?: 'stake' | 'unstake' | 'delegate' } | null} */ (null),
    );
    // True while the new-stake chooser's "Contract staking" arm is browsing
    // contracts, so the contract list's own back button returns to the
    // chooser instead of home.
    const [stakeContractPickerActive, setStakeContractPickerActive] = useState(false);
    const [parallelPrefill, setParallelPrefill] = useState(
        /** @type {Array<{ chainId: string, action: string, params: Record<string, string>, note?: string }> | null} */ (null),
    );
    const [governanceRef, setGovernanceRef] = useState(
        /** @type {{ chainId: string, pollIndex?: string | number } | null} */ (null),
    );
    const [stakingRef, setStakingRef] = useState(
        /** @type {{ kind: 'validator' | 'contract', chainId: string, address: string, contractActionIndex?: string } | null} */ (null),
    );
    const [activeMarket, setActiveMarket] = useState(
        /** @type {{ chainId: string, tick1: string, tick2: string } | null} */ (null),
    );
    const [marketsAsset, setMarketsAsset] = useState(
        /** @type {{ chainId: string, tick: string, displayName?: string, kind?: string } | null} */ ({
            chainId: 'bitcoin-mainnet',
            tick: 'BTC',
            kind: 'native',
        }),
    );

    // Deep-link view that must survive the unlock cycle. The `?uri=` boot
    // handler routes immediately, but `refresh()` (fired by Locked's
    // onUnlocked) resets the view to 'home', which stomped the route
    // whenever the popup opened locked. Re-applied once the session
    // reports unlocked, then cleared.
    const pendingUriView = useRef(
        /** @type {'send' | 'receive' | 'contract-execute' | null} */ (null),
    );

    const refresh = useCallback(() => {
        setStatus({ state: 'loading' });
        setOnboardingStep('welcome');
        setUnlockedView('home');
        getSessionStatus()
            .then((next) => {
                setStatus(next);
                if (next?.state === 'unlocked' && pendingUriView.current) {
                    setUnlockedView(pendingUriView.current);
                    pendingUriView.current = null;
                }
            })
            .catch((err) =>
                setStatus({ state: 'error', error: err?.message || String(err) }),
            );
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // §47 / Cluster L FOLLOWUP 2: consume `?uri=` from popup.html's
    // location.search when the popup boots. Manifest's
    // `protocol_handlers` block routes `web+xchain:` clicks here. Strip
    // the param via history.replaceState so a re-open or refresh doesn't
    // re-trigger the auto-route.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('uri');
        if (!raw) return;
        try {
            // Pass the registry so coin-code URIs (xchain:TBTC/...) resolve to
            // a chainId; without it intent.chainId is always undefined, which
            // Send tolerated but contract routes cannot.
            const intent = coreUri.parseXchainUri(raw, { chainRegistry: APP_CHAIN_REGISTRY });
            if (intent && intent.kind === 'send') {
                setSendPrefill({
                    address: intent.address,
                    amount: intent.amount,
                    tick: intent.tick,
                    chainId: intent.chainId,
                    memo: intent.memo,
                });
                setUnlockedView('send');
                pendingUriView.current = 'send';
            } else if (intent && intent.kind === 'receive') {
                setUnlockedView('receive');
                pendingUriView.current = 'receive';
            } else if (intent && intent.kind === 'execute' && intent.contractActionIndex && intent.chainId) {
                // Explorer Write-tab deep link: land on the EXECUTE form
                // prefilled. Unroutable without a contract index and a
                // resolved chain, so both are required.
                setContractRef({ chainId: intent.chainId, contractActionIndex: intent.contractActionIndex });
                setExecutePrefill({
                    method: intent.method || '',
                    paramsText: intent.executeParams || '',
                    gasLimit: intent.gasLimit || '',
                });
                setUnlockedView('contract-execute');
                pendingUriView.current = 'contract-execute';
            }
        } catch {
            // Parser surfaces unknown via kind === 'unknown'; defensive
            // try/catch in case future parser changes regress.
        } finally {
            params.delete('uri');
            const next = params.toString();
            const url = window.location.pathname + (next ? `?${next}` : '') + window.location.hash;
            window.history.replaceState(null, '', url);
        }
    }, []);

    useEffect(() => {
        if (status.state !== 'unlocked') {
            setActiveWalletId(null);
            setActiveAccountId(null);
            return;
        }
        let cancelled = false;
        listWallets()
            .then((list) => {
                if (cancelled) return;
                if (Array.isArray(list) && list.length > 0) {
                    setActiveWalletId(list[0].id);
                }
            })
            .catch(() => { /* Home surfaces load errors */ });
        return () => { cancelled = true; };
    }, [status.state]);

    // Load BIP44 accounts for the active wallet and pick the first
    // (lowest-index) one as active. The popover's account picker calls
    // setActiveAccountId on change. State resets when the user locks or
    // switches wallet.
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

    // Switch the active account and remember it per wallet, so a reopen
    // returns to it instead of snapping back to the lowest-index account.
    const handleSwitchAccount = (id) => {
        setActiveAccountId(id);
        if (activeWalletId && id) writeActiveAccount(activeWalletId, id);
    };

    // §42.2 Contracts nav: show only when a BTC wallet address exists
    // (VM actions are BTC-only at launch per BITCOIN_ACTIONS).
    const hasBtcAddress = useBtcAddressesPresent(activeWalletId);
    const hasGovernanceAddress = useGovernanceAddressesPresent(activeWalletId);

    // §24 / G055: resume the user's last view on unlock (persisted
    // per-wallet in localStorage). Restricted to context-free views;
    // anything that needs a prefilled state object falls through to
    // Home. See `lastViewMemory.RESUMABLE_VIEWS` for the set.
    useLastView({
        walletId: activeWalletId,
        currentView: unlockedView,
        onResume: setUnlockedView,
    });

    // §33 command palette: Cmd/Ctrl+K opens a launcher over every action and
    // destination. Inert unless unlocked; contacts feed its fuzzy search and
    // load lazily the first time it opens.
    // Custom keybindings (if the user rebound anything) come from settings;
    // absent settings just fall back to the built-in defaults inside each hook.
    const { settings } = useSettings();
    const palette = useCommandPalette({
        enabled: status.state === 'unlocked',
        binding: settings?.keyboard?.bindings?.['command-palette'],
    });
    const [paletteContacts, setPaletteContacts] = useState(/** @type {any[]} */ ([]));
    //  entity search: token balances join contacts in the palette's
    // searchable surface (the popup has no connected-sites view, so sites are
    // omitted here). Same lazy contract: loaded on each open, and a failed
    // load just leaves the token rows out of the results.
    const [paletteTokenRows, setPaletteTokenRows] = useState(/** @type {any[]} */ ([]));
    useEffect(() => {
        if (!palette.open || status.state !== 'unlocked' || !activeWalletId) return undefined;
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setPaletteContacts(Array.isArray(rows) ? rows : []); })
            .catch(() => { /* palette still works without contacts */ });
        messaging.getWalletBalances(activeWalletId, activeAccountId)
            .then((balances) => {
                if (cancelled) return;
                setPaletteTokenRows(buildBalanceRows(balances, APP_CHAIN_REGISTRY, null));
            })
            .catch(() => { /* palette still works without token rows */ });
        return () => { cancelled = true; };
    }, [palette.open, status.state, activeWalletId, activeAccountId]);
    // Shared catalogue + lazily-loaded contacts; each run() closes over this
    // shell's setUnlockedView (see the web shell for reference wiring). The
    // popup locks via messaging.lockWallet (Home owns the visible Lock button).
    const paletteCommands = [
        ...buildCommands({
            navigate: setUnlockedView,
            lock: () => { messaging.lockWallet().then(refresh).catch(refresh); },
            refresh,
            scan: () => setUnlockedView('scan'),
            switchWallet: () => setUnlockedView('wallet-picker'),
            openHelp: () => setShortcutHelpOpen(true),
            hasBtcAddress,
            hasGovernanceAddress,
        }),
        // : token rows open TokenDetail with the full ref the row
        // carries. Connected-sites and settings-section commands are omitted
        // in the popup (no such views here).
        ...balancesToCommands(paletteTokenRows, {
            openToken: (tok) => { setTokenDetailRef(tok); setUnlockedView('token-detail'); },
        }),
        ...contactsToCommands(paletteContacts, { navigate: setUnlockedView }),
        // With only openHelp supplied this emits just the shortcut-help topic
        // (settings-backed help topics are omitted; the popup has no Settings
        // route).
        ...helpToCommands({ openHelp: () => setShortcutHelpOpen(true) }),
    ];
    // §33.3: free-form "send 100 MYTOKEN" opens Send prefilled (Send resolves
    // the chain from the first available when the prefill carries none). A
    // txid/date-shaped query offers "search history" .
    const paletteParseQuery = (q) => parseFreeformCommands(q, {
        composeSend: ({ amount, tick }) => {
            setSendPrefill({ amount, tick });
            setSendBackTo('home');
            setUnlockedView('send');
        },
        searchHistory: (query) => {
            setHistoryInitialQuery(query);
            setHistoryInitialChainCoin('');
            setHistoryReturnTo('home');
            setUnlockedView('history');
        },
    });
    // §34 keyboard shortcuts (see the web shell for the reference wiring).
    const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
    useKeyboardShortcuts({
        enabled: status.state === 'unlocked' && !palette.open && !shortcutHelpOpen,
        overrides: settings?.keyboard?.bindings,
        handlers: {
            navigate: setUnlockedView,
            lock: () => { messaging.lockWallet().then(refresh).catch(refresh); },
            openHelp: () => setShortcutHelpOpen(true),
        },
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
            // §33: the palette must overlay whatever route is showing, so the
            // route tree is computed in an IIFE and the case returns it beside
            // a single <CommandPalette> mount (this shell has no shared layout
            // wrapper like the web/desktop FullLayoutWithNav to hang it on).
            const routeNode = (() => {
            if (unlockedView === 'send' && activeWalletId) {
                return (
                    <Send
                        walletId={activeWalletId}
                        prefill={sendPrefill}
                        onBack={() => {
                            setSendPrefill(null);
                            setUnlockedView(sendBackTo);
                            setSendBackTo('home');
                        }}
                        onChangeAsset={(carry) => {
                            // Carry the typed To address + amount so picking a
                            // new asset doesn't wipe those fields.
                            setSendPrefill({ address: carry?.address || '', amount: carry?.amount || '' });
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
                        onBack={() => { setSendPrefill(null); setUnlockedView('home'); }}
                        onSelect={(sel) => {
                            // Preserve any To address + amount carried in via onChangeAsset.
                            setSendPrefill((prev) => ({
                                chainId: sel.chainId,
                                tick: sel.tick,
                                kind: sel.kind,
                                displayName: sel.displayName,
                                imageUrl: sel.imageUrl,
                                address: prev?.address || undefined,
                                amount: prev?.amount || undefined,
                            }));
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
                        hideOwnFilter
                        onBack={() => setUnlockedView('receive')}
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
                            const hadPrefill = !!receivePrefill;
                            setReceivePrefill(null);
                            setUnlockedView(hadPrefill ? 'receive-picker' : 'home');
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
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'mint' && activeWalletId) {
                return (
                    <MintForm
                        walletId={activeWalletId}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'destroy' && activeWalletId) {
                return (
                    <DestroyForm
                        walletId={activeWalletId}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'sweep' && (sweepCtx?.walletId || activeWalletId)) {
                const fromMigrate = !!sweepCtx?.migrateTo;
                return (
                    <SweepForm
                        walletId={sweepCtx?.walletId || activeWalletId}
                        onBack={() => {
                            setSweepCtx(null);
                            if (fromMigrate) setUnlockedView('home');
                            else formBack();
                        }}
                        initialChainId={sweepCtx?.chainId || prefillChainId}
                        initialFromAddress={sweepCtx?.fromAddress || prefillFromAddress}
                        initialDestination={sweepCtx?.destination}
                        migrateTo={sweepCtx?.migrateTo || null}
                    />
                );
            }
            if (
                (unlockedView === 'lock'
                    || unlockedView === 'mint-settings'
                    || unlockedView === 'callback-settings'
                    || unlockedView === 'access-lists'
                    || unlockedView === 'description'
                    || unlockedView === 'transfer')
                && activeWalletId
            ) {
                return (
                    <TokenAdminForm
                        walletId={activeWalletId}
                        mode={unlockedView}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'execute-callback' && activeWalletId) {
                return (
                    <CallbackForm
                        walletId={activeWalletId}
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                    />
                );
            }
            if (unlockedView === 'pause-token' && activeWalletId) {
                return (
                    <SleepForm
                        walletId={activeWalletId}
                        mode="tick"
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                    />
                );
            }
            if (unlockedView === 'lock-address' && activeWalletId) {
                return (
                    <SleepForm
                        walletId={activeWalletId}
                        mode="address"
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'broadcast' && activeWalletId) {
                return (
                    <BroadcastForm
                        walletId={activeWalletId}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'dispenser' && activeWalletId) {
                return (
                    <DispenserForm
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                        onBack={formBack}
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
                        onCreateDispenser={() => setUnlockedView('dispenser')}
                        onBack={() => setUnlockedView(dispensersBackTo || 'home')}
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
                            if (dispenserRef.origin === 'manage-token') return setUnlockedView('manage-token');
                            if (dispenserRef.origin === 'explorer') return setUnlockedView('dispenser-explorer');
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
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'dividend' && activeWalletId) {
                return (
                    <DividendForm
                        walletId={activeWalletId}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'airdrop' && activeWalletId) {
                return (
                    <AirdropForm
                        walletId={activeWalletId}
                        resumeId={resumeAirdropId}
                        initialChainId={resumeAirdropId ? undefined : prefillChainId}
                        initialTick={resumeAirdropId ? undefined : prefillTick}
                        initialFromAddress={resumeAirdropId ? undefined : prefillFromAddress}
                        onBack={() => {
                            if (resumeAirdropId) {
                                setResumeAirdropId(null);
                                setUnlockedView('home');
                                return;
                            }
                            formBack();
                        }}
                    />
                );
            }
            if (unlockedView === 'advanced' && activeWalletId) {
                return (
                    <AdvancedActionsForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
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
                        onSweepChain={(s) => {
                            setSweepCtx({
                                walletId: s.legacyWalletId,
                                chainId: s.chainId,
                                fromAddress: s.fromAddress,
                                destination: s.toAddress,
                                migrateTo: { walletId: s.newWalletId, address: s.toAddress, name: 'your new BIP39 wallet' },
                            });
                            setUnlockedView('sweep');
                        }}
                    />
                );
            }
            if (unlockedView === 'pair-signer' && activeWalletId) {
                return (
                    <PairSignerForm
                        walletId={activeWalletId}
                        pairTrezor={null}
                        pairLedger={pairLedgerSigner}
                        onBack={() => setUnlockedView('actions')}
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
                        onOpenMarket={(chainId, tick1, tick2) => {
                            setActiveMarket({ chainId, tick1, tick2 });
                            setUnlockedView('market');
                        }}
                        onBack={() => setUnlockedView('home')}
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
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'create-order' && activeWalletId) {
                return (
                    <CreateOrderForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                        onManageOrders={() => setUnlockedView('my-orders')}
                    />
                );
            }
            if (unlockedView === 'my-orders' && activeWalletId) {
                return (
                    <MyOrdersView
                        walletId={activeWalletId}
                        accountId={activeAccountId}
                        onBack={() => setUnlockedView('actions')}
                        onCreateOrder={() => setUnlockedView('create-order')}
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
                        onBack={() => setUnlockedView('actions')}
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
            if (unlockedView === 'gated-publish' && activeWalletId && tokenDetailRef) {
                return (
                    <GatedPublishForm
                        walletId={activeWalletId}
                        chainId={tokenDetailRef.chainId}
                        tick={tokenDetailRef.tick}
                        issuerAddress={tokenDetailRef.issuer || null}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'publish-file' && activeWalletId) {
                return (
                    <PublishFileForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
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
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'verify-signature') {
                return (
                    <VerifySignatureForm
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'sign-psbt' && activeWalletId) {
                return (
                    <PsbtSignForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
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
                        onBack={() => setUnlockedView('actions')}
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
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'multisig-create' && activeWalletId) {
                return (
                    <MultisigCreate
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'governance-polls' && activeWalletId) {
                return (
                    <GovernancePolls
                        walletId={activeWalletId}
                        onCreate={(chainId) => { setGovernanceRef({ chainId }); setUnlockedView('governance-create-poll'); }}
                        onOpenPoll={(chainId, pollIndex) => { setGovernanceRef({ chainId, pollIndex }); setUnlockedView('governance-poll-detail'); }}
                        onDelegate={(chainId) => { setGovernanceRef({ chainId }); setUnlockedView('governance-delegate'); }}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'governance-create-poll' && activeWalletId && governanceRef) {
                return (
                    <CreatePollForm
                        walletId={activeWalletId}
                        chainId={governanceRef.chainId}
                        onBack={() => setUnlockedView('governance-polls')}
                        onCreated={() => setUnlockedView('governance-polls')}
                    />
                );
            }
            if (unlockedView === 'governance-poll-detail' && activeWalletId && governanceRef) {
                return (
                    <PollDetail
                        walletId={activeWalletId}
                        chainId={governanceRef.chainId}
                        pollIndex={governanceRef.pollIndex}
                        onBack={() => setUnlockedView('governance-polls')}
                    />
                );
            }
            if (unlockedView === 'governance-delegate' && activeWalletId && governanceRef) {
                return (
                    <DelegateVoteForm
                        mode="delegate"
                        walletId={activeWalletId}
                        chainId={governanceRef.chainId}
                        onBack={() => setUnlockedView('governance-polls')}
                    />
                );
            }
            if (unlockedView === 'cosigner-accounts' && activeWalletId) {
                return (
                    <CoSignerAccountList
                        walletId={activeWalletId}
                        onProvision={() => setUnlockedView('cosigner-provision')}
                        onOpen={(id) => { setCoSignerAccountId(id); setUnlockedView('cosigner-detail'); }}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'cosigner-provision' && activeWalletId) {
                return (
                    <CoSignerProvision
                        walletId={activeWalletId}
                        onDone={(id) => { setCoSignerAccountId(id || null); setUnlockedView(id ? 'cosigner-detail' : 'cosigner-accounts'); }}
                        onBack={() => setUnlockedView('cosigner-accounts')}
                    />
                );
            }
            if (unlockedView === 'cosigner-detail' && activeWalletId && coSignerAccountId) {
                return (
                    <CoSignerAccountDetail
                        accountId={coSignerAccountId}
                        onBack={() => setUnlockedView('cosigner-accounts')}
                    />
                );
            }
            if (unlockedView === 'multisig-sign' && activeWalletId) {
                return (
                    <MultisigSigningSession
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'addresses' && activeWalletId) {
                return (
                    <AddressList
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
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
            if (unlockedView === 'messaging' && activeWalletId) {
                return (
                    <MessagingInbox
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        initialCounterparty={messagingThread || undefined}
                        onCompose={(prefill) => {
                            setComposePrefill(prefill || null);
                            setUnlockedView('compose-message');
                        }}
                        onBack={() => {
                            setMessagingThread(null);
                            setUnlockedView('home');
                        }}
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
                        initialMessage={composePrefill?.message}
                        fixedEncryption={composePrefill?.fixedEncryption}
                        onBack={() => {
                            const from = composePrefill?.__from || 'messaging';
                            setMessagingThread(composePrefill?.threadCounterparty || null);
                            setComposePrefill(null);
                            setUnlockedView(from);
                        }}
                        onSent={() => {
                            const from = composePrefill?.__from || 'messaging';
                            setMessagingThread(composePrefill?.threadCounterparty || null);
                            setComposePrefill(null);
                            setUnlockedView(from);
                            setMessageSentNotice(true);
                        }}
                    />
                );
            }
            if (unlockedView === 'contacts' && activeWalletId) {
                return (
                    <ContactsList
                        walletId={activeWalletId}
                        onSend={(prefill) => {
                            setSendPrefill(prefill);
                            setSendBackTo('contacts');
                            setUnlockedView('send');
                        }}
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
                            setContractRef({
                                chainId: cid,
                                contractActionIndex: String(actionIndex),
                                origin: stakeContractPickerActive ? 'stake-picker' : 'contracts-browse',
                            });
                            setUnlockedView('contract-detail');
                        }}
                        onDeploy={() => setUnlockedView('contract-deploy')}
                        onBack={() => {
                            if (stakeContractPickerActive) {
                                setStakeContractPickerActive(false);
                                return setUnlockedView('stake-new');
                            }
                            return setUnlockedView('home');
                        }}
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
                        initialMode={contractRef.initialMode}
                        onBack={() => {
                            // Return to whichever flow opened the form: the
                            // staking list (new-stake picker), the position's
                            // detail page, or plain contract browsing.
                            if (contractRef.origin === 'stake-picker') {
                                setStakeContractPickerActive(false);
                                return setUnlockedView('staking-dashboard');
                            }
                            if (contractRef.origin === 'stake-detail') return setUnlockedView('stake-detail');
                            return setUnlockedView('contract-detail');
                        }}
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
                        initialMethod={executePrefill?.method}
                        initialParamsText={executePrefill?.paramsText}
                        initialGasLimit={executePrefill?.gasLimit}
                        onBack={() => { setExecutePrefill(null); setUnlockedView('contract-detail'); }}
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
                    <StakingList
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        onOpenStake={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('stake-detail');
                        }}
                        onNewStake={() => setUnlockedView('stake-new')}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'stake-detail' && activeWalletId && stakingRef) {
                return (
                    <StakeDetail
                        walletId={activeWalletId}
                        kind={stakingRef.kind}
                        chainId={stakingRef.chainId}
                        address={stakingRef.address}
                        contractActionIndex={stakingRef.contractActionIndex}
                        onUnstake={stakingRef.kind === 'contract'
                            ? () => {
                                setContractRef({
                                    chainId: stakingRef.chainId,
                                    contractActionIndex: String(stakingRef.contractActionIndex),
                                    origin: 'stake-detail',
                                    initialMode: 'unstake',
                                });
                                setUnlockedView('contract-stake');
                            }
                            : () => setUnlockedView('staking-unstake')}
                        onDelegate={stakingRef.kind === 'contract'
                            ? () => {
                                setContractRef({
                                    chainId: stakingRef.chainId,
                                    contractActionIndex: String(stakingRef.contractActionIndex),
                                    origin: 'stake-detail',
                                    initialMode: 'delegate',
                                });
                                setUnlockedView('contract-stake');
                            }
                            : () => setUnlockedView('staking-delegate')}
                        onRevokeDelegation={() => setUnlockedView('staking-revoke')}
                        onClaimRewards={() => setUnlockedView('staking-claim')}
                        onOpenOperatorDashboard={() => setUnlockedView('operator-dashboard')}
                        onStakeMore={stakingRef.kind === 'contract'
                            ? () => {
                                setContractRef({
                                    chainId: stakingRef.chainId,
                                    contractActionIndex: String(stakingRef.contractActionIndex),
                                    origin: 'stake-detail',
                                    initialMode: 'stake',
                                });
                                setUnlockedView('contract-stake');
                            }
                            : undefined}
                        onOpenContract={stakingRef.kind === 'contract'
                            ? () => {
                                setContractRef({
                                    chainId: stakingRef.chainId,
                                    contractActionIndex: String(stakingRef.contractActionIndex),
                                    origin: 'contracts-browse',
                                });
                                setUnlockedView('contract-detail');
                            }
                            : undefined}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'stake-new' && activeWalletId) {
                return (
                    <StakeNew
                        walletId={activeWalletId}
                        onPickValidator={(chainId) => {
                            setStakingRef({ kind: 'validator', chainId, address: '' });
                            setUnlockedView('stake-form');
                        }}
                        onPickContract={() => {
                            setStakeContractPickerActive(true);
                            setUnlockedView('contracts-list');
                        }}
                        onBack={() => setUnlockedView('staking-dashboard')}
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
                        onBack={() => setUnlockedView('stake-detail')}
                    />
                );
            }
            if (unlockedView === 'staking-claim' && activeWalletId && stakingRef) {
                return (
                    <StakingActionForm
                        mode="claim-rewards"
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('stake-detail')}
                    />
                );
            }
            if (unlockedView === 'staking-delegate' && activeWalletId && stakingRef) {
                return (
                    <DelegationActionForm
                        mode="delegate"
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('stake-detail')}
                    />
                );
            }
            if (unlockedView === 'staking-revoke' && activeWalletId && stakingRef) {
                return (
                    <DelegationActionForm
                        mode="revoke"
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('stake-detail')}
                    />
                );
            }
            if (unlockedView === 'operator-dashboard' && activeWalletId && stakingRef) {
                return (
                    <OperatorDashboard
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        address={stakingRef.address}
                        onBack={() => setUnlockedView('stake-detail')}
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
                            // Scope History by coin family (e.g. 'bitcoin')
                            // rather than pre-filling the search box with
                            // the tick ticker.
                            const coin = String(tokenDetailRef.chainId || '').split('-')[0] || '';
                            setHistoryInitialQuery('');
                            setHistoryInitialChainCoin(coin);
                            setHistoryReturnTo('token-detail');
                            setUnlockedView('history');
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
                        onMintSettings={() => openForm('mint-settings')}
                        onCallbackSettings={() => openForm('callback-settings')}
                        onExecuteCallback={() => openForm('execute-callback')}
                        onAccessLists={() => openForm('access-lists')}
                        onPauseToken={() => openForm('pause-token')}
                        onUpdateDescription={() => openForm('description')}
                        onAttachContent={() => openForm('attach-content')}
                        onGatedContent={() => openForm('gated-publish')}
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
                            setHistoryInitialChainCoin(coin);
                            setHistoryReturnTo('home');
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
                            onSweep: () => { setSweepCtx(null); setUnlockedView('sweep'); },
                            onLock: () => setUnlockedView('lock'),
                            onUpdateDescription: () => setUnlockedView('description'),
                            onTransferOwnership: () => setUnlockedView('transfer'),
                            onBroadcast: () => setUnlockedView('broadcast'),
                            onCreateDispenser: () => setUnlockedView('dispenser'),
                            onMyDispensers: () => { setDispensersBackTo(unlockedView); setUnlockedView('dispensers-list'); },
                            onBrowseDispensers: () => setUnlockedView('dispenser-explorer'),
                            onPayDividend: () => setUnlockedView('dividend'),
                            onAirdrop: () => {
                                setResumeAirdropId(null);
                                setUnlockedView('airdrop');
                            },
                            onAdvanced: () => setUnlockedView('advanced'),
                            onLockAddress: () => setUnlockedView('lock-address'),
                            onPairSigner: () => setUnlockedView('pair-signer'),
                            onPayCoinpay: () => {
                                setResumeCoinpay(null);
                                setUnlockedView('coinpay');
                            },
                            onSwap: () => setUnlockedView('swap'),
                            onCreateOrder: () => setUnlockedView('create-order'),
                            onMyOrders: () => setUnlockedView('my-orders'),
                            onPublishFile: () => setUnlockedView('publish-file'),
                            onLink: () => setUnlockedView('link-form'),
                            onParallel: () => setUnlockedView('parallel-compose'),
                            onCrossChainSwap: () => setUnlockedView('cross-chain-swap'),
                            onCrossChainTemplates: () => setUnlockedView('cross-chain-templates'),
                            onMultisigCreate: hasBtcAddress ? () => setUnlockedView('multisig-create') : undefined,
                            onMultisigSign: hasBtcAddress ? () => setUnlockedView('multisig-sign') : undefined,
                            onCoSignerAccounts: hasBtcAddress ? () => setUnlockedView('cosigner-accounts') : undefined,
                            onVoteGovernance: hasGovernanceAddress ? () => setUnlockedView('governance-polls') : undefined,
                            onContacts: () => { setFormReturnView('actions'); setUnlockedView('contacts'); },
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
            return (
                <>
                    {activeWalletId ? <QueuedBroadcastBanner walletId={activeWalletId} /> : null}
                    <Home
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
                        onMarketActivity={activeWalletId ? () => setUnlockedView('market-activity') : undefined}
                        onMarkets={activeWalletId ? () => setUnlockedView('markets') : undefined}
                        onDispensers={activeWalletId ? () => { setDispensersBackTo(unlockedView); setUnlockedView('dispensers-list'); } : undefined}
                        onMessaging={activeWalletId ? () => { setMessagingThread(null); setUnlockedView('messaging'); } : undefined}
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
                        onContacts={activeWalletId ? () => { setFormReturnView('home'); setUnlockedView('contacts'); } : undefined}
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
                        onCommandPalette={palette.openPalette}
                    />
                </>
            );
            })();
            return (
                <>
                    {routeNode}
                    {messageSentNotice ? (
                        <NoticeModal
                            title="Message sent"
                            onClose={() => setMessageSentNotice(false)}
                        />
                    ) : null}
                    <CommandPalette
                        open={palette.open}
                        onClose={palette.closePalette}
                        commands={paletteCommands}
                        parseQuery={paletteParseQuery}
                    />
                    <ShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} overrides={settings?.keyboard?.bindings} />
                </>
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
    onIssue, onMint, onDestroy, onSweep,
    onLock, onUpdateDescription, onTransferOwnership,
    onBroadcast,
    onCreateDispenser,
    onMyDispensers,
    onBrowseDispensers,
    onPayDividend,
    onAirdrop,
    onAdvanced,
    onLockAddress,
    onPairSigner,
    onPayCoinpay,
    onSwap,
    onCreateOrder,
    onMyOrders,
    onPublishFile,
    onLink,
    onParallel,
    onCrossChainSwap,
    onCrossChainTemplates,
    onMultisigCreate,
    onMultisigSign,
    onCoSignerAccounts,
    onVoteGovernance,
    onContacts,
    onSignMessage,
    onVerifySignature,
    onSignPsbt,
}) {
    return [
        {
            id: 'issue',
            label: 'Issue token',
            description: 'Create a token with every option exposed.',
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
            description: 'Burn part of your balance. Irreversible.',
            onSelect: onDestroy,
        },
        {
            id: 'sweep',
            label: 'Sweep address',
            description: 'Move every token balance and ownership from one address to a destination, optionally force-closing its open offers.',
            onSelect: onSweep,
        },
        {
            id: 'lock',
            label: 'Lock',
            description: 'Permanently lock one or more settings on a token you own (supply, minting, description, and more).',
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
            label: 'Broadcast',
            description: 'Publish text, oracle value, or feed reference on-chain.',
            onSelect: onBroadcast,
        },
        {
            id: 'dispenser',
            label: 'Create dispenser',
            description: 'Open a vending machine that sells your token for coin or fiat currency.',
            onSelect: onCreateDispenser,
        },
        {
            id: 'dispensers-list',
            label: 'My dispensers',
            description: 'Manage dispensers you have opened: view + cancel.',
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
            description: 'Pay a dividend in any token to a token\'s holders, pro rata.',
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
            label: 'Pay for a matched order',
            description: 'Finish a matched order by paying the coin side.',
            onSelect: onPayCoinpay,
        },
        {
            id: 'swap',
            label: 'Swap tokens',
            description: 'Swap one token directly for another, with no coin payment step.',
            onSelect: onSwap,
        },
        {
            id: 'create-order',
            label: 'Create order',
            description: 'Place a DEX limit order on any pair, including native-coin sides, with expiration and allow/block lists.',
            onSelect: onCreateOrder,
        },
        {
            id: 'my-orders',
            label: 'My orders',
            description: 'View, edit, and cancel your open orders across every pair.',
            onSelect: onMyOrders,
        },
        {
            id: 'publish-file',
            label: 'Publish file',
            description: 'Store a file on the chain: public, or encrypted so only holders of your token can open it.',
            onSelect: onPublishFile,
        },
        {
            id: 'link',
            label: 'Link cross-chain actions',
            description: 'Tie two existing actions on different chains together. Both sides thread together in History.',
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
            description: 'Offer a token on one chain in exchange for a token on another. Settles automatically when a counterparty fills the offer.',
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
            description: 'Set up a shared wallet: pick your co-signers, an address type, and how many signatures are required. Bitcoin only at launch.',
            onSelect: onMultisigCreate,
        },
        {
            id: 'multisig-sign',
            label: 'Multisig signing',
            description: 'Resume a shared-wallet transaction that is waiting for signatures and track who has signed.',
            onSelect: onMultisigSign,
        },
        {
            id: 'governance-polls',
            label: 'Governance',
            description: 'Create and vote on token-weighted polls, and delegate your voting weight.',
            onSelect: onVoteGovernance,
        },
        {
            id: 'cosigner-accounts',
            label: 'Agent accounts',
            description: 'Share a 2-of-2 address with an automated agent. This wallet co-signs each request that fits the policy you set. Bitcoin only at launch.',
            onSelect: onCoSignerAccounts,
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
            description: 'Submit any action the SDK supports. Power-user surface for ADDRESS / CALLBACK / SLEEP / raw MESSAGE.',
            onSelect: onAdvanced,
        },
        {
            id: 'lock-address',
            label: 'Lock this address',
            description: 'Safety freeze: block all actions from this address until a chosen block. One-way until it unlocks.',
            onSelect: onLockAddress,
        },
        {
            id: 'pair-signer',
            label: 'Pair hardware signer',
            description: 'Add a Ledger to this wallet via WebHID. Trezor is available in the XChain web and desktop wallets.',
            onSelect: onPairSigner,
        },
    ];
}
