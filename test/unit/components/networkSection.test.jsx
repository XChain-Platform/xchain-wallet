// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const updateSpy = vi.fn();
const setActiveNetworkSpy = vi.fn();
let settingsRecord;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: settingsRecord,
        loading: false,
        error: null,
        update: updateSpy,
    }),
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: { setActiveNetwork: setActiveNetworkSpy } }),
}));

const { NetworkSection } = await import(
    '../../../packages/core/src/shared/components/settings/NetworkSection.jsx'
);

beforeEach(() => {
    settingsRecord = { activeNetwork: 'mainnet', developerMode: true };
    updateSpy.mockReset();
    setActiveNetworkSpy.mockReset();
});

afterEach(() => cleanup());

describe('NetworkSection', () => {
    it('does not switch networks until the user confirms', async () => {
        render(<NetworkSection activeWallet={{ id: 'wallet-1' }} />);
        fireEvent.change(screen.getByLabelText('Active network'), { target: { value: 'testnet' } });

        expect(screen.getByRole('dialog', { name: 'Switch to Testnet?' })).toBeInTheDocument();
        expect(screen.getByText(/Mainnet balances and chain settings stay unchanged/)).toBeInTheDocument();
        expect(setActiveNetworkSpy).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(setActiveNetworkSpy).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Active network')).toHaveValue('mainnet');
    });

    it('switches through the wallet-aware route after confirmation', async () => {
        setActiveNetworkSpy.mockReturnValueOnce(new Promise(() => {}));
        render(<NetworkSection activeWallet={{ id: 'wallet-1' }} />);
        fireEvent.change(screen.getByLabelText('Active network'), { target: { value: 'regtest' } });
        fireEvent.click(screen.getByRole('button', { name: 'Switch network' }));

        await waitFor(() => expect(setActiveNetworkSpy).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            network: 'regtest',
        }));
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('shows a failed switch without reloading the selected network', async () => {
        setActiveNetworkSpy.mockRejectedValueOnce(new Error('Wallet is locked.'));
        render(<NetworkSection activeWallet={{ id: 'wallet-1' }} />);
        fireEvent.change(screen.getByLabelText('Active network'), { target: { value: 'testnet' } });
        fireEvent.click(screen.getByRole('button', { name: 'Switch network' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Wallet is locked.');
        expect(screen.getByLabelText('Active network')).toHaveValue('mainnet');
    });
});
