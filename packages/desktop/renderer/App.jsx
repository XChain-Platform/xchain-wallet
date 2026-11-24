// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Desktop renderer App: same shape as packages/extension/src/popup/App.jsx
// and packages/web/src/App.jsx, wired against desktop-specific
// messaging + HW factories.
//
// §9.3.2: the renderer is a view only. Every state-affecting operation
// flows through `messaging.*` → preload `sendMessage` → main
// MessageHost. No keys live here.
//
// HW pairing (§40.12, Step 18): `pairLedgerSigner` uses Chromium's
// WebHID (via `@ledgerhq/hw-transport-webhid`), and `pairTrezorSigner`
// uses Trezor Connect loaded at runtime from Trezor's hosted global
// build (not the T-RSL `@trezor/connect-web` npm package; see
// renderer/signerFactories/trezorFactory.js). The Ledger lib is pure JS
// (no native node-HID / node-usb), so the desktop factories are thin
// bindings around the shared core `makeTrezorFactory` /
// `makeLedgerFactory` builders, same as web. (The MV3 extension can't
// load remote code, so it ships Ledger only.)
//
// Main process (`main/permissions.js`) must wire WebHID permission
// handlers onto `session.defaultSession`. Without them, Electron
// returns an empty device list under `contextIsolation: true`.

import { Fragment, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RouteErrorBoundary } from '@xchain-wallet/core/shared/components/RouteErrorBoundary.jsx';
import { ShellRouteOutlet } from '@xchain-wallet/core/shared/components/ShellRouteOutlet.jsx';
import {
    applySendAssetPick,
    beginSendAssetSwitch,
    cancelSendAssetSwitch,
} from '@xchain-wallet/core/shared/utils/sendAssetSwitch.js';
import { useAutoLockPolicy } from '@xchain-wallet/core/shared/hooks/useAutoLockPolicy.js';
import { useLastView } from '@xchain-wallet/core/shared/hooks/useLastView.js';
import { useDocumentTitle } from '@xchain-wallet/core/shared/hooks/useDocumentTitle.js';
import { useScannedPsbt } from '@xchain-wallet/core/shared/hooks/useScannedPsbt.js';
import { useSettings } from '@xchain-wallet/core/shared/hooks/useSettings.js';
import { useActiveWalletModeSource, useWalletMode } from '@xchain-wallet/core/shared/hooks/useWalletMode.js';
import { ShellAppHeader } from '@xchain-wallet/core/shared/components/ShellAppHeader.jsx';
import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';
import { Loading } from '@xchain-wallet/core/shared/routes/Loading.jsx';
import { VaultUnavailable } from '@xchain-wallet/core/shared/routes/VaultUnavailable.jsx';
import { RouteNotFound } from '@xchain-wallet/core/shared/routes/RouteNotFound.jsx';
import { NewerWalletNeeded, SiteRequestApproval } from '@xchain-wallet/core/shared/routes/NewerWalletNeeded.jsx';
import { storage as coreStorageLib } from '@xchain-wallet/core';
import { t } from '../../core/src/i18n/index.js';
import { Onboarding } from '@xchain-wallet/core/shared/routes/Onboarding.jsx';
import { CreateWallet } from '@xchain-wallet/core/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '@xchain-wallet/core/shared/routes/ImportWallet.jsx';
import { PairPartnerWallet } from '@xchain-wallet/core/shared/routes/PairPartnerWallet.jsx';
import { AddAccountForm } from '@xchain-wallet/core/shared/routes/AddAccountForm.jsx';
import { WalletPicker } from '@xchain-wallet/core/shared/routes/WalletPicker.jsx';
import { AccountPicker } from '@xchain-wallet/core/shared/routes/AccountPicker.jsx';
import { AccountDetails } from '@xchain-wallet/core/shared/routes/AccountDetails.jsx';
import { ViewRecoveryPhrase } from '@xchain-wallet/core/shared/routes/ViewRecoveryPhrase.jsx';
import { ExportWalletBackup } from '@xchain-wallet/core/shared/routes/ExportWalletBackup.jsx';
import { RemoveWallet } from '@xchain-wallet/core/shared/routes/RemoveWallet.jsx';
import { WalletDetails } from '@xchain-wallet/core/shared/routes/WalletDetails.jsx';
import { RenameWalletForm } from '@xchain-wallet/core/shared/routes/RenameWalletForm.jsx';
import { RenameAccountForm } from '@xchain-wallet/core/shared/routes/RenameAccountForm.jsx';
import { clearActiveAccount, writeActiveAccount } from '@xchain-wallet/core/shared/utils/activeAccountMemory.js';
import { reconcileActiveAccount } from '@xchain-wallet/core/shared/utils/activeAccountScope.js';
import { clearActiveWallet, readActiveWallet, writeActiveWallet } from '@xchain-wallet/core/shared/utils/activeWalletMemory.js';
import { isConfirmActive } from '@xchain-wallet/core/shared/hooks/useConfirmAction.js';
import { useHeldWalletSwitch } from '@xchain-wallet/core/shared/hooks/useHeldWalletSwitch.js';
import { takePostDemoIntent } from '@xchain-wallet/core/shared/utils/demoGraduation.js';
import { historyScopeForAsset } from '@xchain-wallet/core/shared/utils/historyEntryScope.js';
import {
    defaultDexAssetForNetwork, defaultDispenserAssetForNetwork,
    syncDexAssetToNetwork, syncDispenserAssetToNetwork,
} from '@xchain-wallet/core/shared/chainSelection.js';
import { lockImmediately } from '@xchain-wallet/core/shared/utils/lockAction.js';
import { clearSensitiveCopy } from '@xchain-wallet/core/shared/clipboard.js';
import { CoinpayObligationsProvider } from '@xchain-wallet/core/shared/hooks/useCoinpayObligations.js';
import { Locked } from '@xchain-wallet/core/shared/routes/Locked.jsx';
import { Home } from '@xchain-wallet/core/shared/routes/Home.jsx';
import { Settings } from '@xchain-wallet/core/shared/routes/Settings.jsx';
import { Send } from '@xchain-wallet/core/shared/routes/Send.jsx';
import { SendPicker } from '@xchain-wallet/core/shared/routes/SendPicker.jsx';
import { ReceivePicker } from '@xchain-wallet/core/shared/routes/ReceivePicker.jsx';
import { Receive } from '@xchain-wallet/core/shared/routes/Receive.jsx';
import { ScanRoute } from '@xchain-wallet/core/shared/routes/ScanRoute.jsx';
import { ActionsMenu } from '@xchain-wallet/core/shared/routes/ActionsMenu.jsx';
import { buildActionEntries } from '@xchain-wallet/core/shared/actionEntries.js';
import { MyTokens } from '@xchain-wallet/core/shared/routes/MyTokens.jsx';
import { TokenDetail } from '@xchain-wallet/core/shared/routes/TokenDetail.jsx';
import { IssueTokenForm } from '@xchain-wallet/core/shared/routes/IssueTokenForm.jsx';
import { MintForm } from '@xchain-wallet/core/shared/routes/MintForm.jsx';
import { DestroyForm } from '@xchain-wallet/core/shared/routes/DestroyForm.jsx';
import { TokenAdminForm } from '@xchain-wallet/core/shared/routes/TokenAdminForm.jsx';
import { BridgeMoveForm } from '@xchain-wallet/core/shared/routes/BridgeMoveForm.jsx';
import { CallbackForm } from '@xchain-wallet/core/shared/routes/CallbackForm.jsx';
import { SleepForm } from '@xchain-wallet/core/shared/routes/SleepForm.jsx';
import { BroadcastForm } from '@xchain-wallet/core/shared/routes/BroadcastForm.jsx';
import { DispenserForm } from '@xchain-wallet/core/shared/routes/DispenserForm.jsx';
import { DispensersList } from '@xchain-wallet/core/shared/routes/DispensersList.jsx';
import { MyLists } from '@xchain-wallet/core/shared/routes/MyLists.jsx';
import { ListDetail } from '@xchain-wallet/core/shared/routes/ListDetail.jsx';
import { ListLookForm } from '@xchain-wallet/core/shared/routes/ListLookForm.jsx';
import { ListCreateForm } from '@xchain-wallet/core/shared/routes/ListCreateForm.jsx';
import { DispenserDetail } from '@xchain-wallet/core/shared/routes/DispenserDetail.jsx';
import { DispenserExplorer } from '@xchain-wallet/core/shared/routes/DispenserExplorer.jsx';
import { DividendForm } from '@xchain-wallet/core/shared/routes/DividendForm.jsx';
import { AirdropForm } from '@xchain-wallet/core/shared/routes/AirdropForm.jsx';
import { AdvancedActionsForm } from '@xchain-wallet/core/shared/routes/AdvancedActionsForm.jsx';
import { MigrateToBip39 } from '@xchain-wallet/core/shared/routes/MigrateToBip39.jsx';
import { SweepForm } from '@xchain-wallet/core/shared/routes/SweepForm.jsx';
import { CoinpayForm } from '@xchain-wallet/core/shared/routes/CoinpayForm.jsx';
import { ObligationsView } from '@xchain-wallet/core/shared/routes/ObligationsView.jsx';
import { SellOwnershipForm } from '@xchain-wallet/core/shared/routes/SellOwnershipForm.jsx';
import { MessagingInbox } from '@xchain-wallet/core/shared/routes/MessagingInbox.jsx';
import { NoticeModal } from '@xchain-wallet/core/shared/components/NoticeModal.jsx';
import { ComposeMessage } from '@xchain-wallet/core/shared/routes/ComposeMessage.jsx';
import { ContactsList } from '@xchain-wallet/core/shared/routes/ContactsList.jsx';
import { StakingList } from '@xchain-wallet/core/shared/routes/StakingList.jsx';
import { StakeDetail } from '@xchain-wallet/core/shared/routes/StakeDetail.jsx';
import { StakeNew } from '@xchain-wallet/core/shared/routes/StakeNew.jsx';
import { History } from '@xchain-wallet/core/shared/routes/History.jsx';
import { ActionDetail } from '@xchain-wallet/core/shared/routes/ActionDetail.jsx';
import { LinkForm } from '@xchain-wallet/core/shared/routes/LinkForm.jsx';
import { AttachContentForm } from '@xchain-wallet/core/shared/routes/AttachContentForm.jsx';
import { GatedPublishForm } from '@xchain-wallet/core/shared/routes/GatedPublishForm.jsx';
import { PublishFileForm } from '@xchain-wallet/core/shared/routes/PublishFileForm.jsx';
import { ProjectRosterForm } from '@xchain-wallet/core/shared/routes/ProjectRosterForm.jsx';
import { ParallelComposer } from '@xchain-wallet/core/shared/routes/ParallelComposer.jsx';
import { BatchComposerForm } from '@xchain-wallet/core/shared/routes/BatchComposerForm.jsx';
import { AddressList } from '@xchain-wallet/core/shared/routes/AddressList.jsx';
import { ViewPrivateKey } from '@xchain-wallet/core/shared/routes/ViewPrivateKey.jsx';
import { KeyQR } from '@xchain-wallet/core/shared/components/KeyQR.jsx';
import { AddressPreferencesForm } from '@xchain-wallet/core/shared/routes/AddressPreferencesForm.jsx';
import { SignMessageForm } from '@xchain-wallet/core/shared/routes/SignMessageForm.jsx';
import { VerifySignatureForm } from '@xchain-wallet/core/shared/routes/VerifySignatureForm.jsx';
import { PsbtSignForm } from '@xchain-wallet/core/shared/routes/PsbtSignForm.jsx';
import { useBtcAddressesPresent } from '@xchain-wallet/core/shared/hooks/useBtcAddressesPresent.js';
import { useVmAddressesPresent } from '@xchain-wallet/core/shared/hooks/useVmAddressesPresent.js';
import { useAccountList } from '@xchain-wallet/core/shared/hooks/useAccountList.js';
import { useGovernanceAddressesPresent } from '@xchain-wallet/core/shared/hooks/useGovernanceAddressesPresent.js';
import { useMessagingUnread } from '@xchain-wallet/core/shared/hooks/useMessagingUnread.js';
import { buildWalletAlerts } from '@xchain-wallet/core/shared/walletAlerts.js';
import { navItemKey, useNavHistory, WALLET_SWITCH_KEEPS } from '@xchain-wallet/core/ui/navHistory.js';
import * as messaging from './messaging.js';
import { getSessionStatus, listWallets, lockWallet, listAccounts } from './messaging.js';
import { LeftNav, FullLayoutWithNav } from '@xchain-wallet/core/shared/components/LeftNav.jsx';
import { CommandPalette } from '@xchain-wallet/core/shared/commandPalette/CommandPalette.jsx';
import { useCommandPalette } from '@xchain-wallet/core/shared/commandPalette/useCommandPalette.js';
import { createRootViewOpener } from '@xchain-wallet/core/shared/rootViewOpener.js';
import { buildCommands, contactsToCommands, parseFreeformCommands, balancesToCommands, sitesToCommands, settingsSectionsToCommands, helpToCommands, hiddenSettingsSectionIds } from '@xchain-wallet/core/shared/commandPalette/commandRegistry.js';
import { buildBalanceRows } from '@xchain-wallet/core/shared/components/BalanceList.jsx';
import { loadDisplayBalances } from '@xchain-wallet/core/shared/utils/displayBalances.js';
import { useKeyboardShortcuts } from '@xchain-wallet/core/shared/keyboard/useKeyboardShortcuts.js';
import { ShortcutHelp } from '@xchain-wallet/core/shared/keyboard/ShortcutHelp.jsx';
import { BottomTabBar } from '@xchain-wallet/core/shared/components/BottomTabBar.jsx';
import { useWaitingLinkDropped } from '@xchain-wallet/core/shared/components/WaitingLinkDroppedNotice.jsx';
import { QueuedBroadcastBanner } from '@xchain-wallet/core/shared/components/QueuedBroadcastBanner.jsx';
import { LockedSendOutcomeNotice } from '@xchain-wallet/core/shared/components/LockedSendOutcomeNotice.jsx';
import { EraseScheduledNotice } from '@xchain-wallet/core/shared/components/EraseScheduledNotice.jsx';
import { ReachabilityBanner } from '@xchain-wallet/core/shared/components/ReachabilityBanner.jsx';
import { ToastHost, useClearToastsOnLock, useToast } from '@xchain-wallet/core/shared/components/ToastHost.jsx';
import { useDemoAutoWipe } from '@xchain-wallet/core/shared/hooks/useDemoAutoWipe.js';
import {
    registerHardwareRecord,
    registerSigner as registerLocalSigner,
} from './signerBridge.js';
import {
    trackHardwareFactories, useHardwareReconnect, useHardwareSessionReset,
} from '@xchain-wallet/core/shared/hooks/useHardwareSessionReset.js';
import { openHardwareSigner } from '@xchain-wallet/core/signers/hardwareReconnect.js';
import { userFacingMessage } from '@xchain-wallet/core/shared/utils/userFacingMessage.js';
import { registry as registryLib } from '@xchain-wallet/core';
import { isDemoWallet } from '@xchain-wallet/core/flows';
import { useDeepLinks } from './deepLinkRoute.js';
import { withResolvedIssuer } from '@xchain-wallet/core/shared/utils/tokenDetailIssuer.js';

const lazyRoute = (load, name) => lazy(() => load().then((module) => ({ default: module[name] })));

const TokenWizard = lazyRoute(() => import('@xchain-wallet/core/shared/routes/TokenWizard.jsx'), 'TokenWizard');
const OracleForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/OracleForm.jsx'), 'OracleForm');
const MarketActivity = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MarketActivity.jsx'), 'MarketActivity');
const MarketsList = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MarketsList.jsx'), 'MarketsList');
const MarketView = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MarketView.jsx'), 'MarketView');
// The Trade page, routed as its own page as the web shell does.
const MarketTrade = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MarketTrade.jsx'), 'MarketTrade');
const CreateOrderForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CreateOrderForm.jsx'), 'CreateOrderForm');
const MyOrdersView = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MyOrdersView.jsx'), 'MyOrdersView');
const OrderDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/OrderDetail.jsx'), 'OrderDetail');
const EditOrderForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/EditOrderForm.jsx'), 'EditOrderForm');
const CancelOrderForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CancelOrderForm.jsx'), 'CancelOrderForm');
const MySwapsView = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MySwapsView.jsx'), 'MySwapsView');
const SwapDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/SwapDetail.jsx'), 'SwapDetail');
const EditSwapForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/EditSwapForm.jsx'), 'EditSwapForm');
const CancelSwapForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CancelSwapForm.jsx'), 'CancelSwapForm');
const SwapForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/SwapForm.jsx'), 'SwapForm');
const CrossChainSwapForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CrossChainSwapForm.jsx'), 'CrossChainSwapForm');
const CrossChainOrderForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CrossChainOrderForm.jsx'), 'CrossChainOrderForm');
const ContractsList = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ContractsList.jsx'), 'ContractsList');
const ContractDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ContractDetail.jsx'), 'ContractDetail');
// Every staking write route (contract and validator) renders the one Staking form.
const StakingForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/StakingForm.jsx'), 'StakingForm');
const DeployContractForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/DeployContractForm.jsx'), 'DeployContractForm');
const ExecuteContractForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ExecuteContractForm.jsx'), 'ExecuteContractForm');
const ContractFundsForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ContractFundsForm.jsx'), 'ContractFundsForm');
const ControllerBindForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ControllerBindForm.jsx'), 'ControllerBindForm');
const UnbindForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/UnbindForm.jsx'), 'UnbindForm');
const GovernancePolls = lazyRoute(() => import('@xchain-wallet/core/shared/routes/GovernancePolls.jsx'), 'GovernancePolls');
const BetFeedsList = lazyRoute(() => import('@xchain-wallet/core/shared/routes/BetFeedsList.jsx'), 'BetFeedsList');
const BetFeedDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/BetFeedDetail.jsx'), 'BetFeedDetail');
const CreateBetFeedForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CreateBetFeedForm.jsx'), 'CreateBetFeedForm');
// My bets and My markets are Bet Markets tabs (BetFeedsList draws the oracle
// console itself); every link to them opens Bet Markets on that tab.
const BET_AREA_VIEWS = new Set(['bet-markets', 'bet-market-detail', 'bet-oracle-record', 'bet-create']);
const OracleRecord = lazyRoute(() => import('@xchain-wallet/core/shared/routes/OracleRecord.jsx'), 'OracleRecord');
const CreatePollForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CreatePollForm.jsx'), 'CreatePollForm');
const PollDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/PollDetail.jsx'), 'PollDetail');
const DelegateVoteForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/DelegateVoteForm.jsx'), 'DelegateVoteForm');
const MyDelegations = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MyDelegations.jsx'), 'MyDelegations');
const MultisigCreate = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MultisigCreate.jsx'), 'MultisigCreate');
const MultisigCosignerShare = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MultisigCosignerShare.jsx'), 'MultisigCosignerShare');
const MultisigSigningSession = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MultisigSigningSession.jsx'), 'MultisigSigningSession');
const CoSignerAccountList = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CoSignerAccountList.jsx'), 'CoSignerAccountList');
const CoSignerProvision = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CoSignerProvision.jsx'), 'CoSignerProvision');
const CoSignerAccountDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CoSignerAccountDetail.jsx'), 'CoSignerAccountDetail');
const PairSignerForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/PairSignerForm.jsx'), 'PairSignerForm');
const HardwareFirstRun = lazyRoute(() => import('@xchain-wallet/core/shared/components/HardwareFirstRun.jsx'), 'HardwareFirstRun');
const HardwareSignPage = lazyRoute(() => import('@xchain-wallet/core/shared/components/HardwareSignPage.jsx'), 'HardwareSignPage');
const AlertsRoute = lazyRoute(() => import('@xchain-wallet/core/shared/routes/AlertsRoute.jsx'), 'AlertsRoute');

