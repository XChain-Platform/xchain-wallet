// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useSyncExternalStore } from 'react';

const APP_TITLE = 'XChain Wallet';

const KNOWN_ROUTES = new Set([
    'home', 'send', 'send-picker', 'receive', 'receive-picker', 'scan',
    'wizard', 'actions', 'my-tokens', 'manage-token', 'token-detail',
    'market-activity', 'issue', 'mint', 'destroy', 'sweep', 'lock',
    'mint-settings', 'callback-settings', 'execute-callback', 'access-lists',
    'bridge-settings', 'bridge-move', 'pause-token', 'lock-address',
    'description', 'transfer', 'broadcast', 'oracle', 'dispenser',
    'dispensers-list', 'dispenser-detail', 'dispenser-explorer', 'dividend',
    'resume-confirm', 'airdrop', 'advanced', 'migrate-bip39', 'pair-signer',
    'markets', 'markets-picker', 'market', 'create-order', 'my-orders',
    'my-swaps', 'coinpay', 'obligations', 'swap', 'sell-name', 'messaging',
    'compose-message', 'contacts', 'lists', 'list-detail', 'list-create',
    'list-fork', 'list-share', 'list-transfer', 'list-rename', 'list-union',
    'shared-lists', 'contracts-list', 'contract-detail', 'contract-stake',
    'contract-deploy', 'contract-execute', 'contract-deposit',
    'contract-withdraw', 'controller-bind', 'staking-dashboard',
    'stake-detail', 'stake-new', 'stake-form', 'staking-unstake',
    'staking-claim', 'staking-delegate', 'staking-revoke',
    'operator-dashboard', 'history', 'action-detail', 'link-form',
    'attach-content', 'gated-publish', 'publish-file', 'project-roster',
    'parallel-compose', 'batch-compose', 'cross-chain-swap',
    'cross-chain-order', 'cross-chain-templates', 'multisig-create',
    'multisig-sign', 'cosigner-accounts', 'cosigner-provision',
    'cosigner-detail', 'addresses', 'address-preferences', 'view-private-key',
    'add-wallet', 'add-account', 'wallet-picker', 'account-picker',
    'wallet-details', 'wallet-rename', 'account-rename', 'sign-message',
    'verify-signature', 'sign-psbt', 'settings', 'connected-sites', 'alerts',
    'menu', 'bet-markets', 'bet-market-detail', 'bet-oracle-record',
    'bet-create', 'my-bets', 'bet-oracle-console', 'governance-polls',
    'governance-create-poll', 'governance-poll-detail',
    'governance-delegate',
]);

// Routes whose page heading differs from the words of the route id read as
// that heading, so the window title names the page the user is looking at.
const ROUTE_LABELS = {
    actions: 'Token Actions',
    'compose-message': 'New message',
    markets: 'Decentralized exchange',
    market: 'Marketplace',
    'market-activity': 'Marketplace',
    'dispensers-list': 'My dispensers',
    lists: 'My lists',
    obligations: 'Payments due',
    'contracts-list': 'Contracts',
    'staking-dashboard': 'Staking',
    'governance-polls': 'Governance',
    'bet-markets': 'Betting',
    'bet-oracle-console': 'My markets',
    wizard: 'Issue a token',
    issue: 'Issue token',
    sweep: 'Sweep address',
    oracle: 'My oracle',
    dispenser: 'Create dispenser',
    dividend: 'Pay dividend',
    airdrop: 'Airdrop tokens',
    'list-create': 'Create list',
    'controller-bind': 'Bind controller',
    'bridge-move': 'Move across networks',
    advanced: 'Advanced action',
    swap: 'Swap tokens',
    coinpay: 'Pay for matched order',
    'cross-chain-swap': 'Cross-chain swap',
    'cross-chain-order': 'Cross-chain order',
    'cross-chain-templates': 'Cross-chain templates',
    'wallet-picker': 'Wallets',
    'account-picker': 'Accounts',
    'migrate-bip39': 'Migrate to BIP39',
    'sign-psbt': 'Sign PSBT',
    'multisig-sign': 'Multisig Signing',
    'cosigner-accounts': 'Co-signer Accounts',
    'cosigner-provision': 'Add Co-signer Account',
    'cosigner-detail': 'Co-signer Account',
};

const ONBOARDING_LABELS = {
    welcome: 'Welcome',
    create: 'Create Wallet',
    import: 'Import Wallet',
    'import-freewallet': 'Import FreeWallet',
    'pair-partner': 'Pair Partner Wallet',
};

function labelForRoute(route) {
    if (!KNOWN_ROUTES.has(route)) return null;
    if (ROUTE_LABELS[route]) return ROUTE_LABELS[route];
    return route
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
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
    if (statusState === 'no-wallet') label = ONBOARDING_LABELS[onboardingStep] || 'Welcome';
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
    useEffect(() => {
        if (!enabled || typeof document === 'undefined') return undefined;
        const previousTitle = document.title;
        document.title = documentTitleFor({ statusState, onboardingStep, unlockedView, section });
        return () => { document.title = previousTitle; };
    }, [enabled, onboardingStep, section, statusState, unlockedView]);
}
