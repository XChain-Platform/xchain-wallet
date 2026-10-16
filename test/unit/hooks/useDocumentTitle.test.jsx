// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import {
    documentTitleFor,
    useDocumentTitle,
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
    })).toBe('XChain Wallet - Sign PSBT');
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