// Loaded on first pairing; a lock or wallet switch resets the loaded ones.
const hardwareFactories = trackHardwareFactories({
    trezor: () => import('./signerFactories/trezorFactory.js'),
    ledger: () => import('./signerFactories/ledgerFactory.js'),
});
const pairTrezorSigner = (...args) => hardwareFactories.load('trezor')
    .then((module) => module.pairTrezorSigner(...args));
const pairLedgerSigner = (...args) => hardwareFactories.load('ledger')
    .then((module) => module.pairLedgerSigner(...args));
const resetHardwareSessions = () => hardwareFactories.reset();
// The same factories reopen a paired device after a lock or reload, and decide
// whether Welcome offers Connect Hardware Wallet at all.
const HARDWARE_PAIR_FACTORIES = Object.freeze({ trezor: pairTrezorSigner, ledger: pairLedgerSigner });

// Same default chain registry the web shell uses: buildBalanceRows needs it
// to resolve divisibility / display names for the palette's token rows.
const APP_CHAIN_REGISTRY = registryLib.defaultRegistry();

// Screens that list wallet or account rows read them when they mount. A rename
// or an added account in a sibling window remounts only these, so a form open
// here (a payment being composed or signed) keeps what it holds.
const RECORD_LIST_VIEWS = new Set([
    'wallet-picker', 'wallet-details', 'account-picker', 'account-details', 'settings', 'connected-sites', 'addresses',
]);
export const SESSION_STATUS_TIMEOUT_MS = 10_000;

function getSessionStatusWithTimeout() {
    let timer;
    return Promise.race([
        Promise.resolve().then(() => getSessionStatus()),
        new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error('The desktop service did not respond.')),
                SESSION_STATUS_TIMEOUT_MS,
            );
        }),
    ]).finally(() => clearTimeout(timer));
}

export function App() {
    return (
        <MessagingProvider shell="desktop" messaging={messaging}>
            <ToastHost>
                <RouteErrorBoundary>
                    <AppInner />
                </RouteErrorBoundary>
            </ToastHost>
        </MessagingProvider>
    );
}

