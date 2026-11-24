// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

const routeModules = import.meta.glob([
    '../../../packages/core/src/shared/routes/*.jsx',
    // Split-out pieces of History.jsx are not routes; History.jsx renders them.
    '!../../../packages/core/src/shared/routes/HistoryDetailCard.jsx',
    '!../../../packages/core/src/shared/routes/HistoryEntryRow.jsx',
    '!../../../packages/core/src/shared/routes/HistoryShared.jsx',
    // ActionDetail.jsx renders this body with the entry it resolved.
    '!../../../packages/core/src/shared/routes/ActionDetailView.jsx',
    '!../../../packages/core/src/shared/routes/ResumeConfirm.jsx',
    // The poll status pill is shared by GovernancePolls and PollDetail, not a route.
    '!../../../packages/core/src/shared/routes/PollStatusPill.jsx',
    // AddressList renders View Address with the row the user opened.
    '!../../../packages/core/src/shared/routes/AddressDetail.jsx',
    // Split-out pieces of My Orders and Order detail; OrderDetail renders them.
    '!../../../packages/core/src/shared/routes/OrderRow.jsx',
    '!../../../packages/core/src/shared/routes/OrderDetailBody.jsx',
    '!../../../packages/core/src/shared/routes/OrderActionPanel.jsx',
    // The Edit and Cancel route bodies and their shared Form Standard frame;
    // EditOrderForm, CancelOrderForm, EditSwapForm and CancelSwapForm render them.
    '!../../../packages/core/src/shared/routes/OrderActionForms.jsx',
    '!../../../packages/core/src/shared/routes/SwapActionForms.jsx',
    '!../../../packages/core/src/shared/routes/TradeOwnerActionForm.jsx',
    // The bet market's outcome list; BetFeedDetail renders it on its Bet tab.
    '!../../../packages/core/src/shared/routes/OutcomeList.jsx',
]);

const ROUTES_RENDERED_BY_AXE = [
    'AccountDetails',
    'AccountPicker',
    'ActionDetail',
    'ActionsMenu',
    'AddAccountForm',
    'AddAddressModal',
    'AddressList',
    'AddressPreferencesForm',
    'AdvancedActionsForm',
    'AirdropForm',
    'AlertsRoute',
    'AttachContentForm',
    'BatchComposerForm',
    'BetFeedDetail',
    'BetFeedsList',
    'BetMarketHero',
    'BridgeMoveForm',
    'BridgeOriginBadge',
    'BroadcastForm',
    'CallbackForm',
    'CancelOrderForm',
    'CancelSwapForm',
    'CoSignerAccountDetail',
    'CoSignerAccountList',
    'CoSignerPolicyEditor',
    'CoSignerProvision',
    'CoinpayForm',
    'ComposeMessage',
    'ConnectedSites',
    'ContactsList',
    'ContractDetail',
    'ContractFundsForm',
    'ContractHero',
    'ContractsList',
    'ControllerBindForm',
    'CreateBetFeedForm',
    'CreateOrderForm',
    'CreatePollForm',
    'CreateWallet',
    'CrossChainOrderForm',
    'CrossChainSwapForm',
    'DelegateVoteForm',
    'DeployContractForm',
    'DestroyForm',
    'DispenserDetail',
    'DispenserExplorer',
    'DispenserForm',
    'DispenserHero',
    'DispensersList',
    'DividendForm',
    'EditOrderForm',
    'EditSwapForm',
    'ExecuteContractForm',
    'ExportWalletBackup',
    // Forgot Password pages (forgotPassword.a11y.test.jsx), rendered through Locked.
    'ForgotPassword',
    'GatedPublishForm',
    'GovernancePolls',
    'History',
    'Home',
    'ImportWallet',
    'IssueTokenForm',
    'LinkForm',
    'ListCreateForm',
    'ListDetail',
    // Edit look page, scanned in routes-a-l.a11y.
    'ListLookForm',
    'Loading',
    'Locked',
    'ManageToken',
    'MarketActivity',
    'MarketView',
    'MarketTrade',
    'MarketsList',
    'MessagingInbox',
    'MigrateToBip39',
    'MintForm',
    'MultisigCosignerShare',
    'MultisigCreate',
    'MultisigSendForm',
    'MultisigSigningSession',
    'MyDelegations',
    'MyLists',
    'MyOrdersView',
    'MySwapsView',
    'MyTokens',
    'NewerWalletNeeded',
    'ObligationsView',
    'Onboarding',
    'OnboardingCarousel',
    'OracleConsole',
    'OracleForm',
    'OrderDetail',
    'OracleRecord',
    'OracleRecordHero',
    'PairPartnerWallet',
    'PairSignerForm',
    'ParallelComposer',
    'PollDetail',
    'ProjectRosterForm',
    'PsbtSignForm',
    'PublishFileForm',
    'Receive',
    'ReceivePicker',
    'RemoveWallet',
    'RenameAccountForm',
    'RenameWalletForm',
    'RouteNotFound',
    'ScanRoute',
    'SellOwnershipForm',
    'Send',
    'SendPicker',
    'Settings',
    // Settings' stateful inline rows, scanned on the Security, Backup and
    // Recovery, Notifications and Network and Fees pages (settings.a11y).
    'SettingsInlineRows',
    'SharedListDirectory',
    'SignMessageForm',
    'SignerSelectForm',
    'SleepForm',
    'StakeDetail',
    'StakeNew',
    'StakingForm',
    'StakingList',
    'SwapDetail',
    'SwapForm',
    'SweepForm',
    'TokenAdminForm',
    'TokenDetail',
    'TokenPicker',
    'TokenWizard',
    'UnbindForm',
    'VaultUnavailable',
    'VerifySignatureForm',
    'ViewPrivateKey',
    'ViewRecoveryPhrase',
    'WalletDetails',
    'WalletPicker',
];

const ROUTES_NOT_RENDERED_BY_AXE = [];

function registeredRouteNames() {
    return Object.keys(routeModules)
        .map((path) => path.slice(path.lastIndexOf('/') + 1, -4))
        .sort();
}

describe('a11y route coverage inventory', () => {
    it('accounts for every route module as rendered or explicitly missing', () => {
        expect([
            ...ROUTES_RENDERED_BY_AXE,
            ...ROUTES_NOT_RENDERED_BY_AXE,
        ].sort()).toEqual(registeredRouteNames());
    });

    it('renders the priority routes in the runtime axe suite', () => {
        expect(ROUTES_RENDERED_BY_AXE).toEqual(expect.arrayContaining([
            'Send',
            'Receive',
            'ActionDetail',
            'TokenDetail',
            'Home',
            'DispenserDetail',
            'StakeDetail',
            'PollDetail',
            'BetFeedDetail',
            'ExecuteContractForm',
            'SwapForm',
            'ListDetail',
            'Settings',
            'Onboarding',
            'OnboardingCarousel',
            'IssueTokenForm',
            'DispenserForm',
            'CreateOrderForm',
        ]));
    });

    it('renders every M-Z route in the runtime axe suite', () => {
        const mToZRoutes = registeredRouteNames()
            .filter((name) => /^[M-Z]/.test(name))
            .filter((name) => !ROUTES_NOT_RENDERED_BY_AXE.includes(name));
        expect(ROUTES_RENDERED_BY_AXE).toEqual(expect.arrayContaining(mToZRoutes));
    });
});
