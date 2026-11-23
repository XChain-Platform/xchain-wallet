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

import { Fragment, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '@xchain-wallet/core/ui/Skeleton.jsx';
import { useAutoLockPolicy } from '@xchain-wallet/core/shared/hooks/useAutoLockPolicy.js';
import { useLastView } from '@xchain-wallet/core/shared/hooks/useLastView.js';
import { useDocumentTitle } from '@xchain-wallet/core/shared/hooks/useDocumentTitle.js';
import { useScannedPsbt } from '@xchain-wallet/core/shared/hooks/useScannedPsbt.js';
import { subscribeVaultWipe } from '@xchain-wallet/core/shared/utils/wipeWalletStorage.js';
import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';
import { useSettings } from '@xchain-wallet/core/shared/hooks/useSettings.js';
import { useActiveWalletModeSource, useWalletMode } from '@xchain-wallet/core/shared/hooks/useWalletMode.js';
import { useWalletFilters } from '@xchain-wallet/core/shared/hooks/useWalletFilters.js';
import { Loading } from '@xchain-wallet/core/shared/routes/Loading.jsx';
import { VaultUnavailable } from '@xchain-wallet/core/shared/routes/VaultUnavailable.jsx';
import { vaultErrorKind } from '../../core/src/storage/backend.js';
import { clearActiveAccount, writeActiveAccount } from '@xchain-wallet/core/shared/utils/activeAccountMemory.js';
import { reconcileActiveAccount } from '@xchain-wallet/core/shared/utils/activeAccountScope.js';
import { readActiveWallet, writeActiveWallet } from '@xchain-wallet/core/shared/utils/activeWalletMemory.js';
import { takePostDemoIntent } from '@xchain-wallet/core/shared/utils/demoGraduation.js';
import { createLaunchRouteState, shouldClearTransientState } from '@xchain-wallet/core/shared/utils/launchRouteState.js';
import { clearSensitiveCopy } from '@xchain-wallet/core/shared/clipboard.js';
import { historyScopeForAsset } from '@xchain-wallet/core/shared/utils/historyEntryScope.js';
import {
    defaultDexAssetForNetwork, defaultDispenserAssetForNetwork,
    syncDexAssetToNetwork, syncDispenserAssetToNetwork,
} from '@xchain-wallet/core/shared/chainSelection.js';
import { lockImmediately } from '@xchain-wallet/core/shared/utils/lockAction.js';
import { useMessagingUnread } from '@xchain-wallet/core/shared/hooks/useMessagingUnread.js';
import { CoinpayObligationsProvider } from '@xchain-wallet/core/shared/hooks/useCoinpayObligations.js';
import { useDemoAutoWipe } from '@xchain-wallet/core/shared/hooks/useDemoAutoWipe.js';
import { Locked } from '@xchain-wallet/core/shared/routes/Locked.jsx';
import { isDemoWallet } from '../../core/src/flows/demoMode.js';
import { ToastHost, useClearToastsOnLock, useToast } from '@xchain-wallet/core/shared/components/ToastHost.jsx';
import { RouteErrorBoundary } from '@xchain-wallet/core/shared/components/RouteErrorBoundary.jsx';
import { ShellRouteOutlet } from '@xchain-wallet/core/shared/components/ShellRouteOutlet.jsx';
import {
    applySendAssetPick,
    beginSendAssetSwitch,
    cancelSendAssetSwitch,
} from '@xchain-wallet/core/shared/utils/sendAssetSwitch.js';
import { NOTIFICATION_EVENT } from './notifications/webNotifyAdapter.js';
import { createNotificationToastGate } from './notifications/notificationToastGate.js';
import { ReachabilityBanner } from '@xchain-wallet/core/shared/components/ReachabilityBanner.jsx';
import { useWaitingLinkDropped } from '@xchain-wallet/core/shared/components/WaitingLinkDroppedNotice.jsx';
// §6 / D4. Renders nothing unless a shell installed a direct-update
// provider, which only a sideloaded Android APK does; see flows/directUpdate.js.
import { UpdateNoticeBanner } from '@xchain-wallet/core/shared/components/UpdateNoticeBanner.jsx';
import { LeftNav, FullLayoutWithNav } from '@xchain-wallet/core/shared/components/LeftNav.jsx';
import { ShellAppHeader } from '@xchain-wallet/core/shared/components/ShellAppHeader.jsx';
import { useCommandPalette } from '@xchain-wallet/core/shared/commandPalette/useCommandPalette.js';
import { createRootViewOpener } from '@xchain-wallet/core/shared/rootViewOpener.js';
import { useKeyboardShortcuts } from '@xchain-wallet/core/shared/keyboard/useKeyboardShortcuts.js';
import { dismissAllOverlays, useBackHandler } from '@xchain-wallet/core/ui/backStack.js';
import { navItemKey, useNavHistory, WALLET_SWITCH_KEEPS } from '@xchain-wallet/core/ui/navHistory.js';
import { defaultRegistry } from '../../core/src/registry/index.js';
import { withResolvedIssuer } from '@xchain-wallet/core/shared/utils/tokenDetailIssuer.js';
import { t } from '../../core/src/i18n/index.js';

const APP_CHAIN_REGISTRY = defaultRegistry();
import { BottomTabBar } from '@xchain-wallet/core/shared/components/BottomTabBar.jsx';
// The DEX surface, as one module rather than nine route blocks. A
// build whose profile hides `dex` gets the inert twin instead (vite.config.js),
// so those route components are not in the bundle at all and every entry point
// below goes with them: each one is wired only when DEX_SURFACE_ENABLED.
import { DEX_SURFACE_ENABLED, renderDexRoute } from './surfaces/dex.jsx';
import { buildWalletAlerts } from '@xchain-wallet/core/shared/walletAlerts.js';
// Both notices open after first paint, so the dialog and its styles load on demand.
import { NoticeModalOnDemand as NoticeModal } from '@xchain-wallet/core/shared/components/onDemandOverlays.js';
import { onDemandComponent, useIdlePreload } from '@xchain-wallet/core/shared/utils/onDemandComponent.js';
import { useFocusTrap } from '@xchain-wallet/core/shared/utils/focusTrap.js';
import { useBtcAddressesPresent } from '@xchain-wallet/core/shared/hooks/useBtcAddressesPresent.js';
import { useVmAddressesPresent } from '@xchain-wallet/core/shared/hooks/useVmAddressesPresent.js';
import { useAccountList } from '@xchain-wallet/core/shared/hooks/useAccountList.js';
import { useGovernanceAddressesPresent } from '@xchain-wallet/core/shared/hooks/useGovernanceAddressesPresent.js';
import {
    registerHardwareRecord,
    registerSigner as registerLocalSigner,
} from './signerBridge.js';
import {
    trackHardwareFactories, useHardwareReconnect, useHardwareSessionReset,
} from '@xchain-wallet/core/shared/hooks/useHardwareSessionReset.js';
import { openHardwareSigner } from '@xchain-wallet/core/signers/hardwareReconnect.js';
import { userFacingMessage } from '@xchain-wallet/core/shared/utils/userFacingMessage.js';
import * as messaging from './messaging.js';
import { getSessionStatus, listWallets, lockWallet, listAccounts } from './messaging.js';
import { claimedDeepLinkRoute } from '../../desktop/renderer/deepLinkRoute.js';
import { subscribeToNativeDeepLinks } from './deeplinks/nativeDeepLinks.js';
import { canApplyNativeIntent, useNativeAppLifecycle } from './platform/nativeAppLifecycle.js';
import { ExtensionBanner } from './components/ExtensionBanner.jsx';
import { useActiveVariant, shellForVariant } from './devVariant.js';
import { deferNonCriticalWork } from './deferNonCriticalWork.js';
import devShellStyles from './DevVariantShell.module.css';

const lazyRoute = (load, name) => lazy(() => load().then((module) => ({ default: module[name] })));

// The queue is read after unlock and the banner shows only when it holds an
// entry, so the banner and its styles load on idle instead of at startup.
const QueuedBroadcastBanner = onDemandComponent(
    () => import('@xchain-wallet/core/shared/components/QueuedBroadcastBanner.jsx'),
    'QueuedBroadcastBanner',
);
const LockedSendOutcomeNotice = onDemandComponent(
    () => import('@xchain-wallet/core/shared/components/LockedSendOutcomeNotice.jsx'),
    'LockedSendOutcomeNotice',
);
// An erase scheduled from another tab's lock screen; it shows only when one is.
const EraseScheduledNotice = onDemandComponent(
    () => import('@xchain-wallet/core/shared/components/EraseScheduledNotice.jsx'),
    'EraseScheduledNotice',
);

// Overlays opened by a key or a developer toggle, never needed for first
// paint. App mounts each one the first time it opens, then keeps it mounted.
const loadCommandPaletteHost = () => import('./CommandPaletteHost.jsx');
const CommandPaletteHost = lazyRoute(loadCommandPaletteHost, 'CommandPaletteHost');
const ShortcutHelp = lazyRoute(() => import('@xchain-wallet/core/shared/keyboard/ShortcutHelp.jsx'), 'ShortcutHelp');
const DevVariantBadge = lazyRoute(() => import('./DevVariantBadge.jsx'), 'DevVariantBadge');

// An unknown view renders inside the route outlet's Suspense like every other
// route, so its EmptyState and ListPage styles stay out of the startup CSS.
const RouteNotFound = lazyRoute(() => import('@xchain-wallet/core/shared/routes/RouteNotFound.jsx'), 'RouteNotFound');
const NewerWalletNeeded = lazyRoute(() => import('@xchain-wallet/core/shared/routes/NewerWalletNeeded.jsx'), 'NewerWalletNeeded');
const SiteRequestApproval = lazyRoute(() => import('@xchain-wallet/core/shared/routes/NewerWalletNeeded.jsx'), 'SiteRequestApproval');
const loadLinkHandoff = import.meta.glob('./routes/LinkHandoff.jsx')['./routes/LinkHandoff.jsx'];
const LinkHandoff = loadLinkHandoff ? lazyRoute(loadLinkHandoff, 'LinkHandoff') : null;
const AddAccountForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/AddAccountForm.jsx'), 'AddAccountForm');
const WalletPicker = lazyRoute(() => import('@xchain-wallet/core/shared/routes/WalletPicker.jsx'), 'WalletPicker');
const AccountPicker = lazyRoute(() => import('@xchain-wallet/core/shared/routes/AccountPicker.jsx'), 'AccountPicker');
const AccountDetails = lazyRoute(() => import('@xchain-wallet/core/shared/routes/AccountDetails.jsx'), 'AccountDetails');
const ViewRecoveryPhrase = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ViewRecoveryPhrase.jsx'), 'ViewRecoveryPhrase');
const ExportWalletBackup = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ExportWalletBackup.jsx'), 'ExportWalletBackup');
const RemoveWallet = lazyRoute(() => import('@xchain-wallet/core/shared/routes/RemoveWallet.jsx'), 'RemoveWallet');
const WalletDetails = lazyRoute(() => import('@xchain-wallet/core/shared/routes/WalletDetails.jsx'), 'WalletDetails');
const RenameWalletForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/RenameWalletForm.jsx'), 'RenameWalletForm');
const RenameAccountForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/RenameAccountForm.jsx'), 'RenameAccountForm');
const AlertsRoute = lazyRoute(() => import('@xchain-wallet/core/shared/routes/AlertsRoute.jsx'), 'AlertsRoute');
const KeyQR = lazyRoute(() => import('@xchain-wallet/core/shared/components/KeyQR.jsx'), 'KeyQR');
const Onboarding = lazyRoute(() => import('@xchain-wallet/core/shared/routes/Onboarding.jsx'), 'Onboarding');
const CreateWallet = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CreateWallet.jsx'), 'CreateWallet');
const ImportWallet = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ImportWallet.jsx'), 'ImportWallet');
const PairPartnerWallet = lazyRoute(() => import('@xchain-wallet/core/shared/routes/PairPartnerWallet.jsx'), 'PairPartnerWallet');
const HardwareFirstRun = lazyRoute(() => import('@xchain-wallet/core/shared/components/HardwareFirstRun.jsx'), 'HardwareFirstRun');
const HardwareSignPage = lazyRoute(() => import('@xchain-wallet/core/shared/components/HardwareSignPage.jsx'), 'HardwareSignPage');
const Home = lazyRoute(() => import('@xchain-wallet/core/shared/routes/Home.jsx'), 'Home');
const Settings = lazyRoute(() => import('@xchain-wallet/core/shared/routes/Settings.jsx'), 'Settings');
const TokenDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/TokenDetail.jsx'), 'TokenDetail');
const Send = lazyRoute(() => import('@xchain-wallet/core/shared/routes/Send.jsx'), 'Send');
const SendPicker = lazyRoute(() => import('@xchain-wallet/core/shared/routes/SendPicker.jsx'), 'SendPicker');
const Receive = lazyRoute(() => import('@xchain-wallet/core/shared/routes/Receive.jsx'), 'Receive');
const ScanRoute = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ScanRoute.jsx'), 'ScanRoute');
// The Actions menu is the one screen that reads the action catalogue (every
// action's label and description), so the two load together the first time the
// menu opens. That is why `entries` is a function of the catalogue's builder.
const loadActionsMenu = () => Promise.all([
    import('@xchain-wallet/core/shared/routes/ActionsMenu.jsx'),
    import('@xchain-wallet/core/shared/actionEntries.js'),
]).then(([menu, catalogue]) => ({
    default: function ActionsMenuWithCatalogue({ entries, ...props }) {
        return <menu.ActionsMenu {...props} entries={entries(catalogue.buildActionEntries)} />;
    },
}));
const ActionsMenu = lazy(loadActionsMenu);
const MyTokens = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MyTokens.jsx'), 'MyTokens');
const IssueTokenForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/IssueTokenForm.jsx'), 'IssueTokenForm');
const MintForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MintForm.jsx'), 'MintForm');
const DestroyForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/DestroyForm.jsx'), 'DestroyForm');
const SweepForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/SweepForm.jsx'), 'SweepForm');
const TokenAdminForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/TokenAdminForm.jsx'), 'TokenAdminForm');
const BridgeMoveForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/BridgeMoveForm.jsx'), 'BridgeMoveForm');
const CallbackForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CallbackForm.jsx'), 'CallbackForm');
const SleepForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/SleepForm.jsx'), 'SleepForm');
const BroadcastForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/BroadcastForm.jsx'), 'BroadcastForm');
const DispenserForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/DispenserForm.jsx'), 'DispenserForm');
const DispensersList = lazyRoute(() => import('@xchain-wallet/core/shared/routes/DispensersList.jsx'), 'DispensersList');
const ReceivePicker = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ReceivePicker.jsx'), 'ReceivePicker');
const MyLists = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MyLists.jsx'), 'MyLists');
const ListDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ListDetail.jsx'), 'ListDetail');
const ListLookForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ListLookForm.jsx'), 'ListLookForm');
const ListCreateForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ListCreateForm.jsx'), 'ListCreateForm');
const DispenserDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/DispenserDetail.jsx'), 'DispenserDetail');
const DispenserExplorer = lazyRoute(() => import('@xchain-wallet/core/shared/routes/DispenserExplorer.jsx'), 'DispenserExplorer');
const DividendForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/DividendForm.jsx'), 'DividendForm');
const AirdropForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/AirdropForm.jsx'), 'AirdropForm');
const AdvancedActionsForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/AdvancedActionsForm.jsx'), 'AdvancedActionsForm');
const MigrateToBip39 = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MigrateToBip39.jsx'), 'MigrateToBip39');
const CoinpayForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/CoinpayForm.jsx'), 'CoinpayForm');
const ObligationsView = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ObligationsView.jsx'), 'ObligationsView');
const SellOwnershipForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/SellOwnershipForm.jsx'), 'SellOwnershipForm');
const MessagingInbox = lazyRoute(() => import('@xchain-wallet/core/shared/routes/MessagingInbox.jsx'), 'MessagingInbox');
const ComposeMessage = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ComposeMessage.jsx'), 'ComposeMessage');
const ContactsList = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ContactsList.jsx'), 'ContactsList');
const StakingList = lazyRoute(() => import('@xchain-wallet/core/shared/routes/StakingList.jsx'), 'StakingList');
const StakeDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/StakeDetail.jsx'), 'StakeDetail');
const StakeNew = lazyRoute(() => import('@xchain-wallet/core/shared/routes/StakeNew.jsx'), 'StakeNew');
// Every staking write route (contract and validator) renders the one Staking form.
const StakingForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/StakingForm.jsx'), 'StakingForm');
const History = lazyRoute(() => import('@xchain-wallet/core/shared/routes/History.jsx'), 'History');
const ActionDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ActionDetail.jsx'), 'ActionDetail');
const LinkForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/LinkForm.jsx'), 'LinkForm');
const AttachContentForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/AttachContentForm.jsx'), 'AttachContentForm');
const GatedPublishForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/GatedPublishForm.jsx'), 'GatedPublishForm');
const PublishFileForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/PublishFileForm.jsx'), 'PublishFileForm');
const ProjectRosterForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ProjectRosterForm.jsx'), 'ProjectRosterForm');
const SignMessageForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/SignMessageForm.jsx'), 'SignMessageForm');
const VerifySignatureForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/VerifySignatureForm.jsx'), 'VerifySignatureForm');
const PsbtSignForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/PsbtSignForm.jsx'), 'PsbtSignForm');
const ViewPrivateKey = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ViewPrivateKey.jsx'), 'ViewPrivateKey');
const ParallelComposer = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ParallelComposer.jsx'), 'ParallelComposer');
const BatchComposerForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/BatchComposerForm.jsx'), 'BatchComposerForm');
const AddressList = lazyRoute(() => import('@xchain-wallet/core/shared/routes/AddressList.jsx'), 'AddressList');
const AddressPreferencesForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/AddressPreferencesForm.jsx'), 'AddressPreferencesForm');
const TokenWizard = lazyRoute(() => import('@xchain-wallet/core/shared/routes/TokenWizard.jsx'), 'TokenWizard');
const OracleForm = lazyRoute(() => import('@xchain-wallet/core/shared/routes/OracleForm.jsx'), 'OracleForm');
const ContractsList = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ContractsList.jsx'), 'ContractsList');
const ContractDetail = lazyRoute(() => import('@xchain-wallet/core/shared/routes/ContractDetail.jsx'), 'ContractDetail');
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

// A session read that never settles (a wedged storage adapter, a host bridge
// that never answers) gives way to the failure screen instead of leaving the
// loading dots up forever. It sits well above a slow but working adapter.
export const SESSION_STATUS_TIMEOUT_MS = 20_000;

function getSessionStatusWithTimeout() {
    let timer;
    return Promise.race([
        Promise.resolve().then(() => getSessionStatus()),
        new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error('The wallet storage did not respond.')),
                SESSION_STATUS_TIMEOUT_MS,
            );
        }),
    ]).finally(() => clearTimeout(timer));
}

