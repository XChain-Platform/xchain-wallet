// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-23: a WITHDRAW moves the CONTRACT's custody, but the form used to size
// itself off the USER's wallet balance - offering "635,000 MEMEVALID available"
// and a Max to match while the contract held 5,000. The excess only failed
// on-chain, as `invalid: insufficient contract balance`, after a signed and
// fee-paying transaction. These drive the real component in both modes: the
// numbers a user reads and Max fills must come from whichever balance the
// action actually spends, and an over-withdrawal must stop at the form.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { ContractFundsForm } from '../../../packages/core/src/shared/routes/ContractFundsForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: ADDRESS,
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

// The wallet holds far more than the contract does: the whole point of D-23 is
// that these two numbers are different and the form must pick the right one.
const WALLET_BALANCE = '635000';
const CONTRACT_HELD = '5000';

// `walletMode` among `extra` is the mode of wallet `w`, published the way the
// shell does from the wallet list; every other entry is a messaging method.
function mountForm(mode, { walletMode = 'full', ...extra } = {}, props = {}) {
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getContractBalance: vi.fn().mockResolvedValue({
            data: [{ tick: 'MEMEVALID', quantity: CONTRACT_HELD }],
        }),
        // useTickBalance's source: per-chain, per-address SDK balance rows.
        getWalletBalances: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{
                address: ADDRESS,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: 'MEMEVALID', quantity: WALLET_BALANCE, divisibility: 0 }],
                },
            }],
        }),
        ...extra,
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ContractFundsForm, {
                mode,
                walletId: 'w',
                chainId: 'bitcoin-mainnet',
                contractActionIndex: '1632',
                onBack() {},
                ...props,
            }),
        ),
    );
    return messaging;
}

// Pick MEMEVALID through the standard TokenPicker both modes open: withdraw
// hands it the contract's custody rows, deposit the wallet's tokens.
async function pickToken(messaging) {
    const openPicker = await screen.findByRole('button', { name: /^Token:/ });
    fireEvent.click(openPicker);
    // The wallet picker also renders a favorite toggle per row, whose label
    // names the token too; pick the row itself.
    const row = await screen.findAllByRole('button', { name: /MEMEVALID/i })
        .then((buttons) => {
            const rows = buttons.filter((button) => !/pin|favou?rite/i.test(button.getAttribute('aria-label') || ''));
            if (rows.length !== 1) throw new Error(`expected one MEMEVALID row, found ${rows.length}`);
            return rows[0];
        })
        .catch(() => screen.findByLabelText(/MEMEVALID/i));
    fireEvent.click(row);
    return messaging;
}

afterEach(() => {
    cleanup();
    resetWalletModes();
    __clearTokenInfoCache();
});

