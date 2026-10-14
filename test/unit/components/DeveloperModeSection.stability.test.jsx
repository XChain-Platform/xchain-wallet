// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let messaging;
let settings;
const fundActiveWalletFromMiner = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));
vi.mock('../../../packages/core/src/shared/components/LogConsole.jsx', () => ({ LogConsole: () => null }));
vi.mock('../../../packages/core/src/flows/regtestFaucet.js', () => ({ fundActiveWalletFromMiner }));

const { DeveloperModeSection, RegtestRow } = await import(
    '../../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx'
);

beforeEach(() => {
    settings = {
        ...createDefaultSettings(),
        developerMode: true,
        fees: {
            'bitcoin-regtest': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
        },
    };
    messaging = {
        listWallets: vi.fn(async () => [{ id: 'wallet-1' }]),
        listCustomChains: vi.fn(async () => ({ descriptors: [] })),
        getNewestAddress: vi.fn(async () => ({ address: 'bcrt1qtest' })),
    };
    fundActiveWalletFromMiner.mockReset();
    fundActiveWalletFromMiner.mockResolvedValue({
        ok: true,
        txid: 'txid-123',
        address: 'bcrt1qactive',
    });
});

afterEach(() => cleanup());

describe('DeveloperModeSection unavailable actions', () => {
    it('does not render the unimplemented Raw PSBT control', () => {
        render(<DeveloperModeSection />);
        expect(screen.queryByRole('switch', { name: 'Raw PSBT inspector' })).toBeNull();
        expect(screen.queryByText(/Coming soon/)).toBeNull();
    });

    it('hides the mint handoff when the route callback is unavailable', () => {
        render(<DeveloperModeSection />);
        expect(screen.queryByRole('button', { name: 'Mint test XCHAIN' })).toBeNull();
    });

    it('rejects an empty faucet amount before requesting an address', () => {
        render(<DeveloperModeSection />);
        const input = screen.getByRole('textbox', { name: 'Amount (BTC)' });
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Get test BTC' }));

        expect(screen.getByText('Enter an amount of BTC greater than 0.')).toBeTruthy();
        expect(messaging.getNewestAddress).not.toHaveBeenCalled();
    });

    it('funds the active wallet and account', async () => {
        render(
            <DeveloperModeSection
                activeWallet={{ id: 'wallet-2', name: 'Second wallet' }}
                activeAccount={{ id: 'account-7', name: 'Trading' }}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Get test BTC' }));

        await waitFor(() => expect(fundActiveWalletFromMiner).toHaveBeenCalledWith(expect.objectContaining({
            messaging,
            walletId: 'wallet-2',
            accountId: 'account-7',
            chainId: 'bitcoin-regtest',
            amount: 10,
        })));
        expect(messaging.listWallets).not.toHaveBeenCalled();
        expect(await screen.findByText(/Sent 10 BTC to bcrt1qactive/)).toBeTruthy();
    });

    it('keeps hook ordering stable when the faucet appears and disappears', () => {
        const props = {
            activeWallet: { id: 'wallet-2' },
            activeAccount: { id: 'account-7' },
        };
        const view = render(<DeveloperModeSection {...props} />);

        settings = { ...settings, fees: {} };
        expect(() => view.rerender(<DeveloperModeSection {...props} />)).not.toThrow();

        settings = {
            ...settings,
            fees: {
                'bitcoin-regtest': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
            },
        };
        expect(() => view.rerender(<DeveloperModeSection {...props} />)).not.toThrow();
    });

    it('exposes the adopted style guide fields and actions by role', async () => {
        render(<DeveloperModeSection />);

        expect(screen.getByRole('combobox', {
            name: 'Cache password for localhost auto-sign',
        })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Miner URL' })).toBeTruthy();

        fireEvent.click(await screen.findByRole('button', { name: 'Add custom chain…' }));

        expect(screen.getByRole('textbox', {
            name: 'Custom chain descriptor JSON',
        })).toBeTruthy();
        expect(screen.getByRole('button', {
            name: 'Paste custom chain descriptor',
        })).toBeTruthy();
    });

    it('explains when no active wallet is available for activation', async () => {
        render(
            <RegtestRow
                descriptor={{ id: 'bitcoin-regtest', displayName: 'Bitcoin Regtest' }}
                isActive={false}
                disabled={false}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Activate…' }));
        fireEvent.change(screen.getByLabelText('Bitcoin Regtest activation password'), {
            target: { value: 'password' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        expect(await screen.findByText('No active wallet is available for network activation.')).toBeTruthy();
    });

    it('shows an activated regtest as active immediately after activation', async () => {
        messaging.activateChainRequest = vi.fn(async () => ({ addresses: [{ address: 'bcrt1qnew' }] }));
        render(
            <RegtestRow
                descriptor={{ id: 'bitcoin-regtest', displayName: 'Bitcoin Regtest' }}
                isActive={false}
                disabled={false}
                activeWallet={{ id: 'wallet-2' }}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Activate…' }));
        fireEvent.change(screen.getByLabelText('Bitcoin Regtest activation password'), {
            target: { value: 'password' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        expect(await screen.findByText('Active')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Activate…' })).toBeNull();
        expect(messaging.activateChainRequest).toHaveBeenCalledWith(expect.objectContaining({
            walletId: 'wallet-2',
            chainId: 'bitcoin-regtest',
        }));
    });
});
