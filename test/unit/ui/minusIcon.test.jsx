// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MinusIcon } from '../../../packages/core/src/ui/icons/index.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MultisigCreate } from '../../../packages/core/src/shared/routes/MultisigCreate.jsx';

const ADDRESS = {
    id: 'addr-1',
    address: 'tb1qminusicontest',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/1'/0'/0/0",
};

afterEach(() => cleanup());

describe('MinusIcon', () => {
    it('renders an svg using the shared icon contract', () => {
        const { container } = render(<MinusIcon />);
        const icon = container.querySelector('svg');

        expect(icon).toBeInTheDocument();
        expect(icon).toHaveAttribute('data-xc-icon');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders in the signatures-required decrement button without changing its name', async () => {
        const messaging = {
            getAddressesByChain: vi.fn(async () => ({ 'bitcoin-testnet': [ADDRESS] })),
            getMultisigCosignerInfo: vi.fn(async () => ({})),
            createMultisigConfig: vi.fn(async () => ({})),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MultisigCreate walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        const decrement = await screen.findByRole('button', {
            name: 'Decrease signatures required',
        });
        expect(decrement.querySelector('svg')).toBeInTheDocument();
        expect(decrement).toBeEnabled();

        fireEvent.change(screen.getByLabelText('Type'), {
            target: { value: 'taproot-musig2' },
        });
        await waitFor(() => expect(decrement).toBeDisabled());
    });
});