function AppInner() {
    const { showToast } = useToast();
    const [status, setStatus] = useState(/** @type {any} */ ({ state: 'loading' }));
    const [lockReason, setLockReason] = useState(
        /** @type {'auto-lock-unsaved' | null} */ (null),
    );
    useClearToastsOnLock(status.state);
    const statusRequest = useRef(0);
    // Keyboard-binding overrides for the palette + shortcuts live in
    // settings; null-safe reads below tolerate the pre-load window.
    const { settings } = useSettings();
    const activeNetwork = settings ? (settings.activeNetwork || 'mainnet') : undefined;
    // A demo graduation wipes the vault and reloads, so the lane
    // the user picked (create / import / FreeWallet) is handed across the
    // reload here. One-shot read: it never survives to hijack a later visit.
    const [onboardingStep, setOnboardingStep] = useState(
        /** @returns {'welcome' | 'create' | 'import' | 'import-freewallet' | 'pair-partner' | 'pair-signer'} */
        () => takePostDemoIntent() || 'welcome',
    );
    // One navigation history: opening a page pushes it, Back pops it. Each
    // entry keeps the item its page showed (see navContext below), so Back
    // reopens the same token, account or list the user left.
    const navContext = useRef({ capture: () => null, restore: () => {} });
    const nav = useNavHistory({
        initialView: /** @type {'home' | 'send' | 'receive' | 'wizard' | 'actions' | 'my-tokens' | 'manage-token' | 'market-activity' | 'issue' | 'mint' | 'destroy' | 'sweep' | 'lock' | 'mint-settings' | 'callback-settings' | 'execute-callback' | 'access-lists' | 'bridge-settings' | 'bridge-move' | 'pause-token' | 'lock-address' | 'description' | 'transfer' | 'broadcast' | 'oracle' | 'dispenser' | 'dispensers-list' | 'dispensers-picker' | 'dispenser-detail' | 'dispenser-explorer' | 'dividend' | 'airdrop' | 'advanced' | 'migrate-bip39' | 'pair-signer' | 'markets' | 'markets-picker' | 'market' | 'market-trade' | 'create-order' | 'my-orders' | 'order-detail' | 'edit-order' | 'cancel-order' | 'my-swaps' | 'swap-detail' | 'edit-swap' | 'cancel-swap' | 'coinpay' | 'obligations' | 'swap' | 'sell-name' | 'messaging' | 'compose-message' | 'contacts' | 'alerts' | 'lists' | 'list-detail' | 'list-create' | 'list-fork' | 'list-share' | 'list-transfer' | 'list-rename' |'contracts-list' | 'contract-detail' | 'contract-deploy' | 'contract-execute' | 'contract-deposit' | 'contract-withdraw' | 'controller-bind' | 'staking-dashboard' | 'stake-detail' | 'stake-new' | 'stake-form' | 'staking-unstake' | 'staking-claim' | 'staking-delegate' | 'staking-revoke' | 'history' | 'action-detail' | 'token-detail' | 'link-form' | 'attach-content' | 'gated-publish' | 'publish-file' | 'project-roster' | 'parallel-compose' | 'batch-compose' | 'cross-chain-swap' | 'cross-chain-order' | 'multisig-create' | 'multisig-share' | 'multisig-sign' | 'cosigner-accounts' | 'cosigner-provision' | 'cosigner-detail' | 'addresses' | 'address-preferences' | 'view-private-key' | 'add-wallet' | 'add-account' | 'wallet-picker' | 'account-picker' | 'wallet-details' | 'account-details' | 'wallet-phrase' | 'wallet-rename' | 'account-rename' | 'sign-message' | 'verify-signature' | 'sign-psbt' | 'scan'} */ ('home'),
        capture: () => navContext.current.capture(),
        restore: (ctx) => navContext.current.restore(ctx),
        itemKey: navItemKey,
        network: activeNetwork,
    });
    const unlockedView = nav.view;
    const setUnlockedView = nav.navigate;
    // A page opened from the sidebar, bottom bar, menu or palette is a root:
    // the history starts over on it and it shows no Back.
    // Every root open clears the form's source token, so no shell entry point
    // (menu, bottom bar, palette, go-to shortcut) can leak one into another form.
    const openRootView = createRootViewOpener(nav.navigateRoot, () => {
        setFormSource(null);
        setTokenAdminInitialPicker(null);
    });
    const goBack = nav.back;
    const resetNav = nav.reset;
    useDocumentTitle({
        statusState: status.state,
        onboardingStep,
        unlockedView,
    });
    const [walletDetailsId, setWalletDetailsId] = useState(/** @type {string | null} */ (null));
    // The account a My Accounts row opened (Account Details, which holds rename).
    const [accountDetailsId, setAccountDetailsId] = useState(/** @type {string | null} */ (null));
    // The wallet whose recovery phrase page Wallet Details opened.
    const [recoveryPhraseWallet, setRecoveryPhraseWallet] = useState(
        /** @type {{ id: string, name: string } | null} */ (null),
    );
    const [coSignerAccountId, setCoSignerAccountId] = useState(/** @type {string | null} */ (null));
    const [multisigSessionId, setMultisigSessionId] = useState(/** @type {string | null} */ (null));
    const [multisigInitialLink, setMultisigInitialLink] = useState(/** @type {string | null} */ (null));
    // §17.7: the address staged for the key-reveal ceremony; cleared on Back
    // so a stale address cannot leak into a later visit.
    const [privateKeyAddress, setPrivateKeyAddress] = useState(
        /** @type {any | null} */ (null),
    );
    // The address item shown inside the Addresses route. It belongs to the
    // history entry so child actions pop back to this detail, then the list.
    const [addressDetailTarget, setAddressDetailTarget] = useState(
        /** @type {any | null} */ (null),
    );
    // PC-32: the address whose on-chain preferences are being edited.
    const [addressPrefsTarget, setAddressPrefsTarget] = useState(
        /** @type {{ chainId: string, address: string } | null} */ (null),
    );
    const [walletRenameTarget, setWalletRenameTarget] = useState(
        /** @type {{ id: string, name: string } | null} */ (null),
    );
    const [accountRenameTarget, setAccountRenameTarget] = useState(
        /** @type {{ id: string, name: string } | null} */ (null),
    );
    const [migrateLegacyWalletId, setMigrateLegacyWalletId] = useState(/** @type {string | null} */ (null));
    // Set on the way back from a migration sweep, so the wizard reopens on its
    // kept list even when that sweep was the last one.
    const [migrateResume, setMigrateResume] = useState(false);
    // PC-34: SweepForm context. Free-entry sweeps leave it null (form
    // defaults to the active wallet); the migrate lane prefills the
    // legacy wallet + locked destination.
    const [sweepCtx, setSweepCtx] = useState(
        /** @type {{ walletId: string, chainId: string, fromAddress: string, destination: string, migrateTo: { walletId: string, address: string, name?: string } } | null} */ (null),
    );
    const [resumeAirdropId, setResumeAirdropId] = useState(
        /** @type {string | null} */ (null),
    );
    const [resumeCoinpay, setResumeCoinpay] = useState(
        /** @type {{ chainId: string, address: string, orderMatchActionIndex: string } | null} */ (null),
    );
    const [composePrefill, setComposePrefill] = useState(
        /** @type {{ chainId?: string, fromAddressId?: string, toAddress?: string } | null} */ (null),
    );
    // Address a conversation's menu sends to Contacts (add or edit form).
    const [contactsOpenTarget, setContactsOpenTarget] = useState(
        /** @type {{ address: string, chainId?: string, edit?: boolean } | null} */ (null),
    );
    // Conversation to reopen when the messaging inbox next mounts (set when
    // backing out of a compose form launched from that thread's composer).
    const [messagingThread, setMessagingThread] = useState(
        /** @type {string | null} */ (null),
    );
    // Quick "Message sent" confirmation modal, shown over the view the user
    // is returned to after a compose-form send succeeds.
    const [messageSentNotice, setMessageSentNotice] = useState(false);
    const [deepLinkNotice, setDeepLinkNotice] = useState(/** @type {string | null} */ (null));
    // §24.3 / Cluster Y FOLLOWUP 1: `<ScanRoute>` outcomes route into
    // the existing 'send' view via this prefill slot. Cleared after
    // submit / back to avoid leaking a stale prefill into a future Send.
    // Counts payment links that prefilled Send. It keys the Send route so a
    // link arriving while Send is open replaces the form (the earlier one is
    // kept as a draft) instead of being dropped silently.
    const [sendLinkSeq, setSendLinkSeq] = useState(0);
    // True while the Send screen shows an approved payment; incoming links wait.
    const [sendLinksHeld, setSendLinksHeld] = useState(false);
    const [sendPrefill, setSendPrefill] = useState(
        /** @type {{ address?: string, amount?: string, tick?: string, chainId?: string, memo?: string } | null} */ (null),
    );
    const [executePrefill, setExecutePrefill] = useState(
        /** @type {{ method?: string, paramsText?: string } | null} */ (null),
    );
    const [siteRequestRoute, setSiteRequestRoute] = useState(
        /** @type {{ view?: string, request?: Record<string, unknown> } | null} */ (null),
    );
    // The transaction a scan just produced, handed to the Sign panel so
    // the scan delivers its payload rather than only its destination. Mirrors
    // `sendPrefill` above, which is what the send outcome has always done.
    const [scannedPsbt, setScannedPsbt] = useScannedPsbt(unlockedView);
    // Receive prefill carrier (a token or chain opened Receive); cleared
    // when the user backs out of Receive. Mirrors `sendPrefill` for Send.
    const [receivePrefill, setReceivePrefill] = useState(
        /** @type {{ chainId?: string, tick?: string, kind?: string, displayName?: string, imageUrl?: string | null } | null} */ (null),
    );
    const [activeWalletId, setActiveWalletId] = useState(
        /** @type {string | null} */ (null),
    );
    // A lock clears the active wallet and a switch replaces it; either ends
    // the device session the previous wallet opened.
    useHardwareSessionReset(activeWalletId, resetHardwareSessions);
    // Once unlocked, the active wallet's paired devices are registered again,
    // so a lock or a reload never leaves a hardware wallet unable to sign.
    // Adding an account bumps signerListKey: the list is read again so a
    // Ledger's record carries the identity of a network the account added.
    const [signerListKey, setSignerListKey] = useState(0);
    useHardwareReconnect({
        unlocked: status.state === 'unlocked',
        walletId: activeWalletId,
        listSigners: messaging.listSigners,
        registerRecord: registerHardwareRecord,
        factories: HARDWARE_PAIR_FACTORIES,
        refreshKey: signerListKey,
    });
    // §24 Cluster Y FOLLOWUP 3: track the resolved active-wallet record
    // for LeftNav / BottomTabBar wallet-switcher labelling and so the
    // 'settings' top-level view can pass `activeWallet` into Settings.
    const [walletList, setWalletList] = useState(/** @type {Array<{ id: string, name: string }>} */ ([]));
    // Bumped when a sibling window moves the active network, so chain-scoped routes remount.
    const [networkRevision, setNetworkRevision] = useState(0);
    // Bumped when a sibling window adds a wallet, so this window reads the list again.
    const [walletsRevision, setWalletsRevision] = useState(0);
    // Counts wallet and account record changes made in sibling windows, so the
    // header and an open rename screen read the names again.
    const [recordRevision, setRecordRevision] = useState(0);
    // Bumped to remount a screen that lists wallet or account rows.
    const [recordListRevision, setRecordListRevision] = useState(0);
    const statusStateRef = useRef(status.state);
    const walletListRef = useRef(walletList);
    const pendingActiveWalletId = useRef(/** @type {string | null} */ (null));
    statusStateRef.current = status.state;
    walletListRef.current = walletList;
    const [activeAccountId, setActiveAccountId] = useState(
        /** @type {string | null} */ (null),
    );
    const messagingUnread = useMessagingUnread(activeWalletId, activeAccountId);
    const headerAccounts = useAccountList(activeWalletId, `${accountRenameTarget?.id ?? ''}:${recordRevision}`);
    const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
    // §33 command palette: Cmd/Ctrl+K opens a launcher over every action and
    // destination. It stays disabled while locked or while shortcut help owns
    // the modal layer. Contacts load lazily the first time it opens.
    const palette = useCommandPalette({
        enabled: status.state === 'unlocked' && !shortcutHelpOpen,
        binding: settings?.keyboard?.bindings?.['command-palette'],
        // Every palette and menu pick opens its page as a root.
        navigate: openRootView,
        currentView: unlockedView,
    });
    const [paletteContacts, setPaletteContacts] = useState(/** @type {any[]} */ ([]));
    // entity search: token balances + connected sites join contacts
    // in the palette's searchable surface. Same lazy contract as contacts:
    // loaded on each open, and a failed load just drops that entity family
    // from the results. Token commands land on the 'token-detail' route
    // (desktop parity with the web shell). (Desktop exposes no
    // connected-sites bridge, so the sites load is guarded and normally
    // stays empty.)
    const [paletteTokenRows, setPaletteTokenRows] = useState(/** @type {any[]} */ ([]));
    const [paletteSites, setPaletteSites] = useState(/** @type {any[]} */ ([]));
    useLayoutEffect(() => {
        setPaletteContacts([]);
        setPaletteTokenRows([]);
        setPaletteSites([]);
    }, [palette.open, status.state, activeWalletId, activeAccountId, palette.onlineRetryKey]);
    useEffect(() => {
        if (!palette.open || status.state !== 'unlocked' || !activeWalletId) return undefined;
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setPaletteContacts(Array.isArray(rows) ? rows : []); })
            .catch(() => { /* palette still works without contacts */ });
        // The balances Home shows, so a coin opened from here matches
        // Home's figure (a demo wallet's are synthesized, not read).
        loadDisplayBalances(messaging, activeWalletId, activeAccountId)
            .then((balances) => {
                if (cancelled) return;
                setPaletteTokenRows(buildBalanceRows(balances, APP_CHAIN_REGISTRY, null));
            })
            .catch(() => { /* palette still works without token rows */ });
        if (typeof messaging.listConnectedSites === 'function') {
            messaging.listConnectedSites()
                .then((sites) => { if (!cancelled) setPaletteSites(Array.isArray(sites) ? sites : []); })
                .catch(() => { /* palette still works without sites */ });
        }
        return () => { cancelled = true; };
    }, [palette.open, status.state, activeWalletId, activeAccountId, palette.onlineRetryKey]);
    // Which Settings section a palette deep-link should open.
    // Cleared when the user backs out of Settings. The ref holds a new value
    // at once, so Settings' history entry keeps the section set in the same
    // handler that leaves it (its Wallets page, for My Wallets).
    const [settingsInitialSection, setSettingsSectionState] = useState(
        /** @type {string | null} */ (null),
    );
    const settingsSectionRef = useRef(/** @type {string | null} */ (null));
    const setSettingsInitialSection = useCallback((section) => {
        settingsSectionRef.current = section;
        setSettingsSectionState(section);
    }, []);
    // Opened from Settings, Back to Settings reopens its Wallets page.
    const openWalletPicker = (from = /** @type {'home' | 'settings'} */ ('home')) => {
        if (from === 'settings') setSettingsInitialSection('g-wallets');
        setUnlockedView('wallet-picker');
    };
    // §34 keyboard shortcuts (see the web shell for the reference wiring).
    useKeyboardShortcuts({
        enabled: status.state === 'unlocked' && !palette.open && !shortcutHelpOpen,
        overrides: settings?.keyboard?.bindings,
        handlers: {
            // A go-to shortcut is a nav pick like the palette's: a root page.
            navigate: openRootView,
            lock: handleLock,
            openHelp: () => setShortcutHelpOpen(true),
        },
    });
    const [dispenserRef, setDispenserRef] = useState(
        /** @type {{ chainId: string, actionIndex: string } | null} */ (null),
    );
    const [dispenserMarketAsset, setDispenserMarketAsset] = useState(
        () => defaultDispenserAssetForNetwork(settings?.activeNetwork),
    );
    useEffect(() => {
        setDispenserMarketAsset((current) => syncDispenserAssetToNetwork(current, settings?.activeNetwork));
    }, [settings?.activeNetwork]);
    // Which order the Order detail page shows, picked from a My Orders row.
    const [orderRef, setOrderRef] = useState(
        /** @type {{ chainId: string, actionIndex: string } | null} */ (null),
    );
    // Which swap the Swap Details page shows, picked from a My Swaps row.
    const [swapRef, setSwapRef] = useState(
        /** @type {{ chainId: string, actionIndex: string } | null} */ (null),
    );
    // PC-10 "My Lists": which list ListDetail is showing, and the
    // {chainId, actionIndex, type, items} handed from ListDetail's Edit and
    // Fork tiles into the List form.
    const [listRef, setListRef] = useState(
        /** @type {{ chainId: string, actionIndex: string, origin?: 'shared', directoryChainId?: string } | null} */ (null),
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
    // Shared token-context slot: Home balance rows / the palette's token
    // commands fill it fully (kind, quantity, fiatRate, ...) for the
    // held-token 'token-detail' view; MyTokens fills the owner
    // subset for the owner-gated 'manage-token' view.
    const [tokenDetailRef, setTokenDetailRef] = useState(
        /** @type {{ chainId: string, tick: string, kind: string, displayName?: string, divisibility?: number | null, fiatRate?: number | null, quantity?: string, imageUrl?: string | null, issuer?: string | null } | null} */ (null),
    );
    // Wide Home's selected item (G115), held here so a visit to Send or a
    // form opened from the detail panel comes back to the same item. Scoped
    // to the wallet it was picked in.
    const [homeDetail, setHomeDetail] = useState(
        /** @type {{ walletId: string, item: any } | null} */ (null),
    );
    // The page that opened the current action form, when that page hands the
    // form an asset to prefill ('manage-token', 'token-detail', 'settings') or
    // terms to reopen ('dispenser-detail'). It no longer decides where Back goes.
    const [formSource, setFormSource] = useState(/** @type {string | null} */ (null));
    const [tokenAdminInitialPicker, setTokenAdminInitialPicker] = useState(
        /** @type {'shared-block' | null} */ (null),
    );
    // Leaving a form drops its prefill; the page Back returns to restores its own.
    const formBack = () => {
        setFormSource(null);
        setTokenAdminInitialPicker(null);
        goBack();
    };
    const formDone = () => {
        setFormSource(null);
        setTokenAdminInitialPicker(null);
        setUnlockedView('home');
    };
    // 'token-detail' covers the coin and token page's Actions tab, which
    // opens each per-asset form pre-filled with the asset on screen.
    const fromManage = formSource === 'manage-token' || formSource === 'settings' || formSource === 'token-detail';
    // The wizard opened from a token (Issue subtoken) takes that token as the
    // subtoken's parent; the faucet's 'settings' source never opens it.
    const subtokenParentFromToken = formSource === 'manage-token' || formSource === 'token-detail';
    const prefillChainId = fromManage ? tokenDetailRef?.chainId : undefined;
    const prefillTick = fromManage ? tokenDetailRef?.tick : undefined;
    const prefillFromAddress = fromManage ? tokenDetailRef?.issuer : undefined;
    const handleFaucetMint = ({ chainId, tick }) => {
        setTokenDetailRef({ chainId, tick });
        setFormSource('settings');
        setUnlockedView('mint');
    };
    const [contractRef, setContractRef] = useState(
        /** @type {{ chainId: string, contractActionIndex: string, initialMode?: 'stake' | 'unstake' | 'delegate' } | null} */ (null),
    );
    const [governanceRef, setGovernanceRef] = useState(
        /** @type {{ chainId: string, pollIndex?: string | number, clear?: { tick: string, delegate: string, address: string } } | null} */ (null),
    );
    // Betting navigation. `duplicateFeedIndex` carries the cancel-and-recreate
    // path: markets are immutable, so a corrected market is a NEW market
    // pre-filled from the old one.
    const [betRef, setBetRef] = useState(
        /** @type {{ chainId: string, feedIndex?: string | number, duplicateFeedIndex?: string | number } | null} */ (null),
    );
    // Bet Markets' tab (All | My bets | My markets), held here so a market
    // opened from a tab comes back to it, and so a link (the palette, a
    // resolve prompt) can open Bet Markets on a given tab.
    const [betTab, setBetTab] = useState('all');
    // Unwinds to Bet Markets when the user came through it, so a market
    // created or settled from a detail page never leaves that page to Back into.
    const landOnBetTab = nav.land;
    const openBetTab = useCallback((tab) => { setBetTab(tab); landOnBetTab('bet-markets'); }, [landOnBetTab]);
    useEffect(() => {
        if (!BET_AREA_VIEWS.has(unlockedView)) setBetTab('all');
    }, [unlockedView]);
    const [stakingRef, setStakingRef] = useState(
        /** @type {{ kind: 'validator' | 'contract', chainId: string, address: string, contractActionIndex?: string } | null} */ (null),
    );
    const [activeMarket, setActiveMarket] = useState(
        /** @type {{ chainId: string, tick1: string, tick2: string } | null} */ (null),
    );
    const [marketsAsset, setMarketsAsset] = useState(
        /** @type {{ chainId: string, tick: string, displayName?: string, kind?: string } | null} */ (
            () => defaultDexAssetForNetwork(settings?.activeNetwork)
        ),
    );
    useEffect(() => {
        setMarketsAsset((current) => syncDexAssetToNetwork(current, settings?.activeNetwork));
    }, [settings?.activeNetwork]);
    // §24.6 / Cluster Y FOLLOWUP 4: when the renderer is launched
    // with an `xc-init-route` search-string entry (set by main on
    // detach-window IPC), parse it once at mount, route the new
    // window's initial view + context, and strip the search so a
    // refresh doesn't re-trigger. Skip useLastView's resume in that
    // case so the detached window opens on its pinned target rather
    // than the previously-resumed view.
    const [initialRoute, setInitialRoute] = useState(
        /** @type {{ initialView?: string, initialContext?: any } | null} */ (() => parseInitialRoute()),
    );
    const [historyInitialFocus, setHistoryInitialFocus] = useState(
        /** @type {{ chainId?: string, actionIndex?: string, txHash?: string } | null} */ (null),
    );
    // A palette "search history" intent pre-populates History's
    // search box (and optionally scopes its chain filter) on entry, then
    // returns to whichever view launched it. Empty = no scoping.
    const [historyInitialQuery, setHistoryInitialQuery] = useState('');
    const [historyInitialChainCoin, setHistoryInitialChainCoin] = useState('');
    // The entry ActionDetail renders, set when an activity row is clicked.
    const [selectedHistoryEntry, setSelectedHistoryEntry] = useState(
        /** @type {any | null} */ (null),
    );
    // Lock in "this window was detached" at mount; the resume-skip
    // gate stays on for the lifetime of the window even after we
    // clear initialRoute (which we do to keep the state slot from
    // re-firing on subsequent re-renders).
    const isDetachedWindow = useRef(initialRoute !== null);

    const refresh = useCallback(() => {
        const request = ++statusRequest.current;
        setStatus({ state: 'loading' });
        setOnboardingStep('welcome');
        // A session read starts the navigation history over.
        resetNav('home');
        getSessionStatusWithTimeout()
            .then((next) => {
                if (statusRequest.current === request) setStatus(next);
            })
            .catch((err) => {
                if (statusRequest.current !== request) return;
                setStatus({
                    state: 'error',
                    error: err?.message || String(err),
                    // A vault that EXISTS and will not open gets a
                    // screen of its own, and which of the three it is decides
                    // what that screen may offer. Narrowed here because this is
                    // the last point at which the error is still an error.
                    errorKind: coreStorageLib.vaultErrorKind(err),
                });
            });
    }, [resetNav]);
    const noteAutoLockUnsaved = useCallback(() => {
        setLockReason('auto-lock-unsaved');
        refresh();
    }, [refresh]);
    useDemoAutoWipe(activeWalletId, refresh);
    // An unlock that finds the encrypted vault gone lands on the screen a
    // start-up read shows for the same state, and outranks any read in flight.
    const showVaultUnavailable = useCallback((next) => {
        statusRequest.current += 1;
        setStatus({ state: 'error', ...next });
    }, []);

    function clearTransientActionState() {
        resetNav('home');
        setMigrateResume(false);
        setFormSource(null);
        setTokenAdminInitialPicker(null);
        setTokenDetailRef(null);
        setSweepCtx(null);
        setResumeAirdropId(null);
        setPrivateKeyAddress(null);
        setAddressPrefsTarget(null);
        setResumeCoinpay(null);
        setListForkRef(null);
        setSellNameRef(null);
        setComposePrefill(null);
        setStakingRef(null);
        setSendPrefill(null);
        setScannedPsbt(null);
        setExecutePrefill(null);
        setSiteRequestRoute(null);
        setMultisigInitialLink(null);
    }

    function handleLock() {
        return lockImmediately({
            lockWallet,
            clearTransientState: clearTransientActionState,
            showLocked: () => setStatus({ state: 'locked' }),
            recover: refresh,
        });
    }

    useEffect(() => {
        refresh();
        return () => { statusRequest.current += 1; };
    }, [refresh]);

    // A wallet chosen in a sibling window while a review, or the signing or
    // broadcast result it ends on, is open here waits until the review is
    // cancelled or the user leaves the result, so both stay on screen for the
    // wallet they belong to. A wallet gone from the list by then is dropped.
    const heldWalletSwitch = useHeldWalletSwitch((walletId, { navigated }) => {
        if (statusStateRef.current !== 'unlocked') return;
        if (!walletListRef.current.some((wallet) => wallet.id === walletId)) return;
        // The old wallet's pages leave the history, as on a switch made here.
        if (walletId !== activeWalletId) nav.retain((view) => WALLET_SWITCH_KEEPS.has(view));
        setActiveAccountId(null);
        setActiveWalletId(walletId);
        writeActiveWallet(walletId);
        if (!navigated) setUnlockedView('home');
    });
    const heldSwitchNavigated = heldWalletSwitch.navigated;
    useEffect(() => { heldSwitchNavigated(); }, [unlockedView, palette.navigationKey, heldSwitchNavigated]);

    // The sibling-window listener outlives renders, so it reads what this
    // window shows through refs.
    const shownWalletIds = useRef(/** @type {Array<string | null | undefined>} */ ([]));
    shownWalletIds.current = [activeWalletId, walletDetailsId, walletRenameTarget?.id];
    const shownWalletId = useRef(/** @type {string | null} */ (null));
    shownWalletId.current = activeWalletId;
    const shownView = useRef(/** @type {string} */ ('home'));
    shownView.current = unlockedView;
    // The sync is built once so its latest-call-wins guard spans events. A
    // chain that left remounts the open screens unless a review is showing.
    const customChainSync = useRef(/** @type {(() => Promise<unknown>) | null} */ (null));
    if (!customChainSync.current) {
        customChainSync.current = registryLib.createCustomChainSync({
            registry: APP_CHAIN_REGISTRY,
            getSettings: messaging.getSettings,
            onSettings: (next) => window.dispatchEvent(new CustomEvent('xc:settings-changed', { detail: next })),
            onChainsDropped: () => { if (!isConfirmActive()) setNetworkRevision((value) => value + 1); },
        });
    }

    useEffect(() => {
        const bridge = globalThis.xchainWalletWindow;
        if (!bridge || typeof bridge.onStateChange !== 'function') return undefined;
        return bridge.onStateChange((change) => {
            if (change?.kind === 'session') {
                refresh();
                return;
            }
            if (change?.kind === 'wallets' && change.change === 'added') {
                if (statusStateRef.current === 'unlocked') setWalletsRevision((value) => value + 1);
                return;
            }
            // A custom network added or removed in a sibling window: read the saved
            // settings and make this realm's registry match.
            if (change?.kind === 'custom-chains') {
                if (statusStateRef.current === 'unlocked') void customChainSync.current?.();
                return;
            }
            // A sibling's settings write reaches this window's useSettings the way its own does.
            if (change?.kind === 'settings' || change?.kind === 'network') {
                const settings = change.settings;
                if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
                window.dispatchEvent(new CustomEvent('xc:settings-changed', { detail: settings }));
                if (change.kind === 'network') setNetworkRevision((value) => value + 1);
                return;
            }
            if (change?.kind === 'wallets' || change?.kind === 'accounts') {
                if (statusStateRef.current !== 'unlocked') return;
                const changedWalletId = change.walletId;
                if (typeof changedWalletId !== 'string' || !changedWalletId) return;
                // A review open here signs exactly what it shows, so a record
                // change leaves it mounted; the names refresh at the next screen.
                const remountRecordLists = () => {
                    setRecordRevision((value) => value + 1);
                    if (RECORD_LIST_VIEWS.has(shownView.current) && !isConfirmActive()) {
                        setRecordListRevision((value) => value + 1);
                    }
                };
                if (change.kind === 'accounts') {
                    if (shownWalletId.current === changedWalletId) remountRecordLists();
                    return;
                }
                if (change.change === 'removed') {
                    // A wallet removed in a sibling window must not stay open
                    // here: the session reload picks the stored wallet if it
                    // survives, the first remaining one otherwise.
                    heldWalletSwitch.drop(changedWalletId);
                    if (pendingActiveWalletId.current === changedWalletId) pendingActiveWalletId.current = null;
                    if (readActiveWallet() === changedWalletId) clearActiveWallet();
                    if (shownWalletIds.current.includes(changedWalletId)) {
                        refresh();
                        return;
                    }
                }
                listWallets()
                    .then((list) => {
                        if (!Array.isArray(list) || statusStateRef.current !== 'unlocked') return;
                        walletListRef.current = list;
                        setWalletList(list);
                    })
                    .catch(() => { /* the next session refresh reloads the list */ });
                remountRecordLists();
                return;
            }
            if (change?.kind !== 'active-wallet' || statusStateRef.current !== 'unlocked') return;
            const walletId = change.walletId;
            if (typeof walletId !== 'string') return;
            if (!walletListRef.current.some((wallet) => wallet.id === walletId)) {
                pendingActiveWalletId.current = walletId;
                return;
            }
            if (heldWalletSwitch.request(walletId)) return;
            setActiveAccountId(null);
            setActiveWalletId(walletId);
            writeActiveWallet(walletId);
            setUnlockedView('home');
        });
    }, [refresh]);

    useEffect(() => {
        if (status.state !== 'unlocked') {
            clearTransientActionState();
            // A key copied in the session must not outlive it on the clipboard.
            void clearSensitiveCopy();
            pendingActiveWalletId.current = null;
            heldWalletSwitch.clear();
            walletListRef.current = [];
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
                walletListRef.current = arr;
                setWalletList(arr);
                if (arr.length === 0) return;
                // §24.6 / Cluster Y FU 4: when an initial route names a
                // walletId that's actually in the vault, prefer it over
                // the first-wallet default. Otherwise fall through to
                // the first wallet as before.
                //
                // D-34(c): and below that, the last wallet the user actually
                // chose. A deep link still wins - it names a wallet
                // explicitly - but a plain app restart no longer snaps a
                // multi-wallet user back to their first wallet, which is how
                // a send, a receive address or a mint ended up signed by the
                // wrong one. The stored id is validated against the live list
                // so a removed wallet falls back to the default.
                const ctxWalletId = initialRoute?.initialContext?.walletId;
                const persisted = readActiveWallet();
                const pendingWalletId = pendingActiveWalletId.current;
                pendingActiveWalletId.current = null;
                if (pendingWalletId && arr.some((w) => w.id === pendingWalletId)) {
                    setActiveWalletId(pendingWalletId);
                    writeActiveWallet(pendingWalletId);
                    setUnlockedView('home');
                } else if (ctxWalletId && arr.some((w) => w.id === ctxWalletId)) {
                    setActiveWalletId(ctxWalletId);
                } else if (persisted && arr.some((w) => w.id === persisted)) {
                    setActiveWalletId(persisted);
                } else {
                    setActiveWalletId(arr[0].id);
                }
            })
            .catch(() => { /* Home surfaces load errors */ });
        return () => { cancelled = true; };
    }, [status.state]);

    // A sibling window added a wallet: re-read the list so this window's
    // switcher matches, take a selection that named a wallet this list did not
    // hold yet (held like any sibling switch while a review is open), and
    // leave a wallet that is gone.
    useEffect(() => {
        if (walletsRevision === 0 || statusStateRef.current !== 'unlocked') return undefined;
        let cancelled = false;
        listWallets()
            .then((list) => {
                if (cancelled) return;
                const arr = Array.isArray(list) ? list : [];
                walletListRef.current = arr;
                setWalletList(arr);
                const pendingWalletId = pendingActiveWalletId.current;
                if (pendingWalletId && arr.some((w) => w.id === pendingWalletId)) {
                    pendingActiveWalletId.current = null;
                    if (heldWalletSwitch.request(pendingWalletId)) return;
                    setActiveAccountId(null);
                    setActiveWalletId(pendingWalletId);
                    writeActiveWallet(pendingWalletId);
                    setUnlockedView('home');
                    return;
                }
                setActiveWalletId((current) => {
                    if (current && arr.some((w) => w.id === current)) return current;
                    setActiveAccountId(null);
                    return arr[0]?.id ?? null;
                });
            })
            .catch(() => { /* the next change or unlock reloads the list */ });
        return () => { cancelled = true; };
    }, [walletsRevision]);

    // §24.6 / Cluster Y FOLLOWUP 4: apply the initialView once
    // unlock settles. Route + context-state both flip in lockstep
    // here. Runs once per route then clears the slot so subsequent
    // re-renders + later navigations don't re-trigger.
    useEffect(() => {
        if (!initialRoute || status.state !== 'unlocked') return;
        const view = initialRoute.initialView;
        const ctx = initialRoute.initialContext || {};
        if (view === 'history') {
            setHistoryInitialFocus({
                chainId: ctx.chainId,
                actionIndex: ctx.actionIndex != null ? String(ctx.actionIndex) : undefined,
                txHash: ctx.txHash,
            });
            setUnlockedView('history');
        } else if (typeof view === 'string' && view) {
            setUnlockedView(view);
        }
        setInitialRoute(null);
    }, [initialRoute, status.state]);

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
                const chosen = reconcileActiveAccount(activeWalletId, sorted);
                setActiveAccountId(chosen);
            })
            .catch(() => { if (!cancelled) setActiveAccountId(null); });
        return () => { cancelled = true; };
    }, [activeWalletId]);

    // Switch the active account and remember it per wallet, so a restart
    // returns to it instead of snapping back to the lowest-index account.
    const handleSwitchAccount = (id) => {
        const nextId = typeof id === 'string' && id ? id : null;
        setActiveAccountId(nextId);
        if (!activeWalletId) return;
        if (nextId) writeActiveAccount(activeWalletId, nextId);
        else clearActiveAccount(activeWalletId);
    };

    // D-34(c): switch the active WALLET and remember it, so a restart returns
    // to it instead of snapping back to the first wallet. Twin of the account
    // handler above, one level up.
    const handleSwitchWallet = (id, name) => {
        setActiveAccountId(null);
        const changed = typeof id === 'string' && id.length > 0 && id !== activeWalletId;
        // The old wallet's pages leave the history; the wallet pages stay.
        if (changed) nav.retain((view) => WALLET_SWITCH_KEEPS.has(view));
        setActiveWalletId(id);
        if (id) writeActiveWallet(id, name);
        if (changed) messaging.setActiveWallet(id).catch(() => { /* best-effort sibling-window notice */ });
        // An add flow left on its closing notice puts the wallet in the vault
        // without handing it to this list, so the header would call the wallet
        // unnamed; the list is read again for a wallet it lacks.
        if (typeof id === 'string' && id && !walletListRef.current.some((wallet) => wallet.id === id)) {
            listWallets()
                .then((list) => {
                    if (!Array.isArray(list) || statusStateRef.current !== 'unlocked') return;
                    walletListRef.current = list;
                    setWalletList(list);
                })
                .catch(() => { /* the next session refresh reloads the list */ });
        }
    };

    const handleWalletAdded = (wallet) => {
        if (wallet?.id) {
            setWalletList((list) => (
                list.some((entry) => entry.id === wallet.id)
                    ? list.map((entry) => (entry.id === wallet.id ? { ...entry, ...wallet } : entry))
                    : [...list, wallet]
            ));
            handleSwitchWallet(wallet.id, wallet.name);
            showToast({ message: `${wallet.name || 'New wallet'} is now active.`, variant: 'success' });
        }
        refresh();
    };

    // The connect flow reports only the new wallet's id; its name comes from the list.
    const handleHardwareWalletAdded = (walletId) => {
        const fallback = walletId ? { id: walletId } : null;
        listWallets()
            .then((list) => {
                const found = Array.isArray(list) ? list.find((w) => w.id === walletId) : null;
                handleWalletAdded(found || fallback);
            })
            .catch(() => handleWalletAdded(fallback));
    };

    // Unlink removed the wallet; re-read the session, which lands on Home, or
    // on Welcome when that was the last wallet.
    const handleWalletUnlinked = () => {
        setWalletDetailsId(null);
        refresh();
    };

    // Manage, Reconnect: open the device inside the click and hand it to the bridge.
    const handleHardwareReconnect = (wallet, signer) => {
        if (!signer?.id) return;
        // The outcome goes back to the card, whose badge follows it.
        return openHardwareSigner(signer)
            .then((live) => {
                registerLocalSigner(signer.id, live);
                showToast({ message: `${wallet?.name || 'Hardware wallet'} is connected.`, variant: 'success' });
                return true;
            })
            .catch((err) => {
                showToast({ message: userFacingMessage(err, 'Could not connect the hardware wallet.'), variant: 'error' });
                return false;
            });
    };

    // A hardware wallet's Accounts row opens the shared My Accounts page (G131),
    // which lists the active wallet's accounts, so that wallet becomes active first.
    const handleHardwareOpenAccounts = (wallet) => {
        if (wallet?.id && wallet.id !== activeWalletId) handleSwitchWallet(wallet.id, wallet.name);
        setUnlockedView('account-picker');
    };

    // Two gates, because the lanes stopped agreeing. Staking,
    // multisig and co-signer accounts are still Bitcoin-exclusive; the §42.2
    // Contracts nav follows the registry, which now advertises DEPLOY on
    // LTC/DOGE as well. One shared hook would have opened all of them.
    const hasBtcAddress = useBtcAddressesPresent(activeWalletId);
    const hasVmAddress = useVmAddressesPresent(activeWalletId);
    const hasGovernanceAddress = useGovernanceAddressesPresent(activeWalletId);
    // The wallet-mode gate on the spend surfaces. An air-gapped signer
    // wallet hides Send / Receive, so the nav rails and the command palette
    // drop both entries. The mode belongs to the active wallet; this shell
    // publishes it for every `useWalletMode()` reader below.
    useActiveWalletModeSource(activeWalletId);
    const { isSignerMode, isWatcherMode } = useWalletMode();

    // The item each page shows, kept on its history entry when the user
    // leaves it and put back when Back returns to it. Prefills are left out:
    // their setters run for the next page. The Settings section is kept only
    // on Settings' own entry, so Back to Settings reopens the page it was on.
    navContext.current = {
        capture: () => ({
            settingsSection: unlockedView === 'settings' ? settingsSectionRef.current : null,
            tokenDetailRef,
            formSource,
            tokenAdminInitialPicker,
            selectedHistoryEntry,
            historyInitialQuery,
            historyInitialChainCoin,
            historyInitialFocus,
            walletDetailsId,
            accountDetailsId,
            recoveryPhraseWallet,
            walletRenameTarget,
            accountRenameTarget,
            migrateLegacyWalletId,
            addressDetailTarget,
            privateKeyAddress,
            addressPrefsTarget,
            coSignerAccountId,
            multisigSessionId,
            dispenserRef,
            orderRef,
            swapRef,
            listRef,
            listForkRef,
            sellNameRef,
            contractRef,
            governanceRef,
            betRef,
            stakingRef,
            activeMarket,
        }),
        restore: (ctx) => {
            setSettingsInitialSection(ctx.settingsSection ?? null);
            setTokenDetailRef(ctx.tokenDetailRef);
            setFormSource(ctx.formSource);
            setTokenAdminInitialPicker(ctx.tokenAdminInitialPicker);
            setSelectedHistoryEntry(ctx.selectedHistoryEntry);
            setHistoryInitialQuery(ctx.historyInitialQuery);
            setHistoryInitialChainCoin(ctx.historyInitialChainCoin);
            setHistoryInitialFocus(ctx.historyInitialFocus);
            setWalletDetailsId(ctx.walletDetailsId);
            setAccountDetailsId(ctx.accountDetailsId);
            setRecoveryPhraseWallet(ctx.recoveryPhraseWallet);
            setWalletRenameTarget(ctx.walletRenameTarget);
            setAccountRenameTarget(ctx.accountRenameTarget);
            setMigrateLegacyWalletId(ctx.migrateLegacyWalletId);
            setAddressDetailTarget(ctx.addressDetailTarget);
            setPrivateKeyAddress(ctx.privateKeyAddress);
            setAddressPrefsTarget(ctx.addressPrefsTarget);
            setCoSignerAccountId(ctx.coSignerAccountId);
            setMultisigSessionId(ctx.multisigSessionId);
            setDispenserRef(ctx.dispenserRef);
            setOrderRef(ctx.orderRef);
            setSwapRef(ctx.swapRef);
            setListRef(ctx.listRef);
            setListForkRef(ctx.listForkRef);
            setSellNameRef(ctx.sellNameRef);
            setContractRef(ctx.contractRef);
            setGovernanceRef(ctx.governanceRef);
            setBetRef(ctx.betRef);
            setStakingRef(ctx.stakingRef);
            setActiveMarket(ctx.activeMarket);
        },
    };

    // §24 / G055: resume the user's last view on unlock (persisted
    // per-wallet in localStorage). Deep views carry their validated route
    // params so reload, Back, and Forward can prime the selected item first.
    // A resume starts the history over; browser Back and Forward follow it.
    //
    // §24.6 / Cluster Y FU 4: detached windows skip the resume so
    // they land on their pinned target (the initialView effect above
    // sets unlockedView). The resume effect's onResume still drives
    // the user's primary window.
    useLastView({
        walletId: activeWalletId,
        navBacks: nav.backs,
        // An unset network is mainnet, the same default the header reads.
        network: settings ? (settings.activeNetwork || 'mainnet') : undefined,
        sessionActive: status.state === 'unlocked',
        currentView: unlockedView,
        currentParams: unlockedView === 'token-detail' ? tokenDetailRef
            : unlockedView === 'list-detail' ? listRef
                : unlockedView === 'dispenser-detail' ? dispenserRef
                    // The Trade page resumes on its market too.
                    : unlockedView === 'market' || unlockedView === 'market-trade' ? activeMarket : null,
        onResumeParams: (view, params) => {
            if (view === 'token-detail' && params) setTokenDetailRef(params);
            if (view === 'list-detail' && params) setListRef(params);
            if (view === 'dispenser-detail' && params) setDispenserRef(params);
            if ((view === 'market' || view === 'market-trade') && params) setActiveMarket(params);
        },
        onResume: (view, meta) => (meta?.source === 'history' ? nav.sync(view) : resetNav(view)),
        onHistoryPop: (view) => {
            if (!nav.isPrevious(view)) return false;
            goBack();
            return true;
        },
        skip: isDetachedWindow.current,
    });

    // A scan carries the notice on to the Send form it opens.
    const waitingLinkDropped = useWaitingLinkDropped(unlockedView, { scan: 'send' });

    // OS deep links, applied after unlock and after the resume above. A
    // detached window neither claims nor applies one: it keeps its pinned view.
    const waitingLink = useDeepLinks({
        bridge: typeof window !== 'undefined' ? window.xchainWalletDeepLink : undefined,
        detached: isDetachedWindow.current,
        chainRegistry: APP_CHAIN_REGISTRY,
        unlocked: status.state === 'unlocked',
        walletId: activeWalletId,
        held: sendLinksHeld,
        apply: (route) => {
            if (route.view === 'deep-link-error') {
                setDeepLinkNotice(route.message);
                return;
            }
            if (route.sendPrefill) {
                setSendPrefill(route.sendPrefill);
                setSendLinkSeq((n) => n + 1);
            }
            if (route.contractRef) setContractRef(route.contractRef);
            if (route.executePrefill) setExecutePrefill(route.executePrefill);
            if (route.view === 'site-request-approval' || route.view === 'newer-wallet-needed') {
                setSiteRequestRoute(route);
            }
            if (route.view === 'multisig-sign') setMultisigInitialLink(route.initialLink || null);
            setUnlockedView(route.view);
        },
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
        lock: handleLock,
        onArmRefused: noteAutoLockUnsaved,
    });

    switch (status.state) {
        case 'loading':
            return <Loading />;
        case 'error':
            return status.errorKind
                ? <VaultUnavailable kind={status.errorKind} detail={status.error} onRetry={refresh} />
                : <Loading error={status.error} onRetry={refresh} />;
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
            // Connect Hardware Wallet on a fresh install: the three connect
            // steps, then Set Password, then the vault is created.
            if (onboardingStep === 'pair-signer') {
                return (
                    <Suspense fallback={<Loading />}>
                        <HardwareFirstRun
                            pairTrezor={pairTrezorSigner}
                            pairLedger={pairLedgerSigner}
                            onBack={() => setOnboardingStep('welcome')}
                            onCreated={refresh}
                            onSignerPaired={registerLocalSigner}
                        />
                    </Suspense>
                );
            }
            return (
                <Onboarding
                    onCreate={() => setOnboardingStep('create')}
                    onImport={() => setOnboardingStep('import')}
                    onImportFromFreeWallet={() => setOnboardingStep('import-freewallet')}
                    onConnectHardware={() => setOnboardingStep('pair-signer')}
                    hardwareFactories={HARDWARE_PAIR_FACTORIES}
                    onDemoEntered={refresh}
                    onWalletFound={refresh}
                />
            );
        case 'locked':
            return (
                <Locked
                    lockReason={lockReason}
                    onUnlocked={() => { setLockReason(null); refresh(); }}
                    onVaultUnavailable={showVaultUnavailable}
                />
            );
        case 'unlocked': {
            // §24.2 / G053: wrap the unlocked-route render tree in
            // <FullLayoutWithNav> so the left nav is always visible at
            // ≥900px viewports. Existing route returns are captured by
            // the IIFE so the surrounding switch case stays readable.
            const activeWallet = walletList.find((w) => w.id === activeWalletId) || null;
            const menuAlerts = buildWalletAlerts({ activeWallet, messagingUnread }, {
                onMessaging: () => { setMessagingThread(null); setUnlockedView('messaging'); },
                onMigrateToBip39: () => setUnlockedView('migrate-bip39'),
            });
            const routeNode = (() => {
            if (siteRequestRoute?.view === 'site-request-approval' && siteRequestRoute.request) {
                return (
                    <SiteRequestApproval
                        request={siteRequestRoute.request}
                        onReject={() => { setSiteRequestRoute(null); goBack(); }}
                    />
                );
            }
            if (siteRequestRoute?.view === 'newer-wallet-needed') {
                return (
                    <NewerWalletNeeded
                        onBack={() => { setSiteRequestRoute(null); goBack(); }}
                    />
                );
            }
            if (unlockedView === 'send' && activeWalletId) {
                return (
                    <Send
                        key={`${activeWalletId}:${activeAccountId || 'all'}:${sendLinkSeq}`}
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        // The sent form hands over to History or the signing
                        // session in its place, so Back never reopens it.
                        onViewHistory={(target) => {
                            setHistoryInitialQuery('');
                            setHistoryInitialChainCoin('');
                            setHistoryInitialFocus(target || null);
                            nav.replace('history');
                        }}
                        onSessionStarted={(sessionId) => {
                            setMultisigSessionId(sessionId || null);
                            nav.replace('multisig-sign');
                        }}
                        prefill={sendPrefill}
                        onHoldLinks={(held, release) => {
                            setSendLinksHeld(held);
                            // Only Back or Done on the result opens the waiting link;
                            // any other route drops it and says so.
                            if (held || release?.open) return;
                            if (waitingLink.waiting) {
                                waitingLinkDropped.show();
                            }
                            waitingLink.drop();
                        }}
                        linkWaiting={waitingLink.waiting}
                        onBack={() => {
                            setSendPrefill(null);
                            goBack();
                        }}
                        onReceive={() => { setReceivePrefill(null); setUnlockedView('receive'); }}
                        onDone={() => {
                            setSendPrefill(null);
                            setUnlockedView('home');
                        }}
                        onChangeAsset={(carry) => {
                            setSendPrefill((prev) => beginSendAssetSwitch(prev, carry));
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
                        onBack={() => {
                            setSendPrefill(cancelSendAssetSwitch);
                            goBack();
                        }}
                        // A pick returns to Send with the asset, never a second Send.
                        onSelect={(sel) => {
                            setSendPrefill((prev) => applySendAssetPick(prev, sel));
                            nav.land('send');
                        }}
                    />
                );
            }
            if (unlockedView === 'receive' && activeWalletId) {
                return (
                    <Receive
                        key={`${activeWalletId}:${activeAccountId || 'all'}`}
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        prefill={receivePrefill}
                        onBack={() => {
                            setReceivePrefill(null);
                            goBack();
                        }}
                    />
                );
            }
            if (unlockedView === 'scan' && activeWalletId) {
                return (
                    <ScanRoute
                        onBack={goBack}
                        // The scanner turns into the page its code opens, so
                        // Back from that page skips the finished scan.
                        onClassified={(outcome) => {
                            if (outcome.kind === 'send') {
                                setSendPrefill({
                                    address: outcome.address,
                                    amount: outcome.amount,
                                    tick: outcome.tick,
                                    chainId: outcome.chainId,
                                    memo: outcome.memo,
                                    requestMessage: outcome.requestMessage,
                                    feePriority: outcome.feePriority,
                                });
                                nav.replace('send');
                            } else if (outcome.kind === 'receive') {
                                nav.replace('receive');
                            } else if (outcome.kind === 'psbt') {
                                setScannedPsbt(outcome.psbtHex || null);
                                nav.replace('sign-psbt');
                            }
                        }}
                    />
                );
            }
            if (unlockedView === 'wizard' && activeWalletId) {
                return (
                    <TokenWizard
                        walletId={activeWalletId}
                        onBack={formBack}
                        onCustom={() => setUnlockedView('issue')}
                        // Issue subtoken on a token's page opens it as a
                        // subtoken of that token; the Create token entries
                        // clear the form source, so they start blank.
                        initialChainId={subtokenParentFromToken ? tokenDetailRef?.chainId : undefined}
                        initialParentTick={subtokenParentFromToken ? tokenDetailRef?.tick : undefined}
                    />
                );
            }
            if (unlockedView === 'issue' && activeWalletId) {
                return (
                    <IssueTokenForm
                        walletId={activeWalletId}
                        onBack={goBack}
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
                            // Back on the migration list, it marks the swept row
                            // and still offers the others.
                            if (fromMigrate) setMigrateResume(true);
                            formBack();
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
                    // ISSUE v7 bridgeability (BRIDGE_CHAINS / MIN_DEPTH /
                    // LOCK_BRIDGE). Same form, one more mode, so it inherits the
                    // ManageToken prefill and the shared Back behaviour.
                    || unlockedView === 'bridge-settings'
                    || unlockedView === 'description'
                    || unlockedView === 'transfer')
                && activeWalletId
            ) {
                return (
                    <TokenAdminForm
                        walletId={activeWalletId}
                        mode={unlockedView}
                        initialPicker={tokenAdminInitialPicker || undefined}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                        onBack={formBack}
                    />
                );
            }
            // XBRIDGE move (lock on the origin chain, burn back everywhere
            // else). The form picks the leg from the chain it is on, so the
            // route hands it only the token context and lets it decide.
            if (unlockedView === 'bridge-move' && activeWalletId) {
                return (
                    <BridgeMoveForm
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
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
                        initialFromAddress={prefillFromAddress}
                        onBack={formBack}
                        onDone={formDone}
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
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
                        reopen={formSource === 'dispenser-detail' ? dispenserRef?.reopen : undefined}
                        onBack={formBack}
                    />
                );
            }
            // D-153: see the web shell. The ADDRESS-scoped half of this form
            // has nothing to do with tokens, so a token context must not gate
            // the route.
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
            // Unbind is its own form; like Bind it is gated on the wallet alone.
            if (unlockedView === 'controller-unbind' && activeWalletId) {
                return (
                    <UnbindForm
                        walletId={activeWalletId}
                        chainId={tokenDetailRef?.chainId}
                        tick={tokenDetailRef?.tick}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'lists' && activeWalletId) {
                return (
                    <MyLists
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        onOpenList={(cid, actionIndex, shared) => {
                            setListRef({ chainId: cid, actionIndex, ...(shared || {}) });
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
                        walletId={activeWalletId}
                        chainId={listRef.chainId}
                        actionIndex={listRef.actionIndex}
                        onBack={goBack}
                        onEdit={(ref) => { setListForkRef(ref); setUnlockedView('list-rename'); }}
                        onEditLook={() => setUnlockedView('list-look')}
                        onFork={(ref) => { setListForkRef(ref); setUnlockedView('list-fork'); }}
                        onShare={listRef.origin === 'shared' ? undefined : (ref) => { setListRef(ref); setUnlockedView('list-share'); }}
                        onTransfer={listRef.origin === 'shared' ? undefined : (ref) => { setListRef(ref); setUnlockedView('list-transfer'); }}
                    />
                );
            }
            // Edit look is its own page; Save and Back both return to the list.
            if (unlockedView === 'list-look' && activeWalletId && listRef) {
                return (
                    <ListLookForm
                        chainId={listRef.chainId}
                        actionIndex={listRef.actionIndex}
                        onBack={goBack}
                        onDone={goBack}
                    />
                );
            }
            if (unlockedView === 'list-create' && activeWalletId) {
                return (
                    <ListCreateForm
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        onBack={goBack}
                        onDone={() => nav.land('lists')}
                    />
                );
            }
            // Every list action opens the one List form with its action
            // picked; a form that is done unwinds to My Lists, past the form.
            // Edit and Fork take the members ListDetail handed over.
            const listRepointHandlers = {
                // Each consumer's own edit screen opens on top of My Lists,
                // so Back from it lands there and not in the finished fork.
                'issue-lists': () => { nav.land('lists'); setUnlockedView('access-lists'); },
                'dispenser-lists': () => { nav.land('lists'); setUnlockedView('dispensers-list'); },
                'order-lists': () => { nav.land('lists'); setUnlockedView('my-orders'); },
            };
            if (unlockedView === 'list-rename' && activeWalletId && (listForkRef || listRef)) {
                return (
                    <ListCreateForm
                        action="edit"
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        listRef={listForkRef || listRef}
                        onBack={goBack}
                        onDone={() => { setListForkRef(null); nav.land('lists'); }}
                        repointHandlers={listRepointHandlers}
                    />
                );
            }
            if (unlockedView === 'list-fork' && activeWalletId && listForkRef) {
                return (
                    <ListCreateForm
                        action="fork"
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        listRef={listForkRef}
                        onBack={goBack}
                        onDone={() => { setListForkRef(null); nav.land('lists'); }}
                        repointHandlers={listRepointHandlers}
                    />
                );
            }
            if (unlockedView === 'list-share' && activeWalletId && listRef) {
                return (
                    <ListCreateForm
                        action="share"
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        listRef={listRef}
                        onBack={goBack}
                        onDone={() => nav.land('lists')}
                        repointHandlers={listRepointHandlers}
                    />
                );
            }
            if (unlockedView === 'list-transfer' && activeWalletId && listRef) {
                return (
                    <ListCreateForm
                        action="transfer"
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        listRef={listRef}
                        onBack={goBack}
                        onDone={() => nav.land('lists')}
                        repointHandlers={listRepointHandlers}
                    />
                );
            }

            if (unlockedView === 'dispensers-list' || unlockedView === 'dispenser-detail') {
                if ((unlockedView === 'dispensers-list' && activeWalletId)
                    || (unlockedView === 'dispenser-detail' && activeWalletId && dispenserRef)) {
                    const renderDispenserDetail = (ref, extra = {}) => (
                        <DispenserDetail
                            walletId={activeWalletId}
                            chainId={ref.chainId}
                            actionIndex={ref.actionIndex}
                            onBack={goBack}
                            onOpenAgain={(terms) => {
                                setDispenserRef({ ...ref, reopen: terms });
                                setFormSource('dispenser-detail');
                                setUnlockedView('dispenser');
                            }}
                            {...extra}
                        />
                    );
                    return (
                        <DispensersList
                            walletId={activeWalletId}
                            activeAccountId={activeAccountId || undefined}
                            onOpenDispenser={(chainId, actionIndex) => {
                                setDispenserRef({ chainId, actionIndex });
                                setUnlockedView('dispenser-detail');
                            }}
                            onCreateDispenser={() => setUnlockedView('dispenser')}
                            onBack={goBack}
                            marketAsset={dispenserMarketAsset}
                            onChangeMarket={() => setUnlockedView('dispensers-picker')}
                            selectedDispenser={dispenserRef}
                            onSelectDispenser={setDispenserRef}
                            renderDispenser={(ref) => renderDispenserDetail(ref, { embedded: true })}
                            renderDispenserPage={unlockedView === 'dispenser-detail'
                                ? (ref, page) => renderDispenserDetail(ref, { measureRef: page.measureRef })
                                : undefined}
                        />
                    );
                }
            }
            if (unlockedView === 'dispensers-picker' && activeWalletId) {
                return (
                    <ReceivePicker
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        title={t('common.dispensers.selectMarket')}
                        backLabel={t('common.dispensers.backToDispensers')}
                        onBack={goBack}
                        onSelect={(selection) => {
                            setDispenserMarketAsset({
                                chainId: selection.chainId,
                                tick: selection.tick,
                                displayName: selection.displayName,
                                kind: selection.kind,
                            });
                            nav.land('dispensers-list');
                        }}
                    />
                );
            }
            if (unlockedView === 'dispenser-explorer' && activeWalletId) {
                return (
                    <DispenserExplorer
                        onOpenDispenser={(chainId, actionIndex) => {
                            setDispenserRef({ chainId, actionIndex });
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
                            setResumeAirdropId(null);
                            formBack();
                        }}
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
                        resumeList={migrateResume}
                        onBack={() => {
                            // Re-read the wallets on the way out, never mid-wizard; a
                            // full session refresh would also clear the history.
                            listWallets()
                                .then((list) => {
                                    if (!Array.isArray(list)) return;
                                    walletListRef.current = list;
                                    setWalletList(list);
                                })
                                .catch(() => { /* the list refreshes on the next unlock */ });
                            setMigrateLegacyWalletId(null);
                            setMigrateResume(false);
                            goBack();
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
            // Connect Hardware Wallet inside an open vault: the device is
            // saved as its own wallet, which then becomes active.
            if (unlockedView === 'pair-signer') {
                return (
                    <PairSignerForm
                        mode="add"
                        pairTrezor={pairTrezorSigner}
                        pairLedger={pairLedgerSigner}
                        onSignerPaired={registerLocalSigner}
                        onBack={formBack}
                        onCreated={handleHardwareWalletAdded}
                    />
                );
            }
            // Settings, Advanced, Use another phone as a signer.
            if (unlockedView === 'pair-partner') {
                return (
                    <PairPartnerWallet
                        onBack={goBack}
                        onPaired={handleWalletAdded}
                    />
                );
            }
            if (unlockedView === 'sign-psbt' && activeWalletId) {
                return (
                    <PsbtSignForm
                        walletId={activeWalletId}
                        initialPsbt={scannedPsbt || undefined}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'sign-message' && activeWalletId) {
                return (
                    <SignMessageForm
                        walletId={activeWalletId}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'verify-signature' && activeWalletId) {
                return (
                    <VerifySignatureForm
                        onBack={goBack}
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
                        onBack={goBack}
                        // Wide content: the list and the picked market side by side. The
                        // pick lives in activeMarket, so Back from the Trade page keeps it.
                        selectedMarket={activeMarket}
                        onSelectMarket={(chainId, tick1, tick2) => setActiveMarket({ chainId, tick1, tick2 })}
                        renderMarket={(market, panel) => (
                            <MarketView
                                embedded
                                walletId={activeWalletId}
                                chainId={market.chainId}
                                tick1={market.tick1}
                                tick2={market.tick2}
                                onWatchlistChange={panel.onWatchlistChange}
                                onSwap={() => setActiveMarket({
                                    chainId: market.chainId,
                                    tick1: market.tick2,
                                    tick2: market.tick1,
                                })}
                                onTrade={(trade) => {
                                    setActiveMarket({ ...market, trade });
                                    setUnlockedView('market-trade');
                                }}
                            />
                        )}
                    />
                );
            }
            if (unlockedView === 'markets-picker' && activeWalletId) {
                return (
                    <ReceivePicker
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        title={t('shell.markets.selectAsset')}
                        backLabel={t('shell.markets.back')}
                        selectedKey={marketsAsset ? `${marketsAsset.chainId}:${marketsAsset.tick}` : null}
                        hideOwnFilter
                        onBack={goBack}
                        // A pick returns to Markets with the asset, never a second Markets.
                        onSelect={(sel) => {
                            setMarketsAsset({
                                chainId: sel.chainId,
                                tick: sel.tick,
                                displayName: sel.displayName,
                                kind: sel.kind,
                            });
                            nav.land('markets');
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
                            goBack();
                        }}
                        onSwap={() => setActiveMarket({
                            chainId: activeMarket.chainId,
                            tick1: activeMarket.tick2,
                            tick2: activeMarket.tick1,
                        })}
                        // Buy, Sell and a book price open the Trade page route.
                        onTrade={(trade) => {
                            setActiveMarket({
                                chainId: activeMarket.chainId,
                                tick1: activeMarket.tick1,
                                tick2: activeMarket.tick2,
                                trade,
                            });
                            setUnlockedView('market-trade');
                        }}
                    />
                );
            }
            // The Trade page. Back drops the trade and returns to the market.
            if (unlockedView === 'market-trade' && activeMarket && activeWalletId) {
                return (
                    <MarketTrade
                        walletId={activeWalletId}
                        chainId={activeMarket.chainId}
                        tick1={activeMarket.tick1}
                        tick2={activeMarket.tick2}
                        side={activeMarket.trade?.side}
                        mode={activeMarket.trade?.mode}
                        price={activeMarket.trade?.price ?? null}
                        pick={activeMarket.trade?.pick}
                        onBack={() => {
                            setActiveMarket({
                                chainId: activeMarket.chainId,
                                tick1: activeMarket.tick1,
                                tick2: activeMarket.tick2,
                            });
                            goBack();
                        }}
                    />
                );
            }
            if (unlockedView === 'obligations' && activeWalletId) {
                return (
                    <ObligationsView
                        walletId={activeWalletId}
                        activeAccountId={activeAccountId || undefined}
                        onBack={goBack}
                        onPay={(ref) => {
                            setResumeCoinpay(ref);
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
                            setResumeCoinpay(null);
                            goBack();
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
            if (unlockedView === 'create-order' && activeWalletId) {
                return (
                    <CreateOrderForm
                        walletId={activeWalletId}
                        onBack={formBack}
                        onManageOrders={() => setUnlockedView('my-orders')}
                    />
                );
            }
            if (unlockedView === 'my-orders' && activeWalletId) {
                return (
                    <MyOrdersView
                        walletId={activeWalletId}
                        accountId={activeAccountId}
                        onBack={formBack}
                        onCreateOrder={() => setUnlockedView('create-order')}
                        onOpenOrder={(ref) => {
                            setOrderRef(ref);
                            setUnlockedView('order-detail');
                        }}
                    />
                );
            }
            if (unlockedView === 'order-detail' && activeWalletId && orderRef) {
                return (
                    <OrderDetail
                        walletId={activeWalletId}
                        accountId={activeAccountId}
                        chainId={orderRef.chainId}
                        actionIndex={orderRef.actionIndex}
                        onBack={goBack}
                        // The order's "Open the market" action row.
                        onOpenMarket={(chainId, tick1, tick2) => {
                            setActiveMarket({ chainId, tick1, tick2 });
                            setUnlockedView('market');
                        }}
                        // Edit and Cancel open their own standard form routes.
                        onEditOrder={(ref) => {
                            setOrderRef(ref);
                            setUnlockedView('edit-order');
                        }}
                        onCancelOrder={(ref) => {
                            setOrderRef(ref);
                            setUnlockedView('cancel-order');
                        }}
                    />
                );
            }
            if (unlockedView === 'edit-order' && activeWalletId && orderRef) {
                return (
                    <EditOrderForm
                        walletId={activeWalletId}
                        accountId={activeAccountId}
                        chainId={orderRef.chainId}
                        actionIndex={orderRef.actionIndex}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'cancel-order' && activeWalletId && orderRef) {
                return (
                    <CancelOrderForm
                        walletId={activeWalletId}
                        accountId={activeAccountId}
                        chainId={orderRef.chainId}
                        actionIndex={orderRef.actionIndex}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'my-swaps' && activeWalletId) {
                return (
                    <MySwapsView
                        walletId={activeWalletId}
                        accountId={activeAccountId}
                        onBack={formBack}
                        onCreateSwap={() => setUnlockedView('swap')}
                        onOpenSwap={(chainId, actionIndex) => {
                            setSwapRef({ chainId, actionIndex });
                            setUnlockedView('swap-detail');
                        }}
                    />
                );
            }
            if (unlockedView === 'swap-detail' && activeWalletId && swapRef) {
                return (
                    <SwapDetail
                        walletId={activeWalletId}
                        accountId={activeAccountId}
                        chainId={swapRef.chainId}
                        actionIndex={swapRef.actionIndex}
                        onBack={goBack}
                        // Edit and Cancel open their own standard form routes.
                        onEditSwap={(ref) => {
                            setSwapRef(ref);
                            setUnlockedView('edit-swap');
                        }}
                        onCancelSwap={(ref) => {
                            setSwapRef(ref);
                            setUnlockedView('cancel-swap');
                        }}
                    />
                );
            }
            if (unlockedView === 'edit-swap' && activeWalletId && swapRef) {
                return (
                    <EditSwapForm
                        walletId={activeWalletId}
                        accountId={activeAccountId}
                        chainId={swapRef.chainId}
                        actionIndex={swapRef.actionIndex}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'cancel-swap' && activeWalletId && swapRef) {
                return (
                    <CancelSwapForm
                        walletId={activeWalletId}
                        accountId={activeAccountId}
                        chainId={swapRef.chainId}
                        actionIndex={swapRef.actionIndex}
                        onBack={goBack}
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
                        onBack={formBack}
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
            if (unlockedView === 'parallel-compose' && activeWalletId) {
                return (
                    <ParallelComposer
                        walletId={activeWalletId}
                        onBack={formBack}
                    />
                );
            }
            if (unlockedView === 'batch-compose' && activeWalletId) {
                return (
                    <BatchComposerForm
                        walletId={activeWalletId}
                        onBack={formBack}
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
            if (unlockedView === 'cross-chain-order' && activeWalletId) {
                return (
                    <CrossChainOrderForm
                        walletId={activeWalletId}
                        onBack={formBack}
                        onManageOrders={() => setUnlockedView('my-orders')}
                    />
                );
            }
            if (unlockedView === 'multisig-create' && activeWalletId) {
                return (
                    <MultisigCreate
                        walletId={activeWalletId}
                        onBack={formBack}
                        onShare={() => setUnlockedView('multisig-share')}
                    />
                );
            }
            if (unlockedView === 'multisig-share' && activeWalletId) {
                return <MultisigCosignerShare walletId={activeWalletId} onBack={goBack} />;
            }
            // Bet Markets and a market opened on its own route share the wide
            // split. Narrow content keeps the list, then the standalone detail.
            const renderBetDetail = (ref, extra = {}) => (
                <BetFeedDetail
                    walletId={activeWalletId}
                    chainId={ref.chainId}
                    feedIndex={ref.feedIndex}
                    onOpenOracle={(chainId, address) => { setBetRef({ ...ref, chainId, oracleAddress: address }); setUnlockedView('bet-oracle-record'); }}
                    onDuplicate={(chainId, feedIndex) => { setBetRef({ chainId, duplicateFeedIndex: feedIndex }); setUnlockedView('bet-create'); }}
                    onBack={goBack}
                    {...extra}
                />
            );
            if (unlockedView === 'bet-markets' || unlockedView === 'bet-market-detail') {
                if ((unlockedView === 'bet-markets' && activeWalletId) || (unlockedView === 'bet-market-detail' && activeWalletId && betRef)) {
                    return (
                        <BetFeedsList
                            walletId={activeWalletId}
                            view={betTab}
                            onViewChange={setBetTab}
                            onOpenMarket={(chainId, feedIndex) => { setBetRef({ chainId, feedIndex }); setUnlockedView('bet-market-detail'); }}
                            onCreate={(chainId) => { setBetRef({ chainId }); setUnlockedView('bet-create'); }}
                            onBack={goBack}
                            selectedMarket={betRef}
                            onSelectMarket={setBetRef}
                            renderMarket={(ref) => renderBetDetail(ref, { embedded: true })}
                            renderMarketPage={unlockedView === 'bet-market-detail'
                                ? (ref, page) => renderBetDetail(ref, { measureRef: page.measureRef })
                                : undefined}
                        />
                    );
                }
            }
            // Who is running this market, and what their record is. Reached from a
            // market rather than the menu: it is a check you make about one oracle,
            // and it needs the address as its subject.
            if (unlockedView === 'bet-oracle-record' && activeWalletId && betRef?.oracleAddress) {
                return (
                    <OracleRecord
                        chainId={betRef.chainId}
                        address={betRef.oracleAddress}
                        walletId={activeWalletId}
                        /* Resolve sends the oracle to Bet Markets on My markets. */
                        onResolvePending={() => openBetTab('markets')}
                        onOpenMarket={(chainId, feedIndex) => { setBetRef({ chainId, feedIndex }); setUnlockedView('bet-market-detail'); }}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'bet-create' && activeWalletId && betRef) {
                return (
                    <CreateBetFeedForm
                        walletId={activeWalletId}
                        chainId={betRef.chainId}
                        duplicateFeedIndex={betRef.duplicateFeedIndex}
                        onBack={goBack}
                        onCreated={() => openBetTab('markets')}
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
                        onMyDelegations={(chainId) => { setGovernanceRef({ chainId }); setUnlockedView('governance-delegations'); }}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'governance-create-poll' && activeWalletId && governanceRef) {
                return (
                    <CreatePollForm
                        walletId={activeWalletId}
                        chainId={governanceRef.chainId}
                        onBack={goBack}
                        onCreated={() => nav.land('governance-polls')}
                    />
                );
            }
            if (unlockedView === 'governance-poll-detail' && activeWalletId && governanceRef) {
                return (
                    <PollDetail
                        walletId={activeWalletId}
                        chainId={governanceRef.chainId}
                        pollIndex={governanceRef.pollIndex}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'governance-delegate' && activeWalletId && governanceRef) {
                return (
                    <DelegateVoteForm
                        mode="delegate"
                        walletId={activeWalletId}
                        chainId={governanceRef.chainId}
                        onBack={goBack}
                    />
                );
            }
            // Opened from the menu there is no poll chain yet; My delegations
            // then picks the first voting network this wallet has an address on.
            if (unlockedView === 'governance-delegations' && activeWalletId) {
                return (
                    <MyDelegations
                        walletId={activeWalletId}
                        chainId={governanceRef?.chainId}
                        onClear={(chainId, clear) => { setGovernanceRef({ chainId, clear }); setUnlockedView('governance-clear-delegation'); }}
                        onDelegate={(chainId) => { setGovernanceRef({ chainId }); setUnlockedView('governance-delegate'); }}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'governance-clear-delegation' && activeWalletId && governanceRef?.clear) {
                return (
                    <DelegateVoteForm
                        mode="clear"
                        walletId={activeWalletId}
                        chainId={governanceRef.chainId}
                        clear={governanceRef.clear}
                        onBack={goBack}
                        onDone={() => nav.land('governance-delegations')}
                    />
                );
            }
            if (unlockedView === 'cosigner-accounts' && activeWalletId) {
                return (
                    <CoSignerAccountList
                        walletId={activeWalletId}
                        onProvision={() => setUnlockedView('cosigner-provision')}
                        onOpen={(id) => { setCoSignerAccountId(id); setUnlockedView('cosigner-detail'); }}
                        selectedAccountId={coSignerAccountId}
                        onSelectAccount={setCoSignerAccountId}
                        renderAccount={(id) => (
                            <CoSignerAccountDetail accountId={id} walletId={activeWalletId} onBack={goBack} embedded />
                        )}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'cosigner-provision' && activeWalletId) {
                return (
                    <CoSignerProvision
                        walletId={activeWalletId}
                        // The new account's page takes the finished form's place.
                        onDone={(id) => {
                            setCoSignerAccountId(id || null);
                            if (id) nav.replace('cosigner-detail');
                            else nav.land('cosigner-accounts');
                        }}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'cosigner-detail' && activeWalletId && coSignerAccountId) {
                return (
                    <CoSignerAccountList
                        walletId={activeWalletId}
                        onProvision={() => setUnlockedView('cosigner-provision')}
                        onOpen={(id) => setCoSignerAccountId(id)}
                        selectedAccountId={coSignerAccountId}
                        onSelectAccount={setCoSignerAccountId}
                        renderAccount={(id) => (
                            <CoSignerAccountDetail accountId={id} walletId={activeWalletId} onBack={goBack} embedded />
                        )}
                        renderAccountPage={(id, page) => (
                            <CoSignerAccountDetail
                                accountId={id}
                                walletId={activeWalletId}
                                onBack={goBack}
                                measureRef={page.measureRef}
                            />
                        )}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'multisig-sign' && activeWalletId) {
                return (
                    <MultisigSigningSession
                        walletId={activeWalletId}
                        initialSessionId={multisigSessionId || undefined}
                        initialLink={multisigInitialLink || undefined}
                        onBack={() => { setMultisigInitialLink(null); formBack(); }}
                    />
                );
            }
            if (unlockedView === 'addresses' && activeWalletId) {
                return (
                    <AddressList
                        walletId={activeWalletId}
                        // A private key import offers the backup file at once (ruling 2026-11-16).
                        onExportBackup={() => {
                            setWalletDetailsId(activeWalletId);
                            setUnlockedView('wallet-backup');
                        }}
                        accountId={activeAccountId || undefined}
                        // Opened from Settings > Wallets: every account's addresses.
                        scope={settingsInitialSection === 'g-wallets' ? 'wallet' : 'account'}
                        onBack={goBack}
                        selectedAddress={addressDetailTarget}
                        onSelectedAddressChange={setAddressDetailTarget}
                        onDetailBack={goBack}
                        onReceive={(sel) => {
                            // The detail's Receive tile hands back its address; the list's own
                            // empty-state action passes none (or an event), so it opens as before.
                            setReceivePrefill(sel && typeof sel.address === 'string' && sel.chainId
                                ? { chainId: sel.chainId, address: sel.address }
                                : null);
                            setUnlockedView('receive');
                        }}
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
            if (unlockedView === 'view-private-key' && activeWalletId && privateKeyAddress) {
                return (
                    <ViewPrivateKey
                        walletId={activeWalletId}
                        address={privateKeyAddress}
                        renderQR={({ value }) => <KeyQR value={value} alt={t('shell.privateKeyQr')} />}
                        onBack={() => {
                            setPrivateKeyAddress(null);
                            goBack();
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
                            goBack();
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
                        onContact={(target) => {
                            setMessagingThread(target.address);
                            setContactsOpenTarget(target);
                            setUnlockedView('contacts');
                        }}
                        onCompose={(prefill) => {
                            setComposePrefill(prefill || null);
                            setUnlockedView('compose-message');
                        }}
                        onBack={() => {
                            setMessagingThread(null);
                            goBack();
                        }}
                    />
                );
            }
            // Leaving the composer, by Back or after sending, returns to the
            // page that opened it; the inbox reopens the thread it came from.
            if (unlockedView === 'compose-message' && activeWalletId) {
                const leaveCompose = () => {
                    setMessagingThread(composePrefill?.threadCounterparty || null);
                    setComposePrefill(null);
                    goBack();
                };
                return (
                    <ComposeMessage
                        walletId={activeWalletId}
                        chainId={composePrefill?.chainId}
                        fromAddressId={composePrefill?.fromAddressId}
                        toAddress={composePrefill?.toAddress}
                        initialMessage={composePrefill?.message}
                        fixedEncryption={composePrefill?.fixedEncryption}
                        onBack={leaveCompose}
                        onSent={() => {
                            leaveCompose();
                            setMessageSentNotice(true);
                        }}
                    />
                );
            }
            if (unlockedView === 'contacts' && activeWalletId) {
                return (
                    <ContactsList
                        key={activeWalletId}
                        walletId={activeWalletId}
                        openTarget={contactsOpenTarget}
                        onOpenTargetConsumed={() => setContactsOpenTarget(null)}
                        onSend={(prefill) => {
                            setSendPrefill(prefill);
                            setUnlockedView('send');
                        }}
                        onSendMessage={(prefill) => {
                            setComposePrefill(prefill);
                            setUnlockedView('compose-message');
                        }}
                        onBack={goBack}
                        onOpenBackup={() => {
                            setSettingsInitialSection('backup');
                            setUnlockedView('settings');
                        }}
                    />
                );
            }
            if (unlockedView === 'alerts' && activeWalletId) {
                return (
                    <AlertsRoute
                        key={activeWalletId}
                        walletId={activeWalletId}
                        onBack={goBack}
                        accountId={activeAccountId}
                        alerts={menuAlerts}
                        isWatcherMode={isWatcherMode}
                        onResumeCoinpay={(ref) => { setResumeCoinpay(ref); setUnlockedView('coinpay'); }}
                        onResumeAirdrop={(id) => { setResumeAirdropId(id); setUnlockedView('airdrop'); }}
                    />
                );
            }
            const renderContractDetail = (ref, extra = {}) => (
                <ContractDetail
                    walletId={activeWalletId}
                    chainId={ref.chainId}
                    contractActionIndex={ref.contractActionIndex}
                    onExecute={(next) => { setContractRef(ref); setExecutePrefill(next?.method ? { method: next.method } : null); setUnlockedView('contract-execute'); }}
                    onDeposit={() => { setContractRef(ref); setUnlockedView('contract-deposit'); }}
                    onWithdraw={() => { setContractRef(ref); setUnlockedView('contract-withdraw'); }}
                    onStakeToContract={() => { setContractRef(ref); setUnlockedView('contract-stake'); }}
                    onBack={goBack}
                    {...extra}
                />
            );
            if (unlockedView === 'contracts-list' || unlockedView === 'contract-detail') {
                if ((unlockedView === 'contracts-list' && activeWalletId) || (unlockedView === 'contract-detail' && activeWalletId && contractRef)) {
                    return (
                        <ContractsList
                            walletId={activeWalletId}
                            onOpenContract={(cid, actionIndex) => {
                                setContractRef({
                                    chainId: cid,
                                    contractActionIndex: String(actionIndex),
                                });
                                setUnlockedView('contract-detail');
                            }}
                            onDeploy={() => setUnlockedView('contract-deploy')}
                            onBack={goBack}
                            selectedContract={contractRef}
                            onSelectContract={setContractRef}
                            renderContract={(ref, panel) => renderContractDetail(ref, {
                                embedded: true,
                                headerSlot: panel.toolsSlot,
                            })}
                            renderContractPage={unlockedView === 'contract-detail'
                                ? (ref, page) => renderContractDetail(ref, { measureRef: page.measureRef })
                                : undefined}
                        />
                    );
                }
            }
            if (unlockedView === 'contract-stake' && activeWalletId && contractRef) {
                return (
                    <StakingForm
                        walletId={activeWalletId}
                        target={{ kind: 'contract', chainId: contractRef.chainId, contractActionIndex: contractRef.contractActionIndex }}
                        action={contractRef.initialMode || 'stake'}
                        initialTick={contractRef.initialTick}
                        initialSigningPubkey={contractRef.initialSigningPubkey}
                        initialFromAddress={contractRef.initialFromAddress}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'contract-deploy' && activeWalletId) {
                return (
                    <DeployContractForm
                        walletId={activeWalletId}
                        onBack={goBack}
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
                        onBack={() => { setExecutePrefill(null); goBack(); }}
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
                        onBack={goBack}
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
                        onBack={goBack}
                    />
                );
            }
            // One stake's detail, for its own page and for Staking's right
            // panel on wide content. The stake's forms read stakingRef, which
            // StakingList keeps on the stake the right panel shows.
            const renderStakeDetail = (ref, extra = {}) => (
                <StakeDetail
                    walletId={activeWalletId}
                    kind={ref.kind}
                    chainId={ref.chainId}
                    address={ref.address}
                    contractActionIndex={ref.contractActionIndex}
                    onUnstake={ref.kind === 'contract'
                        ? (position) => {
                            setContractRef({
                                chainId: ref.chainId,
                                contractActionIndex: String(ref.contractActionIndex),
                                initialMode: 'unstake',
                                // Seed the form from THIS position (xchain-wallet#34)
                                // instead of letting it fall back to XCHAIN/blank/default-address.
                                initialTick: position?.tick || undefined,
                                initialSigningPubkey: position?.signingPubkey || undefined,
                                initialFromAddress: ref.address || undefined,
                            });
                            setUnlockedView('contract-stake');
                        }
                        : () => setUnlockedView('staking-unstake')}
                    onDelegate={ref.kind === 'contract'
                        ? (position) => {
                            setContractRef({
                                chainId: ref.chainId,
                                contractActionIndex: String(ref.contractActionIndex),
                                initialMode: 'delegate',
                                initialTick: position?.tick || undefined,
                                initialSigningPubkey: position?.signingPubkey || undefined,
                                initialFromAddress: ref.address || undefined,
                            });
                            setUnlockedView('contract-stake');
                        }
                        : () => setUnlockedView('staking-delegate')}
                    onRevokeDelegation={() => setUnlockedView('staking-revoke')}
                    onClaimRewards={() => setUnlockedView('staking-claim')}
                    onStakeMore={ref.kind === 'contract'
                        ? (position) => {
                            setContractRef({
                                chainId: ref.chainId,
                                contractActionIndex: String(ref.contractActionIndex),
                                initialMode: 'stake',
                                initialTick: position?.tick || undefined,
                                initialSigningPubkey: position?.signingPubkey || undefined,
                                initialFromAddress: ref.address || undefined,
                            });
                            setUnlockedView('contract-stake');
                        }
                        : () => setUnlockedView('stake-form')}
                    onOpenContract={ref.kind === 'contract'
                        ? () => {
                            setContractRef({
                                chainId: ref.chainId,
                                contractActionIndex: String(ref.contractActionIndex),
                            });
                            setUnlockedView('contract-detail');
                        }
                        : undefined}
                    {...extra}
                />
            );
            // Staking, and a stake opened on its own route: on wide content
            // both are the list beside the picked stake, as the DEX shows its
            // markets; narrower, the list and the stake's page as before.
            // Stake detail needs its stake; without one the route falls through as before.
            if (unlockedView === 'staking-dashboard' || unlockedView === 'stake-detail') {
                if ((unlockedView === 'staking-dashboard' && activeWalletId) || (unlockedView === 'stake-detail' && activeWalletId && stakingRef)) {
                    return (
                        <StakingList
                            walletId={activeWalletId}
                            activeAccountId={activeAccountId || undefined}
                            onOpenStake={(ref) => {
                                setStakingRef(ref);
                                setUnlockedView('stake-detail');
                            }}
                            onNewStake={() => setUnlockedView('stake-new')}
                            onBack={goBack}
                            selectedStake={stakingRef}
                            onSelectStake={setStakingRef}
                            onClaim={(ref) => {
                                setStakingRef(ref);
                                setUnlockedView('staking-claim');
                            }}
                            renderStake={(ref, panel) => renderStakeDetail(ref, {
                                embedded: true,
                                headerSlot: panel.toolsSlot,
                                preloaded: panel.preloaded,
                            })}
                            renderStakePage={unlockedView === 'stake-detail'
                                ? (ref, page) => renderStakeDetail(ref, { onBack: goBack, measureRef: page.measureRef })
                                : undefined}
                        />
                    );
                }
            }
            if (unlockedView === 'stake-new' && activeWalletId) {
                return (
                    <StakeNew
                        walletId={activeWalletId}
                        onPickValidator={(chainId) => {
                            setStakingRef({ kind: 'validator', chainId, address: '' });
                            setUnlockedView('stake-form');
                        }}
                        onPickContract={() => setUnlockedView('contracts-list')}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'stake-form' && activeWalletId && stakingRef) {
                return (
                    <StakingForm
                        walletId={activeWalletId}
                        target={{ kind: 'network', chainId: stakingRef.chainId }}
                        action="stake"
                        initialFromAddress={stakingRef.address || undefined}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'staking-unstake' && activeWalletId && stakingRef) {
                return (
                    <StakingForm
                        walletId={activeWalletId}
                        target={{ kind: 'network', chainId: stakingRef.chainId }}
                        action="unstake"
                        initialFromAddress={stakingRef.address || undefined}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'staking-claim' && activeWalletId && stakingRef) {
                return (
                    <StakingForm
                        walletId={activeWalletId}
                        target={{ kind: 'network', chainId: stakingRef.chainId }}
                        action="claim-rewards"
                        initialFromAddress={stakingRef.address || undefined}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'staking-delegate' && activeWalletId && stakingRef) {
                return (
                    <StakingForm
                        walletId={activeWalletId}
                        target={{ kind: 'network', chainId: stakingRef.chainId }}
                        action="delegate"
                        initialFromAddress={stakingRef.address || undefined}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'staking-revoke' && activeWalletId && stakingRef) {
                return (
                    <StakingForm
                        walletId={activeWalletId}
                        target={{ kind: 'network', chainId: stakingRef.chainId }}
                        action="revoke"
                        initialFromAddress={stakingRef.address || undefined}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'history' && activeWalletId) {
                return (
                    <History
                        key={`${activeWalletId}:${activeAccountId || 'all'}`}
                        walletId={activeWalletId}
                        accountId={activeAccountId || undefined}
                        onBack={goBack}
                        onReceive={() => { setReceivePrefill(null); setUnlockedView('receive'); }}
                        initialSearchQuery={historyInitialQuery}
                        initialChainCoin={historyInitialChainCoin}
                        initialFocus={historyInitialFocus}
                        onSelectEntry={(entry) => {
                            setSelectedHistoryEntry(entry);
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
                        onBack={goBack}
                        onOpenDispenser={(chainId, actionIndex) => {
                            setDispenserRef({ chainId, actionIndex });
                            setUnlockedView('dispenser-detail');
                        }}
                    />
                );
            }
            // Held-token detail view, ported from the web shell so
            // Home balance rows and palette token commands land somewhere.
            // The same TokenDetail draws wide Home's detail panel (G115,
            // `embedded`) and My Tokens' token page (`ownerView`, the
            // manage-token route): one page, one layout. Every action first
            // makes this asset the shell's token, so a form opened from the
            // panel gets it.
            const renderTokenDetail = (assetRef, { embedded = false, ownerView = false } = {}) => {
                const asset = () => {
                    setTokenDetailRef(assetRef);
                    return assetRef;
                };
                // The issuer's actions: each form opens with this token and the
                // issuer the page resolved, and Back returns to the page.
                const openOwnerForm = (view, ctx, options = {}) => {
                    setTokenDetailRef(ctx?.issuer ? { ...assetRef, issuer: ctx.issuer } : assetRef);
                    setFormSource('token-detail');
                    setTokenAdminInitialPicker(options.initialPicker || null);
                    setUnlockedView(view);
                };
                const manageActions = {
                    onIssueSubtoken: (ctx) => openOwnerForm('wizard', ctx),
                    onMint: (ctx) => openOwnerForm('mint', ctx),
                    onDestroy: (ctx) => openOwnerForm('destroy', ctx),
                    onLock: (ctx) => openOwnerForm('lock', ctx),
                    onMintSettings: (ctx) => openOwnerForm('mint-settings', ctx),
                    onCallbackSettings: (ctx) => openOwnerForm('callback-settings', ctx),
                    onExecuteCallback: (ctx) => openOwnerForm('execute-callback', ctx),
                    onAccessLists: (ctx) => openOwnerForm('access-lists', ctx),
                    onUseSharedBlockList: (ctx) => openOwnerForm('access-lists', ctx, { initialPicker: 'shared-block' }),
                    onBridgeSettings: (ctx) => openOwnerForm('bridge-settings', ctx),
                    onPauseToken: (ctx) => openOwnerForm('pause-token', ctx),
                    onUpdateDescription: (ctx) => openOwnerForm('description', ctx),
                    onAttachContent: (ctx) => openOwnerForm('attach-content', ctx),
                    onGatedContent: (ctx) => openOwnerForm('gated-publish', ctx),
                    onManageRoster: (ctx) => openOwnerForm('project-roster', ctx),
                    onTransferOwnership: (ctx) => openOwnerForm('transfer', ctx),
                    onSellOwnership: (ctx) => {
                        setSellNameRef({ chainId: assetRef.chainId, tick: assetRef.tick, fromAddress: ctx?.issuer || assetRef.issuer || undefined });
                        openOwnerForm('sell-name', ctx);
                    },
                    onCreateDispenser: (ctx) => openOwnerForm('dispenser', ctx),
                    onPayDividend: (ctx) => openOwnerForm('dividend', ctx),
                    onAirdrop: (ctx) => { setResumeAirdropId(null); openOwnerForm('airdrop', ctx); },
                    onBroadcast: (ctx) => openOwnerForm('broadcast', ctx),
                    onBindController: (ctx) => openOwnerForm('controller-bind', ctx),
                    onUnbindController: (ctx) => openOwnerForm('controller-unbind', ctx),
                };
                return (
                    <TokenDetail
                        walletId={activeWalletId}
                        chainId={assetRef.chainId}
                        tick={assetRef.tick}
                        kind={assetRef.kind}
                        displayName={assetRef.displayName}
                        divisibility={assetRef.divisibility}
                        fiatRate={assetRef.fiatRate}
                        fiatRateSource={assetRef.fiatRateSource}
                        fiatRateStale={assetRef.fiatRateStale === true}
                        fiatRateFetchedAt={assetRef.fiatRateFetchedAt || null}
                        quantity={assetRef.quantity}
                        imageUrl={assetRef.imageUrl}
                        embedded={embedded}
                        manageActions={assetRef.kind === 'native' ? null : manageActions}
                        ownerView={ownerView}
                        onIssuerResolved={embedded ? undefined : (creator) => setTokenDetailRef(withResolvedIssuer(creator))}
                        onBack={goBack}
                        onSend={() => {
                            const a = asset();
                            setSendPrefill({
                                chainId: a.chainId,
                                tick: a.tick,
                                kind: a.kind,
                                displayName: a.displayName,
                                imageUrl: a.imageUrl,
                            });
                            setUnlockedView('send');
                        }}
                        onReceive={() => {
                            const a = asset();
                            setReceivePrefill({
                                chainId: a.chainId,
                                tick: a.tick,
                                kind: a.kind,
                                displayName: a.displayName,
                                imageUrl: a.imageUrl,
                            });
                            setUnlockedView('receive');
                        }}
                        onViewActivity={() => {
                            const scope = historyScopeForAsset(asset());
                            setHistoryInitialQuery(scope.searchQuery);
                            setHistoryInitialChainCoin(scope.chainCoin);
                            setUnlockedView('history');
                        }}
                        onBuy={() => {
                            const a = asset();
                            setMarketsAsset({
                                chainId: a.chainId,
                                tick: a.tick,
                                kind: a.kind,
                                displayName: a.displayName,
                            });
                            setUnlockedView('markets');
                        }}
                        // Same hop MyTokens' onSelectTick uses: tokenDetailRef
                        // carries this tick's chainId/tick, so Manage Token
                        // only needs the view switch.
                        onManageToken={() => { asset(); setUnlockedView('manage-token'); }}
                        // The Actions tab: each form opens pre-filled with this
                        // asset (the ManageToken prefill path) and Back returns
                        // here. TokenDetail offers only the ones the asset allows.
                        // The History tab's rows open the same ActionDetail
                        // view History does, and Back returns here.
                        onSelectEntry={(entry) => {
                            setSelectedHistoryEntry(entry);
                            setUnlockedView('action-detail');
                        }}
                        assetActions={(() => {
                            const openFromAsset = (view) => {
                                asset();
                                setFormSource('token-detail');
                                setTokenAdminInitialPicker(null);
                                setUnlockedView(view);
                            };
                            return {
                                onMint: () => openFromAsset('mint'),
                                onDestroy: () => openFromAsset('destroy'),
                                onSweep: () => { setSweepCtx(null); openFromAsset('sweep'); },
                                onLock: () => openFromAsset('lock'),
                                onUpdateDescription: () => openFromAsset('description'),
                                onTransferOwnership: () => openFromAsset('transfer'),
                                onPublishOraclePrice: () => openFromAsset('oracle'),
                                onCreateDispenser: () => openFromAsset('dispenser'),
                                onBrowseDispensers: () => openFromAsset('dispenser-explorer'),
                                onPayDividend: () => openFromAsset('dividend'),
                                onAirdrop: () => { setResumeAirdropId(null); openFromAsset('airdrop'); },
                                onSwap: () => openFromAsset('swap'),
                                onCrossChainSwap: () => openFromAsset('cross-chain-swap'),
                                onBridgeMove: () => openFromAsset('bridge-move'),
                                onBridgeSettings: () => openFromAsset('bridge-settings'),
                            };
                        })()}
                    />
                );
            };
            if (unlockedView === 'token-detail' && activeWalletId && tokenDetailRef) {
                return renderTokenDetail(tokenDetailRef);
            }
            // Wide Home's detail panel (G115): a coin, token or NFT is the
            // coin and token page embedded; a DeFi row is its entry detail.
            const renderHomeDetail = (item) => (item?.type === 'entry' ? (
                <ActionDetail
                    embedded
                    entry={item.entry}
                    walletId={activeWalletId}
                    onOpenDispenser={(chainId, actionIndex) => {
                        setDispenserRef({ chainId, actionIndex });
                        setUnlockedView('dispenser-detail');
                    }}
                />
            ) : renderTokenDetail(item.token, { embedded: true }));
            const selectHomeDetail = (item) => setHomeDetail({ walletId: activeWalletId, item });
            if (unlockedView === 'market-activity') {
                return (
                    <MarketActivity
                        walletId={activeWalletId}
                        onBack={goBack}
                        onOpenDispenser={(chainId, actionIndex) => {
                            setDispenserRef({ chainId, actionIndex });
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
                        onBack={goBack}
                        onIssue={() => { setFormSource(null); setUnlockedView('wizard'); }}
                        renderToken={(row) => renderTokenDetail({
                            chainId: row.chainId,
                            tick: row.tick,
                            kind: 'token',
                            divisibility: row.divisibility ?? null,
                            // A demo wallet's issued tokens carry the holding and
                            // artwork the page would otherwise read from Home's row.
                            ...(row.demo === true ? {
                                displayName: row.displayName, quantity: row.quantity, fiatRate: row.fiatRate, imageUrl: row.imageUrl,
                            } : {}),
                        }, { embedded: true, ownerView: true })}
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
                // My Tokens opens the same asset page Home does (operator
                // ruling 2026-11-15), with the issuer's groups shown at once.
                return renderTokenDetail(tokenDetailRef, { ownerView: true });
            }
            if (unlockedView === 'actions' && activeWalletId) {
                return (
                    <ActionsMenu
                        entries={buildActionEntries({
                            onIssue: () => { setFormSource(null); setUnlockedView('wizard'); },
                            onMint: () => setUnlockedView('mint'),
                            onDestroy: () => setUnlockedView('destroy'),
                            onSweep: () => { setSweepCtx(null); setUnlockedView('sweep'); },
                            onLock: () => setUnlockedView('lock'),
                            onUpdateDescription: () => setUnlockedView('description'),
                            onTransferOwnership: () => setUnlockedView('transfer'),
                            onBroadcast: () => setUnlockedView('broadcast'),
                            onPublishOraclePrice: () => setUnlockedView('oracle'),
                            onCreateDispenser: () => setUnlockedView('dispenser'),
                            onMyDispensers: () => setUnlockedView('dispensers-list'),
                            onBrowseDispensers: () => setUnlockedView('dispenser-explorer'),
                            onPayDividend: () => setUnlockedView('dividend'),
                            onAirdrop: () => {
                                setResumeAirdropId(null);
                                setUnlockedView('airdrop');
                            },
                            onLockAddress: () => setUnlockedView('lock-address'),
                            onPairSigner: () => setUnlockedView('pair-signer'),
                            onPayCoinpay: () => {
                                setResumeCoinpay(null);
                                setUnlockedView('coinpay');
                            },
                            onSwap: () => setUnlockedView('swap'),
                            onCreateOrder: () => setUnlockedView('create-order'),
                            onMyOrders: () => setUnlockedView('my-orders'),
                            onMySwaps: () => setUnlockedView('my-swaps'),
                            onPublishFile: () => setUnlockedView('publish-file'),
                            onLink: () => setUnlockedView('link-form'),
                            onBatch: () => setUnlockedView('batch-compose'),
                            onCrossChainSwap: () => setUnlockedView('cross-chain-swap'),
                            onCrossChainOrder: () => setUnlockedView('cross-chain-order'),
                            // The two XBRIDGE surfaces. Both are catalogue
                            // entries now, so the shell arms them the same way
                            // as every other row instead of appending its own
                            // copy of the label and description.
                            onBridgeMove: () => setUnlockedView('bridge-move'),
                            onBridgeSettings: () => setUnlockedView('bridge-settings'),
                            onMultisigCreate: hasBtcAddress ? () => setUnlockedView('multisig-create') : undefined,
                            onMultisigSign: hasBtcAddress ? () => {
                                setMultisigSessionId(null);
                                setMultisigInitialLink(null);
                                setUnlockedView('multisig-sign');
                            } : undefined,
                            onCoSignerAccounts: hasBtcAddress ? () => setUnlockedView('cosigner-accounts') : undefined,
                            onVoteGovernance: hasGovernanceAddress ? () => setUnlockedView('governance-polls') : undefined,
                            onBetting: () => setUnlockedView('bet-markets'),
                            onContacts: () => setUnlockedView('contacts'),
                            onSignMessage: () => setUnlockedView('sign-message'),
                            onVerifySignature: () => setUnlockedView('verify-signature'),
                            onSignPsbt: () => setUnlockedView('sign-psbt'),
                        }, { pairsTrezor: true })}
                        onBack={goBack}
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
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'settings' || unlockedView === 'connected-sites') {
                // §24 Cluster Y FOLLOWUP 2: same top-level Settings
                // route the web shell ships; 'connected-sites' deep-links
                // into the Connected Sites drilldown.
                // Palette deep-links land on a specific section via
                // settingsInitialSection; the key forces a remount when the
                // target changes while Settings is already the active view.
                const settingsSubpage = unlockedView === 'connected-sites'
                    ? 'connected-sites'
                    : settingsInitialSection;
                return (
                    <Settings
                        key={`${activeWalletId || 'none'}:${activeAccountId || 'all'}:${settingsSubpage || 'root'}`}
                        onBack={() => { setSettingsInitialSection(null); goBack(); }}
                        activeWallet={activeWallet}
                        activeAccount={headerAccounts.find((account) => account.id === activeAccountId) || null}
                        onOpenWalletPicker={() => openWalletPicker('settings')}
                        onOpenAccountPicker={
                            activeWalletId ? () => {
                                setSettingsInitialSection('g-wallets');
                                setUnlockedView('account-picker');
                            } : undefined
                        }
                        onOpenAddresses={
                            activeWalletId ? () => {
                                setSettingsInitialSection('g-wallets');
                                setAddressDetailTarget(null);
                                setUnlockedView('addresses');
                            } : undefined
                        }
                        initialSubpageId={settingsSubpage}
                        // A row on Settings, Appearance, Tokens opens that
                        // token's page; Back returns to the Tokens page.
                        onOpenToken={(tok) => {
                            setSettingsInitialSection('display-tokens');
                            setTokenDetailRef(tok);
                            setUnlockedView('token-detail');
                        }}
                        onNavigateToMint={handleFaucetMint}
                        onNavigateToAdvanced={() => setUnlockedView('advanced')}
                        onNavigateToActionQueue={() => setUnlockedView('parallel-compose')}
                        onPairAnotherPhone={() => setUnlockedView('pair-partner')}
                    />
                );
            }
            if (unlockedView === 'wallet-details' && walletDetailsId) {
                return (
                    <WalletDetails
                        walletId={walletDetailsId}
                        onBack={() => {
                            setWalletDetailsId(null);
                            goBack();
                        }}
                        onRename={(wallet) => {
                            setWalletRenameTarget({ id: wallet.id, name: wallet.name });
                            setUnlockedView('wallet-rename');
                        }}
                        onExited={refresh}
                        // Set as active wallet switches to this wallet and
                        // stays on its page; the row hides once it is active.
                        activeWalletId={activeWalletId}
                        onMakeActive={(wallet) => handleSwitchWallet(wallet.id, wallet.name)}
                        // Remove wallet opens its own page for this wallet, which
                        // leaves the active wallet as it is unless this is the one removed.
                        onRemoveWallet={() => setUnlockedView('wallet-remove')}
                        // Settings' Backup page for a Wallet Details action with no page of
                        // its own; it acts on the active wallet, so this one becomes active.
                        onOpenSettings={() => {
                            if (walletDetailsId !== activeWalletId) handleSwitchWallet(walletDetailsId);
                            setSettingsInitialSection('backup-export');
                            setUnlockedView('settings');
                        }}
                        onShowRecoveryPhrase={(wallet) => {
                            setRecoveryPhraseWallet({ id: wallet.id, name: wallet.name || '' });
                            setUnlockedView('wallet-phrase');
                        }}
                        // Export backup opens its own page for this wallet,
                        // which leaves the active wallet as it is.
                        onExportBackup={() => setUnlockedView('wallet-backup')}
                        onMigrateToBip39={() => {
                            setMigrateLegacyWalletId(walletDetailsId);
                            setUnlockedView('migrate-bip39');
                        }}
                        // A hardware wallet's Unlink removed it.
                        onUnlinked={handleWalletUnlinked}
                        onReconnect={handleHardwareReconnect}
                        onOpenAccounts={handleHardwareOpenAccounts}
                    />
                );
            }
            // Export backup for the wallet whose Wallet Details page opened it.
            if (unlockedView === 'wallet-backup' && walletDetailsId) {
                const backupWallet = walletList.find((w) => w.id === walletDetailsId);
                return (
                    <ExportWalletBackup
                        walletId={walletDetailsId}
                        walletName={backupWallet?.name || ''}
                        walletFormat={backupWallet?.format}
                        onBack={goBack}
                    />
                );
            }
            // Remove the wallet whose Wallet Details page opened it.
            if (unlockedView === 'wallet-remove' && walletDetailsId) {
                const removeWallet = walletList.find((w) => w.id === walletDetailsId);
                return (
                    <RemoveWallet
                        walletId={walletDetailsId}
                        walletName={removeWallet?.name || ''}
                        walletFormat={removeWallet?.format}
                        activeWalletId={activeWalletId}
                        onBack={goBack}
                        onRemoved={() => {
                            listWallets()
                                .then((list) => { if (Array.isArray(list)) setWalletList(list); })
                                .catch(() => { /* the list refreshes on the next unlock */ });
                            setWalletDetailsId(null);
                            nav.land('wallet-picker');
                        }}
                    />
                );
            }
            // Show recovery phrase for the wallet whose page opened it.
            if (unlockedView === 'wallet-phrase' && recoveryPhraseWallet) {
                return (
                    <ViewRecoveryPhrase
                        walletId={recoveryPhraseWallet.id}
                        walletName={recoveryPhraseWallet.name}
                        onBack={() => {
                            setRecoveryPhraseWallet(null);
                            goBack();
                        }}
                    />
                );
            }
            if (unlockedView === 'wallet-rename' && walletRenameTarget) {
                return (
                    <RenameWalletForm
                        walletId={walletRenameTarget.id}
                        initialName={walletRenameTarget.name}
                        refreshKey={recordRevision}
                        onBack={() => {
                            setWalletRenameTarget(null);
                            goBack();
                        }}
                        // A saved name lands on Wallet Details, past the form.
                        onRenamed={(wallet) => {
                            if (wallet?.id) {
                                setWalletList((list) => list.map((entry) => (
                                    entry.id === wallet.id ? { ...entry, ...wallet } : entry
                                )));
                            }
                            setWalletRenameTarget(null);
                            nav.land('wallet-details');
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
                        onRenameAccount={(account) => {
                            setAccountRenameTarget(account);
                            setUnlockedView('account-rename');
                        }}
                        onShowDetails={(account) => {
                            setAccountDetailsId(account.id);
                            setUnlockedView('account-details');
                        }}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'account-details' && activeWalletId && accountDetailsId) {
                return (
                    <AccountDetails
                        walletId={activeWalletId}
                        accountId={accountDetailsId}
                        activeAccountId={activeAccountId}
                        onBack={() => {
                            setAccountDetailsId(null);
                            goBack();
                        }}
                        onMakeActive={(account) => handleSwitchAccount(account.id)}
                        onRename={(account) => {
                            setAccountRenameTarget(account);
                            setUnlockedView('account-rename');
                        }}
                        // Shown only for the active account, so Settings'
                        // export page acts on the account this page shows.
                        onExtendedKeys={() => {
                            setSettingsInitialSection('wallet-xpub');
                            setUnlockedView('settings');
                        }}
                    />
                );
            }
            if (unlockedView === 'account-rename' && accountRenameTarget) {
                return (
                    <RenameAccountForm
                        accountId={accountRenameTarget.id}
                        walletId={activeWalletId}
                        initialName={accountRenameTarget.name}
                        refreshKey={recordRevision}
                        onBack={() => {
                            setAccountRenameTarget(null);
                            goBack();
                        }}
                        // Saved or not, the form gives way to the page that opened it.
                        onRenamed={() => {
                            setAccountRenameTarget(null);
                            goBack();
                        }}
                    />
                );
            }
            if (unlockedView === 'add-account' && activeWalletId) {
                return (
                    <AddAccountForm
                        walletId={activeWalletId}
                        onBack={goBack}
                        onCreated={(account) => {
                            if (account?.id) handleSwitchAccount(account.id);
                            setSignerListKey((n) => n + 1);
                            setUnlockedView('home');
                        }}
                    />
                );
            }
            if (unlockedView === 'add-wallet') {
                if (onboardingStep === 'create') {
                    return (
                        <CreateWallet
                            mode="add"
                            onBack={() => setOnboardingStep('welcome')}
                            onCreated={handleWalletAdded}
                        />
                    );
                }
                if (onboardingStep === 'import') {
                    return (
                        <ImportWallet
                            mode="add"
                            onBack={() => setOnboardingStep('welcome')}
                            onImported={handleWalletAdded}
                        />
                    );
                }
                if (onboardingStep === 'import-freewallet') {
                    return (
                        <ImportWallet
                            mode="add"
                            variant="freewallet"
                            onBack={() => setOnboardingStep('welcome')}
                            onImported={handleWalletAdded}
                        />
                    );
                }
                if (onboardingStep === 'pair-signer') {
                    return (
                        <PairSignerForm
                            mode="add"
                            pairTrezor={pairTrezorSigner}
                            pairLedger={pairLedgerSigner}
                            onBack={() => setOnboardingStep('welcome')}
                            onCreated={handleHardwareWalletAdded}
                            onSignerPaired={registerLocalSigner}
                        />
                    );
                }
                return (
                    <Onboarding
                        mode="add"
                        onCreate={() => setOnboardingStep('create')}
                        onImport={() => setOnboardingStep('import')}
                        onImportFromFreeWallet={() => setOnboardingStep('import-freewallet')}
                        onConnectHardware={() => setOnboardingStep('pair-signer')}
                        hardwareFactories={HARDWARE_PAIR_FACTORIES}
                        onBack={() => {
                            setOnboardingStep('welcome');
                            goBack();
                        }}
                    />
                );
            }
            if (unlockedView !== 'home') {
                return <RouteNotFound onHome={() => setUnlockedView('home')} />;
            }
            return (
                <Fragment key={`${activeWalletId}:${activeAccountId || 'all'}`}>
                    <Home
                    activeWalletId={activeWalletId}
                    onReceive={activeWalletId ? () => { setReceivePrefill(null); setUnlockedView('receive'); } : undefined}
                    onExchange={activeWalletId ? () => {
                        setMarketsAsset(defaultDexAssetForNetwork(settings?.activeNetwork));
                        setUnlockedView('markets');
                    } : undefined}
                    onHistory={activeWalletId ? () => {
                        setHistoryInitialQuery('');
                        setHistoryInitialChainCoin('');
                        setUnlockedView('history');
                    } : undefined}
                    onSelectToken={activeWalletId ? (tok) => {
                        setTokenDetailRef(tok);
                        setUnlockedView('token-detail');
                    } : undefined}
                    onSelectEntry={activeWalletId ? (entry) => {
                        setSelectedHistoryEntry(entry);
                        setUnlockedView('action-detail');
                    } : undefined}
                    onOpenWalletPicker={() => openWalletPicker()}
                    onOpenAccountPicker={activeWalletId ? () => setUnlockedView('account-picker') : undefined}
                    onSignPsbt={activeWalletId ? () => setUnlockedView('sign-psbt') : undefined}
                    onSignMessage={activeWalletId ? () => setUnlockedView('sign-message') : undefined}
                    onVerifySignature={activeWalletId ? () => setUnlockedView('verify-signature') : undefined}
                    activeAccountId={activeAccountId}
                    onSwitchAccount={handleSwitchAccount}
                    renderDetail={activeWalletId ? renderHomeDetail : undefined}
                    detailSelection={homeDetail?.walletId === activeWalletId ? homeDetail.item : null}
                    onDetailSelect={selectHomeDetail}
                    />
                </Fragment>
            );
            })();
            const handleNavLock = handleLock;
            // The sidebar's wallet switcher opens My wallets as a root page.
            const handleOpenWalletPicker = () => openRootView('wallet-picker');
            // Opening Settings from a nav surface starts the history over on
            // it, as every nav pick does.
            const handleOpenSettings = () => {
                setSettingsInitialSection(null);
                resetNav('settings');
            };
            const handleShellSelect = (view) => {
                // Picking the root page already on screen does nothing; the
                // same page reached from another page starts over.
                if (unlockedView === view && !nav.canGoBack) return;
                if (view === 'send') {
                    setSendPrefill(null);
                } else if (view === 'receive') {
                    setReceivePrefill(null);
                } else if (view === 'history') {
                    setHistoryInitialQuery('');
                    setHistoryInitialChainCoin('');
                    setHistoryInitialFocus(null);
                } else if (view === 'messaging') {
                    setMessagingThread(null);
                } else if (view === 'multisig-sign') {
                    // A fresh signing session, as the All actions row opens it.
                    setMultisigSessionId(null);
                    setMultisigInitialLink(null);
                } else if (view === 'add-wallet') {
                    // The add-wallet chooser, as My wallets' Add wallet opens it.
                    setOnboardingStep('welcome');
                } else if (view === 'coinpay') {
                    // A fresh payment, as the All actions row opens it.
                    setResumeCoinpay(null);
                }
                // Every nav and menu row opens its page as a root: the history
                // starts over on it, so it shows no Back (G06).
                palette.navigate(view);
            };
            const activeWalletName =
                walletList.find((w) => w.id === activeWalletId)?.name || undefined;
            // §33 command list: shared catalogue + lazily-loaded contacts,
            // each run() using the palette navigator so the destination
            // receives a fresh route mount.
            const paletteCtx = {
                navigate: palette.navigate,
                lock: handleNavLock,
                refresh,
                scan: () => palette.navigate('scan'),
                switchWallet: () => palette.navigate('wallet-picker'),
                openBetTab: (tab) => { setBetTab(tab); palette.navigate('bet-markets'); },
                openHelp: () => setShortcutHelpOpen(true),
                hasBtcAddress,
                hasVmAddress,
                hasGovernanceAddress,
                hasDexSurface: true,
                isSignerMode,
                isWatcherMode,
                isDemoWallet: isDemoWallet(activeWalletId),
            };
            // entity handlers: tokens open TokenDetail with the full
            // ref the row already carries (desktop parity); sites land
            // on the Connected Sites drilldown; settings sections deep-link
            // via settingsInitialSection; help topics open the shortcut help
            // modal.
            const openSettingsSection = (sectionId) => {
                if (sectionId === 'connected-sites') { palette.navigate('connected-sites'); return; }
                setSettingsInitialSection(sectionId);
                palette.navigate('settings');
            };
            const paletteEntityCtx = {
                openToken: (tok) => { setTokenDetailRef(tok); palette.navigate('token-detail'); },
                openConnectedSites: () => palette.navigate('connected-sites'),
                openSettings: openSettingsSection,
                openHelp: () => setShortcutHelpOpen(true),
                hiddenSettingsSections: hiddenSettingsSectionIds({ settings }),
            };
            const paletteCommands = [
                ...buildCommands(paletteCtx),
                ...balancesToCommands(paletteTokenRows, paletteEntityCtx),
                ...contactsToCommands(paletteContacts, { navigate: palette.navigate }),
                ...sitesToCommands(paletteSites, paletteEntityCtx),
                ...settingsSectionsToCommands(paletteEntityCtx),
                ...helpToCommands(paletteEntityCtx),
            ];
            // §33.3: free-form "send 100 MYTOKEN" opens Send prefilled (Send
            // resolves the chain from the first available when unset). A
            // txid/date-shaped query offers "search history".
            const paletteParseQuery = (q) => parseFreeformCommands(q, {
                isSignerMode,
                isDemoWallet: isDemoWallet(activeWalletId),
                composeSend: ({ amount, tick }) => {
                    setSendPrefill({ amount, tick });
                    palette.navigate('send');
                },
                searchHistory: (query) => {
                    setHistoryInitialQuery(query);
                    setHistoryInitialChainCoin('');
                    palette.navigate('history');
                },
            });
            // Assigned rather than returned directly so the whole unlocked
            // tree (both nav surfaces AND the route, Home included) sits under
            // one CoinpayObligationsProvider, which is the tree's only
            // pending-COINPAY scan.
            const unlockedTree = (
                <FullLayoutWithNav
                    routeKey={`${unlockedView}:${palette.navigationKey}`}
                    nav={
                        <LeftNav
                            currentView={unlockedView}
                            onSelect={handleShellSelect}
                            onLock={handleNavLock}
                            onOpenWalletPicker={handleOpenWalletPicker}
                            onOpenSettings={handleOpenSettings}
                            walletName={activeWalletName}
                            hasVmAddress={hasVmAddress}
                            hasBtcAddress={hasBtcAddress}
                            hasGovernanceAddress={hasGovernanceAddress}
                            hasDexSurface
                            isSignerMode={isSignerMode}
                        />
                    }
                    bottomBar={
                        <BottomTabBar
                            currentView={unlockedView}
                            onSelect={handleShellSelect}
                            onOpenSettings={handleOpenSettings}
                            isSignerMode={isSignerMode}
                        />
                    }
                    header={
                        <ShellAppHeader
                            walletId={activeWalletId}
                            accountId={activeAccountId}
                            alerts={menuAlerts}
                            onOpenNotifications={() => handleShellSelect('alerts')}
                            onResumeCoinpay={activeWalletId ? (ref) => { setResumeCoinpay(ref); setUnlockedView('coinpay'); } : undefined}
                            onResumeAirdrop={activeWalletId ? (id) => { setResumeAirdropId(id); setUnlockedView('airdrop'); } : undefined}
                            onMenuToggle={palette.togglePalette}
                            menuOpen={palette.open}
                            onLock={handleNavLock}
                            isWatcherMode={isWatcherMode}
                            activeWallet={activeWalletId ? { id: activeWalletId, name: activeWalletName } : null}
                        />
                    }
                    notices={
                        activeWalletId ? (
                            <>
                                {/* An erase scheduled from a lock screen (another window) shows first. */}
                                <EraseScheduledNotice />
                                {waitingLinkDropped.node}
                                <LockedSendOutcomeNotice walletId={activeWalletId} routeKey={unlockedView} />
                                <QueuedBroadcastBanner walletId={activeWalletId} />
                                {/* Demo data is fixture data and never stale, so no reachability notice. */}
                                {isDemoWallet(activeWalletId) ? null : <ReachabilityBanner />}
                            </>
                        ) : null
                    }
                >
                    <ShellRouteOutlet
                        routeKey={unlockedView}
                        walletId={activeWalletId}
                        resetKey={`${unlockedView}:${palette.navigationKey}`}
                        onHome={() => setUnlockedView('home')}
                        canGoBack={nav.canGoBack}
                    >
                        <Fragment key={`${palette.navigationKey}:${networkRevision}:${recordListRevision}`}>{routeNode}</Fragment>
                    </ShellRouteOutlet>
                    {messageSentNotice ? (
                        <NoticeModal
                            title={t('shell.messageSent')}
                            onClose={() => setMessageSentNotice(false)}
                        />
                    ) : null}
                    {deepLinkNotice ? (
                        <NoticeModal
                            title={t('shell.cannotOpenLink')}
                            message={deepLinkNotice}
                            onClose={() => setDeepLinkNotice(null)}
                        />
                    ) : null}
                    <CommandPalette
                        open={palette.open}
                        onClose={palette.closePalette}
                        commands={paletteCommands}
                        parseQuery={paletteParseQuery}
                        menu={{
                            gates: {
                                isSignerMode,
                                hasDexSurface: true,
                                hasVmAddress,
                                hasBtcAddress,
                                hasGovernanceAddress,
                            },
                            currentView: unlockedView,
                            onSelect: handleShellSelect,
                            onOpenSettings: handleOpenSettings,
                            onLock: handleNavLock,
                        }}
                    />
                    <ShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} overrides={settings?.keyboard?.bindings} />
                    {/* One sign page per shell: it shows itself while a hardware wallet signs. */}
                    <Suspense fallback={null}>
                        <HardwareSignPage />
                    </Suspense>
                </FullLayoutWithNav>
            );
            return (
                <CoinpayObligationsProvider walletId={activeWalletId} accountId={activeAccountId}>
                    {unlockedTree}
                </CoinpayObligationsProvider>
            );
        }
        default:
            return <Loading error={t('shell.unknownState', { state: status.state })} />;
    }
}

/**
 * §24.6 / Cluster Y FOLLOWUP 4: parse the `xc-init-route` search-string
 * entry main appended to the BrowserWindow's loadFile when the window
 * was spawned via `xchain:open-window` IPC. Returns the decoded
 * { initialView?, initialContext? } payload, or null when the slot is
 * absent / malformed. Strips the search string from the URL after
 * parsing so a renderer reload doesn't re-trigger the route.
 */
function parseInitialRoute() {
    if (typeof window === 'undefined') return null;
    try {
        const params = new URLSearchParams(window.location.search || '');
        const raw = params.get('xc-init-route');
        if (!raw) return null;
        const json = atob(decodeURIComponent(raw));
        const parsed = JSON.parse(json);
        // Strip the search so a refresh doesn't re-route. Keep pathname
        // + hash; everything we need is now in component state.
        try {
            const stripped = window.location.pathname + window.location.hash;
            window.history.replaceState({}, '', stripped);
        } catch { /* same-origin call must succeed; swallow on prudish jsdom */ }
        if (!parsed || typeof parsed !== 'object') return null;
        return /** @type {{ initialView?: string, initialContext?: any }} */ (parsed);
    } catch {
        return null;
    }
}
