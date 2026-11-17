// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';

const FREEWALLET_PHRASE = 'explode gaze wolf admit nice charm except three any guitar into color';
const BIP39_24_WORD_PHRASE = `${Array(23).fill('abandon').join(' ')} art`;
const PASSWORD = 'correct-horse-battery';

function FreeWalletImportFlow({ messaging, initialStep = 'welcome' }) {
    const [step, setStep] = useState(initialStep);

    if (step === 'complete') {
        return <h1>Imported FreeWallet</h1>;
    }

    return (
        <MessagingProvider shell="web" messaging={messaging}>
            {step === 'welcome' ? (
                <Onboarding
                    onCreate={() => setStep('create')}
                    onImport={() => setStep('import')}
                />
            ) : null}
            {step === 'import' || step === 'freewallet' ? (
                <ImportWallet
                    variant={step === 'freewallet' ? 'freewallet' : 'default'}
                    mode="fresh"
                    onBack={() => setStep('welcome')}
                    onImported={() => setStep('complete')}
                />
            ) : null}
        </MessagingProvider>
    );
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('FreeWallet onboarding migration flow', () => {
    it('imports a 12-word legacy phrase through the FreeWallet wallet type', async () => {
        localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
        localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
        localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
        const messaging = {
            importMnemonic: vi.fn().mockResolvedValue({ walletId: 'freewallet-wallet' }),
        };
        render(<FreeWalletImportFlow messaging={messaging} />);

        expect(screen.getAllByRole('button').map((button) => button.textContent.trim()))
            .toEqual(['Create New Wallet', 'Import Wallet']);
        expect(screen.queryByRole('button', { name: 'Import FreeWallet' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Import Wallet' }));

        expect(screen.getByRole('heading', { name: 'Import Wallet' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Wallet type: Standard recovery phrase' }));
        fireEvent.click(screen.getByRole('option', { name: /^FreeWallet \/ PartyWallet/ }));
        expect(screen.getByRole('button', { name: 'Wallet type: FreeWallet / PartyWallet' })).toBeInTheDocument();
        expect(screen.getByLabelText('Wallet name')).toHaveValue('Imported Wallet');
        expect(screen.getByText('0 / 12 words')).toBeInTheDocument();
        expect(screen.getByText('Uses the legacy Counterwallet/FreeWallet word list.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Import' }).className).toMatch(/success/);

        fireEvent.change(screen.getByLabelText('Recovery phrase'), {
            target: { value: BIP39_24_WORD_PHRASE },
        });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        // The import form is on the form error standard: its notice lists the
        // problem and the phrase field says it under itself too.
        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent('Expected 12 words, got 24.');
        expect(messaging.importMnemonic).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Recovery phrase'), {
            target: { value: FREEWALLET_PHRASE },
        });
        expect(screen.getByText('FreeWallet / Counterwallet recovery phrase detected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(await screen.findByRole('heading', { name: 'Automatic Donations' }))
            .toBeInTheDocument();
        await waitFor(() => expect(messaging.importMnemonic).toHaveBeenCalledWith({
            password: PASSWORD,
            mnemonic: FREEWALLET_PHRASE,
            name: 'Imported Wallet',
            bip39Passphrase: '',
            walletMode: 'full',
            format: 'counterwallet-legacy',
        }));
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(await screen.findByRole('heading', { name: 'Imported FreeWallet' }))
            .toBeInTheDocument();
    });

    it('keeps the old route working by preselecting FreeWallet', () => {
        render(<FreeWalletImportFlow messaging={{}} initialStep="freewallet" />);

        expect(screen.getByRole('heading', { name: 'Import Wallet' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Wallet type: FreeWallet / PartyWallet' })).toBeInTheDocument();
        expect(screen.getByText('Uses the legacy Counterwallet/FreeWallet word list.')).toBeInTheDocument();
    });
});

describe('FreeWallet lane format pin', () => {
    const BOTH_LISTS_PHRASE = 'idea wall voice bar arrow today burden party course pretty glove shove';
    const BIP39_ONLY_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    async function submit(phrase) {
        const messaging = { importMnemonic: vi.fn().mockResolvedValue({ walletId: 'w-1' }) };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ImportWallet variant="freewallet" mode="fresh" onBack={() => {}} onImported={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: phrase } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        const detected = screen.queryByText('FreeWallet / Counterwallet recovery phrase detected') !== null;
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        return { messaging, detected };
    }

    it('pins the legacy format for a phrase both wordlists accept', async () => {
        const { messaging, detected } = await submit(BOTH_LISTS_PHRASE);
        expect(detected).toBe(true);
        await waitFor(() => expect(messaging.importMnemonic).toHaveBeenCalled());
        expect(messaging.importMnemonic).toHaveBeenCalledWith(
            expect.objectContaining({ format: 'counterwallet-legacy' }),
        );
    });

    it('refuses a BIP39-only phrase when FreeWallet is selected', async () => {
        const { messaging } = await submit(BIP39_ONLY_PHRASE);
        expect(await screen.findByRole('alert', { name: 'Form errors' }))
            .toHaveTextContent(/Counterwallet\/FreeWallet word list/);
        expect(messaging.importMnemonic).not.toHaveBeenCalled();
    });
});
