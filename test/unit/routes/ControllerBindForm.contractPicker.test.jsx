// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';

const CHAIN = 'bitcoin-testnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'tb1qcontractpicker00000000000000000000000',
    publicKey: '02aa',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
});

function messagingFor() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getControllerActionClasses: vi.fn().mockResolvedValue({ actionClasses: ['transfer'] }),
        getOwnedTokens: vi.fn().mockResolvedValue([]),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'available' }),
        getContractsForSource: vi.fn().mockResolvedValue({
            data: [{ action_index: '47', source: ADDRESS.address, status: 'valid', meta_name: 'Guardian' }],
        }),
        getDepositsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getWithdrawalsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getContractsBrowseAll: vi.fn().mockResolvedValue({ data: [] }),
    };
    return messaging;
}

function mount() {
    const messaging = messagingFor();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ControllerBindForm walletId="wallet-1" chainId={CHAIN} onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => cleanup());

describe('ControllerBindForm contract picker', () => {
    it('opens the standard contracts picker and fills the selected action index', async () => {
        const messaging = mount();
        const field = await screen.findByLabelText('Guard contract');

        fireEvent.click(screen.getByRole('button', { name: 'Choose guard contract' }));

        expect(await screen.findByRole('heading', { name: 'Contracts' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'My Contracts' })).toHaveAttribute('aria-selected', 'true');
        const contract = await screen.findByRole('button', { name: 'Open Guardian (C:BTC:47)' });
        expect(contract.querySelector('img')).not.toBeNull();
        fireEvent.click(contract);

        expect(await screen.findByLabelText('Guard contract')).toHaveValue('47');
        expect(screen.getByRole('heading', { name: 'Bind Controller' })).toBeInTheDocument();
        expect(messaging.getContractsForSource).toHaveBeenCalledOnce();
        expect(field).not.toBeInTheDocument();
    });

    it('keeps native paste entry on the editable guard contract field', async () => {
        mount();
        const field = await screen.findByLabelText('Guard contract');

        fireEvent.paste(field, { clipboardData: { getData: () => ' 84 ' } });

        expect(field).toHaveValue('84');
    });
});
