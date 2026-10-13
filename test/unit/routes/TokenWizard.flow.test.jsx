// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

const ADDRESSES = {
    'bitcoin-mainnet': [{
        id: 'addr-1',
        address: 'bc1qexampleexampleexampleexampleexampleex',
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
};

function mountWizard({ composeForConfirm = vi.fn().mockResolvedValue({
    psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
}) } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(TokenWizard, { walletId: 'w', onBack() {} }),
        ),
    );
    return messaging;
}

afterEach(cleanup);

describe('TokenWizard guided flow', () => {
    it('supports keyboard submission, accurate progress, Back retention, and a complete review', async () => {
        mountWizard();

        expect(await screen.findByText('Step 1 of 4: Template')).toBeTruthy();
        fireEvent.click(screen.getByText('Utility token'));
        expect(await screen.findByText('Step 2 of 4: Network')).toBeTruthy();
        await screen.findByLabelText('Fee paid by');

        fireEvent.submit(screen.getByRole('form', { name: 'Choose token chain' }));
        expect(await screen.findByText('Step 3 of 4: Details')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'UTILITY' },
        });
        fireEvent.change(screen.getByLabelText('Display name (optional)'), {
            target: { value: 'Useful Token' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
        fireEvent.click(screen.getByLabelText('Divisible (8 decimal places)'));
        fireEvent.change(screen.getByLabelText('Description (optional)'), {
            target: { value: 'Membership credits' },
        });
        fireEvent.change(screen.getByLabelText('Max mint per transaction (optional)'), {
            target: { value: '25' },
        });

        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        expect(await screen.findByText('Step 4 of 4: Review')).toBeTruthy();
        for (const value of [
            'Utility token',
            'Useful Token',
            'UTILITY',
            '1000',
            '8',
            'Membership credits',
            '25',
            'XCHAIN',
        ]) {
            expect(screen.getAllByText(value).length).toBeGreaterThan(0);
        }

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByLabelText('Token name (ticker)').value).toBe('UTILITY');
        expect(screen.getByLabelText('Display name (optional)').value).toBe('Useful Token');
        expect(screen.getByLabelText('Supply').value).toBe('1000');
        expect(screen.getByLabelText('Divisible (8 decimal places)').checked).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(await screen.findByText('Step 2 of 4: Network')).toBeTruthy();
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token chain' }));
        expect(screen.getByLabelText('Token name (ticker)').value).toBe('UTILITY');
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));
        expect(await screen.findByTestId('confirm-modal')).toBeTruthy();
    });

    it('keeps host composition errors on the review step', async () => {
        const composeForConfirm = vi.fn().mockRejectedValue(new Error('Host could not compose token'));
        mountWizard({ composeForConfirm });

        fireEvent.click(await screen.findByText('Meme token'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token chain' }));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'MEME' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));

        // An unclassified host error reaches the user as the generic house line.
        expect(await screen.findByText(/Something went wrong\. Try again\./)).toBeTruthy();
        expect(screen.getByText('Step 4 of 4: Review')).toBeTruthy();
        expect(composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid optional mint caps before review', async () => {
        const messaging = mountWizard();
        fireEvent.click(await screen.findByText('Utility token'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token chain' }));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'UTILITY' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Max mint per transaction (optional)'), {
            target: { value: 'zero' },
        });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Max mint per transaction must be a positive number',
        );
        expect(screen.queryByText('Step 4 of 4: Review')).toBeNull();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects amounts that exceed the selected divisibility', async () => {
        const messaging = mountWizard();
        fireEvent.click(await screen.findByText('Meme token'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token chain' }));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'MEME' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1.5' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Supply must be a whole number for an indivisible token.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('does not validate hidden fields left by a different template', async () => {
        mountWizard();
        fireEvent.click(await screen.findByText('Custom'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token chain' }));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'SWITCHED' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Transfer ownership to (optional)'), {
            target: { value: 'not-an-address' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        fireEvent.click(screen.getByText('Meme token'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token chain' }));
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        expect(await screen.findByText('Step 4 of 4: Review')).toBeTruthy();
        expect(screen.queryByText(/Transfer ownership address is not valid/i)).toBeNull();
    });
});
