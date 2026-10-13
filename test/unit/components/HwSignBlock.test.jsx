// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HwSignBlock } from '../../../packages/core/src/shared/components/HwSignBlock.jsx';

afterEach(() => cleanup());

const baseProps = {
    signerKind: 'ledger',
    signerName: 'Test Ledger',
    path: "m/84'/0'/0'/0/0",
    address: 'bc1qexample',
    chainId: 'bitcoin-mainnet',
};

describe('HwSignBlock device instructions', () => {
    it('shows each signing step after the mocked transport reports ready', async () => {
        const transport = vi.fn().mockResolvedValue({ status: 'available' });
        render(<HwSignBlock {...baseProps} getStatus={transport} />);

        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent('1. Select the sign button below.');
        expect(status).toHaveTextContent('2. Review every detail on your device.');
        expect(status).toHaveTextContent('3. Approve on the device only if everything matches.');
        expect(status).toHaveTextContent('To cancel, reject on the device; nothing will be signed.');
        expect(transport).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet' });
    });

    it('treats an explicit device rejection as cancellation, not disconnection', async () => {
        const rejection = Object.assign(new Error('request rejected'), {
            name: 'UserRejectedError',
        });
        const transport = vi.fn().mockRejectedValue(rejection);
        render(<HwSignBlock {...baseProps} getStatus={transport} />);

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveAttribute('data-status', 'cancelled');
        });
        expect(screen.getByRole('status')).toHaveTextContent(
            'Signing was cancelled on your device. Nothing was signed.',
        );
        expect(screen.queryByText(/Device not detected/i)).not.toBeInTheDocument();
    });
});
