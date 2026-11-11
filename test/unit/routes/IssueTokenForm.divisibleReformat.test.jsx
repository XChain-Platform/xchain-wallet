// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Max supply, Initial mint, Max per transaction and Max per address are amount
// fields: every edit is checked against the precision the Divisible switch sets
// (8 places on, whole numbers off), turning Divisible off under a fractional
// value shows a field error at once instead of waiting for submit, and the
// three fields under the cap carry a Max that fills the Max supply value. The
// compose payload keeps DECIMALS and MINT_SUPPLY exactly as the fields hold them.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';

const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: 'bc1qexampleexampleexampleexampleexampleex',
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

const DIVISIBLE = 'Divisible (8 decimal places)';
const MAX = 'Use max available amount';

let composeForConfirm;

function mountForm() {
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(IssueTokenForm, { walletId: 'w', onBack() {} }),
        ),
    );
}

async function typeTicker() {
    fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'REFORMAT' } });
}

// "Max supply" also names a lock switch, so the amount field is found by role.
function field(label) {
    return label === 'Max supply'
        ? screen.getByRole('textbox', { name: label })
        : screen.getByLabelText(label);
}

function type(label, value) {
    fireEvent.change(field(label), { target: { value } });
}

function errorTextOf(label) {
    const input = field(label);
    const ids = String(input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent || '').join(' ');
}

function maxButtons() {
    return screen.getAllByRole('button', { name: MAX });
}

async function submit() {
    fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
}

async function composedParams() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
    return composeForConfirm.mock.calls[0][0].actionData.params;
}

afterEach(() => cleanup());

