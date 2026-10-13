// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const nextPaint = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/shared/utils/nextPaint.js', () => ({ nextPaint }));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import {
    clearDemoWalletId,
    clearLockoutState,
} from '../../../packages/core/src/flows/index.js';

beforeEach(() => {
    clearDemoWalletId();
    clearLockoutState();
    nextPaint.mockReset();
});

afterEach(() => {
    cleanup();
    clearLockoutState();
});

describe('Locked paint failure recovery', () => {
    it('re-enables the form and reports the failure', async () => {
        nextPaint.mockRejectedValue(new Error('Could not prepare unlock'));
        const unlockWallet = vi.fn();
        render(
            <MessagingProvider shell="popup" messaging={{ unlockWallet }}>
                <Locked onUnlocked={() => {}} />
            </MessagingProvider>,
        );

        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: 'password' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));

        expect(await screen.findByText('Could not prepare unlock')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Unlock Wallet' })).not.toBeDisabled();
        });
        expect(screen.getByLabelText('Password')).not.toBeDisabled();
        expect(unlockWallet).not.toHaveBeenCalled();
    });
});