describe('ContractFundsForm withdraw sizes off contract custody (D-23)', () => {
    it('opens the standard token picker on only the contract-held tokens, with the held amounts', async () => {
        mountForm('withdraw', {
            getContractBalance: vi.fn().mockResolvedValue({
                data: [
                    { tick: 'MEMEVALID', quantity: CONTRACT_HELD },
                    { tick: 'PEPE', quantity: '12.5' },
                ],
            }),
        });
        const field = await screen.findByRole('button', { name: /^Token:/ });
        // The title is fixed; the contract shows as the first field instead.
        expect(screen.getByRole('heading', { name: 'Withdraw from Contract' })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Contract' })).toHaveTextContent('#1632');
        fireEvent.click(field);

        // The picker's own title, never the form's "Withdraw from Contract" page.
        expect(await screen.findByRole('heading', { name: 'Select Token' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /^Withdraw/ })).toBeNull();
        const option = (tick) => (name) => name.startsWith(`Select ${tick} on Bitcoin,`);
        const meme = await screen.findByRole('button', { name: option('MEMEVALID') });
        expect(meme).toHaveAccessibleName(/5,000 MEMEVALID/);
        expect(meme).not.toHaveAccessibleName(/635,000/);
        expect(screen.getByRole('button', { name: option('PEPE') })).toHaveAccessibleName(/12\.5 PEPE/);
        // Only what the contract holds: not the wallet's BTC.
        expect(screen.getAllByRole('button', { name: (name) => name.startsWith('Select ') })).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', { name: option('PEPE') }));
        expect(await screen.findByRole('button', { name: /^Token: PEPE/ })).toBeInTheDocument();
    });

    it('says the contract holds no tokens when its custody is empty, with nothing to reset', async () => {
        mountForm('withdraw', { getContractBalance: vi.fn().mockResolvedValue({ data: [] }) });
        fireEvent.click(await screen.findByRole('button', { name: /^Token:/ }));

        expect(await screen.findByRole('heading', { name: 'Select Token' })).toBeInTheDocument();
        expect(await screen.findByText('No contract tokens')).toBeInTheDocument();
        expect(screen.getByText('Tokens held by this contract appear here.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reset Filters' })).toBeNull();
        expect(screen.queryAllByRole('button', { name: (name) => name.startsWith('Select ') })).toHaveLength(0);
    });

    it('reads the contract balance for the target contract, not just the wallet', async () => {
        const messaging = mountForm('withdraw');
        await waitFor(() => expect(messaging.getContractBalance).toHaveBeenCalledTimes(1));
        expect(messaging.getContractBalance.mock.calls[0][0]).toEqual({
            chainId: 'bitcoin-mainnet',
            contractActionIndex: '1632',
        });
    });

    it('shows the custody amount as "held by the contract", not the wallet balance', async () => {
        const messaging = mountForm('withdraw');
        await pickToken(messaging);
        expect(await screen.findByText(/5,000 MEMEVALID held by the contract/)).toBeInTheDocument();
        expect(screen.queryByText(/635,000/)).not.toBeInTheDocument();
    });

    it('blocks a withdrawal larger than the contract holds, before any signing', async () => {
        const messaging = mountForm('withdraw');
        await pickToken(messaging);
        fireEvent.change(await screen.findByLabelText(/Quantity/i, { selector: 'input' }), { target: { value: '6000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
        expect(await screen.findByRole('alert'))
            .toHaveTextContent('The contract only holds 5,000 MEMEVALID.');
    });

    it('compares large custody quantities without losing integer precision', async () => {
        const messaging = mountForm('withdraw', {
            getContractBalance: vi.fn().mockResolvedValue({
                data: [{ tick: 'MEMEVALID', quantity: '9007199254740992' }],
            }),
        });
        await pickToken(messaging);
        fireEvent.change(await screen.findByLabelText(/Quantity/i, { selector: 'input' }), {
            target: { value: '9007199254740993' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('The contract only holds 9,007,199,254,740,992 MEMEVALID.');
    });

    it('allows a withdrawal the contract can cover', async () => {
        const messaging = mountForm('withdraw');
        await pickToken(messaging);
        fireEvent.change(await screen.findByLabelText(/Quantity/i, { selector: 'input' }), { target: { value: '5000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
        await waitFor(() => {
            const alert = screen.queryByRole('alert');
            expect(alert === null || !/only holds/.test(alert.textContent)).toBe(true);
        });
    });

    it('deposit still sizes off the WALLET, and never reads contract custody', async () => {
        // Depositing spends the user's own tokens, so the old behaviour is the
        // correct behaviour here - the fix must not cross the two modes over.
        const messaging = mountForm('deposit');
        await pickToken(messaging);
        expect(await screen.findByText(/635,000 MEMEVALID available/)).toBeInTheDocument();
        expect(messaging.getContractBalance).not.toHaveBeenCalled();
    });

    it('blocks a deposit larger than the wallet balance', async () => {
        const messaging = mountForm('deposit');
        await pickToken(messaging);
        expect(await screen.findByText(/635,000 MEMEVALID available/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/Quantity/i, { selector: 'input' }), { target: { value: '635001' } });
        fireEvent.click(screen.getByRole('button', { name: 'Deposit' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Only 635,000 MEMEVALID is available to deposit.');
    });

    it('shows required token and quantity messages before review', async () => {
        const messaging = mountForm('deposit');
        const submit = await screen.findByRole('button', { name: 'Deposit' });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);
        expect(await screen.findByRole('alert')).toHaveTextContent('Token ticker is required.');

        await pickToken(messaging);
        fireEvent.click(screen.getByRole('button', { name: 'Deposit' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Quantity must be a positive decimal.');
    });

    it('rejects quantity beyond the token precision before review', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({ divisibility: 2 });
        const messaging = mountForm('deposit', { getTokenInfo });
        await pickToken(messaging);
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalled());
        fireEvent.change(screen.getByLabelText(/Quantity/i, { selector: 'input' }), { target: { value: '1.234' } });

        expect(await screen.findByText('Amount can have at most 2 decimal places.'))
            .toBeInTheDocument();
    });

    it('rejects a malformed contract ID before review', async () => {
        mountForm('deposit', {}, { contractActionIndex: '0' });
        fireEvent.click(await screen.findByRole('button', { name: 'Deposit' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Contract ID must be a positive whole number.');
    });

    it('uses the shared confirmation and keeps values when Reject returns to the form', async () => {
        const messaging = mountForm('withdraw', {
            walletMode: 'watcher',
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
        });
        await pickToken(messaging);
        fireEvent.change(screen.getByLabelText(/Quantity/i, { selector: 'input' }), { target: { value: '12.5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));

        expect(await screen.findByRole('heading', { name: 'Confirm' })).toBeInTheDocument();
        expect(screen.getByText('Another phone signs for this wallet: this prepares the transaction for it. Sign it there, then bring the signed transaction to a wallet that can broadcast it.')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent(/Withdraw 12.5 MEMEVALID/i);
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('0.000015 BTC');
        expect(screen.queryByTestId('confirm-total-main')).toBeNull();
        expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

        expect(await screen.findByLabelText(/Quantity/i, { selector: 'input' })).toHaveValue('12.50000000');
        expect(screen.getByRole('button', { name: /^Token: MEMEVALID/ })).toBeInTheDocument();
    });
});