// Loaded on first pairing; a lock or wallet switch resets the loaded ones.
const TREZOR_PAIRING_ENABLED = import.meta.env.XCHAIN_TREZOR_PAIRING !== false;
const hardwareFactories = trackHardwareFactories({
    ...(TREZOR_PAIRING_ENABLED ? { trezor: () => import('./signers/trezorFactory.js') } : {}),
    ledger: () => import('./signers/ledgerFactory.js'),
});
const pairTrezorSigner = TREZOR_PAIRING_ENABLED
    ? (...args) => hardwareFactories.load('trezor')
        .then((module) => module.pairTrezorSigner(...args))
    : null;
const pairLedgerSigner = (...args) => hardwareFactories.load('ledger')
    .then((module) => module.pairLedgerSigner(...args));
const resetHardwareSessions = () => hardwareFactories.reset();
// The same factories reopen a paired device after a lock or reload, and decide
// whether Welcome offers Connect Hardware Wallet at all.
const HARDWARE_PAIR_FACTORIES = Object.freeze({ trezor: pairTrezorSigner, ledger: pairLedgerSigner });
const loadPaletteBalanceRows = async (messagingClient, walletId, accountId) => {
    const [{ loadDisplayBalances }, { buildBalanceRows }] = await Promise.all([
        import('@xchain-wallet/core/shared/utils/displayBalances.js'),
        import('@xchain-wallet/core/shared/components/BalanceList.jsx'),
    ]);
    const balances = await loadDisplayBalances(messagingClient, walletId, accountId);
    return buildBalanceRows(balances, APP_CHAIN_REGISTRY, null);
};

