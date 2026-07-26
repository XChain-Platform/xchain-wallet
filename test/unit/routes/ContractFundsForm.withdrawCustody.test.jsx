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

function mountForm(mode, extra = {}) {
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
    const row = await screen.findByRole('button', { name: /MEMEVALID/i })
        .catch(() => screen.findByLabelText(/MEMEVALID/i));
    fireEvent.click(row);
    return messaging;
}

afterEach(() => cleanup());

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
});
