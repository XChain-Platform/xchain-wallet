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
    '!../../../packages/core/src/shared/routes/ResumeConfirm.jsx',
    // The poll status pill is shared by GovernancePolls and PollDetail, not a route.
    '!../../../packages/core/src/shared/routes/PollStatusPill.jsx',
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
    'ContractStakeForm',
    'ContractsList',
    'ControllerBindForm',
    'CreateBetFeedForm',
    'CreateOrderForm',
    'CreatePollForm',
    'CreateWallet',
    'CrossChainOrderForm',
    'CrossChainSwapForm',
    'DelegateVoteForm',
    'DelegationActionForm',
    'DeployContractForm',
    'DestroyForm',
    'DispenserDetail',
    'DispenserExplorer',
    'DispenserForm',
    'DispenserHero',
    'DispensersList',
    'DividendForm',
    'ExecuteContractForm',
    'ExportWalletBackup',
    'GatedPublishForm',
    'GovernancePolls',
    'History',
    'Home',
    'ImportWallet',
    'IssueTokenForm',
    'LinkForm',
    'ListCreateForm',
    'ListDetail',
    'ListForkForm',
    'ListRenameForm',
    'ListShareForm',
    'ListTransferForm',
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
    'ObligationsView',
    'Onboarding',
    'OnboardingCarousel',
    'OperatorDashboard',
    'OracleConsole',
    'OracleForm',
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
    'SharedListDirectory',
    'SignMessageForm',
    'SignerSelectForm',
    'SleepForm',
    'StakeDetail',
    'StakeForm',
    'StakeNew',
    'StakingActionForm',
    'StakingList',
    'SwapForm',
    'SweepForm',
    'TokenAdminForm',
    'TokenDetail',
    'TokenPicker',
    'TokenWizard',
    'UnbindForm',
    'UnionListForm',
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
        const mToZRoutes = registeredRouteNames().filter((name) => /^[M-Z]/.test(name));
        expect(ROUTES_RENDERED_BY_AXE).toEqual(expect.arrayContaining(mToZRoutes));
    });
});