export function App() {
    const variantState = useActiveVariant();
    if (LinkHandoff && typeof window !== 'undefined' && /^\/link(?:\/|$)/.test(window.location.pathname)) {
        return (
            <Suspense fallback={<Loading />}>
                <LinkHandoff />
            </Suspense>
        );
    }
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
                        <RouteErrorBoundary>
                            <AppInner />
                        </RouteErrorBoundary>
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
    return (
        <Suspense fallback={null}>
            <DevVariantBadge state={state} />
        </Suspense>
    );
}

function AppInner() {
    // No variant read here any more. Navigation surfaces are chosen
    // by <FullLayoutWithNav> from its measured container width; the variant
    // only decides the dev-preview frame and the messaging shell, both of
    // which are resolved in <App> above.
    const { showToast, dismissToast } = useToast();
    // §34.1: settings carry the keyboard-shortcut overrides threaded into
    // the palette hook, the dispatcher, and the help modal below.
    const { settings } = useSettings();
    const activeNetwork = settings ? (settings.activeNetwork || 'mainnet') : undefined;
    const [status, setStatus] = useState(/** @type {any} */ ({ state: 'loading' }));
    useClearToastsOnLock(status.state);
    // A wipe in another tab leaves this one holding a session for a vault that is gone.
    useEffect(() => subscribeVaultWipe(() => window.location.reload()), []);
    const statusStateRef = useRef(status.state);
    statusStateRef.current = status.state;
    const nativeSuspendedRef = useRef(false);
    // Only the newest session read may set the status; an older one that
    // settles late (after a timeout and a retry) is dropped.
    const statusRequest = useRef(0);
    const [nativeResumeKey, setNativeResumeKey] = useState(0);
    // A demo graduation wipes the vault and reloads, so the lane
    // the user picked (create / import / FreeWallet) is handed across the
    // reload here. One-shot read: it never survives to hijack a later visit.
    const [onboardingStep, setOnboardingStep] = useState(
        /** @returns {'welcome' | 'create' | 'import' | 'import-freewallet' | 'pair-partner' | 'pair-signer'} */
        () => takePostDemoIntent() || 'welcome',
    );
    const preserveInitialOnboardingStep = useRef(onboardingStep !== 'welcome');
    // One navigation history: opening a page pushes it, Back pops it. Each
    // entry keeps the item its page showed (see navContext below), so Back
    // reopens the same token, account or list the user left.
    const navContext = useRef({ capture: () => null, restore: () => {} });
    const nav = useNavHistory({
        initialView: /** @type {'home' | 'send' | 'receive' | 'wizard' | 'actions' | 'my-tokens' | 'manage-token' | 'market-activity' | 'issue' | 'mint' | 'destroy' | 'sweep' | 'lock' | 'mint-settings' | 'callback-settings' | 'execute-callback' | 'access-lists' | 'bridge-settings' | 'bridge-move' | 'pause-token' | 'lock-address' | 'description' | 'transfer' | 'broadcast' | 'oracle' | 'dispenser' | 'dispensers-list' | 'dispensers-picker' | 'dispenser-detail' | 'dispenser-explorer' | 'dividend' | 'airdrop' | 'advanced' | 'migrate-bip39' | 'pair-signer' | 'markets' | 'markets-picker' | 'market' | 'create-order' | 'my-orders' | 'order-detail' | 'edit-order' | 'cancel-order' | 'my-swaps' | 'swap-detail' | 'edit-swap' | 'cancel-swap' | 'coinpay' | 'obligations' | 'swap' | 'sell-name' | 'messaging' | 'compose-message' | 'contacts' | 'lists' | 'list-detail' | 'list-create' | 'list-fork' | 'list-share' | 'list-transfer' | 'list-rename' |'contracts-list' | 'contract-detail' | 'contract-deploy' | 'contract-execute' | 'contract-deposit' | 'contract-withdraw' | 'controller-bind' | 'staking-dashboard' | 'stake-detail' | 'stake-new' | 'stake-form' | 'staking-unstake' | 'staking-claim' | 'staking-delegate' | 'staking-revoke' | 'history' | 'action-detail' | 'token-detail' | 'link-form' | 'attach-content' | 'gated-publish' | 'publish-file' | 'project-roster' | 'parallel-compose' | 'batch-compose' | 'cross-chain-swap' | 'cross-chain-order' | 'multisig-create' | 'multisig-share' | 'multisig-sign' | 'cosigner-accounts' | 'cosigner-provision' | 'cosigner-detail' | 'addresses' | 'address-preferences' | 'add-wallet' | 'add-account' | 'wallet-picker' | 'account-picker' | 'wallet-details' | 'account-details' | 'wallet-phrase' | 'wallet-rename' | 'account-rename' | 'scan'} */ ('home'),
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
    const [tokenDetailRef, setTokenDetailRef] = useState(
        /** @type {{ chainId: string, tick: string, kind: string, displayName: string, divisibility: number, fiatRate: number | null, quantity: string } | null} */ (null),
    );
    // Wide Home's selected item (G115), held here so a visit to Send or a
    // form opened from the detail panel comes back to the same item. Scoped
    // to the wallet it was picked in.
    const [homeDetail, setHomeDetail] = useState(
        /** @type {{ walletId: string, item: any } | null} */ (null),
    );
    const [historyInitialQuery, setHistoryInitialQuery] = useState('');
    // M2.4: the entry the History route should open on, set when the user
    // follows the send success card straight to their new transaction. It is
    // a tx hash rather than an action index because nothing has indexed it
    // yet, which is the whole reason the card offers the jump.
    const [historyInitialFocus, setHistoryInitialFocus] = useState(
        /** @type {{ chainId?: string, txHash?: string } | null} */ (null),
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
    // When a form was launched from ManageToken, expose the locked
    // (chainId, tick) so it can prefill + visually lock its ticker
    // field. Forms opened from ActionsMenu pass undefined and behave
    // as free-entry.
    // 'settings' covers the Developer Mode regtest-faucet "Mint test
    // XCHAIN" button (handleFaucetMint below): it stashes a synthetic
    // tokenDetailRef the same way ManageToken does, so MintForm gets the
    // same chainId/tick prefill treatment from either entry point.
    // 'token-detail' covers the coin and token page's Actions tab, which
    // opens each per-asset form pre-filled with the asset on screen.
    const fromManage = formSource === 'manage-token' || formSource === 'settings' || formSource === 'token-detail';
    // The wizard opened from a token (Issue subtoken) takes that token as the
    // subtoken's parent; the faucet's 'settings' source never opens it.
    const subtokenParentFromToken = formSource === 'manage-token' || formSource === 'token-detail';
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
        setFormSource('settings');
        setUnlockedView('mint');
    };
    // Coin family to scope History's chain filter to on entry (mirror
    // of popup wiring). Empty = no scoping.
    const [historyInitialChainCoin, setHistoryInitialChainCoin] = useState('');
    // Selected entry for the standalone ActionDetail view (mirror of
    // popup wiring). Set on row click in History or in Home's Activity
    // tab; cleared on back.
    const [selectedHistoryEntry, setSelectedHistoryEntry] = useState(
        /** @type {any | null} */ (null),
    );
    const [walletDetailsId, setWalletDetailsId] = useState(/** @type {string | null} */ (null));
    // The account a My Accounts row opened (Account Details, which holds rename).
    const [accountDetailsId, setAccountDetailsId] = useState(/** @type {string | null} */ (null));
    // The wallet whose recovery phrase page Wallet Details opened.
    const [recoveryPhraseWallet, setRecoveryPhraseWallet] = useState(
        /** @type {{ id: string, name: string } | null} */ (null),
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
    // Last-view persistence and DEX defaults stay scoped to the wallet's
    // active network once the encrypted settings record is available.
    // Asset-kind filter: surfaced via the global filter popover on the
    // send-picker route so the user can narrow the spendable list to
    // all / coins / tokens. Lifted here so the popover and SendPicker
    // share one source of truth.
    const [globalKindFilter, setGlobalKindFilter] = useState(/** @type {'all' | 'coins' | 'tokens'} */ ('all'));
    // QR scanner overlay: available from any unlocked view through the
    // palette's Scan command. On a `send` outcome we populate the
    // sendPrefill and navigate into Send; receive jumps to the Receive
    // route; psbt opens the PSBT-sign route. Mirrors the existing
    // dedicated 'scan' route handler.
    const [globalScannerOpen, setGlobalScannerOpen] = useState(false);
    const globalScannerRef = useRef(null);
    useFocusTrap(globalScannerRef, {
        active: globalScannerOpen,
        initialFocusRef: globalScannerRef,
    });
    // Escape and the system Back gesture close the scanner like any other
    // modal; its own Back control is a route-level handler that Escape skips.
    useBackHandler(globalScannerOpen ? () => setGlobalScannerOpen(false) : undefined);
    // Any view change closes the scanner; otherwise it (and the camera)
    // stayed on screen over whatever view the user had moved to (LG K51,
    // 2026-10-12: palette "Scan a QR code", then Home, then History). The nav
    // handlers also close it directly, for a tap on the view already shown.
    useEffect(() => {
        setGlobalScannerOpen(false);
    }, [unlockedView]);
    const [resumeAirdropId, setResumeAirdropId] = useState(
        /** @type {string | null} */ (null),
    );
    // §17.7 / G027: staged address handed to <ViewPrivateKey> when the
    // user picks "Show key" from the addresses list.
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
    const [coSignerAccountId, setCoSignerAccountId] = useState(
        /** @type {string | null} */ (null),
    );
    const [multisigSessionId, setMultisigSessionId] = useState(/** @type {string | null} */ (null));
    const [multisigInitialLink, setMultisigInitialLink] = useState(/** @type {string | null} */ (null));
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
    const [contactScanPrefill, setContactScanPrefill] = useState(
        /** @type {{ address: string, chainId?: string } | null} */ (null),
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
    // One per-wallet model feeds the persistent header and every route that
    // participates in the Home filter. Send and Receive keep separate query
    // text so typing there cannot narrow Home's Tokens tab.
    const {
        networkFilter: globalNetworkFilter,
        tokenQuery: globalTokenQuery,
        setNetworkFilter: setGlobalNetworkFilter,
        setTokenQuery: setGlobalTokenQuery,
    } = useWalletFilters(activeWalletId);
    const [activeAccountId, setActiveAccountId] = useState(
        /** @type {string | null} */ (null),
    );
    // Unread-message state feeds the Alerts route, while navigation surfaces
    // expose no unread badges or counts.
    const messagingUnread = useMessagingUnread(activeWalletId, activeAccountId);
    // §33 command palette: Cmd/Ctrl+K opens a launcher over every action and
    // destination. The global shortcut is inert unless the wallet is unlocked
    // (nothing to navigate to on the Locked / onboarding screens).
    const palette = useCommandPalette({
        enabled: status.state === 'unlocked',
        binding: settings?.keyboard?.bindings?.['command-palette'],
        // Every palette and menu pick opens its page as a root.
        navigate: openRootView,
        currentView: unlockedView,
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
        loadPaletteBalanceRows(messaging, activeWalletId, activeAccountId)
            .then((rows) => {
                if (cancelled) return;
                setPaletteTokenRows(rows);
            })
            .catch(() => { /* palette still works without token rows */ });
        messaging.listConnectedSites()
            .then((sites) => { if (!cancelled) setPaletteSites(Array.isArray(sites) ? sites : []); })
            .catch(() => { /* palette still works without sites */ });
        return () => { cancelled = true; };
    }, [palette.open, status.state, activeWalletId, activeAccountId, palette.onlineRetryKey]);
    // §34 keyboard shortcuts: global core set + `g`-leader nav + the `?`
    // help modal. Disabled while locked, while the palette owns the keys, and
    // while the help modal itself is open.
    const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
    // The palette and the help modal are lazy chunks. Each mounts the first
    // time it opens and stays mounted after, so later opens and closes behave
    // exactly as an always-mounted overlay does.
    const paletteMounted = useRef(false);
    if (palette.open) paletteMounted.current = true;
    const shortcutHelpMounted = useRef(false);
    if (shortcutHelpOpen) shortcutHelpMounted.current = true;
    // Fetch the palette chunk once the wallet is unlocked and the screen has
    // painted, so the first Cmd/Ctrl+K opens without waiting on the network.
    const unlockedNow = status.state === 'unlocked';
    useEffect(() => {
        if (!unlockedNow) return undefined;
        return deferNonCriticalWork(() => { loadCommandPaletteHost().catch(() => {}); });
    }, [unlockedNow]);
    // A notice can open without a click (a deep link the wallet cannot
    // follow), so its dialog is fetched on idle rather than on first use;
    // the queued-broadcast banner is fetched then too, ready for unlock.
    useIdlePreload(NoticeModal, QueuedBroadcastBanner);
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
    // §24 Cluster Y FOLLOWUP 3: track the resolved active-wallet record
    // so LeftNav / BottomTabBar can label the wallet switcher and so
    // the new 'settings' top-level view can pass `activeWallet` through
    // to the Settings drilldown the same way Home does.
    const [walletList, setWalletList] = useState(/** @type {Array<{ id: string, name: string }>} */ ([]));
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
    // The coin/token the user picked to scope the Markets list to.
    // Carried between MarketsList and the picker (`markets-picker`) so
    // re-entering Markets restores the selection.
    const [marketsAsset, setMarketsAsset] = useState(
        /** @type {{ chainId: string, tick: string, displayName?: string, kind?: string } | null} */ (
            () => defaultDexAssetForNetwork(settings?.activeNetwork)
        ),
    );
    useEffect(() => {
        setMarketsAsset((current) => syncDexAssetToNetwork(current, settings?.activeNetwork));
    }, [settings?.activeNetwork]);
    // Counts payment links that prefilled Send. It keys the Send route so a
    // link arriving while Send is open replaces the form (the earlier one is
    // kept as a draft) instead of being dropped silently.
    const [sendLinkSeq, setSendLinkSeq] = useState(0);
    // §47 / Cluster L FOLLOWUP 1: deep-link prefill for Send. Populated
    // once on mount from `?uri=` in `location.search`; consumed by the
    // 'send' route below and cleared after the user submits or backs out.
    const [sendPrefill, setSendPrefill] = useState(
        /** @type {{ address?: string, amount?: string, tick?: string, chainId?: string, memo?: string } | null} */ (null),
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
    // Deep-link prefill for contract EXECUTE (explorer Write-tab links,
    // xchain:{COIN}/execute?...). Mirrors `sendPrefill`; consumed by the
    // 'contract-execute' route and cleared when the user backs out.
    const [executePrefill, setExecutePrefill] = useState(
        /** @type {{ method?: string, paramsText?: string } | null} */ (null),
    );
    const [siteRequest, setSiteRequest] = useState(/** @type {Record<string, unknown> | null} */ (null));
    // The launch guard keeps a URI authoritative through both unlock and the
    // later per-wallet last-view restore.
    const launchRouteState = useRef(createLaunchRouteState());

    const refresh = useCallback(() => {
        const request = ++statusRequest.current;
        setStatus({ state: 'loading' });
        setOnboardingStep((step) => {
            if (preserveInitialOnboardingStep.current) {
                preserveInitialOnboardingStep.current = false;
                return step;
            }
            return 'welcome';
        });
        // A session read starts the navigation history over.
        resetNav('home');
        getSessionStatusWithTimeout()
            .then((next) => {
                if (statusRequest.current !== request) return;
                setStatus(next);
                if (next?.state === 'unlocked') nativeSuspendedRef.current = false;
                const launchView = launchRouteState.current.takeForSession(next);
                if (launchView) resetNav(launchView);
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
            .catch((err) => {
                if (statusRequest.current !== request) return;
                setStatus({
                    state: 'error',
                    error: err?.message || String(err),
                    // A vault that EXISTS and will not open gets a
                    // screen of its own, and which of the three it is decides
                    // what that screen may offer. Narrowed here because this is
                    // the last point at which the error is still an error.
                    errorKind: vaultErrorKind(err),
                });
            });
    }, [resetNav]);
    useDemoAutoWipe(activeWalletId, refresh);
    // An unlock that finds the encrypted vault gone lands on the screen a
    // start-up read shows for the same state, and outranks any read in flight.
    const showVaultUnavailable = useCallback((next) => {
        statusRequest.current += 1;
        setStatus({ state: 'error', ...next });
    }, []);

    const finishFreshWalletCreation = useCallback(() => {
        const next = { hasWallet: true, hasSession: true, state: 'unlocked' };
        const launchView = launchRouteState.current.takeForSession(next);
        setOnboardingStep('welcome');
        resetNav(launchView || 'home');
        nativeSuspendedRef.current = false;
        setStatus(next);
        if (typeof window !== 'undefined') {
            try {
                window.dispatchEvent(new CustomEvent('xc:session-changed'));
            } catch { /* CustomEvent unsupported: non-fatal */ }
        }
    }, [resetNav]);

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
        setContactScanPrefill(null);
        setStakingRef(null);
        setSendPrefill(null);
        setScannedPsbt(null);
        setExecutePrefill(null);
        setSiteRequest(null);
        setMultisigInitialLink(null);
        setGlobalScannerOpen(false);
        launchRouteState.current.clear();
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

    // While the Send screen shows an approved payment, the newest incoming
    // link waits here and is applied when that screen unmounts.
    const sendLinksHeldRef = useRef(false);
    const heldLinkRef = useRef(/** @type {string | null} */ (null));
    const [sendLinkWaiting, setSendLinkWaiting] = useState(false);

    // Apply one incoming wallet URI. Extracted from the mount effect below
    // (S3) because the native shells have no query string to read: an
    // Android intent arrives through the XChainLinks plugin instead, and it
    // must land on THIS code - where the parse, the text hardening and the
    // unlock gating already are - rather than on a second intake path where
    // one of those would eventually be forgotten.
    //
    // Nothing here unlocks anything or submits anything. Every branch ends at
    // a prefilled form the user still has to act on.
    const applyUriIntent = useCallback((raw) => {
        if (sendLinksHeldRef.current && typeof raw === 'string' && raw.trim()) {
            heldLinkRef.current = raw;
            setSendLinkWaiting(true);
            return;
        }
        try {
            // The mapping is shared with the desktop shell; it parses with
            // the registry, hardens the free text and routes only links that
            // carry what their form needs.
            const route = claimedDeepLinkRoute(raw, APP_CHAIN_REGISTRY);
            if (!route) return;
            if (route.view === 'deep-link-error') {
                setDeepLinkNotice(route.message);
                launchRouteState.current.clear();
                return;
            }
            if (route.view === 'send') {
                setSendPrefill(route.sendPrefill);
                setSendLinkSeq((n) => n + 1);
            }
            if (route.view === 'contract-execute') {
                setContractRef(route.contractRef);
                setExecutePrefill(route.executePrefill);
            }
            if (route.view === 'site-request-approval') setSiteRequest(route.request);
            if (route.view === 'multisig-sign') setMultisigInitialLink(route.initialLink || null);
            // The launch guard holds a locked-session link through unlock and the
            // later last-view restore. A link that arrives while a native shell
            // is backgrounded is held the same way and applied on resume, so the
            // view never changes out of sight.
            launchRouteState.current.remember(route.view, statusStateRef.current);
            if (canApplyNativeIntent(statusStateRef.current, nativeSuspendedRef.current)) {
                // The link's form replaces whatever the scanner overlay covers,
                // so the overlay closes and releases the camera.
                setGlobalScannerOpen(false);
                setUnlockedView(route.view);
            } else if (statusStateRef.current === 'unlocked') {
                launchRouteState.current.remember(route.view, 'suspended');
            }
        } catch {
            // The shared router returns an error route for malformed input;
            // this remains defensive against an unexpected parser failure.
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
    const waitingLinkDropped = useWaitingLinkDropped(unlockedView);
    const showWaitingLinkDropped = waitingLinkDropped.show;
    // The waiting link opens only when the user left Send by Back or Done on
    // the result; any other route drops it and says so on the screen chosen.
    const holdSendLinks = useCallback((held, release) => {
        sendLinksHeldRef.current = held;
        if (held) return;
        setSendLinkWaiting(false);
        if (heldLinkRef.current === null) return;
        const raw = heldLinkRef.current;
        heldLinkRef.current = null;
        if (release?.open) {
            applyUriIntent(raw);
        } else {
            showWaitingLinkDropped();
        }
    }, [applyUriIntent, showWaitingLinkDropped]);

    // No auto-unlock: the password is never persisted to Web API
    // storage, so a page reload always re-locks the wallet and the
    // user re-enters their password (threat model §1, §2.1:
    // https://docs.xchain.io/components/wallet/threat-model).

    const previousSessionStateRef = useRef(undefined);
    useEffect(() => {
        const previousState = previousSessionStateRef.current;
        previousSessionStateRef.current = status.state;
        if (status.state !== 'unlocked') {
            // A link opened before unlock parks its prefill while the shell
            // loads or sits locked; only leaving an unlocked session wipes it.
            // A key copied in the session must not outlive it on the clipboard.
            void clearSensitiveCopy();
            if (shouldClearTransientState(previousState, status.state)) clearTransientActionState();
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
    // A layout effect, so the listener comes off and the toasts are dismissed in
    // the commit that shows the lock screen, before it paints.
    useLayoutEffect(() => {
        if (status.state !== 'unlocked') return undefined;
        const gate = createNotificationToastGate();
        // Ids this effect put on screen: a lock must take them off again, since
        // a notification toast names an amount and the lock screen shows none.
        const shownIds = new Set();
        let sequence = 0;
        const onNotify = (event) => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            const detail = (event && event.detail) || {};
            const message = detail.title && detail.body
                ? `${detail.title}: ${detail.body}`
                : (detail.title || detail.body || 'Notification');
            const toast = gate(message);
            const id = toast.id || `notification-${sequence += 1}`;
            shownIds.add(id);
            showToast({ id, message: toast.message, variant: 'default' });
        };
        window.addEventListener(NOTIFICATION_EVENT, onNotify);
        return () => {
            window.removeEventListener(NOTIFICATION_EVENT, onNotify);
            for (const id of shownIds) dismissToast(id);
        };
    }, [status.state, showToast, dismissToast]);

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
                const chosen = reconcileActiveAccount(activeWalletId, sorted);
                setActiveAccountId(chosen);
            })
            .catch(() => { if (!cancelled) setActiveAccountId(null); });
        return () => { cancelled = true; };
    }, [activeWalletId]);

    // Switch the active wallet and remember it, so a reload returns to it
    // instead of snapping back to the first wallet. Twin of the account
    // handler below.
    const handleSwitchWallet = (id, name) => {
        // The old wallet's pages leave the history; the wallet pages stay.
        if (id && id !== activeWalletId) nav.retain((view) => WALLET_SWITCH_KEEPS.has(view));
        setActiveAccountId(null);
        setActiveWalletId(id);
        if (id) writeActiveWallet(id, name || walletList.find((wallet) => wallet.id === id)?.name);
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

    // Switch the active account and remember it per wallet, so a reload
    // returns to it instead of snapping back to the lowest-index account.
    const handleSwitchAccount = (id) => {
        const nextId = typeof id === 'string' && id ? id : null;
        setActiveAccountId(nextId);
        if (!activeWalletId) return;
        if (nextId) writeActiveAccount(activeWalletId, nextId);
        else clearActiveAccount(activeWalletId);
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

    // Settings names the selected account while the per-wallet effect above
    // continues to own account selection.
    const headerAccounts = useAccountList(activeWalletId, accountRenameTarget);

    // Build the Alerts destination from the shared list in core.
    const activeWallet = walletList.find((w) => w.id === activeWalletId) || null;
    const menuAlerts = buildWalletAlerts({ activeWallet, messagingUnread }, {
        onMessaging: () => { setMessagingThread(null); setUnlockedView('messaging'); },
        onMigrateToBip39: () => setUnlockedView('migrate-bip39'),
    });

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
    useLastView({
        walletId: activeWalletId,
        network: activeNetwork,
        navBacks: nav.backs,
        sessionActive: status.state === 'unlocked',
        currentView: unlockedView,
        currentParams: unlockedView === 'token-detail' ? tokenDetailRef
            : unlockedView === 'list-detail' ? listRef
                : unlockedView === 'dispenser-detail' ? dispenserRef
                    : unlockedView === 'market' ? activeMarket : null,
        onResumeParams: (view, params) => {
            if (view === 'token-detail' && params) setTokenDetailRef(params);
            if (view === 'list-detail' && params) setListRef(params);
            if (view === 'dispenser-detail' && params) setDispenserRef(params);
            if (view === 'market' && params) setActiveMarket(params);
        },
        onResume: (view, meta) => (meta?.source === 'history' ? nav.sync(view) : resetNav(view)),
        onHistoryPop: (view) => {
            if (!nav.isPrevious(view)) return false;
            goBack();
            return true;
        },
        skip: launchRouteState.current.shouldSkipLastViewResume(),
    });
    useEffect(() => {
        if (activeWalletId) launchRouteState.current.walletActivated();
    }, [activeWalletId]);

    // §26: idle auto-lock. Mounted HERE, above the view switch,
    // so one timer spans the whole unlocked session. It used to live in
    // Home.jsx, and since exactly one route renders at a time, navigating
    // to Send / Receive / History / Settings unmounted Home and cancelled
    // the timer: a wallet parked on those screens never locked. The policy
    // hook owns the timeout, the demo-wallet skip and the extension
    // service-worker backstop report. Do not move it into a route.
    const autoLock = useAutoLockPolicy({
        sessionState: status.state,
        activeWalletId,
        onLocked: refresh,
        lock: handleLock,
    });
    // While the app is in the background the hook hides the page and keeps
    // the screen mounted; unmounting it would drop every typed form value.
    useNativeAppLifecycle({
        checkAutoLock: autoLock.checkNow,
        sessionState: status.state,
        onBackground: () => {
            nativeSuspendedRef.current = true;
            setGlobalScannerOpen(false);
            setUnlockedView((view) => (view === 'scan' ? 'home' : view));
            palette.closePalette();
            setShortcutHelpOpen(false);
            dismissAllOverlays();
        },
        onUnlockedResume: () => {
            nativeSuspendedRef.current = false;
            if (statusStateRef.current !== 'unlocked') return;
            const launchView = launchRouteState.current.takeForSession({ state: 'unlocked' });
            if (launchView) {
                setUnlockedView(launchView);
                // The wallet is already active, so no last-view restore is
                // left for the launch guard to hold back.
                launchRouteState.current.walletActivated();
            }
            setNativeResumeKey((key) => key + 1);
        },
    });

    switch (status.state) {
        case 'loading':
            return <Loading />;
        case 'error':
            return status.errorKind
                ? <VaultUnavailable kind={status.errorKind} detail={status.error} />
                : <Loading error={status.error} onRetry={refresh} />;
        case 'no-wallet':
            if (onboardingStep === 'create') {
                return (
                    <Suspense fallback={<Loading />}>
                        <CreateWallet
                            onBack={() => setOnboardingStep('welcome')}
                            onCreated={finishFreshWalletCreation}
                        />
                    </Suspense>
                );
            }
            if (onboardingStep === 'import') {
                return (
                    <Suspense fallback={<Loading />}>
                        <ImportWallet
                            onBack={() => setOnboardingStep('welcome')}
                            onImported={refresh}
                        />
                    </Suspense>
                );
            }
            if (onboardingStep === 'import-freewallet') {
                return (
                    <Suspense fallback={<Loading />}>
                        <ImportWallet
                            variant="freewallet"
                            onBack={() => setOnboardingStep('welcome')}
                            onImported={refresh}
                        />
                    </Suspense>
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
                            onCreated={finishFreshWalletCreation}
                            onSignerPaired={registerLocalSigner}
                        />
                    </Suspense>
                );
            }
            return (
                <Suspense fallback={<Loading />}>
                    <Onboarding
                        onCreate={() => setOnboardingStep('create')}
                        onImport={() => setOnboardingStep('import')}
                        onImportFromFreeWallet={() => setOnboardingStep('import-freewallet')}
                        onConnectHardware={() => setOnboardingStep('pair-signer')}
                        hardwareFactories={HARDWARE_PAIR_FACTORIES}
                        onDemoEntered={refresh}
                        onWalletFound={refresh}
                    />
                </Suspense>
            );
        case 'locked':
            return <Locked onUnlocked={refresh} onVaultUnavailable={showVaultUnavailable} />;
        case 'unlocked': {
            // §24.2 / G053: wrap the unlocked-route render tree in
            // <FullLayoutWithNav> so the left nav is always visible at
            // ≥900px viewports. Existing route returns are captured by
            // the IIFE so the surrounding switch case stays readable.
            const routeNode = (() => {
            if (unlockedView === 'site-request-approval' && siteRequest) {
                return (
                    <SiteRequestApproval
                        request={siteRequest}
                        onReject={() => { setSiteRequest(null); goBack(); }}
                    />
                );
            }
            if (unlockedView === 'newer-wallet-needed') {
                return <NewerWalletNeeded onBack={goBack} />;
            }
            if (unlockedView === 'alerts' && activeWalletId) {
                return (
                    <AlertsRoute
                        key={activeWalletId}
                        onBack={goBack}
                        walletId={activeWalletId}
                        accountId={activeAccountId}
                        alerts={menuAlerts}
                        isWatcherMode={isWatcherMode}
                        onResumeCoinpay={(ref) => { setResumeCoinpay(ref); setUnlockedView('coinpay'); }}
                        onResumeAirdrop={(id) => { setResumeAirdropId(id); setUnlockedView('airdrop'); }}
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
                        onBack={() => {
                            setSendPrefill(null);
                            goBack();
                        }}
                        onReceive={() => { setReceivePrefill(null); setUnlockedView('receive'); }}
                        onDone={() => {
                            setSendPrefill(null);
                            setUnlockedView('home');
                        }}
                        prefill={sendPrefill}
                        onHoldLinks={holdSendLinks}
                        linkWaiting={sendLinkWaiting}
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
                        networkFilter={globalNetworkFilter}
                        onNetworkFilterChange={setGlobalNetworkFilter}
                        kindFilter={globalKindFilter}
                        onKindFilterChange={setGlobalKindFilter}
                        hideOwnFilter
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
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
                        initialFromAddress={prefillFromAddress}
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
                        onBack={formBack}
                        initialChainId={prefillChainId}
                        initialTick={prefillTick}
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
                        onDone={formDone}
                        initialChainId={prefillChainId}
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
                        reopen={formSource === 'dispenser-detail' ? dispenserRef?.reopen : undefined}
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
                        onBack={goBack}
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
                'order-lists': DEX_SURFACE_ENABLED ? () => { nav.land('lists'); setUnlockedView('my-orders'); } : undefined,
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
                            formBack();
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
                        hasDexSurface={DEX_SURFACE_ENABLED}
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
                                .then((list) => { if (Array.isArray(list)) setWalletList(list); })
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
                        onBack={formBack}
                        onCreated={handleHardwareWalletAdded}
                        onSignerPaired={registerLocalSigner}
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
                    goBack,
                    landView: nav.land,
                    setDispenserRef,
                    orderRef,
                    setOrderRef,
                    swapRef,
                    setSwapRef,
                    formBack,
                });
                if (dexRoute) return dexRoute;
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
                        onBack={goBack}
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
                        hasDexSurface={DEX_SURFACE_ENABLED}
                        onBack={goBack}
                    />
                );
            }
            if (unlockedView === 'parallel-compose' && activeWalletId) {
                return (
                    <ParallelComposer
                        walletId={activeWalletId}
                        hasDexSurface={DEX_SURFACE_ENABLED}
                        onBack={formBack}
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
                        networkFilter={globalNetworkFilter}
                        tokenQuery={globalTokenQuery}
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
                        onSend={(prefill) => {
                            setSendPrefill(prefill);
                            setUnlockedView('send');
                        }}
                        onSendMessage={(prefill) => {
                            setComposePrefill(prefill);
                            setUnlockedView('compose-message');
                        }}
                        onBack={goBack}
                        openTarget={contactsOpenTarget}
                        onOpenTargetConsumed={() => setContactsOpenTarget(null)}
                        scanPrefill={contactScanPrefill}
                        onScanPrefillConsumed={() => setContactScanPrefill(null)}
                        onOpenBackup={() => { setSettingsInitialSection('backup'); setUnlockedView('settings'); }}
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
                                setContractRef({ chainId: cid, contractActionIndex: String(actionIndex) });
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
                        initialFocus={historyInitialFocus}
                        initialChainCoin={historyInitialChainCoin}
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
            // One TokenDetail for the coin and token page, for wide Home's
            // detail panel (G115, `embedded`) and for My Tokens' token page
            // (`ownerView`, the manage-token route): one page, one layout.
            // Every action first makes this asset the shell's token, so a form
            // opened from the panel gets it.
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
                            // Chain scope plus the tick as the search term for a
                            // token; chain scope alone for the native coin. See
                            // historyEntryScope.js for why neither half is enough.
                            const scope = historyScopeForAsset(asset());
                            setHistoryInitialQuery(scope.searchQuery);
                            setHistoryInitialChainCoin(scope.chainCoin);
                            setUnlockedView('history');
                        }}
                        onBuy={DEX_SURFACE_ENABLED ? () => {
                            const a = asset();
                            setMarketsAsset({
                                chainId: a.chainId,
                                tick: a.tick,
                                kind: a.kind,
                                displayName: a.displayName,
                            });
                            setUnlockedView('markets');
                        } : undefined}
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
                                // Swap and cross-chain swap live on the DEX surface,
                                // which some web builds leave out.
                                onSwap: DEX_SURFACE_ENABLED ? () => openFromAsset('swap') : undefined,
                                onCrossChainSwap: DEX_SURFACE_ENABLED ? () => openFromAsset('cross-chain-swap') : undefined,
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
                        entries={(buildActionEntries) => buildActionEntries({
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
                            onBatch: () => setUnlockedView('batch-compose'),
                            onCrossChainSwap: DEX_SURFACE_ENABLED ? () => setUnlockedView('cross-chain-swap') : undefined,
                            onCrossChainOrder: DEX_SURFACE_ENABLED ? () => setUnlockedView('cross-chain-order') : undefined,
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
                        }, { pairsTrezor: TREZOR_PAIRING_ENABLED })}
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
                        backLabel={nav.previousView === 'settings' ? t('shell.settings.back') : undefined}
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
            // §49 / Cluster G FOLLOWUP 4: QueuedBroadcastBanner is now
            // mounted in FullLayoutWithNav.header below so it persists
            // across every unlocked view, not only Home.
            return (
                <Fragment key={`${activeWalletId}:${activeAccountId || 'all'}`}>
                    <Home
                        activeWalletId={activeWalletId}
                        resumeKey={nativeResumeKey}
                        networkFilter={globalNetworkFilter}
                        onNetworkFilterChange={setGlobalNetworkFilter}
                        tokenQuery={globalTokenQuery}
                        onTokenQueryChange={setGlobalTokenQuery}
                        onReceive={activeWalletId ? () => { setReceivePrefill(null); setUnlockedView('receive'); } : undefined}
                        onExchange={DEX_SURFACE_ENABLED && activeWalletId ? () => {
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
            // The palette's Switch wallet opens My wallets as a root page.
            const handleOpenWalletPicker = () => openRootView('wallet-picker');
            // Opening Settings from a nav surface starts the history over on
            // it, as every nav pick does.
            const handleOpenSettings = () => {
                setGlobalScannerOpen(false);
                setSettingsInitialSection(null);
                resetNav('settings');
            };
            const activeWalletRow =
                walletList.find((w) => w.id === activeWalletId) || null;
            // §33: assemble the palette command list from the shared catalogue
            // (navigation + authoring + signing + wallet verbs, gated exactly
            // like the ActionsMenu) plus the lazily-loaded contacts. Every
            // `run` uses the palette navigator, so selecting a command drives
            // the same view state with a fresh route mount.
            // A plain Send command opens a blank form: the prefill a free-form
            // intent left behind belongs to that abandoned intent, not to
            // this one. composeSend keeps the raw navigator so its own
            // prefill survives the jump.
            const paletteCtx = {
                navigate: (view) => {
                    if (view === 'send') setSendPrefill(null);
                    palette.navigate(view);
                },
                lock: handleNavLock,
                refresh,
                scan: () => setGlobalScannerOpen(true),
                switchWallet: handleOpenWalletPicker,
                openBetTab: (tab) => { setBetTab(tab); palette.navigate('bet-markets'); },
                openHelp: () => setShortcutHelpOpen(true),
                hasBtcAddress,
                hasVmAddress,
                hasGovernanceAddress,
                // Compile-time, not a preference: false only in a build that
                // dropped the DEX surface entirely, where a palette
                // command pointing at `markets` would navigate to a view that
                // no longer exists.
                hasDexSurface: DEX_SURFACE_ENABLED,
                isSignerMode,
                isWatcherMode,
                isDemoWallet: isDemoWallet(activeWalletId),
            };
            // entity handlers: tokens open TokenDetail with the full
            // ref the row already carries; sites land on the Connected Sites
            // drilldown; settings sections deep-link via
            // settingsInitialSection; help topics reuse both.
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
            };
            // §33.3: free-form intents like "send 100 MYTOKEN" open Send
            // prefilled. Send falls back to the first chain when the prefill
            // carries no chainId, so amount + tick alone is enough. A
            // txid/date-shaped query offers "search history".
            const paletteParseCtx = {
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
            };
            const handleMenuSelect = (view) => {
                setGlobalScannerOpen(false);
                // Picking the root page already on screen only scrolls it to
                // the top; the same page reached from another page starts over.
                if (view === unlockedView && !nav.canGoBack) {
                    const main = typeof document === 'undefined' ? null : document.getElementById('xc-main');
                    if (main) main.scrollTop = 0;
                    return;
                }
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
            // Assigned rather than returned directly so the whole unlocked
            // tree (both nav surfaces AND the route, Home included) sits under
            // one CoinpayObligationsProvider, which is the tree's only
            // pending-COINPAY scan.
            const unlockedTree = (
                // Both nav surfaces are handed in unconditionally.
                // FullLayoutWithNav measures its own width and mounts exactly
                // one of them (sidebar at >= 640px, bottom tab bar below), so
                // the web shell no longer carries a width threshold of its own
                // that used to disagree with the CSS and leave 640-899px with
                // no navigation at all.
                <FullLayoutWithNav
                    routeKey={`${unlockedView}:${palette.navigationKey}`}
                    nav={
                        <LeftNav
                            currentView={unlockedView}
                            onSelect={handleMenuSelect}
                            onLock={handleNavLock}
                            onOpenSettings={handleOpenSettings}
                            hasVmAddress={hasVmAddress}
                            hasBtcAddress={hasBtcAddress}
                            hasGovernanceAddress={hasGovernanceAddress}
                            hasDexSurface={DEX_SURFACE_ENABLED}
                            isSignerMode={isSignerMode}
                        />
                    }
                    bottomBar={
                        <BottomTabBar
                            currentView={unlockedView}
                            onSelect={handleMenuSelect}
                            onOpenSettings={handleOpenSettings}
                            isSignerMode={isSignerMode}
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
                                <ShellAppHeader
                                    walletId={activeWalletId}
                                    accountId={activeAccountId}
                                    alerts={menuAlerts}
                                    onOpenNotifications={() => handleMenuSelect('alerts')}
                                    onResumeCoinpay={activeWalletId ? (ref) => { setResumeCoinpay(ref); setUnlockedView('coinpay'); } : undefined}
                                    onResumeAirdrop={activeWalletId ? (id) => { setResumeAirdropId(id); setUnlockedView('airdrop'); } : undefined}
                                    onMenuToggle={palette.togglePalette}
                                    menuOpen={palette.open}
                                    onLock={handleNavLock}
                                    isWatcherMode={isWatcherMode}
                                    activeWallet={activeWalletRow}
                                />
                            </>
                        ) : null
                    }
                    notices={
                        activeWalletId ? (
                            <>
                                {/* A second tab's lock screen can schedule the erase; it shows first. */}
                                <EraseScheduledNotice />
                                {waitingLinkDropped.node}
                                <LockedSendOutcomeNotice walletId={activeWalletId} routeKey={unlockedView} />
                                <QueuedBroadcastBanner walletId={activeWalletId} />
                                {/* Demo data is fixture data and never stale, so no reachability notice. */}
                                {isDemoWallet(activeWalletId) ? null : <ReachabilityBanner />}
                                <UpdateNoticeBanner />
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
                        fallback={<Skeleton.List rows={5} />}
                    >
                        <Fragment key={palette.navigationKey}>{routeNode}</Fragment>
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
                    {globalScannerOpen ? (
                        <div
                            ref={globalScannerRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="xc-global-scanner-title"
                            tabIndex={-1}
                            style={{
                                // A modal: it inerts the header and navigation, so it
                                // covers them too rather than leaving dead controls on show.
                                position: 'fixed',
                                inset: 0,
                                boxSizing: 'border-box',
                                padding: 'env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)',
                                zIndex: 'var(--xc-z-overlay)',
                                background: 'var(--xc-bg)',
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            {/* ScanRoute is a lazy chunk; without its own boundary the first
                                open suspends the whole shell into the route error screen. */}
                            <Suspense fallback={<Loading />}>
                                <ScanRoute
                                    embedded
                                    titleId="xc-global-scanner-title"
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
                                                    requestMessage: outcome.requestMessage,
                                                });
                                                // Send reads its prefill once on mount, so a scan
                                                // over an open Send form remounts it like a link
                                                // does (the earlier form is kept as a draft).
                                                // The scan is newer than any link waiting on an
                                                // approved payment; the remount releases that
                                                // link as dropped and Send says so.
                                                setSendLinkSeq((n) => n + 1);
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
                            </Suspense>
                        </div>
                    ) : null}
                    {paletteMounted.current ? (
                        <Suspense fallback={null}>
                            <CommandPaletteHost
                                open={palette.open}
                                focusSearch={palette.focusSearch}
                                onClose={palette.closePalette}
                                ctx={paletteCtx}
                                entityCtx={paletteEntityCtx}
                                tokenRows={paletteTokenRows}
                                contacts={paletteContacts}
                                sites={paletteSites}
                                navigate={palette.navigate}
                                parseCtx={paletteParseCtx}
                                settings={settings}
                                menu={{
                                    gates: {
                                        isSignerMode,
                                        hasDexSurface: DEX_SURFACE_ENABLED,
                                        hasVmAddress,
                                        hasBtcAddress,
                                        hasGovernanceAddress,
                                    },
                                    currentView: unlockedView,
                                    onSelect: handleMenuSelect,
                                    onOpenSettings: handleOpenSettings,
                                    onLock: handleNavLock,
                                }}
                            />
                        </Suspense>
                    ) : null}
                    {shortcutHelpMounted.current ? (
                        <Suspense fallback={null}>
                            <ShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} overrides={settings?.keyboard?.bindings} />
                        </Suspense>
                    ) : null}
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
