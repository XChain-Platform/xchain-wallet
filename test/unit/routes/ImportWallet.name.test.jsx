// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

afterEach(cleanup);

function submitPhrase(name, importMnemonic = vi.fn().mockResolvedValue({ wallet: { id: 'w1', name: 'x' } })) {
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic }}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />
        </MessagingProvider>,
    );
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
    fireEvent.change(screen.getByLabelText('Wallet name'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText(/^Confirm/), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    return importMnemonic;
}

describe('ImportWallet wallet name', () => {
    it('refuses a name that draws no mark', () => {
        const importMnemonic = submitPhrase('​​​');

        expect(screen.getByRole('alert')).toHaveTextContent('Wallet name must include a visible character.');
        expect(importMnemonic).not.toHaveBeenCalled();
    });

    it('refuses a name past the shared length cap', () => {
        const importMnemonic = submitPhrase('N'.repeat(65));

        expect(screen.getByRole('alert')).toHaveTextContent('Wallet name must be 64 characters or fewer.');
        expect(importMnemonic).not.toHaveBeenCalled();
    });

    it('imports with a name of exactly the cap', async () => {
        const importMnemonic = submitPhrase('N'.repeat(64));

        await waitFor(() => expect(importMnemonic).toHaveBeenCalledTimes(1));
        expect(importMnemonic.mock.calls[0][0].name).toBe('N'.repeat(64));
    });

    it('imports a blank name under the default', async () => {
        const importMnemonic = submitPhrase('   ');

        await waitFor(() => expect(importMnemonic).toHaveBeenCalledTimes(1));
        expect(importMnemonic.mock.calls[0][0].name.length).toBeGreaterThan(0);
    });

    it('clears the name error when the name is edited', () => {
        submitPhrase('N'.repeat(65));
        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Wallet name'), { target: { value: 'Savings' } });

        expect(screen.queryByText(/Wallet name must/)).toBeNull();
    });

    it('applies the same rule on the private key lane', () => {
        const importMnemonic = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={{ importMnemonic }}>
                <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />
            </MessagingProvider>,
        );
        fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));
        fireEvent.change(screen.getByLabelText('WIF private key'), { target: { value: 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ' } });
        fireEvent.click(screen.getByLabelText("I understand this key isn't recoverable from a recovery phrase."));
        fireEvent.change(screen.getByLabelText('Wallet name'), { target: { value: 'N'.repeat(65) } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText(/^Confirm/), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Wallet name must be 64 characters or fewer.');
        expect(importMnemonic).not.toHaveBeenCalled();
    });
});
