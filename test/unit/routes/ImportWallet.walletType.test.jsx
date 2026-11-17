// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const BIP39_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LEGACY_PHRASE = 'explode gaze wolf admit nice charm except three any guitar into color';
const PASSWORD = 'correct-horse-battery';

afterEach(() => {
    cleanup();
    localStorage.clear();
});

function renderImport() {
    const importMnemonic = vi.fn().mockResolvedValue({ walletId: 'wallet-1' });
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic }}>
            <ImportWallet mode="fresh" onBack={() => {}} onImported={() => {}} />
        </MessagingProvider>,
    );
    return importMnemonic;
}

function chooseWalletType(type) {
    if (type === 'BIP39') return;
    fireEvent.click(screen.getByRole('button', { name: /Wallet type:/ }));
    fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${type}`) }));
}

function fillAndSubmit(phrase) {
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: phrase } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
}

describe('Import Wallet type choice', () => {
    it('shows exactly two described options with the standard recovery phrase selected', () => {
        renderImport();

        const trigger = screen.getByRole('button', { name: 'Wallet type: Standard recovery phrase' });
        expect(trigger.querySelector('svg')).not.toBeNull();
        expect(within(trigger).getByText('12 or 24 words, the standard recovery phrase')).toBeInTheDocument();
        fireEvent.click(trigger);
        const options = screen.getAllByRole('option');
        expect(options.map((option) => option.textContent)).toEqual([
            'Standard recovery phrase12 or 24 words, the standard recovery phrase',
            'FreeWallet / PartyWallet12 words from a legacy Counterparty wallet',
        ]);
        expect(options.every((option) => option.querySelector('svg, img') !== null)).toBe(true);
        fireEvent.click(options[1]);
        const legacyTrigger = screen.getByRole('button', { name: 'Wallet type: FreeWallet / PartyWallet' });
        expect(within(legacyTrigger).getByText('12 words from a legacy Counterparty wallet')).toBeInTheDocument();
    });

    it('keeps every option line within the 360px copy budget', () => {
        const optionLines = [
            'Standard recovery phrase',
            '12 or 24 words, the standard recovery phrase',
            'FreeWallet / PartyWallet',
            '12 words from a legacy Counterparty wallet',
        ];

        // At the wallet's 12px and 14px menu text sizes, 48 characters leaves
        // room for the icon and menu insets inside a 360px viewport.
        expect(optionLines.every((line) => line.length <= 48)).toBe(true);
    });

    it.each([
        ['BIP39', BIP39_PHRASE, 'bip39'],
        ['FreeWallet / PartyWallet', LEGACY_PHRASE, 'counterwallet-legacy'],
    ])('validates and imports the %s word list', async (type, phrase, format) => {
        const importMnemonic = renderImport();
        chooseWalletType(type);
        fillAndSubmit(phrase);

        await waitFor(() => expect(importMnemonic).toHaveBeenCalledWith(
            expect.objectContaining({ mnemonic: phrase, format }),
        ));
    });

    it.each([
        ['BIP39', LEGACY_PHRASE],
        ['FreeWallet / PartyWallet', BIP39_PHRASE],
    ])('rejects a phrase from the wrong list for %s', async (type, phrase) => {
        const importMnemonic = renderImport();
        chooseWalletType(type);
        fillAndSubmit(phrase);

        expect(await screen.findByRole('alert', { name: 'Form errors' })).toBeInTheDocument();
        expect(importMnemonic).not.toHaveBeenCalled();
    });
});
