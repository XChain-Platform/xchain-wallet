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

function FreeWalletImportFlow({ messaging }) {
    const [step, setStep] = useState('welcome');

    if (step === 'complete') {
        return <h1>Imported FreeWallet</h1>;
    }

    return (
        <MessagingProvider shell="web" messaging={messaging}>
            {step === 'welcome' ? (
                <Onboarding
                    onCreate={() => setStep('create')}
                    onImport={() => setStep('import')}
                    onImportFromFreeWallet={() => setStep('freewallet')}
                />
            ) : null}
            {step === 'freewallet' ? (
                <ImportWallet
                    variant="freewallet"
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
    it('uses the third onboarding entry to import a 12-word legacy phrase', async () => {
        localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
        localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
        localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
        const messaging = {
            importMnemonic: vi.fn().mockResolvedValue({ walletId: 'freewallet-wallet' }),
        };
        render(<FreeWalletImportFlow messaging={messaging} />);

        expect(screen.getAllByRole('button').map((button) => button.textContent.trim()))
            .toEqual(['Create new wallet', 'Import wallet', 'From FreeWallet']);
        fireEvent.click(screen.getByRole('button', { name: 'From FreeWallet' }));

        expect(screen.getByRole('heading', { name: 'Import from FreeWallet' })).toBeInTheDocument();
        expect(screen.getByLabelText('Wallet name')).toHaveValue('FreeWallet');
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();
        expect(screen.getByText('0 / 12 words')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Recovery phrase'), {
            target: { value: BIP39_24_WORD_PHRASE },
        });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Expected 12 words, got 24.');
        expect(messaging.importMnemonic).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Recovery phrase'), {
            target: { value: FREEWALLET_PHRASE },
        });
        expect(screen.getByText('Counterwallet/FreeWallet recovery phrase detected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(await screen.findByRole('heading', { name: 'Automatic Donation System' }))
            .toBeInTheDocument();
        await waitFor(() => expect(messaging.importMnemonic).toHaveBeenCalledWith({
            password: PASSWORD,
            mnemonic: FREEWALLET_PHRASE,
            name: 'FreeWallet',
            bip39Passphrase: '',
        }));
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(await screen.findByRole('heading', { name: 'Imported FreeWallet' }))
            .toBeInTheDocument();
    });
});