describe('IssueTokenForm amount fields follow the Divisible precision', () => {
    it.each([
        'Max supply',
        'Initial mint',
        'Max per transaction',
        'Max per address',
    ])('reformats %s in place and clears the whole-number error when Divisible turns back on', async (label) => {
        mountForm();
        await typeTicker();
        if (label.startsWith('Max per')) {
            fireEvent.click(screen.getByRole('button', { name: /^Public minting/ }));
        }
        const input = field(label);
        type(label, '1234.5');
        expect(errorTextOf(label)).not.toMatch(/at most 8 decimal places/);

        fireEvent.click(screen.getByLabelText(DIVISIBLE));
        expect(errorTextOf(label)).toMatch(/at most 0 decimal places/);

        fireEvent.click(screen.getByLabelText(DIVISIBLE));

        expect(field(label)).toBe(input);
        expect(input).toHaveValue('1,234.50000000');
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
        expect(errorTextOf(label)).not.toMatch(/at most 0 decimal places/);
    });

    it('keeps a fractional stored value when Divisible turns off, then clears its precision error when turned on', async () => {
        mountForm();
        await typeTicker();
        type('Max supply', '12.5');
        expect(field('Max supply')).toHaveValue('12.5');

        fireEvent.click(screen.getByLabelText(DIVISIBLE));

        expect(field('Max supply')).toHaveValue('12.5');
        expect(errorTextOf('Max supply')).toMatch(/at most 0 decimal places/);

        fireEvent.click(screen.getByLabelText(DIVISIBLE));

        expect(field('Max supply')).toHaveValue('12.50000000');
        expect(field('Max supply')).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('shows one in the exact format of each Divisible mode', async () => {
        mountForm();
        await typeTicker();
        type('Max supply', '1');
        expect(field('Max supply')).toHaveValue('1');

        fireEvent.blur(field('Max supply'));
        expect(field('Max supply')).toHaveValue('1.00000000');

        fireEvent.click(screen.getByLabelText(DIVISIBLE));
        expect(field('Max supply')).toHaveValue('1');

        fireEvent.click(screen.getByLabelText(DIVISIBLE));
        expect(field('Max supply')).toHaveValue('1.00000000');
    });

    it('shows a field error at once when Divisible turns off under a fractional Max supply and Initial mint', async () => {
        mountForm();
        await typeTicker();
        type('Max supply', '1.5');
        type('Initial mint', '1.5');
        expect(field('Max supply')).not.toHaveAttribute('aria-invalid', 'true');

        fireEvent.click(screen.getByLabelText(DIVISIBLE));

        for (const label of ['Max supply', 'Initial mint']) {
            const input = field(label);
            expect(input).toHaveValue('1.5');
            expect(input).toHaveAttribute('aria-invalid', 'true');
            expect(errorTextOf(label)).toMatch(/at most 0 decimal places/);
        }
        expect(composeForConfirm).not.toHaveBeenCalled();

        await submit();
        expect(await screen.findByRole('alert', { name: 'Form errors' }))
            .toHaveTextContent('Max supply must be a whole number for an indivisible token.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('keeps the value and allows 8 places when Divisible turns on', async () => {
        mountForm();
        await typeTicker();
        fireEvent.click(screen.getByLabelText(DIVISIBLE));
        type('Max supply', '15');
        fireEvent.click(screen.getByLabelText(DIVISIBLE));
        type('Initial mint', '1.12345678');

        expect(screen.getByLabelText('Initial mint')).toHaveValue('1.12345678');
        expect(screen.getByLabelText('Initial mint')).not.toHaveAttribute('aria-invalid', 'true');
        expect(field('Max supply')).toHaveValue('15.00000000');

        await submit();
        const params = await composedParams();
        expect(params.MAX_SUPPLY).toBe('15');
        expect(params.MINT_SUPPLY).toBe('1.12345678');
    });

    it('fills the Max supply value from Max on Initial mint, Max per transaction and Max per address', async () => {
        mountForm();
        await typeTicker();
        fireEvent.click(screen.getByLabelText(DIVISIBLE));
        // Public minting starts closed; open it so its two amount fields show.
        fireEvent.click(screen.getByRole('button', { name: /^Public minting/ }));
        // Every amount field shows Max in the field (U61); Max supply has
        // nothing to fill from, so its Max stays disabled.
        const buttons = maxButtons();
        expect(buttons).toHaveLength(4);
        for (const button of buttons) expect(button).toBeDisabled();

        type('Max supply', '5000');
        expect(maxButtons()[0]).toBeDisabled();
        for (const button of maxButtons().slice(1)) expect(button).toBeEnabled();
        fireEvent.click(maxButtons()[1]);
        fireEvent.click(maxButtons()[2]);
        fireEvent.click(maxButtons()[3]);

        expect(field('Initial mint')).toHaveValue('5,000');
        expect(field('Max per transaction')).toHaveValue('5,000');
        expect(field('Max per address')).toHaveValue('5,000');

        await submit();
        const params = await composedParams();
        expect(params.MINT_SUPPLY).toBe('5000');
        expect(params.MAX_MINT).toBe('5000');
        expect(params.MINT_ADDRESS_MAX).toBe('5000');
    });

    it('shows a field error while typing a ninth decimal place and refuses to compose', async () => {
        mountForm();
        await typeTicker();
        type('Max supply', '1.12345678');
        type('Max supply', '1.123456789');

        expect(errorTextOf('Max supply')).toMatch(/at most 8 decimal places/);
        expect(field('Max supply')).toHaveAttribute('aria-invalid', 'true');
        expect(composeForConfirm).not.toHaveBeenCalled();

        await submit();
        expect(await screen.findByRole('alert', { name: 'Form errors' }))
            .toHaveTextContent('Max supply can have at most 8 decimal places.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it.each([
        [false, '5000', '1000', '0'],
        [true, '10.5', '2.25', '8'],
    ])('composes DECIMALS and MINT_SUPPLY as entered (divisible %s)', async (divisible, supply, mint, decimals) => {
        mountForm();
        await typeTicker();
        if (!divisible) fireEvent.click(screen.getByLabelText(DIVISIBLE));
        type('Max supply', supply);
        type('Initial mint', mint);

        await submit();
        const params = await composedParams();
        expect(params.DECIMALS).toBe(decimals);
        expect(params.MAX_SUPPLY).toBe(supply);
        expect(params.MINT_SUPPLY).toBe(mint);
    });
});
