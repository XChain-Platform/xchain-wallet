// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { WALLET_TAB_BAR_IDS } from './walletMenu.js';

const GROUPED_ROUTES = {
    home: [
        ['home', 'Home'],
        ['alerts', 'AlertsRoute'],
        ['actions', 'ActionsMenu', { entries: [] }],
        ['token-detail', 'TokenDetail'],
        ['my-tokens', 'MyTokens'],
        ['manage-token', 'ManageToken'],
        ['wizard', 'TokenWizard'],
        ['issue', 'IssueTokenForm'],
        ['mint', 'MintForm'],
        ['destroy', 'DestroyForm'],
        ['sweep', 'SweepForm'],
        ['lock', 'TokenAdminForm', { mode: 'lock' }],
        ['mint-settings', 'TokenAdminForm', { mode: 'mint-settings' }],
        ['callback-settings', 'TokenAdminForm', { mode: 'callback-settings' }],
        ['bridge-settings', 'TokenAdminForm', { mode: 'bridge-settings' }],
        ['description', 'TokenAdminForm', { mode: 'description' }],
        ['transfer', 'TokenAdminForm', { mode: 'transfer' }],
        ['bridge-move', 'BridgeMoveForm'],
        ['execute-callback', 'CallbackForm'],
        ['pause-token', 'SleepForm', { mode: 'pause' }],
        ['lock-address', 'SleepForm', { mode: 'lock' }],
        ['broadcast', 'BroadcastForm'],
        ['oracle', 'OracleForm'],
        ['controller-bind', 'ControllerBindForm'],
        ['controller-unbind', 'UnbindForm'],
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
        ['governance-delegations', 'MyDelegations'],
        ['governance-clear-delegation', 'DelegateVoteForm', { mode: 'clear' }],
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
        ['account-details', 'AccountDetails'],
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
    ],
    scan: [
        ['scan', 'ScanRoute'],
        ['sign-psbt', 'PsbtSignForm'],
    ],
    markets: [
        ['markets', 'MarketsList'],
        ['market', 'MarketView'],
        ['markets-picker', 'ReceivePicker'],
        ['swap', 'SwapForm'],
        ['create-order', 'CreateOrderForm'],
        ['my-orders', 'MyOrdersView'],
        // One order, opened from its My Orders row.
        ['order-detail', 'OrderDetail', { chainId: 'bitcoin-mainnet', actionIndex: '1' }],
        // Order detail's Edit and Cancel: one standard form route each.
        ['edit-order', 'EditOrderForm', { chainId: 'bitcoin-mainnet', actionIndex: '1' }],
        ['cancel-order', 'CancelOrderForm', { chainId: 'bitcoin-mainnet', actionIndex: '1' }],
        ['my-swaps', 'MySwapsView'],
        // One swap, opened from its My Swaps row.
        ['swap-detail', 'SwapDetail', { chainId: 'bitcoin-mainnet', actionIndex: '1' }],
        // Swap Details' Edit and Cancel: one standard form route each.
        ['edit-swap', 'EditSwapForm', { chainId: 'bitcoin-mainnet', actionIndex: '1' }],
        ['cancel-swap', 'CancelSwapForm', { chainId: 'bitcoin-mainnet', actionIndex: '1' }],
        ['cross-chain-swap', 'CrossChainSwapForm'],
        ['cross-chain-order', 'CrossChainOrderForm'],
        ['bet-markets', 'BetFeedsList'],
        ['bet-market-detail', 'BetFeedDetail'],
        ['bet-oracle-record', 'OracleRecord'],
        ['bet-create', 'CreateBetFeedForm'],
        // The Trade page a market's Buy, Sell or book price opens.
        ['market-trade', 'MarketTrade'],
    ],
    'market-activity': [
        ['market-activity', 'MarketActivity'],
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
        // Every staking write route renders the one Staking form on its target and action.
        ['contract-stake', 'StakingForm', {
            target: { kind: 'contract', chainId: 'bitcoin-mainnet', contractActionIndex: '1' },
            action: 'stake',
        }],
        ['staking-dashboard', 'StakingList'],
        ['stake-detail', 'StakeDetail', { kind: 'validator' }],
        ['stake-new', 'StakeNew'],
        ['stake-form', 'StakingForm', { target: { kind: 'network', chainId: 'bitcoin-mainnet' }, action: 'stake' }],
        ['staking-unstake', 'StakingForm', { target: { kind: 'network', chainId: 'bitcoin-mainnet' }, action: 'unstake' }],
        ['staking-claim', 'StakingForm', { target: { kind: 'network', chainId: 'bitcoin-mainnet' }, action: 'claim-rewards' }],
        ['staking-delegate', 'StakingForm', { target: { kind: 'network', chainId: 'bitcoin-mainnet' }, action: 'delegate' }],
        ['staking-revoke', 'StakingForm', { target: { kind: 'network', chainId: 'bitcoin-mainnet' }, action: 'revoke' }],
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
        ['list-look', 'ListLookForm', { chainId: 'bitcoin-mainnet', actionIndex: '1' }],
        ['list-create', 'ListCreateForm'],
        // Every list action route renders the one List form with its action
        // picked; list-rename opens Edit, which holds the name and description.
        ['list-fork', 'ListCreateForm', {
            action: 'fork',
            listRef: { chainId: 'bitcoin-mainnet', actionIndex: '1', type: '1', items: [] },
        }],
        ['list-share', 'ListCreateForm', {
            action: 'share',
            listRef: { chainId: 'bitcoin-mainnet', actionIndex: '1' },
        }],
        ['list-transfer', 'ListCreateForm', {
            action: 'transfer',
            listRef: { chainId: 'bitcoin-mainnet', actionIndex: '1' },
        }],
        ['list-rename', 'ListCreateForm', {
            action: 'edit',
            listRef: { chainId: 'bitcoin-mainnet', actionIndex: '1' },
        }],
        ['access-lists', 'TokenAdminForm', { mode: 'access-lists' }],
    ],
    obligations: [
        ['obligations', 'ObligationsView'],
        ['coinpay', 'CoinpayForm'],
    ],
    settings: [
        ['settings', 'Settings'],
        ['connected-sites', 'ConnectedSites'],
        // Settings, Advanced: the two-phone pairing, moved off Welcome.
        ['pair-partner', 'PairPartnerWallet'],
    ],
};

