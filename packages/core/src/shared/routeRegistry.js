// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const GROUPED_ROUTES = {
    home: [
        ['home', 'Home'],
        ['menu', 'MenuRoute'],
        ['alerts', 'AlertsRoute'],
        ['actions', 'ActionsMenu', { entries: [] }],
        ['resume-confirm', 'ResumeConfirm'],
        ['token-detail', 'TokenDetail'],
        ['my-tokens', 'MyTokens'],
        ['manage-token', 'ManageToken'],
        ['wizard', 'TokenWizard'],
        ['issue', 'IssueTokenForm'],
        ['mint', 'MintForm'],
        ['destroy', 'DestroyForm'],
        ['sweep', 'SweepForm'],
        ['lock', 'TokenAdminForm', { action: 'lock' }],
        ['mint-settings', 'TokenAdminForm', { action: 'mint-settings' }],
        ['callback-settings', 'TokenAdminForm', { action: 'callback-settings' }],
        ['bridge-settings', 'TokenAdminForm', { action: 'bridge-settings' }],
        ['description', 'TokenAdminForm', { action: 'description' }],
        ['transfer', 'TokenAdminForm', { action: 'transfer' }],
        ['bridge-move', 'BridgeMoveForm'],
        ['execute-callback', 'CallbackForm'],
        ['pause-token', 'SleepForm', { mode: 'pause' }],
        ['lock-address', 'SleepForm', { mode: 'lock' }],
        ['broadcast', 'BroadcastForm'],
        ['oracle', 'OracleForm'],
        ['controller-bind', 'ControllerBindForm'],
        ['dividend', 'DividendForm'],
        ['airdrop', 'AirdropForm'],
        ['advanced', 'AdvancedActionsForm'],
        ['pair-signer', 'PairSignerForm'],
        ['sign-message', 'SignMessageForm'],
        ['verify-signature', 'VerifySignatureForm'],
        ['link-form', 'LinkForm'],
        ['attach-content', 'AttachContentForm'],
        ['gated-publish', 'GatedPublishForm'],
        ['publish-file', 'PublishFileForm'],
        ['project-roster', 'ProjectRosterForm'],
        ['parallel-compose', 'ParallelComposer'],
        ['batch-compose', 'BatchComposerForm'],
        ['sell-name', 'SellOwnershipForm'],
        ['multisig-create', 'MultisigCreate'],
        ['multisig-sign', 'MultisigSigningSession'],
        ['governance-polls', 'GovernancePolls'],
        ['governance-create-poll', 'CreatePollForm'],
        ['governance-poll-detail', 'PollDetail'],
        ['governance-delegate', 'DelegateVoteForm'],
        ['cosigner-accounts', 'CoSignerAccountList'],
        ['cosigner-provision', 'CoSignerProvision'],
        ['cosigner-detail', 'CoSignerAccountDetail'],
        ['addresses', 'AddressList'],
        ['view-private-key', 'ViewPrivateKey', {
            address: {
                id: 'address-1',
                address: 'bc1qexampleexampleexampleexampleexampleex',
                source: 'watch',
                chain: 'bitcoin',
                network: 'mainnet',
                derivationPath: null,
                label: '',
            },
        }],
        ['address-preferences', 'AddressPreferencesForm'],
        ['wallet-picker', 'WalletPicker'],
        ['account-picker', 'AccountPicker'],
        ['wallet-details', 'WalletDetails'],
        ['wallet-rename', 'RenameWalletForm'],
        ['account-rename', 'RenameAccountForm'],
        ['add-account', 'AddAccountForm'],
        ['add-wallet', 'CreateWallet'],
        ['migrate-bip39', 'MigrateToBip39'],
    ],
    history: [
        ['history', 'History'],
        ['action-detail', 'ActionDetail'],
    ],
    send: [
        ['send', 'Send'],
        ['send-picker', 'SendPicker'],
    ],
    receive: [
        ['receive', 'Receive'],
        ['receive-picker', 'ReceivePicker'],
    ],
    scan: [
        ['scan', 'ScanRoute'],
        ['sign-psbt', 'PsbtSignForm'],
    ],
    markets: [
        ['markets', 'MarketsList'],
        ['market', 'MarketView'],
        ['markets-picker', 'ReceivePicker'],
        ['market-activity', 'MarketActivity'],
        ['swap', 'SwapForm'],
        ['create-order', 'CreateOrderForm'],
        ['my-orders', 'MyOrdersView'],
        ['my-swaps', 'MySwapsView'],
        ['cross-chain-swap', 'CrossChainSwapForm'],
        ['cross-chain-order', 'CrossChainOrderForm'],
        ['cross-chain-templates', 'CrossChainTemplates'],
        ['bet-markets', 'BetFeedsList'],
        ['bet-market-detail', 'BetFeedDetail'],
        ['bet-oracle-record', 'OracleRecord'],
        ['bet-create', 'CreateBetFeedForm'],
        ['my-bets', 'MyBets'],
        ['bet-oracle-console', 'OracleConsole'],
    ],
    'dispensers-list': [
        ['dispensers-list', 'DispensersList'],
        ['dispenser-detail', 'DispenserDetail'],
        ['dispenser-explorer', 'DispenserExplorer'],
        ['dispenser', 'DispenserForm'],
    ],
    'contracts-list': [
        ['contracts-list', 'ContractsList'],
        ['contract-detail', 'ContractDetail'],
        ['contract-deploy', 'DeployContractForm'],
        ['contract-execute', 'ExecuteContractForm'],
        ['contract-deposit', 'ContractFundsForm', { mode: 'deposit' }],
        ['contract-withdraw', 'ContractFundsForm', { mode: 'withdraw' }],
        ['contract-stake', 'ContractStakeForm'],
        ['staking-dashboard', 'StakingList'],
        ['stake-detail', 'StakeDetail', { kind: 'validator' }],
        ['stake-new', 'StakeNew'],
        ['stake-form', 'StakeForm'],
        ['staking-unstake', 'StakingActionForm', { mode: 'unstake' }],
        ['staking-claim', 'StakingActionForm', { mode: 'claim-rewards' }],
        ['staking-delegate', 'DelegationActionForm', { mode: 'delegate' }],
        ['staking-revoke', 'DelegationActionForm', { mode: 'revoke' }],
        ['operator-dashboard', 'OperatorDashboard'],
    ],
    messaging: [
        ['messaging', 'MessagingInbox'],
        ['compose-message', 'ComposeMessage'],
    ],
    contacts: [
        ['contacts', 'ContactsList'],
    ],
    lists: [
        ['lists', 'MyLists'],
        ['list-detail', 'ListDetail'],
        ['list-create', 'ListCreateForm'],
        ['list-fork', 'ListForkForm', {
            listRef: { chainId: 'bitcoin-mainnet', actionIndex: '1', type: '1', items: [] },
        }],
        ['list-share', 'ListShareForm', {
            listRef: { chainId: 'bitcoin-mainnet', actionIndex: '1' },
        }],
        ['list-transfer', 'ListTransferForm', {
            listRef: { chainId: 'bitcoin-mainnet', actionIndex: '1' },
        }],
        ['list-rename', 'ListRenameForm', {
            listRef: { chainId: 'bitcoin-mainnet', actionIndex: '1' },
        }],
        ['list-union', 'UnionListForm'],
        ['shared-lists', 'SharedListDirectory'],
        ['access-lists', 'TokenAdminForm', { action: 'access-lists' }],
    ],
    obligations: [
        ['obligations', 'ObligationsView'],
        ['coinpay', 'CoinpayForm'],
    ],
    settings: [
        ['settings', 'Settings'],
        ['connected-sites', 'ConnectedSites'],
    ],
};

const TITLE_OVERRIDES = {
    advanced: 'Advanced action',
    'bet-oracle-console': 'My betting markets',
    'sign-psbt': 'Sign transaction',
    'verify-signature': 'Verify signature',
};

function titleFor(id) {
    if (TITLE_OVERRIDES[id]) return TITLE_OVERRIDES[id];
    const words = id.replaceAll('-', ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

export const ROUTE_NAV_GROUPS = Object.freeze(Object.fromEntries(
    Object.entries(GROUPED_ROUTES).map(([group, routes]) => [
        group,
        Object.freeze(routes.map(([id]) => id)),
    ]),
));

export const HIDDEN_ROUTE_IDS = Object.freeze([]);

export const ROUTE_REGISTRY = Object.freeze(Object.fromEntries(
    Object.entries(GROUPED_ROUTES).flatMap(([nav, routes]) => routes.map(
        ([id, component, minimalProps = {}]) => [id, Object.freeze({
            id,
            title: titleFor(id),
            component,
            nav,
            ...(id === nav ? { root: true } : { backTarget: nav }),
            minimalProps: Object.freeze(minimalProps),
        })],
    )),
));
