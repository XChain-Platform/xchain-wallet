// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

vi.mock('../../../packages/core/src/shared/routes/SignerSelectForm.jsx', () => ({
    SignerSelectForm: () => null,
}));

const { AddAccountForm } = await import(
    '../../../packages/core/src/shared/routes/AddAccountForm.jsx');

beforeEach(() => {
    messaging = {
        listAccounts: vi.fn().mockResolvedValue([]),
        createAccount: vi.fn().mockResolvedValue(undefined),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('AddAccountForm navigation', () => {
    it('renders a working Back control', () => {
        const onBack = vi.fn();
        render(
            <AddAccountForm walletId="wallet-1" onBack={onBack} onCreated={() => {}} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
