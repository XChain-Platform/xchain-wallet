// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';

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

const ROUTE_LABELS = {
    actions: 'Token Actions',
    coinpay: 'Coinpay',
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

export function documentTitleFor({ statusState, onboardingStep, unlockedView }) {
    let label = null;
    if (statusState === 'locked') label = 'Unlock';
    if (statusState === 'no-wallet') label = ONBOARDING_LABELS[onboardingStep] || 'Welcome';
    if (statusState === 'error') label = 'Error';
    if (statusState === 'unlocked') label = labelForRoute(unlockedView);
    return label ? `${label} - ${APP_TITLE}` : APP_TITLE;
}

export function useDocumentTitle({ statusState, onboardingStep, unlockedView, enabled = true }) {
    useEffect(() => {
        if (!enabled || typeof document === 'undefined') return;
        document.title = documentTitleFor({ statusState, onboardingStep, unlockedView });
    }, [enabled, onboardingStep, statusState, unlockedView]);
}
