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

function mountForm(mode, extra = {}, props = {}) {
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

// Pick MEMEVALID through whichever picker the mode opens: withdraw lists the
// contract's custody rows as buttons, deposit reuses the wallet TokenPicker
// (whose rows are labelled "Open <TICK> details").
async function pickToken(messaging) {
    const openPicker = await screen.findByRole('button', { name: /Token/i });
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
    __clearTokenInfoCache();
});

describe('ContractFundsForm withdraw sizes off contract custody (D-23)', () => {
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
        fireEvent.change(await screen.findByLabelText(/Quantity/i), { target: { value: '6000' } });
        fireEvent.click(screen.getByRole('button', { name: /^(Withdraw|Preview)$/ }));
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
        fireEvent.change(await screen.findByLabelText(/Quantity/i), {
            target: { value: '9007199254740993' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^(Withdraw|Preview)$/ }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('The contract only holds 9,007,199,254,740,992 MEMEVALID.');
    });

    it('allows a withdrawal the contract can cover', async () => {
        const messaging = mountForm('withdraw');
        await pickToken(messaging);
        fireEvent.change(await screen.findByLabelText(/Quantity/i), { target: { value: '5000' } });
        fireEvent.click(screen.getByRole('button', { name: /^(Withdraw|Preview)$/ }));
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
        fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: '635001' } });
        fireEvent.click(screen.getByRole('button', { name: /^(Deposit|Preview)$/ }));

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
        fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: '1.234' } });

        expect(await screen.findByText('Amount can have at most 2 decimal places.'))
            .toBeInTheDocument();
    });

    it('rejects a malformed contract ID before review', async () => {
        mountForm('deposit', {}, { contractActionIndex: '0' });
        fireEvent.click(await screen.findByRole('button', { name: 'Deposit' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Contract ID must be a positive whole number.');
    });

    it('labels the withdrawal recipient and keeps values when Back returns to the form', async () => {
        const messaging = mountForm('withdraw', {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
        });
        await pickToken(messaging);
        fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: '12.5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByRole('heading', { name: 'Review withdraw' })).toBeInTheDocument();
        expect(screen.getByText('Recipient')).toBeInTheDocument();
        expect(screen.getByText('12.5')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(await screen.findByLabelText(/Quantity/i)).toHaveValue('12.5');
        expect(screen.getByRole('button', { name: /^Token: MEMEVALID/ })).toBeInTheDocument();
    });
});
