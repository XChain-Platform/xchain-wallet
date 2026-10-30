// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeNew } from '../../../packages/core/src/shared/routes/StakeNew.jsx';

afterEach(cleanup);

describe('StakeNew when the address read fails', () => {
    it('words the failure for people and offers Try again, which reloads', async () => {
        const getAddressesByChain = vi.fn()
            .mockRejectedValueOnce(new TypeError('getAddressesByChain: handler crashed at vault.js:88'))
            .mockResolvedValue({ 'bitcoin-mainnet': [{ id: 'a1', address: 'bc1qa' }] });
        render(
            <MessagingProvider shell="web" messaging={{ getAddressesByChain }}>
                <StakeNew walletId="w" onPickValidator={vi.fn()} onPickContract={vi.fn()} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/Couldn.t load your staking networks/);
        expect(alert).not.toHaveTextContent(/vault\.js/);

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('button', { name: /Validator/ })).toBeEnabled();
        expect(getAddressesByChain).toHaveBeenCalledTimes(2);
    });
});
