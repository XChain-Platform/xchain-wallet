// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let messaging;
let settings;
const fundActiveWalletFromMiner = vi.hoisted(() => vi.fn());
const update = vi.fn();

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
    screenVariantFor: () => 'full',
}));
vi.mock('../../../packages/core/src/shared/components/LogConsole.jsx', () => ({ LogConsole: () => null }));
vi.mock('../../../packages/core/src/flows/regtestFaucet.js', () => ({ fundActiveWalletFromMiner }));

const { DeveloperModeSection, RegtestRow } = await import(
    '../../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx'
);
const { Settings } = await import('../../../packages/core/src/shared/routes/Settings.jsx');

beforeEach(() => {
    settings = {
        ...createDefaultSettings(),
        developerMode: true,
        fees: {
            'bitcoin-regtest': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
        },
    };
    messaging = {
        listConnectedSites: vi.fn(async () => []),
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
    update.mockReset();
    update.mockImplementation(async (patch) => ({ ...settings, ...patch }));
});

afterEach(() => cleanup());

describe('DeveloperModeSection unavailable actions', () => {
    it('does not render the unimplemented Raw PSBT control', () => {
        render(<DeveloperModeSection />);
        expect(screen.getByRole('group', { name: 'Developer mode settings' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Developer options' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Local dApp controls' })).toBeTruthy();
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

    it('labels its master switch as an action instead of repeating the page title', () => {
        render(<DeveloperModeSection />);

        const toggle = screen.getByRole('switch', { name: 'Turn on developer mode' });
        expect(toggle.closest('label')).toHaveTextContent(/^Turn on/);
        expect(screen.queryByText('Developer Mode')).toBeNull();
    });

    it('hides developer-only controls and endpoint navigation while off', () => {
        settings = { ...settings, developerMode: false, activeNetwork: 'mainnet' };
        render(<DeveloperModeSection />);

        expect(screen.getByRole('switch', { name: 'Turn on developer mode' })).toBeVisible();
        expect(screen.getByRole('switch', { name: 'Learn Mode' })).toBeVisible();
        expect(screen.queryByRole('switch', { name: 'Show variant popover' })).toBeNull();
        expect(screen.queryByText('Regtest networks')).toBeNull();
        expect(screen.queryByText('Regtest faucet')).toBeNull();
        expect(screen.queryByText('Custom chains')).toBeNull();
        expect(screen.queryByRole('switch', { name: 'Auto-approve localhost dApps' })).toBeNull();
        expect(screen.queryByText('Logs and diagnostics console')).toBeNull();

        cleanup();
        render(<Settings onBack={() => {}} />);
        expect(screen.queryByRole('button', { name: /Network & endpoints/ })).toBeNull();
    });

    it.each(['testnet', 'regtest'])(
        'persists disabling Developer Mode and Mainnet in one write from %s',
        async (activeNetwork) => {
            const reload = vi.fn();
            settings = { ...settings, activeNetwork };
            render(<DeveloperModeSection reload={reload} />);

            expect(screen.getByText(/Turning it off returns the wallet to Mainnet\./)).toBeVisible();
            fireEvent.click(screen.getByRole('switch', { name: 'Turn on developer mode' }));

            await waitFor(() => expect(update).toHaveBeenCalledWith({
                developerMode: false,
                activeNetwork: 'mainnet',
            }));
            expect(reload).toHaveBeenCalledOnce();
        },
    );
});
