// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

const routeModules = import.meta.glob(
    '../../../packages/core/src/shared/routes/*.jsx',
);

const ROUTES_RENDERED_BY_AXE = [
    'ActionDetail',
    'BetFeedDetail',
    'CreateOrderForm',
    'DispenserForm',
    'IssueTokenForm',
    'ManageToken',
    'MarketActivity',
    'MarketView',
    'MarketsList',
    'MenuRoute',
    'MessagingInbox',
    'MigrateToBip39',
    'MintForm',
    'MultisigCosignerShare',
    'MultisigCreate',
    'MultisigSigningSession',
    'MyBets',
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
    'PairPartnerWallet',
    'PairSignerForm',
    'ParallelComposer',
    'PollDetail',
    'ProjectRosterForm',
    'PsbtSignForm',
    'PublishFileForm',
    'Receive',
    'ReceivePicker',
    'RenameAccountForm',
    'RenameWalletForm',
    'ResumeConfirm',
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
    'UnionListForm',
    'VaultUnavailable',
    'VerifySignatureForm',
    'ViewPrivateKey',
    'WalletDetails',
    'WalletPicker',
];

const ROUTES_NOT_RENDERED_BY_AXE = [
    'AccountPicker',
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
    'BetFeedsList',
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
    'ContractStakeForm',
    'ContractsList',
    'ControllerBindForm',
    'CreateBetFeedForm',
    'CreatePollForm',
    'CreateWallet',
    'CrossChainOrderForm',
    'CrossChainSwapForm',
    'CrossChainTemplates',
    'DelegateVoteForm',
    'DelegationActionForm',
    'DeployContractForm',
    'DestroyForm',
    'DispenserDetail',
    'DispenserExplorer',
    'DispensersList',
    'DividendForm',
    'ExecuteContractForm',
    'GatedPublishForm',
    'GovernancePolls',
    'History',
    'Home',
    'ImportWallet',
    'LinkForm',
    'ListCreateForm',
    'ListDetail',
    'ListForkForm',
    'ListRenameForm',
    'ListShareForm',
    'ListTransferForm',
    'Loading',
    'Locked',
];

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
            'Settings',
            'Onboarding',
            'OnboardingCarousel',
            'IssueTokenForm',
            'DispenserForm',
            'CreateOrderForm',
            'BetFeedDetail',
            'PollDetail',
        ]));
    });

    it('renders every M-Z route in the runtime axe suite', () => {
        const mToZRoutes = registeredRouteNames().filter((name) => /^[M-Z]/.test(name));
        expect(ROUTES_RENDERED_BY_AXE).toEqual(expect.arrayContaining(mToZRoutes));
    });
});