const TITLE_OVERRIDES = {
    advanced: 'Advanced action',
    // Connect Hardware Wallet (Welcome, Add Wallet and the actions list).
    'pair-signer': 'Hardware wallet',
    'pair-partner': 'Use another phone as a signer',
    // The Trade page's registry title.
    'market-trade': 'Trade',
    'sign-psbt': 'Sign transaction',
    'verify-signature': 'Verify signature',
    'governance-delegations': 'My delegations',
    'governance-clear-delegation': 'Clear vote delegation',
    // Both open the one asset page (operator ruling 2026-11-15), whose header
    // and window title name the asset; with no asset in hand it is "Token".
    'token-detail': 'Token',
    'manage-token': 'Token',
    // The Issue Token form's own page heading (issue.title), so the registry
    // title never reads "Wizard".
    wizard: 'Issue Token',
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

const ROUTE_NAV_SECTION_OVERRIDES = {
    'my-tokens': 'my-tokens',
    'manage-token': 'my-tokens',
    'governance-polls': 'governance-polls',
    'governance-create-poll': 'governance-polls',
    'governance-poll-detail': 'governance-polls',
    'governance-delegate': 'governance-polls',
    'governance-delegations': 'governance-polls',
    'governance-clear-delegation': 'governance-polls',
    'bet-markets': 'bet-markets',
    'bet-market-detail': 'bet-markets',
    'bet-oracle-record': 'bet-markets',
    'bet-create': 'bet-markets',
    'cosigner-accounts': 'cosigner-accounts',
    'cosigner-provision': 'cosigner-accounts',
    'cosigner-detail': 'cosigner-accounts',
    addresses: 'addresses',
    'view-private-key': 'addresses',
    'address-preferences': 'addresses',
    wizard: 'create-token',
    issue: 'create-token',
    'account-picker': 'accounts',
    'account-details': 'accounts',
    'account-rename': 'accounts',
    'add-account': 'accounts',
    'wallet-picker': 'wallets',
    'wallet-details': 'wallets',
    'wallet-rename': 'wallets',
    'add-wallet': 'wallets',
    'migrate-bip39': 'wallets',
    // Connecting a hardware wallet adds a wallet.
    'pair-signer': 'wallets',
    // Network staking has its own sidebar row. Contract staking keeps the
    // Contracts section because its subject is a contract.
    'staking-dashboard': 'staking-dashboard',
    'stake-detail': 'staking-dashboard',
    'stake-new': 'staking-dashboard',
    'stake-form': 'staking-dashboard',
    'staking-unstake': 'staking-dashboard',
    'staking-claim': 'staking-dashboard',
    'staking-delegate': 'staking-dashboard',
    'staking-revoke': 'staking-dashboard',
};

export const ROUTE_NAV_SECTIONS = Object.freeze(Object.fromEntries(
    Object.entries(GROUPED_ROUTES).flatMap(([defaultSection, routes]) => routes.map(
        ([id]) => [id, ROUTE_NAV_SECTION_OVERRIDES[id] || defaultSection],
    )),
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

// Top-level destinations per navigation surface: the routes each surface
// links to directly. LeftNav and BottomTabBar build their rows from these
// lists, and PageHeader hides its Back control on exactly these routes while
// that surface is on screen (the surface is already the way out). Any route
// not listed, including every drilldown a new screen adds, keeps Back.
// Rows a wallet cannot use (Send in signer mode, Contracts without a VM
// address) stay listed: those routes are unreachable while the row is gone.
export const SIDEBAR_NAV_GROUPS = Object.freeze([
    Object.freeze({
        id: 'wallet',
        labelKey: 'components.leftNav.groupWallet',
        // Scan stays a main-menu route only; it is off the side menu (operator 2026-11-16).
        destinations: Object.freeze(['home', 'history', 'send', 'receive', 'my-tokens']),
    }),
    Object.freeze({
        id: 'trade',
        labelKey: 'components.leftNav.groupTrade',
        destinations: Object.freeze(['markets', 'market-activity', 'dispensers-list', 'bet-markets']),
    }),
    Object.freeze({
        id: 'network',
        labelKey: 'components.leftNav.groupNetwork',
        destinations: Object.freeze(['governance-polls', 'staking-dashboard']),
    }),
    Object.freeze({
        id: 'build',
        labelKey: 'components.leftNav.groupBuild',
        destinations: Object.freeze(['contracts-list', 'cosigner-accounts']),
    }),
    Object.freeze({
        id: 'social',
        labelKey: 'components.leftNav.groupSocial',
        destinations: Object.freeze(['messaging', 'contacts']),
    }),
]);

export const SIDEBAR_PRIMARY_DESTINATIONS = Object.freeze(
    SIDEBAR_NAV_GROUPS.flatMap((group) => group.destinations),
);

// Kept as an empty compatibility export for callers that consume both lists.
export const SIDEBAR_SECONDARY_DESTINATIONS = Object.freeze([]);

export const SIDEBAR_FOOTER_DESTINATIONS = ['settings'];

export const TAB_BAR_DESTINATIONS = WALLET_TAB_BAR_IDS;

export const NAV_SURFACE_DESTINATIONS = {
    sidebar: [
        ...SIDEBAR_PRIMARY_DESTINATIONS,
        ...SIDEBAR_SECONDARY_DESTINATIONS,
        ...SIDEBAR_FOOTER_DESTINATIONS,
    ],
    tabBar: TAB_BAR_DESTINATIONS,
};

/**
 * Whether `routeId` is a destination the given navigation surface links to
 * directly. Membership is by route id, not nav section: a drilldown such as
 * `token-detail` shares Home's section but is not a sidebar destination.
 *
 * @param {string | null | undefined} routeId
 * @param {'sidebar' | 'tabBar' | null | undefined} surface
 */
export function isNavSurfaceDestination(routeId, surface) {
    return Boolean(NAV_SURFACE_DESTINATIONS[surface]?.includes(routeId));
}
