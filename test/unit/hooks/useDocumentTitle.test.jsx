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
    expect(documentTitleFor({ statusState: 'locked' })).toBe('Unlock - XChain Wallet');
    expect(documentTitleFor({
        statusState: 'no-wallet',
        onboardingStep: 'create',
    })).toBe('Create Wallet - XChain Wallet');
    expect(documentTitleFor({
        statusState: 'unlocked',
        unlockedView: 'send',
    })).toBe('Send - XChain Wallet');
    expect(documentTitleFor({
        statusState: 'unlocked',
        unlockedView: 'sign-psbt',
    })).toBe('Sign PSBT - XChain Wallet');
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

    expect(document.title).toBe('Home - XChain Wallet');
    hook.rerender({ unlockedView: 'receive' });
    expect(document.title).toBe('Receive - XChain Wallet');
});

it('does not expose dynamic values or unknown route text', () => {
    expect(documentTitleFor({
        statusState: 'unlocked',
        unlockedView: 'send',
        walletName: 'Secret Savings',
        amount: '21 BTC',
    })).toBe('Send - XChain Wallet');
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
