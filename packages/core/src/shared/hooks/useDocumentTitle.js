// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useSyncExternalStore } from 'react';

const APP_TITLE = 'XChain Wallet';

const KNOWN_ROUTES = new Set([
    'home', 'send', 'send-picker', 'receive', 'scan',
    'wizard', 'actions', 'my-tokens', 'manage-token', 'token-detail',
    'market-activity', 'issue', 'mint', 'destroy', 'sweep', 'lock',
    'mint-settings', 'callback-settings', 'execute-callback', 'access-lists',
    'bridge-settings', 'bridge-move', 'pause-token', 'lock-address',
    'description', 'transfer', 'broadcast', 'oracle', 'dispenser',
    'dispensers-list', 'dispenser-detail', 'dispenser-explorer', 'dividend',
    'airdrop', 'advanced', 'migrate-bip39', 'pair-signer',
    'markets', 'markets-picker', 'market', 'create-order', 'my-orders',
    'my-swaps', 'coinpay', 'obligations', 'swap', 'sell-name', 'messaging',
    'compose-message', 'contacts', 'lists', 'list-detail', 'list-create',
    'list-fork', 'list-share', 'list-transfer', 'list-rename', 'list-union',
    'shared-lists', 'contracts-list', 'contract-detail', 'contract-stake',
    'contract-deploy', 'contract-execute', 'contract-deposit',
    'contract-withdraw', 'controller-bind', 'controller-unbind', 'staking-dashboard',
    'stake-detail', 'stake-new', 'stake-form', 'staking-unstake',
    'staking-claim', 'staking-delegate', 'staking-revoke',
    'operator-dashboard', 'history', 'action-detail', 'link-form',
    'attach-content', 'gated-publish', 'publish-file', 'project-roster',
    'parallel-compose', 'batch-compose', 'cross-chain-swap',
    'cross-chain-order', 'multisig-create', // no cross-chain templates route
    'multisig-sign', 'cosigner-accounts', 'cosigner-provision',
    'cosigner-detail', 'addresses', 'address-preferences', 'view-private-key',
    'add-wallet', 'add-account', 'wallet-picker', 'account-picker',
    'account-details', 'wallet-details', 'wallet-rename', 'account-rename', 'sign-message',
    'verify-signature', 'sign-psbt', 'settings', 'connected-sites', 'alerts',
    'menu', 'bet-markets', 'bet-market-detail', 'bet-oracle-record',
    'bet-create', 'governance-polls',
    'governance-create-poll', 'governance-poll-detail',
    'governance-delegate', 'governance-delegations', 'governance-clear-delegation',
]);

// Routes whose page heading differs from the words of the route id read as
// that heading, so the window title names the page the user is looking at.
// Every other route reads as its id in sentence case, the way headings do.
const ROUTE_LABELS = {
    alerts: 'Notifications',
    'send-picker': 'Send',
    // Every label below is Title Case, matching its page heading.
    actions: 'All Actions',
    lock: 'Lock Token',
    description: 'Update Description',
    transfer: 'Transfer Ownership',
    'markets-picker': 'Choose Asset', // matches the page title
    'list-union': 'Create Union List',
    'contract-deploy': 'Publish Contract',
    'stake-new': 'New Stake',
    'link-form': 'Link Actions',
    'parallel-compose': 'Action Queue',
    'batch-compose': 'Batch',
    'multisig-create': 'Create Multisig',
    'pair-signer': 'Pair Hardware Wallet',
    'compose-message': 'New Message',
    markets: 'Decentralized Exchange',
    market: 'Marketplace',
    'market-activity': 'Marketplace',
    'dispensers-list': 'My Dispensers',
    lists: 'My Lists',
    obligations: 'Payments Due',
    'contracts-list': 'Contracts',
    'staking-dashboard': 'Staking',
    'governance-polls': 'Governance Polls',
    'governance-delegations': 'My Delegations',
    'governance-clear-delegation': 'Clear Vote Delegation',
    'bet-markets': 'Betting',
    wizard: 'Issue a Token',
    issue: 'Issue Token',
    sweep: 'Sweep Address',
    oracle: 'My Oracle',
    dispenser: 'Create Dispenser',
    dividend: 'Pay Dividend',
    airdrop: 'Airdrop Tokens',
    'list-create': 'Create List',
    'controller-bind': 'Bind Controller',
    'controller-unbind': 'Unbind Controller',
    'bridge-move': 'Move Across Networks',
    advanced: 'Advanced Action',
    swap: 'Swap Tokens',
    coinpay: 'Pay for Matched Order',
    'cross-chain-swap': 'Cross-Chain Swap',
    'cross-chain-order': 'Cross-Chain Order',
    'wallet-picker': 'My Wallets',
    'account-picker': 'My Accounts',
    'migrate-bip39': 'Upgrade Wallet',
    'sign-psbt': 'Sign Transaction',
    'multisig-sign': 'Multisig Signing Sessions',
    'cosigner-accounts': 'Agent Accounts',
    'cosigner-provision': 'New Agent Account',
    'cosigner-detail': 'Agent Account',
};

