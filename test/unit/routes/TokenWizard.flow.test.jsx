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
    'bitcoin-regtest': [{
        id: 'addr-1',
        address: 'bc1qexampleexampleexampleexampleexampleex',
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
};

function mountWizard({
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    }),
    walletMode = 'full',
    messagingOverrides = {},
} = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        ...messagingOverrides,
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

afterEach(() => {
    cleanup();
    delete navigator.onLine;
});

describe('TokenWizard guided flow', () => {
    async function reachDetails(templateName) {
        fireEvent.click(await screen.findByText(templateName));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
    }

    it('refuses a hostile description before the review step', async () => {
        const messaging = mountWizard();
        await reachDetails('Meme token');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'SAFE' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Description (optional)'), {
            target: { value: 'safe\u0000unsafe' },
        });

        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Description cannot contain control characters.');
        expect(screen.getByRole('form', { name: 'Token details' })).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('blocks token composition with one plain reason while the device is offline', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        const composeForConfirm = vi.fn();
        mountWizard({ composeForConfirm });

        fireEvent.click(await screen.findByText('Meme token'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'OFFLINE' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        expect(screen.getAllByText('Creating a token needs a network connection.')).toHaveLength(1);
        const continueButton = screen.getByRole('button', { name: 'Continue to confirmation' });
        expect(continueButton).toBeDisabled();
        fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('supports keyboard submission, accurate progress, Back retention, and a complete review', async () => {
        mountWizard();

        expect(await screen.findByText('Step 1 of 4: Template')).toBeTruthy();
        fireEvent.click(screen.getByText('Utility token'));
        expect(await screen.findByText('Step 2 of 4: Network')).toBeTruthy();
        await screen.findByLabelText('Fee paid by');
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);

        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
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
            '1000 UTILITY',
            '8',
            'Membership credits',
            '25 UTILITY',
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
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
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
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
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
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
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
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
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

    it('accepts the protocol supply maximum and values past 2^63', async () => {
        mountWizard();
        await reachDetails('Custom');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'SUPPLYMAX' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), {
            target: { value: '1000000000000000000000' },
        });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        expect(await screen.findByText('Step 4 of 4: Review')).toBeTruthy();
    });

    it('rejects a supply above the protocol maximum before review', async () => {
        const messaging = mountWizard();
        await reachDetails('Custom');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'TOOMUCH' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), {
            target: { value: '1000000000000000000000.00000001' },
        });
        fireEvent.click(screen.getByLabelText('Divisible (8 decimal places)'));
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Supply cannot be more than 1,000,000,000,000,000,000,000.');
        expect(screen.queryByText('Step 4 of 4: Review')).toBeNull();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects an overlong description even if input limits are bypassed', async () => {
        const messaging = mountWizard();
        await reachDetails('Custom');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'LONGDESC' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Description (optional)'), {
            target: { value: '<b>markup</b>'.repeat(700) },
        });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Description cannot be longer than 249 characters.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a bidi override in the description before review', async () => {
        const messaging = mountWizard();
        await reachDetails('Custom');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'SAFETEXT' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Description (optional)'), {
            target: { value: 'safe \u202eTXT' },
        });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Description cannot contain text-direction control characters.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('renders markup as inert description text', async () => {
        mountWizard();
        await reachDetails('Custom');
        const hostile = '<img src=x onerror=alert(1)> TXT';
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'SAFETEXT' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Description (optional)'), {
            target: { value: hostile },
        });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        expect(await screen.findByText('Step 4 of 4: Review')).toBeTruthy();
        expect(document.body.textContent).toContain(hostile);
        expect(document.querySelector('img[src="x"]')).toBeNull();
    });

    it.each(['Collectible', 'Limited edition'])(
        'requires the Image URL before reviewing the %s template',
        async (templateName) => {
            const messaging = mountWizard();
            fireEvent.click(await screen.findByText(templateName));
            await screen.findByLabelText('Fee paid by');
            fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
            fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
                target: { value: 'ART' },
            });
            if (templateName === 'Limited edition') {
                fireEvent.change(screen.getByLabelText('Edition size'), { target: { value: '10' } });
                fireEvent.change(screen.getByLabelText('Copies per mint'), { target: { value: '1' } });
            }

            fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
            expect(await screen.findByRole('alert'))
                .toHaveTextContent('Image URL is required for this template.');
            expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['javascript:alert(1)', 'Image URL must use http, https, ipfs, or ar.'],
        ['data:image/svg+xml,<svg></svg>', 'Image URL must use http, https, ipfs, or ar.'],
        [`https://example.test/${'x'.repeat(300)}`, 'Image URL cannot be longer than 249 characters.'],
    ])(
        'rejects an unsafe or oversized collectible image URL: %s',
        async (url, message) => {
            const messaging = mountWizard();
            await reachDetails('Collectible');
            fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
                target: { value: 'BADIMAGE' },
            });
            fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: url } });
            fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

            expect(await screen.findByText(message)).toBeTruthy();
            expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        },
    );

    it('rejects exponent notation in a create-time callback amount', async () => {
        const messaging = mountWizard();
        fireEvent.click(await screen.findByText('Custom'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'CALLBACK' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
        fireEvent.change(screen.getByLabelText('Callback token (optional)'), {
            target: { value: 'XCHAIN' },
        });
        fireEvent.change(screen.getByLabelText('Payout per unit'), {
            target: { value: '1e2' },
        });
        fireEvent.change(screen.getByLabelText('Callback allowed from block'), {
            target: { value: '1000' },
        });

        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Callback payout per unit must be a positive number.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('does not validate hidden fields left by a different template', async () => {
        mountWizard();
        fireEvent.click(await screen.findByText('Custom'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'SWITCHED' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Transfer ownership to (optional)'), {
            target: { value: 'not-an-address' },
        });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Transfer ownership address is not valid',
        );

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        fireEvent.click(screen.getByText('Meme token'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
        expect(screen.queryByRole('alert')).toBeNull();
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        expect(await screen.findByText('Step 4 of 4: Review')).toBeTruthy();
        expect(screen.queryByText(/Transfer ownership address is not valid/i)).toBeNull();
    });

    it('starts only one watcher build when review is submitted twice', async () => {
        let resolveBuild;
        const buildActionPsbtRequest = vi.fn(() => new Promise((resolve) => {
            resolveBuild = resolve;
        }));
        mountWizard({
            walletMode: 'watcher',
            messagingOverrides: { buildActionPsbtRequest },
        });

        fireEvent.click(await screen.findByText('Meme token'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'ONCE' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        const review = screen.getByRole('form', { name: 'Review token issuance' });

        fireEvent.submit(review);
        fireEvent.submit(review);

        expect(buildActionPsbtRequest).toHaveBeenCalledTimes(1);
        resolveBuild({ psbtHex: '70736274ff00', chainId: 'bitcoin-mainnet' });
        expect(await screen.findByLabelText('Unsigned transaction code')).toBeTruthy();
    });
});
