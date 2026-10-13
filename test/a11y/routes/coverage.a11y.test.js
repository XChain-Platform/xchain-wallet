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
    'Home',
    'Onboarding',
    'OnboardingCarousel',
    'Receive',
    'Send',
    'Settings',
    'TokenDetail',
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
    'BetFeedDetail',
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
    'CreateOrderForm',
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
    'DispenserForm',
    'DispensersList',
    'DividendForm',
    'ExecuteContractForm',
    'GatedPublishForm',
    'GovernancePolls',
    'History',
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
    'ReceivePicker',
    'RenameAccountForm',
    'RenameWalletForm',
    'ResumeConfirm',
    'RouteNotFound',
    'ScanRoute',
    'SellOwnershipForm',
    'SendPicker',
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
    'TokenPicker',
    'TokenWizard',
    'UnionListForm',
    'VaultUnavailable',
    'VerifySignatureForm',
    'ViewPrivateKey',
    'WalletDetails',
    'WalletPicker',
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
            'Home',
            'Settings',
            'Onboarding',
            'OnboardingCarousel',
        ]));
    });
});