const ONBOARDING_LABELS = {
    welcome: 'Welcome',
    create: 'Create Wallet',
    import: 'Import Wallet',
    'import-freewallet': 'Import FreeWallet',
    'pair-partner': 'Pair an Offline Signer',
};

// Title case: short articles, conjunctions and prepositions stay lowercase
// after the first word.
const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'by']);

function labelForRoute(route) {
    if (!KNOWN_ROUTES.has(route)) return null;
    if (ROUTE_LABELS[route]) return ROUTE_LABELS[route];
    return route.split('-')
        .map((word, index) => (index > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
        .join(' ');
}

// A screen with sub-screens of its own (Settings) names the one it is showing
// here, so the window reads as the heading on screen. Only the view that owns
// the sub-screens uses it.
const SECTIONED_VIEWS = new Set(['settings']);
const MAX_SECTION_LENGTH = 60;
let activeSection = null;
const sectionListeners = new Set();

function setActiveSection(label) {
    if (label === activeSection) return;
    activeSection = label;
    sectionListeners.forEach((listener) => listener());
}

function subscribeToSection(listener) {
    sectionListeners.add(listener);
    return () => { sectionListeners.delete(listener); };
}

const readActiveSection = () => activeSection;

/**
 * Names the sub-screen a view is showing for as long as it is mounted.
 *
 * @param {string | null | undefined} label  the heading the sub-screen shows
 */
export function useDocumentTitleSection(label) {
    useEffect(() => {
        if (typeof label !== 'string' || !label.trim()) return undefined;
        setActiveSection(label.trim().slice(0, MAX_SECTION_LENGTH));
        return () => setActiveSection(null);
    }, [label]);
}

export function documentTitleFor({ statusState, onboardingStep, unlockedView, section = null }) {
    let label = null;
    if (statusState === 'locked') label = 'Unlock';
    // An onboarding screen with steps of its own names the one it is showing.
    if (statusState === 'no-wallet') {
        label = typeof section === 'string' && section
            ? section
            : ONBOARDING_LABELS[onboardingStep] || 'Welcome';
    }
    if (statusState === 'error') label = 'Error';
    if (statusState === 'unlocked') {
        label = SECTIONED_VIEWS.has(unlockedView) && typeof section === 'string' && section
            ? section
            : labelForRoute(unlockedView);
    }
    return label ? `${APP_TITLE} - ${label}` : APP_TITLE;
}

export function useDocumentTitle({ statusState, onboardingStep, unlockedView, enabled = true }) {
    const section = useSyncExternalStore(subscribeToSection, readActiveSection, readActiveSection);
    const title = enabled
        ? documentTitleFor({ statusState, onboardingStep, unlockedView, section })
        : null;
    // Ownership spans the whole time the hook is enabled: the host title is
    // read once before the first write and put back only when ownership ends,
    // so a route or sub-screen change never shows the host title in between.
    useEffect(() => {
        if (!enabled || typeof document === 'undefined') return undefined;
        const previousTitle = document.title;
        return () => { document.title = previousTitle; };
    }, [enabled]);
    useEffect(() => {
        if (title === null || typeof document === 'undefined') return;
        if (document.title !== title) document.title = title;
    }, [title]);
}
