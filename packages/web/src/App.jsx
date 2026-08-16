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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAutoLockPolicy } from '@xchain-wallet/core/shared/hooks/useAutoLockPolicy.js';
import { useLastView } from '@xchain-wallet/core/shared/hooks/useLastView.js';
import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';
import { useSettings } from '@xchain-wallet/core/shared/hooks/useSettings.js';
import { useWalletMode } from '@xchain-wallet/core/shared/hooks/useWalletMode.js';
import { Loading } from '@xchain-wallet/core/shared/routes/Loading.jsx';
import { VaultUnavailable } from '@xchain-wallet/core/shared/routes/VaultUnavailable.jsx';
import { storage as coreStorageLib } from '@xchain-wallet/core';
import { Onboarding } from '@xchain-wallet/core/shared/routes/Onboarding.jsx';
import { CreateWallet } from '@xchain-wallet/core/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '@xchain-wallet/core/shared/routes/ImportWallet.jsx';
import { PairPartnerWallet } from '@xchain-wallet/core/shared/routes/PairPartnerWallet.jsx';
import { AddAccountForm } from '@xchain-wallet/core/shared/routes/AddAccountForm.jsx';
import { WalletPicker } from '@xchain-wallet/core/shared/routes/WalletPicker.jsx';
import { AccountPicker } from '@xchain-wallet/core/shared/routes/AccountPicker.jsx';
import { WalletDetails } from '@xchain-wallet/core/shared/routes/WalletDetails.jsx';
import { RenameWalletForm } from '@xchain-wallet/core/shared/routes/RenameWalletForm.jsx';
import { RenameAccountForm } from '@xchain-wallet/core/shared/routes/RenameAccountForm.jsx';
import { readActiveAccount, writeActiveAccount } from '@xchain-wallet/core/shared/utils/activeAccountMemory.js';
import { readActiveWallet, writeActiveWallet } from '@xchain-wallet/core/shared/utils/activeWalletMemory.js';
import { takePostDemoIntent } from '@xchain-wallet/core/shared/utils/demoGraduation.js';
import { useMessagingUnread } from '@xchain-wallet/core/shared/hooks/useMessagingUnread.js';
import { useCoinpayObligations } from '@xchain-wallet/core/shared/hooks/useCoinpayObligations.js';
import { Locked } from '@xchain-wallet/core/shared/routes/Locked.jsx';
import { Home } from '@xchain-wallet/core/shared/routes/Home.jsx';
import { Settings } from '@xchain-wallet/core/shared/routes/Settings.jsx';
import { TokenDetail } from '@xchain-wallet/core/shared/routes/TokenDetail.jsx';
import { ToastHost, useToast } from '@xchain-wallet/core/shared/components/ToastHost.jsx';
import { NOTIFICATION_EVENT } from './notifications/webNotifyAdapter.js';
import { ReachabilityBanner } from '@xchain-wallet/core/shared/components/ReachabilityBanner.jsx';
// §6 / D4. Renders nothing unless a shell installed a direct-update
// provider, which only a sideloaded Android APK does; see flows/directUpdate.js.
import { UpdateNoticeBanner } from '@xchain-wallet/core/shared/components/UpdateNoticeBanner.jsx';
import { isDemoWallet } from '@xchain-wallet/core/flows';
import { QueuedBroadcastBanner } from '@xchain-wallet/core/shared/components/QueuedBroadcastBanner.jsx';
import { DemoBanner } from '@xchain-wallet/core/shared/components/DemoBanner.jsx';
import { LeftNav, FullLayoutWithNav } from '@xchain-wallet/core/shared/components/LeftNav.jsx';
import { AppHeader } from '@xchain-wallet/core/shared/components/AppHeader.jsx';
import { CommandPalette } from '@xchain-wallet/core/shared/commandPalette/CommandPalette.jsx';
import { useCommandPalette } from '@xchain-wallet/core/shared/commandPalette/useCommandPalette.js';
import { buildCommands, contactsToCommands, parseFreeformCommands, balancesToCommands, sitesToCommands, settingsSectionsToCommands, helpToCommands } from '@xchain-wallet/core/shared/commandPalette/commandRegistry.js';
import { buildBalanceRows } from '@xchain-wallet/core/shared/components/BalanceList.jsx';
import { useKeyboardShortcuts } from '@xchain-wallet/core/shared/keyboard/useKeyboardShortcuts.js';
import { ShortcutHelp } from '@xchain-wallet/core/shared/keyboard/ShortcutHelp.jsx';
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
// The DEX surface, as one module rather than nine route blocks. A
// build whose profile hides `dex` gets the inert twin instead (vite.config.js),
// so those route components are not in the bundle at all and every entry point
// below goes with them: each one is wired only when DEX_SURFACE_ENABLED.
import { DEX_SURFACE_ENABLED, renderDexRoute } from './surfaces/dex.jsx';
import { ScanRoute } from '@xchain-wallet/core/shared/routes/ScanRoute.jsx';
import { TokenWizard } from '@xchain-wallet/core/shared/routes/TokenWizard.jsx';
import { ActionsMenu } from '@xchain-wallet/core/shared/routes/ActionsMenu.jsx';
import { MyTokens } from '@xchain-wallet/core/shared/routes/MyTokens.jsx';
import { ManageToken } from '@xchain-wallet/core/shared/routes/ManageToken.jsx';
import { IssueTokenForm } from '@xchain-wallet/core/shared/routes/IssueTokenForm.jsx';
import { MintForm } from '@xchain-wallet/core/shared/routes/MintForm.jsx';
import { DestroyForm } from '@xchain-wallet/core/shared/routes/DestroyForm.jsx';
import { SweepForm } from '@xchain-wallet/core/shared/routes/SweepForm.jsx';
import { TokenAdminForm } from '@xchain-wallet/core/shared/routes/TokenAdminForm.jsx';
import { CallbackForm } from '@xchain-wallet/core/shared/routes/CallbackForm.jsx';
import { SleepForm } from '@xchain-wallet/core/shared/routes/SleepForm.jsx';
import { BroadcastForm } from '@xchain-wallet/core/shared/routes/BroadcastForm.jsx';
import { OracleForm } from '@xchain-wallet/core/shared/routes/OracleForm.jsx';
import { DispenserForm } from '@xchain-wallet/core/shared/routes/DispenserForm.jsx';
import { DispensersList } from '@xchain-wallet/core/shared/routes/DispensersList.jsx';
import { MyLists } from '@xchain-wallet/core/shared/routes/MyLists.jsx';
import { ListDetail } from '@xchain-wallet/core/shared/routes/ListDetail.jsx';
import { ListCreateForm } from '@xchain-wallet/core/shared/routes/ListCreateForm.jsx';
import { ListForkForm } from '@xchain-wallet/core/shared/routes/ListForkForm.jsx';
import { DispenserDetail } from '@xchain-wallet/core/shared/routes/DispenserDetail.jsx';
import { DispenserExplorer } from '@xchain-wallet/core/shared/routes/DispenserExplorer.jsx';
import { DividendForm } from '@xchain-wallet/core/shared/routes/DividendForm.jsx';
import { AirdropForm } from '@xchain-wallet/core/shared/routes/AirdropForm.jsx';
import { AdvancedActionsForm } from '@xchain-wallet/core/shared/routes/AdvancedActionsForm.jsx';
import { MigrateToBip39 } from '@xchain-wallet/core/shared/routes/MigrateToBip39.jsx';
import { CoinpayForm } from '@xchain-wallet/core/shared/routes/CoinpayForm.jsx';
import { ObligationsView } from '@xchain-wallet/core/shared/routes/ObligationsView.jsx';
import { SellOwnershipForm } from '@xchain-wallet/core/shared/routes/SellOwnershipForm.jsx';
import { MessagingInbox } from '@xchain-wallet/core/shared/routes/MessagingInbox.jsx';
import { NoticeModal } from '@xchain-wallet/core/shared/components/NoticeModal.jsx';
import { ComposeMessage } from '@xchain-wallet/core/shared/routes/ComposeMessage.jsx';
import { ContactsList } from '@xchain-wallet/core/shared/routes/ContactsList.jsx';
import { ContractsList } from '@xchain-wallet/core/shared/routes/ContractsList.jsx';
import { ContractDetail } from '@xchain-wallet/core/shared/routes/ContractDetail.jsx';
import { ContractStakeForm } from '@xchain-wallet/core/shared/routes/ContractStakeForm.jsx';
import { DeployContractForm } from '@xchain-wallet/core/shared/routes/DeployContractForm.jsx';
import { ExecuteContractForm } from '@xchain-wallet/core/shared/routes/ExecuteContractForm.jsx';
import { ContractFundsForm } from '@xchain-wallet/core/shared/routes/ContractFundsForm.jsx';
import { ControllerBindForm } from '@xchain-wallet/core/shared/routes/ControllerBindForm.jsx';
import { StakingList } from '@xchain-wallet/core/shared/routes/StakingList.jsx';
import { StakeDetail } from '@xchain-wallet/core/shared/routes/StakeDetail.jsx';
import { StakeNew } from '@xchain-wallet/core/shared/routes/StakeNew.jsx';
import { StakeForm } from '@xchain-wallet/core/shared/routes/StakeForm.jsx';
import { StakingActionForm } from '@xchain-wallet/core/shared/routes/StakingActionForm.jsx';
import { DelegationActionForm } from '@xchain-wallet/core/shared/routes/DelegationActionForm.jsx';
import { GovernancePolls } from '@xchain-wallet/core/shared/routes/GovernancePolls.jsx';
import { BetFeedsList } from '@xchain-wallet/core/shared/routes/BetFeedsList.jsx';
import { BetFeedDetail } from '@xchain-wallet/core/shared/routes/BetFeedDetail.jsx';
import { CreateBetFeedForm } from '@xchain-wallet/core/shared/routes/CreateBetFeedForm.jsx';
import { MyBets } from '@xchain-wallet/core/shared/routes/MyBets.jsx';
import { OracleConsole } from '@xchain-wallet/core/shared/routes/OracleConsole.jsx';
import { OracleRecord } from '@xchain-wallet/core/shared/routes/OracleRecord.jsx';
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
import { BatchComposerForm } from '@xchain-wallet/core/shared/routes/BatchComposerForm.jsx';
import { CrossChainTemplates } from '@xchain-wallet/core/shared/routes/CrossChainTemplates.jsx';
import { MultisigCreate } from '@xchain-wallet/core/shared/routes/MultisigCreate.jsx';
import { MultisigSigningSession } from '@xchain-wallet/core/shared/routes/MultisigSigningSession.jsx';
import { CoSignerAccountList } from '@xchain-wallet/core/shared/routes/CoSignerAccountList.jsx';
import { CoSignerProvision } from '@xchain-wallet/core/shared/routes/CoSignerProvision.jsx';
import { CoSignerAccountDetail } from '@xchain-wallet/core/shared/routes/CoSignerAccountDetail.jsx';
import { AddressList } from '@xchain-wallet/core/shared/routes/AddressList.jsx';
import { AddressPreferencesForm } from '@xchain-wallet/core/shared/routes/AddressPreferencesForm.jsx';
import { PairSignerForm } from '@xchain-wallet/core/shared/routes/PairSignerForm.jsx';
import { useBtcAddressesPresent } from '@xchain-wallet/core/shared/hooks/useBtcAddressesPresent.js';
import { useVmAddressesPresent } from '@xchain-wallet/core/shared/hooks/useVmAddressesPresent.js';
import { useAccountList } from '@xchain-wallet/core/shared/hooks/useAccountList.js';
import { useGovernanceAddressesPresent } from '@xchain-wallet/core/shared/hooks/useGovernanceAddressesPresent.js';
import { pairTrezorSigner } from './signers/trezorFactory.js';
import { pairLedgerSigner } from './signers/ledgerFactory.js';
import { registerSigner as registerLocalSigner } from './signerBridge.js';
import * as messaging from './messaging.js';
import { getSessionStatus, listWallets, lockWallet, listAccounts } from './messaging.js';
import { subscribeToNativeDeepLinks } from './deeplinks/nativeDeepLinks.js';
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
    // No variant read here any more. Navigation surfaces are chosen
    // by <FullLayoutWithNav> from its measured container width; the variant
    // only decides the dev-preview frame and the messaging shell, both of
    // which are resolved in <App> above.
    const { showToast } = useToast();
    // §34.1: settings carry the keyboard-shortcut overrides threaded into
    // the palette hook, the dispatcher, and the help modal below.
    const { settings } = useSettings();
    const [status, setStatus] = useState(/** @type {any} */ ({ state: 'loading' }));
    // A demo graduation wipes the vault and reloads, so the lane
    // the user picked (create / import / FreeWallet) is handed across the
    // reload here. One-shot read: it never survives to hijack a later visit.
    const [onboardingStep, setOnboardingStep] = useState(
        /** @returns {'welcome' | 'create' | 'import' | 'import-freewallet' | 'pair-partner'} */
        () => takePostDemoIntent() || 'welcome',
    );
    const [unlockedView, setUnlockedView] = useState(
        /** @type {'home' | 'send' | 'receive' | 'receive-picker' | 'wizard' | 'actions' | 'my-tokens' | 'manage-token' | 'market-activity' | 'issue' | 'mint' | 'destroy' | 'sweep' | 'lock' | 'mint-settings' | 'callback-settings' | 'execute-callback' | 'access-lists' | 'pause-token' | 'lock-address' | 'description' | 'transfer' | 'broadcast' | 'oracle' | 'dispenser' | 'dispensers-list' | 'dispenser-detail' | 'dispenser-explorer' | 'dividend' | 'airdrop' | 'advanced' | 'migrate-bip39' | 'pair-signer' | 'markets' | 'markets-picker' | 'market' | 'create-order' | 'my-orders' | 'my-swaps' | 'coinpay' | 'obligations' | 'swap' | 'sell-name' | 'messaging' | 'compose-message' | 'contacts' | 'lists' | 'list-detail' | 'list-create' | 'list-fork' | 'contracts-list' | 'contract-detail' | 'contract-deploy' | 'contract-execute' | 'contract-deposit' | 'contract-withdraw' | 'controller-bind' | 'staking-dashboard' | 'stake-detail' | 'stake-new' | 'stake-form' | 'staking-unstake' | 'staking-claim' | 'staking-delegate' | 'staking-revoke' | 'operator-dashboard' | 'history' | 'action-detail' | 'token-detail' | 'link-form' | 'attach-content' | 'gated-publish' | 'publish-file' | 'project-roster' | 'parallel-compose' | 'batch-compose' | 'cross-chain-swap' | 'cross-chain-templates' | 'multisig-create' | 'multisig-sign' | 'cosigner-accounts' | 'cosigner-provision' | 'cosigner-detail' | 'addresses' | 'address-preferences' | 'add-wallet' | 'add-account' | 'wallet-picker' | 'account-picker' | 'wallet-details' | 'wallet-rename' | 'account-rename' | 'scan'} */ ('home'),
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
    // 'settings' covers the Developer Mode regtest-faucet "Mint test
    // XCHAIN" button (handleFaucetMint below): it stashes a synthetic
    // tokenDetailRef the same way ManageToken does, so MintForm gets the
    // same chainId/tick prefill treatment from either entry point.
    const fromManage = formReturnView === 'manage-token' || formReturnView === 'settings';
    const prefillChainId = fromManage ? tokenDetailRef?.chainId : undefined;
    const prefillTick = fromManage ? tokenDetailRef?.tick : undefined;
    // Issuer address stashed by ManageToken via `onIssuerResolved`.
    // When set, each prefill-enabled form defaults its From row to the
    // creator address instead of the newest receive-chain HD address.
    const prefillFromAddress = fromManage ? tokenDetailRef?.issuer : undefined;
    // Developer Mode's regtest faucet "Mint test XCHAIN" button: reuses
    // the ManageToken prefill plumbing above instead of a parallel path.
    const handleFaucetMint = ({ chainId, tick }) => {
        setTokenDetailRef({ chainId, tick });
        setFormReturnView('settings');
        setUnlockedView('mint');
    };
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
    // PC-34: SweepForm context. Free-entry sweeps leave it null (form
    // defaults to the active wallet); the migrate lane prefills the
    // legacy wallet + locked destination.
    const [sweepCtx, setSweepCtx] = useState(
        /** @type {{ walletId: string, chainId: string, fromAddress: string, destination: string, migrateTo: { walletId: string, address: string, name?: string } } | null} */ (null),
    );
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
    // PC-32: the address whose on-chain preferences are being edited.
    const [addressPrefsTarget, setAddressPrefsTarget] = useState(
        /** @type {{ chainId: string, address: string } | null} */ (null),
    );
    const [coSignerAccountId, setCoSignerAccountId] = useState(
        /** @type {string | null} */ (null),
    );
    const [resumeCoinpay, setResumeCoinpay] = useState(
        /** @type {{ chainId: string, address: string, orderMatchActionIndex: string, from?: 'obligations' } | null} */ (null),
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
    const [contactScanPrefill, setContactScanPrefill] = useState(
        /** @type {{ address: string, chainId?: string } | null} */ (null),
    );
    const [activeWalletId, setActiveWalletId] = useState(
        /** @type {string | null} */ (null),
    );
    const [activeAccountId, setActiveAccountId] = useState(
        /** @type {string | null} */ (null),
    );
    // Unread-message count for the active wallet + account, surfaced as a badge
    // on the Messaging nav entries (see useMessagingUnread / msgReadMemory).
    const messagingUnread = useMessagingUnread(activeWalletId, activeAccountId);
    // PC-15: pending-COINPAY scan backing the "Payments due" nav badge.
    const { payableCount: obligationsDue } = useCoinpayObligations(activeWalletId, activeAccountId);
    // §33 command palette: Cmd/Ctrl+K opens a launcher over every action and
    // destination. The global shortcut is inert unless the wallet is unlocked
    // (nothing to navigate to on the Locked / onboarding screens).
    const palette = useCommandPalette({
        enabled: status.state === 'unlocked',
        binding: settings?.keyboard?.bindings?.['command-palette'],
    });
    // Contacts feed the palette's fuzzy search (§33.2). Loaded lazily the
    // first time the palette opens so a locked/never-opened session pays
    // nothing; refreshed on each open so newly-saved contacts appear.
    const [paletteContacts, setPaletteContacts] = useState(/** @type {any[]} */ ([]));
    // entity search: token balances + connected sites join contacts in
    // the palette's searchable surface. Same lazy contract: loaded on each
    // open (each is one host round-trip), and a failed load just leaves that
    // entity family out of the results.
    const [paletteTokenRows, setPaletteTokenRows] = useState(/** @type {any[]} */ ([]));
    const [paletteSites, setPaletteSites] = useState(/** @type {any[]} */ ([]));
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
        messaging.listConnectedSites()
            .then((sites) => { if (!cancelled) setPaletteSites(Array.isArray(sites) ? sites : []); })
            .catch(() => { /* palette still works without sites */ });
        return () => { cancelled = true; };
    }, [palette.open, status.state, activeWalletId, activeAccountId]);
    // §34 keyboard shortcuts: global core set + `g`-leader nav + the `?`
    // help modal. Disabled while locked, while the palette owns the keys, and
    // while the help modal itself is open.
    const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
    // Which Settings section a palette deep-link should open.
    // Cleared when the user backs out of Settings.
    const [settingsInitialSection, setSettingsInitialSection] = useState(
        /** @type {string | null} */ (null),
    );
    useKeyboardShortcuts({
        enabled: status.state === 'unlocked' && !palette.open && !shortcutHelpOpen,
        overrides: settings?.keyboard?.bindings,
        handlers: {
            navigate: setUnlockedView,
            lock: () => { lockWallet().then(refresh).catch(() => refresh()); },
            openHelp: () => setShortcutHelpOpen(true),
        },
    });
    // §24 Cluster Y FOLLOWUP 3: track the resolved active-wallet record
    // so LeftNav / BottomTabBar can label the wallet switcher and so
    // the new 'settings' top-level view can pass `activeWallet` through
    // to the Settings drilldown the same way Home does.
    const [walletList, setWalletList] = useState(/** @type {Array<{ id: string, name: string }>} */ ([]));
    const [dispenserRef, setDispenserRef] = useState(
        /** @type {{ chainId: string, actionIndex: string } | null} */ (null),
    );
    // PC-10 "My Lists": which list ListDetail is showing, and the
    // {chainId, actionIndex, type, items} handed from ListDetail's
    // "Fork & edit" button into ListForkForm.
    const [listRef, setListRef] = useState(
        /** @type {{ chainId: string, actionIndex: string } | null} */ (null),
    );
    const [listForkRef, setListForkRef] = useState(
        /** @type {{ chainId: string, actionIndex: string, type: string, items: string[] } | null} */ (null),
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
    const [governanceRef, setGovernanceRef] = useState(
        /** @type {{ chainId: string, pollIndex?: string | number } | null} */ (null),
    );
    // Betting navigation. `duplicateFeedIndex` carries the cancel-and-recreate
    // path: markets are immutable, so a corrected market is a NEW market
    // pre-filled from the old one.
    const [betRef, setBetRef] = useState(
        /** @type {{ chainId: string, feedIndex?: string | number, duplicateFeedIndex?: string | number } | null} */ (null),
    );
    const [stakingRef, setStakingRef] = useState(
        /** @type {{ kind: 'validator' | 'contract', chainId: string, address: string, contractActionIndex?: string } | null} */ (null),
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
    // The transaction a scan just produced, handed to the Sign panel so
    // the scan delivers its payload rather than only its destination. Mirrors
    // `sendPrefill` above, which is what the send outcome has always done.
    const [scannedPsbt, setScannedPsbt] = useState(/** @type {string | null} */ (null));
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
    // Deep-link prefill for contract EXECUTE (explorer Write-tab links,
    // xchain:{COIN}/execute?...). Mirrors `sendPrefill`; consumed by the
    // 'contract-execute' route and cleared when the user backs out.
    const [executePrefill, setExecutePrefill] = useState(
        /** @type {{ method?: string, paramsText?: string, gasLimit?: string } | null} */ (null),
    );
    // Deep-link view that must survive the unlock cycle. The `?uri=` boot
    // handler routes immediately, but `refresh()` (fired by Locked's
    // onUnlocked) resets the view to 'home', which stomped the route on
    // every locked boot: on web the session never survives a reload, so
    // that was every deep-link open. Re-applied once the session reports
    // unlocked, then cleared.
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
                setStatus({
                    state: 'error',
                    error: err?.message || String(err),
                    // A vault that EXISTS and will not open gets a
                    // screen of its own, and which of the three it is decides
                    // what that screen may offer. Narrowed here because this is
                    // the last point at which the error is still an error.
                    errorKind: coreStorageLib.vaultErrorKind(err),
                }),
            );
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // Apply one incoming wallet URI. Extracted from the mount effect below
    // (S3) because the native shells have no query string to read: an
    // Android intent arrives through the XChainLinks plugin instead, and it
    // must land on THIS code - where the parse, the text hardening and the
    // unlock gating already are - rather than on a second intake path where
    // one of those would eventually be forgotten.
    //
    // Nothing here unlocks anything or submits anything. Every branch ends at
    // a prefilled FORM the user still has to act on, and `pendingUriView` is
    // only applied once the session reports unlocked (see `refresh`).
    const applyUriIntent = useCallback((raw) => {
        try {
            // Pass the registry so coin-code URIs (xchain:TBTC/...) resolve to
            // a chainId; without it intent.chainId is always undefined, which
            // Send tolerated but contract routes cannot.
            //
            // `hardenUriIntentText` neutralizes the free-text
            // fields (memo/tick/method/params) before they ever become
            // prefill state, since this is the first point a `?uri=` query
            // string becomes something the SPA renders. `address` stays
            // whatever the link sent; see the function's own comment for why.
            const intent = coreUri.hardenUriIntentText(
                coreUri.parseXchainUri(raw, { chainRegistry: APP_CHAIN_REGISTRY }),
            );
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
            // Parser surfaces unknown via kind === 'unknown'; nothing else
            // throws here. Defensive try/catch in case future parser
            // changes regress.
        }
    }, []);

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
            applyUriIntent(raw);
        } finally {
            params.delete('uri');
            const next = params.toString();
            const url = window.location.pathname + (next ? `?${next}` : '') + window.location.hash;
            window.history.replaceState(null, '', url);
        }
    }, [applyUriIntent]);

    // S3: the same intents, arriving as Android App Links or
    // `xchain:` intents instead of a query string. A no-op in a browser.
    // Not merged into the effect above: that one runs once at mount and
    // strips a query param, while this one must stay subscribed for as long
    // as the app is open, since a tap can arrive at any moment.
    useEffect(() => subscribeToNativeDeepLinks(applyUriIntent), [applyUriIntent]);

    // No auto-unlock: the password is never persisted to Web API
    // storage, so a page reload always re-locks the wallet and the
    // user re-enters their password (threat model §1, §2.1:
    // https://docs.xchain.io/components/wallet/threat-model).

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
                    // Restore the last selected WALLET if it still exists,
                    // exactly as the account effect below restores the last
                    // account inside it. Snapping to arr[0] unconditionally
                    // meant every reload silently moved a multi-wallet user
                    // back to their first wallet - and a reload always happens,
                    // because the password is never persisted so the app
                    // re-locks. Anything composed afterwards (a send, a receive
                    // address, a mint) was then signed by the wrong wallet.
                    const persisted = readActiveWallet();
                    const chosen = (persisted && arr.some((w) => w.id === persisted))
                        ? persisted
                        : arr[0].id;
                    setActiveWalletId(chosen);
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
        // The account belonging to the PREVIOUS wallet must not survive into a
        // render that already carries the new walletId: every consumer keyed on
        // (walletId, accountId) - balances, addresses, unread counts - would then
        // query a cross-wallet pair, and walletBalances' guard throws on exactly
        // that ("account X does not belong to wallet Y"), blanking Home until the
        // async resolve below lands. Clearing first makes the in-between render
        // wallet-wide, which is merely broader, never invalid.
        setActiveAccountId(null);
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

    // Switch the active wallet and remember it, so a reload returns to it
    // instead of snapping back to the first wallet. Twin of the account
    // handler below.
    const handleSwitchWallet = (id) => {
        setActiveWalletId(id);
        if (id) writeActiveWallet(id);
    };

    // Switch the active account and remember it per wallet, so a reload
    // returns to it instead of snapping back to the lowest-index account.
    const handleSwitchAccount = (id) => {
        setActiveAccountId(id);
        if (activeWalletId && id) writeActiveAccount(activeWalletId, id);
    };

    // Two gates, because the lanes stopped agreeing. Staking,
    // multisig and co-signer accounts are still Bitcoin-exclusive; the §42.2
    // Contracts nav follows the registry, which now advertises DEPLOY on
    // LTC/DOGE as well. One shared hook would have opened all of them.
    const hasBtcAddress = useBtcAddressesPresent(activeWalletId);
    const hasVmAddress = useVmAddressesPresent(activeWalletId);
    const hasGovernanceAddress = useGovernanceAddressesPresent(activeWalletId);
    // The wallet-mode gate on the spend surfaces. Signer mode
    // promises on its own settings screen that Send / Receive are hidden,
    // so the nav rails and the command palette drop both entries.
    const { isSignerMode } = useWalletMode();

    // Accounts of the active wallet, purely so the AppHeader gear
    // can name the active one. The per-wallet effect above owns SELECTION;
    // this owns the label, and keeping them separate stops the header from
    // reaching into that effect's control flow.
    const headerAccounts = useAccountList(activeWalletId);

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
            message: 'This wallet uses the 12-word Counterwallet format. Migrate to BIP39 for wider compatibility with other wallets and stronger security.',
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

    // §26: idle auto-lock. Mounted HERE, above the view switch,
    // so one timer spans the whole unlocked session. It used to live in
    // Home.jsx, and since exactly one route renders at a time, navigating
    // to Send / Receive / History / Settings unmounted Home and cancelled
    // the timer: a wallet parked on those screens never locked. The policy
    // hook owns the timeout, the demo-wallet skip and the extension
    // service-worker backstop report. Do not move it into a route.
    useAutoLockPolicy({
        sessionState: status.state,
        activeWalletId,
        onLocked: refresh,
    });

    switch (status.state) {
        case 'loading':
            return <Loading />;
        case 'error':
            return status.errorKind
                ? <VaultUnavailable kind={status.errorKind} detail={status.error} />
                : <Loading error={status.error} />;
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
            // §20.5: watcher/signer pairing lane. Fresh-install
            // only: it imports the shared recovery phrase itself, so the
            // add-wallet-to-an-open-vault path below doesn't offer it.
            if (onboardingStep === 'pair-partner') {
                return (
                    <PairPartnerWallet
                        onBack={() => setOnboardingStep('welcome')}
                        onPaired={refresh}
                    />
                );
            }
            return (
                <Onboarding
                    onCreate={() => setOnboardingStep('create')}
                    onImport={() => setOnboardingStep('import')}
                    onImportFromFreeWallet={() => setOnboardingStep('import-freewallet')}
                    onPairPartner={() => setOnboardingStep('pair-partner')}
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
                        onMarkets={DEX_SURFACE_ENABLED ? () => setUnlockedView('markets') : undefined}
                        onMarketActivity={DEX_SURFACE_ENABLED ? () => setUnlockedView('market-activity') : undefined}
                        onDispensers={() => { setDispensersBackTo(unlockedView); setUnlockedView('dispensers-list'); }}
                        onTokens={() => setUnlockedView('my-tokens')}
                        onMoreActions={() => setUnlockedView('actions')}
                        onMessaging={() => { setMessagingThread(null); setUnlockedView('messaging'); }}
                        onCrossChain={() => setUnlockedView('cross-chain-templates')}
                        onContacts={() => { setFormReturnView(menuBackTo); setUnlockedView('contacts'); }}
                        onLists={() => setUnlockedView('lists')}
                        onAddresses={() => setUnlockedView('addresses')}
                        onContracts={hasVmAddress ? () => setUnlockedView('contracts-list') : undefined}
                        onStaking={hasBtcAddress ? () => setUnlockedView('staking-dashboard') : undefined}
                        onMultisig={hasBtcAddress ? () => setUnlockedView('multisig-create') : undefined}
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
                        networkFilter={globalNetworkFilter}
                        onNetworkFilterChange={setGlobalNetworkFilter}
                        tokenQuery={globalTokenQuery}
                        onTokenQueryChange={setGlobalTokenQuery}
                        kindFilter={globalKindFilter}
                        onKindFilterChange={setGlobalKindFilter}
                        hideOwnFilter
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
                        networkFilter={globalNetworkFilter}
                        onNetworkFilterChange={setGlobalNetworkFilter}
                        tokenQuery={globalTokenQuery}
                        onTokenQueryChange={setGlobalTokenQuery}
                        kindFilter={globalKindFilter}
                        onKindFilterChange={setGlobalKindFilter}
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
                                setScannedPsbt(outcome.psbtHex || null);
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
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
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
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                    />
                );
            }
            if (unlockedView === 'oracle' && activeWalletId) {
                return (
                    <OracleForm
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
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                    />
                );
            }
            // D-153: NOT gated on tokenDetailRef. This form has two subjects -
            // a token (ISSUE v6) and the SIGNING ADDRESS (ADDRESS v1) - and the
            // address one has nothing to do with tokens: it is the self-imposed
            // spending gate and the recipient-side gate. Requiring a token
            // context to reach the route made that whole half unreachable for
            // anyone who had not issued a token, which is most users. Opened
            // from the palette it arrives with neither, defaults its chain, and
            // offers 'This address' as the only subject.
            if (unlockedView === 'controller-bind' && activeWalletId) {
                return (
                    <ControllerBindForm
                        walletId={activeWalletId}
                        chainId={tokenDetailRef?.chainId}
                        tick={tokenDetailRef?.tick}
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
                            if (dispenserRef.origin === 'explorer') return setUnlockedView('dispenser-explorer');
                            if (dispenserRef.origin === 'manage-token') return setUnlockedView('manage-token');
                            return setUnlockedView('dispensers-list');
                        }}
                    />
                );
            }
            if (unlockedView === 'lists' && activeWalletId) {
                return (
                    <MyLists
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        onOpenList={(cid, actionIndex) => {
                            setListRef({ chainId: cid, actionIndex });
                            setUnlockedView('list-detail');
                        }}
                        onCreateList={() => setUnlockedView('list-create')}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'list-detail' && activeWalletId && listRef) {
                return (
                    <ListDetail
                        chainId={listRef.chainId}
                        actionIndex={listRef.actionIndex}
                        onBack={() => setUnlockedView('lists')}
                        onFork={(ref) => { setListForkRef(ref); setUnlockedView('list-fork'); }}
                    />
                );
            }
            if (unlockedView === 'list-create' && activeWalletId) {
                return (
                    <ListCreateForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('lists')}
                    />
                );
            }
            if (unlockedView === 'list-fork' && activeWalletId && listForkRef) {
                return (
                    <ListForkForm
                        walletId={activeWalletId}
                        listRef={listForkRef}
                        onBack={() => setUnlockedView('list-detail')}
                        onDone={() => { setListForkRef(null); setUnlockedView('lists'); }}
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
                            // Refresh on the way OUT, not on creation: refresh()
                            // resets unlockedView to home, which would abandon
                            // the wizard mid-flow. The later setUnlockedView
                            // below wins, so the intended destination stands.
                            refresh();
                            setMigrateLegacyWalletId(null);
                            setUnlockedView(migrateLegacyWalletId ? 'wallet-details' : 'home');
                        }}
                        onMigrated={() => {
                            // Deliberately does NOT navigate or refresh. The
                            // wizard stays mounted so its remaining stages can
                            // show the new recovery phrase and then the
                            // per-chain sweep rows - the whole point of the
                            // flow. Clearing the id (or calling refresh, which
                            // resets unlockedView to home) dropped the user on
                            // Home the instant the wallet was created, so
                            // neither screen was ever reachable. The
                            // wizard reads the new wallet through messaging,
                            // not App state, so nothing here needs refreshing;
                            // onBack refreshes on the way out.
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
                        pairTrezor={pairTrezorSigner}
                        pairLedger={pairLedgerSigner}
                        onBack={formBack}
                        onPaired={() => setUnlockedView('actions')}
                        onSignerPaired={registerLocalSigner}
                    />
                );
            }
            // The DEX surface: markets, the pair views, orders and
            // swaps. One call instead of nine route blocks, because in a
            // profile that hides `dex` this module is the inert twin and none
            // of those components exist in the bundle. Returns null for any
            // other view, and an unmatched view falls through to Home below.
            {
                const dexRoute = renderDexRoute(unlockedView, {
                    activeWalletId,
                    activeAccountId,
                    marketsAsset,
                    setMarketsAsset,
                    activeMarket,
                    setActiveMarket,
                    setUnlockedView,
                    setDispenserRef,
                    formBack,
                });
                if (dexRoute) return dexRoute;
            }
            if (unlockedView === 'obligations' && activeWalletId) {
                return (
                    <ObligationsView
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        onBack={() => setUnlockedView('home')}
                        onPay={(ref) => {
                            setResumeCoinpay({ ...ref, from: 'obligations' });
                            setUnlockedView('coinpay');
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
                            const from = resumeCoinpay?.from;
                            const cameFromResume = resumeCoinpay !== null;
                            setResumeCoinpay(null);
                            setUnlockedView(from === 'obligations'
                                ? 'obligations'
                                : (cameFromResume ? 'home' : 'actions'));
                        }}
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
                        initialPsbt={scannedPsbt || undefined}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'batch-compose' && activeWalletId) {
                return (
                    <BatchComposerForm
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
                        onEditPreferences={(sel) => {
                            setAddressPrefsTarget(sel);
                            setUnlockedView('address-preferences');
                        }}
                    />
                );
            }
            if (unlockedView === 'address-preferences' && activeWalletId && addressPrefsTarget) {
                return (
                    <AddressPreferencesForm
                        walletId={activeWalletId}
                        chainId={addressPrefsTarget.chainId}
                        address={addressPrefsTarget.address}
                        onBack={() => {
                            setAddressPrefsTarget(null);
                            setUnlockedView('addresses');
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
            if (unlockedView === 'bet-markets' && activeWalletId) {
                return (
                    <BetFeedsList
                        walletId={activeWalletId}
                        onOpenMarket={(chainId, feedIndex) => { setBetRef({ chainId, feedIndex }); setUnlockedView('bet-market-detail'); }}
                        onCreate={(chainId) => { setBetRef({ chainId }); setUnlockedView('bet-create'); }}
                        onMyBets={() => setUnlockedView('my-bets')}
                        onMyMarkets={() => setUnlockedView('bet-oracle-console')}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'bet-market-detail' && activeWalletId && betRef) {
                return (
                    <BetFeedDetail
                        walletId={activeWalletId}
                        chainId={betRef.chainId}
                        feedIndex={betRef.feedIndex}
                        onOpenOracle={(chainId, address) => { setBetRef({ ...betRef, chainId, oracleAddress: address }); setUnlockedView('bet-oracle-record'); }}
                        onBack={() => setUnlockedView('bet-markets')}
                    />
                );
            }
            // Who is running this market, and what their record is. Reached from a
            // market rather than the menu: it is a check you make about one oracle,
            // and it needs the address as its subject.
            if (unlockedView === 'bet-oracle-record' && activeWalletId && betRef?.oracleAddress) {
                return (
                    <OracleRecord
                        chainId={betRef.chainId}
                        address={betRef.oracleAddress}
                        onOpenMarket={(chainId, feedIndex) => { setBetRef({ chainId, feedIndex }); setUnlockedView('bet-market-detail'); }}
                        onBack={() => setUnlockedView(betRef.feedIndex ? 'bet-market-detail' : 'bet-markets')}
                    />
                );
            }
            if (unlockedView === 'bet-create' && activeWalletId && betRef) {
                return (
                    <CreateBetFeedForm
                        walletId={activeWalletId}
                        chainId={betRef.chainId}
                        duplicateFeedIndex={betRef.duplicateFeedIndex}
                        onBack={() => setUnlockedView(betRef.duplicateFeedIndex ? 'bet-oracle-console' : 'bet-markets')}
                        onCreated={() => setUnlockedView('bet-oracle-console')}
                    />
                );
            }
            if (unlockedView === 'my-bets' && activeWalletId) {
                return (
                    <MyBets
                        walletId={activeWalletId}
                        onOpenMarket={(chainId, feedIndex) => { setBetRef({ chainId, feedIndex }); setUnlockedView('bet-market-detail'); }}
                        onBack={() => setUnlockedView('bet-markets')}
                    />
                );
            }
            if (unlockedView === 'bet-oracle-console' && activeWalletId) {
                return (
                    <OracleConsole
                        walletId={activeWalletId}
                        onOpenMarket={(chainId, feedIndex) => { setBetRef({ chainId, feedIndex }); setUnlockedView('bet-market-detail'); }}
                        onDuplicate={(chainId, feedIndex) => { setBetRef({ chainId, duplicateFeedIndex: feedIndex }); setUnlockedView('bet-create'); }}
                        onBack={() => setUnlockedView('bet-markets')}
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
                        scanPrefill={contactScanPrefill}
                        onScanPrefillConsumed={() => setContactScanPrefill(null)}
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
                            const coin = String(tokenDetailRef.chainId || '').split('-')[0] || '';
                            setHistoryInitialQuery('');
                            setHistoryInitialChainCoin(coin);
                            setHistoryReturnTo('token-detail');
                            setUnlockedView('history');
                        }}
                        onBuy={DEX_SURFACE_ENABLED ? () => {
                            setMarketsAsset({
                                chainId: tokenDetailRef.chainId,
                                tick: tokenDetailRef.tick,
                                kind: tokenDetailRef.kind,
                                displayName: tokenDetailRef.displayName,
                            });
                            setUnlockedView('markets');
                        } : undefined}
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
                            onSweep: () => { setSweepCtx(null); setUnlockedView('sweep'); },
                            onLock: () => setUnlockedView('lock'),
                            onUpdateDescription: () => setUnlockedView('description'),
                            onTransferOwnership: () => setUnlockedView('transfer'),
                            onBroadcast: () => setUnlockedView('broadcast'),
                            onPublishOraclePrice: () => setUnlockedView('oracle'),
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
                            // DEX entries: unwired in a profile that
                            // hides the surface, and buildActionEntries drops
                            // an entry with no handler, so they do not render
                            // at all rather than rendering dead.
                            onSwap: DEX_SURFACE_ENABLED ? () => setUnlockedView('swap') : undefined,
                            onCreateOrder: DEX_SURFACE_ENABLED ? () => setUnlockedView('create-order') : undefined,
                            onMyOrders: DEX_SURFACE_ENABLED ? () => setUnlockedView('my-orders') : undefined,
                            onMySwaps: DEX_SURFACE_ENABLED ? () => setUnlockedView('my-swaps') : undefined,
                            onPublishFile: () => setUnlockedView('publish-file'),
                            onLink: () => setUnlockedView('link-form'),
                            onParallel: () => setUnlockedView('parallel-compose'),
                            onBatch: () => setUnlockedView('batch-compose'),
                            onCrossChainSwap: DEX_SURFACE_ENABLED ? () => setUnlockedView('cross-chain-swap') : undefined,
                            onCrossChainTemplates: () => setUnlockedView('cross-chain-templates'),
                            onMultisigCreate: hasBtcAddress ? () => setUnlockedView('multisig-create') : undefined,
                            onMultisigSign: hasBtcAddress ? () => setUnlockedView('multisig-sign') : undefined,
                            onCoSignerAccounts: hasBtcAddress ? () => setUnlockedView('cosigner-accounts') : undefined,
                            onVoteGovernance: hasGovernanceAddress ? () => setUnlockedView('governance-polls') : undefined,
                            onBetting: () => setUnlockedView('bet-markets'),
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
                        onSwitch={handleSwitchWallet}
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
                // Palette deep-links land on a specific section via
                // settingsInitialSection; the key forces a remount when the
                // target changes while Settings is already the active view.
                const settingsSubpage = unlockedView === 'connected-sites'
                    ? 'connected-sites'
                    : settingsInitialSection;
                return (
                    <Settings
                        key={settingsSubpage || 'root'}
                        onBack={() => { setSettingsInitialSection(null); setUnlockedView('home'); }}
                        activeWallet={activeWallet}
                        activeAccount={null}
                        onOpenWalletPicker={() => setUnlockedView('wallet-picker')}
                        onOpenAccountPicker={
                            activeWalletId ? () => setUnlockedView('account-picker') : undefined
                        }
                        initialSubpageId={settingsSubpage}
                        onNavigateToMint={handleFaucetMint}
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
                        mode="add"
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
                    {/* `demoBannerInHeader`: this shell mounts
                        DemoBanner in the layout header, which already renders
                        above Home, so Home must not mount a second one. */}
                    <Home
                        activeWalletId={activeWalletId}
                        demoBannerInHeader
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
                        onSwap={DEX_SURFACE_ENABLED && activeWalletId ? () => setUnlockedView('swap') : undefined}
                        onExchange={DEX_SURFACE_ENABLED && activeWalletId ? () => {
                            setMarketsAsset({ chainId: 'bitcoin-mainnet', tick: 'BTC', kind: 'native' });
                            setUnlockedView('markets');
                        } : undefined}
                        onCreateToken={activeWalletId ? () => setUnlockedView('wizard') : undefined}
                        onActions={activeWalletId ? () => setUnlockedView('actions') : undefined}
                        onMarkets={DEX_SURFACE_ENABLED && activeWalletId ? () => setUnlockedView('markets') : undefined}
                        onMessaging={activeWalletId ? () => { setMessagingThread(null); setUnlockedView('messaging'); } : undefined}
                        onContracts={activeWalletId && hasVmAddress ? () => setUnlockedView('contracts-list') : undefined}
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
            const handleOpenAccountPicker = () => setUnlockedView('account-picker');
            const handleOpenSettings = () => setUnlockedView('settings');
            const activeWalletName =
                walletList.find((w) => w.id === activeWalletId)?.name || undefined;
            const activeWalletRow =
                walletList.find((w) => w.id === activeWalletId) || null;
            // gear status dot: "non-default" means the user has moved
            // off the first entry in the list, which is the only thing the
            // dot is trying to say. Lists are ordered (wallets as stored,
            // accounts by hardened index), so index 0 is the default.
            const headerAccountRow =
                headerAccounts.find((a) => a.id === activeAccountId) || null;
            const headerWalletNonDefault = Boolean(
                activeWalletId && walletList.length > 1 && walletList[0]?.id !== activeWalletId,
            );
            const headerAccountNonDefault = Boolean(
                activeAccountId && headerAccounts.length > 1 && headerAccounts[0]?.id !== activeAccountId,
            );
            // §33: assemble the palette command list from the shared catalogue
            // (navigation + authoring + signing + wallet verbs, gated exactly
            // like the ActionsMenu) plus the lazily-loaded contacts. Every
            // `run` closes over this shell's setUnlockedView, so selecting a
            // command drives the same view state the nav does.
            const paletteCtx = {
                navigate: setUnlockedView,
                lock: handleNavLock,
                refresh,
                scan: () => setGlobalScannerOpen(true),
                switchWallet: handleOpenWalletPicker,
                openHelp: () => setShortcutHelpOpen(true),
                hasBtcAddress,
                hasGovernanceAddress,
                // Compile-time, not a preference: false only in a build that
                // dropped the DEX surface entirely, where a palette
                // command pointing at `markets` would navigate to a view that
                // no longer exists.
                hasDexSurface: DEX_SURFACE_ENABLED,
                isSignerMode,
            };
            // entity handlers: tokens open TokenDetail with the full
            // ref the row already carries; sites land on the Connected Sites
            // drilldown; settings sections deep-link via
            // settingsInitialSection; help topics reuse both.
            const openSettingsSection = (sectionId) => {
                if (sectionId === 'connected-sites') { setUnlockedView('connected-sites'); return; }
                setSettingsInitialSection(sectionId);
                setUnlockedView('settings');
            };
            const paletteEntityCtx = {
                openToken: (tok) => { setTokenDetailRef(tok); setUnlockedView('token-detail'); },
                openConnectedSites: () => setUnlockedView('connected-sites'),
                openSettings: openSettingsSection,
                openHelp: () => setShortcutHelpOpen(true),
            };
            const paletteCommands = [
                ...buildCommands(paletteCtx),
                ...balancesToCommands(paletteTokenRows, paletteEntityCtx),
                ...contactsToCommands(paletteContacts, { navigate: setUnlockedView }),
                ...sitesToCommands(paletteSites, paletteEntityCtx),
                ...settingsSectionsToCommands(paletteEntityCtx),
                ...helpToCommands(paletteEntityCtx),
            ];
            // §33.3: free-form intents like "send 100 MYTOKEN" open Send
            // prefilled. Send falls back to the first chain when the prefill
            // carries no chainId, so amount + tick alone is enough. A
            // txid/date-shaped query offers "search history".
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
            return (
                // Both nav surfaces are handed in unconditionally.
                // FullLayoutWithNav measures its own width and mounts exactly
                // one of them (sidebar at >= 640px, bottom tab bar below), so
                // the web shell no longer carries a width threshold of its own
                // that used to disagree with the CSS and leave 640-899px with
                // no navigation at all.
                <FullLayoutWithNav
                    nav={
                        <LeftNav
                            currentView={unlockedView}
                            onSelect={(view) => setUnlockedView(view)}
                            onLock={handleNavLock}
                            onOpenWalletPicker={handleOpenWalletPicker}
                            onOpenSettings={handleOpenSettings}
                            walletName={activeWalletName}
                            hasBtcAddress={hasBtcAddress}
                            hasDexSurface={DEX_SURFACE_ENABLED}
                            isSignerMode={isSignerMode}
                            badges={{ messaging: messagingUnread, obligations: obligationsDue }}
                        />
                    }
                    bottomBar={
                        <BottomTabBar
                            currentView={unlockedView}
                            onSelect={(view) => setUnlockedView(view)}
                            onLock={handleNavLock}
                            onOpenWalletPicker={handleOpenWalletPicker}
                            onOpenSettings={handleOpenSettings}
                            hasBtcAddress={hasBtcAddress}
                            hasDexSurface={DEX_SURFACE_ENABLED}
                            isSignerMode={isSignerMode}
                            badges={{ messaging: messagingUnread, obligations: obligationsDue }}
                        />
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
                                    onCommandPalette={palette.openPalette}
                                    onManageAddresses={activeWalletId ? () => setUnlockedView('addresses') : undefined}
                                    onViewAddress={activeWalletId ? () => { setReceivePrefill(null); setUnlockedView('receive'); } : undefined}
                                    onLock={handleNavLock}
                                    activeWallet={activeWalletRow}
                                    activeAccount={headerAccountRow}
                                    onOpenWalletPicker={handleOpenWalletPicker}
                                    onOpenAccountPicker={handleOpenAccountPicker}
                                    walletNonDefault={headerWalletNonDefault}
                                    accountNonDefault={headerAccountNonDefault}
                                    chainRegistry={APP_CHAIN_REGISTRY}
                                    coinFamilies={APP_COIN_FAMILIES}
                                    networkFilter={globalNetworkFilter}
                                    onNetworkFilterChange={setGlobalNetworkFilter}
                                    // Cross-site navigation for the *.xchain.io family.
                                    // Web only: the extension popup and desktop app do
                                    // not pass this, so they render no switcher.
                                    platformCurrent="wallet"
                                />
                                {/* Cluster J FOLLOWUP 2: DemoBanner persists across every
                                    unlocked view via the shared layout header slot, not
                                    just Home. */}
                                <DemoBanner activeWalletId={activeWalletId} onExited={refresh} />
                                <QueuedBroadcastBanner walletId={activeWalletId} />
                                {isDemoWallet(activeWalletId) ? null : <ReachabilityBanner />}
                                <UpdateNoticeBanner />
                            </>
                        ) : null
                    }
                >
                    {routeNode}
                    {messageSentNotice ? (
                        <NoticeModal
                            title="Message sent"
                            onClose={() => setMessageSentNotice(false)}
                        />
                    ) : null}
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
                                        if (unlockedView === 'contacts') {
                                            setContactScanPrefill({
                                                address: outcome.address,
                                                chainId: outcome.chainId,
                                            });
                                        } else {
                                            setSendPrefill({
                                                address: outcome.address,
                                                amount: outcome.amount,
                                                tick: outcome.tick,
                                                chainId: outcome.chainId,
                                                memo: outcome.memo,
                                            });
                                            setUnlockedView('send');
                                        }
                                    } else if (outcome.kind === 'receive') {
                                        setUnlockedView('receive');
                                    } else if (outcome.kind === 'psbt') {
                                        setScannedPsbt(outcome.psbtHex || null);
                                        setUnlockedView('sign-psbt');
                                    }
                                }}
                            />
                        </div>
                    ) : null}
                    <CommandPalette
                        open={palette.open}
                        onClose={palette.closePalette}
                        commands={paletteCommands}
                        parseQuery={paletteParseQuery}
                    />
                    <ShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} overrides={settings?.keyboard?.bindings} />
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
    onIssue, onMint, onDestroy, onSweep,
    onLock, onUpdateDescription, onTransferOwnership,
    onBroadcast,
    onPublishOraclePrice,
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
    onMySwaps,
    onPublishFile,
    onLink,
    onParallel,
    onBatch,
    onCrossChainSwap,
    onCrossChainTemplates,
    onMultisigCreate,
    onMultisigSign,
    onCoSignerAccounts,
    onVoteGovernance,
    onBetting,
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
            id: 'oracle',
            label: 'My oracle',
            description: 'Publish what your token is worth in a currency so dispensers can sell at that rate.',
            onSelect: onPublishOraclePrice,
        },
        {
            id: 'dispenser',
            label: 'Create dispenser',
            description: 'Open a vending machine that sells your token for coin or fiat.',
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
            label: 'Pay for a matched order',
            description: 'Finish a matched order by paying the coin side.',
            onSelect: onPayCoinpay,
        },
        {
            id: 'swap',
            label: 'Swap tokens',
            description: 'All-or-nothing token-pair swap (both sides complete together or neither does): no native coin, no follow-up payment needed.',
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
            id: 'my-swaps',
            label: 'My swaps',
            description: 'View, edit, and cancel your open atomic swaps across every pair.',
            onSelect: onMySwaps,
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
            description: 'Anchor two existing actions across chains. Both sides thread together in History.',
            onSelect: onLink,
        },
        {
            id: 'parallel',
            label: 'Parallel cross-chain actions',
            description: 'Compose multiple independent actions across any chains and sign them sequentially. Not all-or-nothing: if one side fails, the sides that already went through are not undone.',
            onSelect: onParallel,
        },
        {
            id: 'batch',
            label: 'Batch',
            description: 'Bundle several actions on one chain into a single transaction. Not all-or-nothing: each action confirms or fails on its own. Issue one new token plus as many of its subtokens as you like, mint each token at most once, and add at most one contract deploy, up to 250 actions; no nested batches.',
            onSelect: onBatch,
        },
        {
            id: 'cross-chain-swap',
            label: 'Cross-chain swap',
            description: 'Open a swap that gives a token on one chain and gets a token on another. Both sides settle together (all-or-nothing) when a counterparty fills the offer.',
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
            id: 'governance-polls',
            label: 'Governance',
            description: 'Create and vote on token-weighted polls, and delegate your voting weight.',
            onSelect: onVoteGovernance,
        },
        {
            id: 'bet-markets',
            label: 'Betting',
            description: 'Browse betting markets and place a bet, track your bets, or run a market of your own as its oracle.',
            onSelect: onBetting,
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
            description: 'Power-user form for submitting any supported on-chain action type.',
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
            description: 'Add a Trezor or Ledger to this wallet.',
            onSelect: onPairSigner,
        },
    // An entry with no handler is an entry this build does not have: a surface
    // compiled out or a capability this wallet lacks (the Bitcoin-only
    // multisig rows). Drop it rather than rendering a button that does nothing
    // when tapped - and, for a store build, rather than showing a reviewer a
    // greyed-out DEX, which raises the same question a working one would.
    ].filter((e) => typeof e.onSelect === 'function');
}
