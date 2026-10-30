// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
    documentTitleFor,
    useDocumentTitle,
    useDocumentTitleSection,
} from '../../../packages/core/src/shared/hooks/useDocumentTitle.js';

afterEach(() => {
    cleanup();
    document.title = '';
});

it('maps session and route state to stable page titles', () => {
    expect(documentTitleFor({ statusState: 'loading' })).toBe('XChain Wallet');
    expect(documentTitleFor({ statusState: 'locked' })).toBe('XChain Wallet - Unlock');
    expect(documentTitleFor({
        statusState: 'no-wallet',
        onboardingStep: 'create',
    })).toBe('XChain Wallet - Create Wallet');
    expect(documentTitleFor({
        statusState: 'unlocked',
        unlockedView: 'send',
    })).toBe('XChain Wallet - Send');
    expect(documentTitleFor({
        statusState: 'unlocked',
        unlockedView: 'sign-psbt',
    })).toBe('XChain Wallet - Sign transaction');
});

it('titles a route with its heading in sentence case', () => {
    const titleOf = (unlockedView) => documentTitleFor({ statusState: 'unlocked', unlockedView });
    expect(titleOf('my-bets')).toBe('XChain Wallet - My bets');
    expect(titleOf('my-tokens')).toBe('XChain Wallet - My tokens');
    expect(titleOf('mint-settings')).toBe('XChain Wallet - Mint settings');
    expect(titleOf('pause-token')).toBe('XChain Wallet - Pause token');
    expect(titleOf('send-picker')).toBe('XChain Wallet - Send');
    expect(titleOf('actions')).toBe('XChain Wallet - Token actions');
    expect(titleOf('cosigner-accounts')).toBe('XChain Wallet - Agent accounts');
    expect(titleOf('governance-polls')).toBe('XChain Wallet - Governance');
    expect(titleOf('bet-markets')).toBe('XChain Wallet - Betting');
});

it('titles an onboarding step with the heading the step shows', () => {
    expect(documentTitleFor({ statusState: 'no-wallet', onboardingStep: 'create' }))
        .toBe('XChain Wallet - Create Wallet');
    expect(documentTitleFor({
        statusState: 'no-wallet',
        onboardingStep: 'create',
        section: 'Write down your recovery phrase',
    })).toBe('XChain Wallet - Write down your recovery phrase');
    expect(documentTitleFor({ statusState: 'no-wallet', onboardingStep: 'welcome' }))
        .toBe('XChain Wallet - Welcome');

    const title = renderHook(() => useDocumentTitle({
        statusState: 'no-wallet',
        onboardingStep: 'create',
        unlockedView: 'home',
    }));
    const section = renderHook(({ label }) => useDocumentTitleSection(label), {
        initialProps: { label: 'Create a new wallet' },
    });
    expect(document.title).toBe('XChain Wallet - Create a new wallet');
    section.rerender({ label: 'Verify your recovery phrase' });
    expect(document.title).toBe('XChain Wallet - Verify your recovery phrase');
    act(() => { section.unmount(); });
    expect(document.title).toBe('XChain Wallet - Create Wallet');
    title.unmount();
});

it('updates the document when the route changes', () => {
    const hook = renderHook(
        ({ unlockedView }) => useDocumentTitle({
            statusState: 'unlocked',
            onboardingStep: 'welcome',
            unlockedView,
        }),
        { initialProps: { unlockedView: 'home' } },
    );

    expect(document.title).toBe('XChain Wallet - Home');
    hook.rerender({ unlockedView: 'receive' });
    expect(document.title).toBe('XChain Wallet - Receive');
});

it('does not expose dynamic values or unknown route text', () => {
    expect(documentTitleFor({
        statusState: 'unlocked',
        unlockedView: 'send',
        walletName: 'Secret Savings',
        amount: '21 BTC',
    })).toBe('XChain Wallet - Send');
    expect(documentTitleFor({
        statusState: 'unlocked',
        unlockedView: 'Secret Savings 21 BTC',
    })).toBe('XChain Wallet');
});

it('leaves compact extension surfaces unchanged when disabled', () => {
    document.title = 'XChain Wallet';

    renderHook(() => useDocumentTitle({
        statusState: 'unlocked',
        onboardingStep: 'welcome',
        unlockedView: 'send',
        enabled: false,
    }));

    expect(document.title).toBe('XChain Wallet');
});

it('titles screens with the heading the screen shows', () => {
    const titleOf = (unlockedView) => documentTitleFor({ statusState: 'unlocked', unlockedView });
    expect(titleOf('obligations')).toBe('XChain Wallet - Payments due');
    expect(titleOf('contracts-list')).toBe('XChain Wallet - Contracts');
    expect(titleOf('lists')).toBe('XChain Wallet - My lists');
    expect(titleOf('staking-dashboard')).toBe('XChain Wallet - Staking');
    expect(titleOf('markets')).toBe('XChain Wallet - Decentralized exchange');
    expect(titleOf('market-activity')).toBe('XChain Wallet - Marketplace');
    expect(titleOf('dispensers-list')).toBe('XChain Wallet - My dispensers');
    expect(titleOf('dispenser')).toBe('XChain Wallet - Create dispenser');
    expect(titleOf('compose-message')).toBe('XChain Wallet - New message');
    expect(titleOf('account-picker')).toBe('XChain Wallet - Accounts');
});

it('titles a sub-screen of Settings with its own heading', () => {
    expect(documentTitleFor({ statusState: 'unlocked', unlockedView: 'settings' }))
        .toBe('XChain Wallet - Settings');
    expect(documentTitleFor({ statusState: 'unlocked', unlockedView: 'settings', section: 'Display' }))
        .toBe('XChain Wallet - Display');
    // Only a view that owns sub-screens takes one.
    expect(documentTitleFor({ statusState: 'unlocked', unlockedView: 'send', section: 'Display' }))
        .toBe('XChain Wallet - Send');
    expect(documentTitleFor({ statusState: 'locked', section: 'Display' }))
        .toBe('XChain Wallet - Unlock');
});

it('follows the sub-screen the view reports and falls back when it leaves', () => {
    const title = renderHook(() => useDocumentTitle({
        statusState: 'unlocked',
        onboardingStep: 'welcome',
        unlockedView: 'settings',
    }));
    expect(document.title).toBe('XChain Wallet - Settings');

    const section = renderHook(({ label }) => useDocumentTitleSection(label), {
        initialProps: { label: 'Display' },
    });
    expect(document.title).toBe('XChain Wallet - Display');

    section.rerender({ label: 'Backup' });
    expect(document.title).toBe('XChain Wallet - Backup');

    section.rerender({ label: null });
    expect(document.title).toBe('XChain Wallet - Settings');

    section.rerender({ label: 'Fees' });
    expect(document.title).toBe('XChain Wallet - Fees');
    act(() => { section.unmount(); });
    expect(document.title).toBe('XChain Wallet - Settings');
    title.unmount();
});
