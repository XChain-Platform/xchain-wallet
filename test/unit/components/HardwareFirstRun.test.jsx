// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Connect Hardware Wallet on a fresh install: after the three connect steps
// hand over the wallet (onDeviceReady), the standard Set Password page shows,
// outside the step count; its Create Wallet makes the vault holding the
// hardware wallet, hands the open device to the shell bridge and finishes.
// Back from Set Password returns to step 3 as the user left it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MockHardwareSigner } from '../signers/MockHardwareSigner.js';

const DEVICE = { vendor: 'trezor', model: 'Safe 3', deviceIdentifier: 'device-abc', firmwareVersion: '2.8.1' };
const ACCOUNTS = [{
    chainId: 'bitcoin-mainnet', accountIndex: 0, address: 'bc1qmockaddress',
    publicKey: `02${'00'.repeat(32)}`, derivationPath: "m/84'/0'/0'", addressType: 'p2wpkh',
}];

// The connect steps are S4's PairSignerForm; this stand-in keeps its step-3
// state (a typed name) so Back can be shown to return to it intact.
vi.mock('../../../packages/core/src/shared/routes/PairSignerForm.jsx', async () => {
    const { useState } = await import('react');
    return {
        PairSignerForm({ mode, onDeviceReady, onBack }) {
            const [name, setName] = useState('My Trezor');
            return (
                <section aria-label="Hardware Wallet" data-mode={mode}>
                    <h1>Hardware Wallet</h1>
                    <p>Step 3 of 3: Accounts</p>
                    <label>
                        Wallet name
                        <input value={name} onChange={(e) => setName(e.target.value)} />
                    </label>
                    <button type="button" onClick={onBack}>Back</button>
                    <button
                        type="button"
                        onClick={() => onDeviceReady({
                            name,
                            device: DEVICE,
                            accounts: ACCOUNTS,
                            signer: globalThis.__hwFirstRunSigner,
                        })}
                    >
                        Add Wallet
                    </button>
                </section>
            );
        },
    };
});

const { HardwareFirstRun } = await import('../../../packages/core/src/shared/components/HardwareFirstRun.jsx');

afterEach(() => {
    cleanup();
    delete globalThis.__hwFirstRunSigner;
});

function mount(messaging, props = {}) {
    const handlers = {
        onBack: vi.fn(),
        onCreated: vi.fn(),
        onSignerPaired: vi.fn(),
        ...props,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <HardwareFirstRun pairTrezor={vi.fn()} pairLedger={vi.fn()} {...handlers} />
        </MessagingProvider>,
    );
    return handlers;
}

function typePasswords(password, confirm = password) {
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('Confirm password', { selector: 'input' }), { target: { value: confirm } });
}

describe('HardwareFirstRun', () => {
    it('runs connect in first mode, then Set Password, then creates the vault with the hardware wallet', async () => {
        const signer = new MockHardwareSigner({ vendor: 'trezor' });
        globalThis.__hwFirstRunSigner = signer;
        const createHardwareWallet = vi.fn(async () => ({
            walletId: 'hw-wallet-1', walletName: 'My Trezor', signer: { id: 'sig-1' }, accounts: [], addresses: [],
        }));
        const handlers = mount({ createHardwareWallet });

        expect(screen.getByRole('region', { name: 'Hardware Wallet' })).toHaveAttribute('data-mode', 'first');
        fireEvent.click(screen.getByRole('button', { name: 'Add Wallet' }));

        // The standard Set Password page, with no step count.
        expect(await screen.findByRole('heading', { name: 'Set Password' })).toBeInTheDocument();
        // The only step count left is the connect form's, hidden behind the page.
        expect(screen.getAllByText(/Step \d of 3/).every((el) => el.closest('[hidden]'))).toBe(true);

        typePasswords('correct horse battery');
        fireEvent.click(screen.getByRole('button', { name: 'Create Wallet' }));

        await waitFor(() => expect(handlers.onCreated).toHaveBeenCalledWith('hw-wallet-1'));
        expect(createHardwareWallet).toHaveBeenCalledWith({
            name: 'My Trezor', device: DEVICE, accounts: ACCOUNTS, password: 'correct horse battery',
        });
        expect(handlers.onSignerPaired).toHaveBeenCalledWith('sig-1', signer);
    });

    it('checks the password like the create flow and never creates on a mismatch', async () => {
        const createHardwareWallet = vi.fn();
        mount({ createHardwareWallet });
        fireEvent.click(screen.getByRole('button', { name: 'Add Wallet' }));
        await screen.findByRole('heading', { name: 'Set Password' });

        typePasswords('short');
        fireEvent.click(screen.getByRole('button', { name: 'Create Wallet' }));
        expect(await screen.findAllByText('Password must be at least 8 characters.')).not.toHaveLength(0);

        typePasswords('long enough password', 'something else');
        fireEvent.click(screen.getByRole('button', { name: 'Create Wallet' }));
        expect(await screen.findAllByText('Passwords do not match.')).not.toHaveLength(0);
        expect(createHardwareWallet).not.toHaveBeenCalled();
    });

    it('returns to step 3 as it was when Back leaves Set Password', async () => {
        mount({ createHardwareWallet: vi.fn() });
        fireEvent.change(screen.getByLabelText('Wallet name'), { target: { value: 'Cold Trezor' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add Wallet' }));
        await screen.findByRole('heading', { name: 'Set Password' });

        fireEvent.click(screen.getByRole('button', { name: 'Back to accounts' }));
        expect(screen.queryByRole('heading', { name: 'Set Password' })).toBeNull();
        expect(screen.getByLabelText('Wallet name')).toHaveValue('Cold Trezor');
    });

    it('shows the create refusal on the page', async () => {
        const createHardwareWallet = vi.fn(async () => {
            throw Object.assign(new Error('A wallet already exists on this device.'), { name: 'WalletExistsError' });
        });
        const handlers = mount({ createHardwareWallet });
        fireEvent.click(screen.getByRole('button', { name: 'Add Wallet' }));
        await screen.findByRole('heading', { name: 'Set Password' });
        typePasswords('correct horse battery');
        fireEvent.click(screen.getByRole('button', { name: 'Create Wallet' }));
        expect(await screen.findAllByText(/already exists/)).not.toHaveLength(0);
        expect(handlers.onCreated).not.toHaveBeenCalled();
    });
});
