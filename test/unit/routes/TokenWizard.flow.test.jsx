// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Create a token route, driven end to end: the one Issue Token form's
// refusals before anything is composed (text safety, amounts, supply ceiling,
// template-only fields, the callback), the offline block, host errors staying
// on the form, the composed payload, and watcher mode's single build.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
// The Create a token route: TokenWizard renders the one Issue Token form.
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

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
    resetWalletModes();
});

// Pick a template (or none), then fill the ticker and max supply.
async function reachForm(templateName, { ticker, supply } = {}) {
    await screen.findByLabelText('Ticker');
    if (templateName) {
        fireEvent.click(screen.getByRole('button', { name: /^Select template/ }));
        fireEvent.click(screen.getByRole('option', { name: new RegExp(templateName) }));
    }
    if (ticker !== undefined) fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: ticker } });
    if (supply !== undefined) {
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: supply } });
    }
}

const issueForm = () => screen.getByRole('form', { name: 'Issue Token' });

// The refusal, whether the error summary or an amount field's own error
// states it (an amount field refuses some keystrokes itself).
async function refusal(text) {
    let found = null;
    await waitFor(() => {
        found = screen.getAllByRole('alert').find((alert) => (
            typeof text === 'string' ? alert.textContent.includes(text) : text.test(alert.textContent)
        ));
        expect(found).toBeTruthy();
    });
    return found;
}

describe('Issue Token form flow', () => {
    it('refuses a hostile description before composing', async () => {
        const messaging = mountWizard();
        await reachForm('Meme token', { ticker: 'SAFE', supply: '1' });
        fireEvent.change(screen.getByLabelText('Token description'), {
            target: { value: 'safe\u0000unsafe' },
        });

        fireEvent.submit(issueForm());

        await refusal('Description cannot contain control characters.');
        expect(issueForm()).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('blocks token composition with one plain reason while the device is offline', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        const composeForConfirm = vi.fn();
        mountWizard({ composeForConfirm });

        await reachForm('Meme token', { ticker: 'OFFLINE', supply: '1' });
        await screen.findByText('Creating a token needs a network connection.');
        expect(screen.getAllByText('Creating a token needs a network connection.')).toHaveLength(1);
        // G130: enabled offline; the press brings the one notice into view.
        expect(screen.getByRole('button', { name: 'Issue Token' })).toBeEnabled();
        fireEvent.submit(issueForm());
        expect(composeForConfirm).not.toHaveBeenCalled();
        expect(screen.getAllByText('Creating a token needs a network connection.')).toHaveLength(1);
    });

    it('submits from the keyboard, composes every field, and keeps the values after a Reject', async () => {
        const messaging = mountWizard();

        await reachForm('Utility token', { ticker: 'UTILITY', supply: '1000' });
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
        // The Utility template turns Divisible on (8 decimal places).
        expect(screen.getByRole('switch', { name: /Divisible/ })).toBeChecked();
        fireEvent.change(screen.getByLabelText('Token description'), {
            target: { value: 'Membership credits' },
        });
        fireEvent.change(screen.getByLabelText('Max per transaction'), {
            target: { value: '25' },
        });

        fireEvent.submit(issueForm());
        expect(await screen.findByTestId('confirm-modal')).toBeTruthy();
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData).toMatchObject({
            action: 'ISSUE',
            params: {
                VERSION: '0',
                TICK: 'UTILITY',
                MAX_SUPPLY: '1000',
                MINT_SUPPLY: '1000',
                DECIMALS: '8',
                DESCRIPTION: 'Membership credits',
                MAX_MINT: '25',
            },
        });
        // The stub returns an opaque action string, so confirmation reports it
        // as unknown while the request assertion above pins the ISSUE fields.
        expect(screen.getByTestId('confirm-status')).toHaveAttribute('data-state', 'unknownAction');

        // Reject returns to the form with every value still there.
        fireEvent.click(screen.getByTestId('confirm-reject'));
        expect(await screen.findByLabelText('Ticker')).toHaveValue('UTILITY');
        expect(screen.getByRole('textbox', { name: 'Max supply' }).value).toMatch(/^1,000(\.0+)?$/);
        expect(screen.getByRole('switch', { name: /Divisible/ })).toBeChecked();
        expect(screen.getByLabelText('Token description')).toHaveValue('Membership credits');
    });

    it('keeps host composition errors on the form', async () => {
        const composeForConfirm = vi.fn().mockRejectedValue(new Error('Host could not compose token'));
        mountWizard({ composeForConfirm });

        await reachForm('Meme token', { ticker: 'MEME', supply: '100' });
        fireEvent.submit(issueForm());

        // An unclassified host error reaches the user as the generic house line.
        expect(await screen.findByText(/Something went wrong\. Try again\./)).toBeTruthy();
        expect(issueForm()).toBeTruthy();
        expect(screen.queryByTestId('confirm-modal')).toBeNull();
        expect(composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid optional mint caps before composing', async () => {
        const messaging = mountWizard();
        await reachForm('Utility token', { ticker: 'UTILITY', supply: '100' });
        fireEvent.change(screen.getByLabelText('Max per transaction'), {
            target: { value: 'zero' },
        });
        fireEvent.submit(issueForm());

        // The amount field refuses the letters itself, or the summary names
        // the rule; either way nothing is composed.
        await refusal(/Max mint per transaction must be a positive number|Enter a valid/);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects amounts that exceed the selected divisibility', async () => {
        const messaging = mountWizard();
        await reachForm('Meme token', { ticker: 'MEME', supply: '1.5' });
        fireEvent.submit(issueForm());

        // Meme is not divisible: whole numbers only, from the summary or the
        // amount field itself.
        await refusal(/whole number|decimal places/i);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('accepts the protocol supply maximum and values past 2^63', async () => {
        const messaging = mountWizard();
        await reachForm(null, { ticker: 'SUPPLYMAX', supply: '1000000000000000000000' });
        fireEvent.submit(issueForm());

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params.MAX_SUPPLY)
            .toBe('1000000000000000000000');
    });

    it('rejects a supply above the protocol maximum before composing', async () => {
        const messaging = mountWizard();
        // Divisible is on by default, so the eighth decimal place is allowed
        // and only the ceiling refuses it.
        await reachForm(null, { ticker: 'TOOMUCH', supply: '1000000000000000000000.00000001' });
        fireEvent.submit(issueForm());

        await refusal('Max supply cannot be more than 1,000,000,000,000,000,000,000.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects an overlong description even if input limits are bypassed', async () => {
        const messaging = mountWizard();
        await reachForm(null, { ticker: 'LONGDESC', supply: '1' });
        fireEvent.change(screen.getByLabelText('Token description'), {
            target: { value: '<b>markup</b>'.repeat(700) },
        });
        fireEvent.submit(issueForm());

        await refusal('Description cannot be longer than 249 characters.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a bidi override in the description before composing', async () => {
        const messaging = mountWizard();
        await reachForm(null, { ticker: 'SAFETEXT', supply: '1' });
        fireEvent.change(screen.getByLabelText('Token description'), {
            target: { value: 'safe \u202eTXT' },
        });
        fireEvent.submit(issueForm());

        await refusal('Description cannot contain text-direction control characters.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('keeps markup inert and composes it as plain description text', async () => {
        const messaging = mountWizard();
        await reachForm(null, { ticker: 'SAFETEXT', supply: '1' });
        const hostile = '<img src=x onerror=alert(1)> TXT';
        fireEvent.change(screen.getByLabelText('Token description'), {
            target: { value: hostile },
        });
        fireEvent.submit(issueForm());

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params.DESCRIPTION).toBe(hostile);
        expect(document.querySelector('img[src="x"]')).toBeNull();
    });

    it.each(['Collectible', 'Limited edition'])(
        'requires the Image URL before composing the %s template',
        async (templateName) => {
            const messaging = mountWizard();
            await reachForm(templateName, { ticker: 'ART' });
            if (templateName === 'Limited edition') {
                fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '10' } });
                fireEvent.change(screen.getByLabelText('Max per transaction'), { target: { value: '1' } });
            }

            fireEvent.submit(issueForm());
            await refusal('Image URL is required for this template.');
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
            await reachForm('Collectible', { ticker: 'BADIMAGE' });
            fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: url } });
            fireEvent.submit(issueForm());

            await refusal(message);
            expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        },
    );

    it('rejects exponent notation in a create-time callback amount', async () => {
        const messaging = mountWizard();
        await reachForm(null, { ticker: 'CALLBACK', supply: '100' });
        fireEvent.change(screen.getByLabelText('Callback token'), {
            target: { value: 'XCHAIN' },
        });
        fireEvent.change(screen.getByLabelText('Payout per unit'), {
            target: { value: '1e2' },
        });
        fireEvent.change(screen.getByLabelText('Callback allowed from block'), {
            target: { value: '1000' },
        });

        fireEvent.submit(issueForm());
        await refusal('Callback payout per unit must be a positive number.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('does not validate a field left by a different template', async () => {
        const messaging = mountWizard();
        // The Collectible template's Image URL is refused...
        await reachForm('Collectible', { ticker: 'SWITCHED' });
        fireEvent.change(screen.getByLabelText('Image URL'), {
            target: { value: 'javascript:alert(1)' },
        });
        fireEvent.submit(issueForm());
        await refusal('Image URL must use http, https, ipfs, or ar.');

        // ...and switching to Meme drops that field from the form and the ISSUE.
        fireEvent.click(screen.getByRole('button', { name: /^Select template/ }));
        fireEvent.click(screen.getByRole('option', { name: /Meme token/ }));
        expect(screen.queryByLabelText('Image URL')).toBeNull();
        fireEvent.submit(issueForm());

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params.DESCRIPTION).toBeUndefined();
        expect(screen.queryByText(/Image URL must use/i)).toBeNull();
    });

    it('starts only one watcher build when review is submitted twice', async () => {
        let resolveBuild;
        const buildActionPsbtRequest = vi.fn(() => new Promise((resolve) => {
            resolveBuild = resolve;
        }));
        // The active wallet's mode decides watcher mode.
        publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
        mountWizard({
            walletMode: 'watcher',
            messagingOverrides: { buildActionPsbtRequest },
        });

        await reachForm('Meme token', { ticker: 'ONCE', supply: '1' });
        fireEvent.submit(issueForm());
        const review = await screen.findByTestId('confirm-modal');
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent('Issue');
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
        expect(review).toHaveTextContent('Another phone signs for this wallet: this prepares the transaction for it.');

        await waitFor(() => expect(screen.getByTestId('confirm-approve')).not.toBeDisabled());
        fireEvent.click(screen.getByTestId('confirm-approve'));
        fireEvent.click(screen.getByTestId('confirm-approve'));

        expect(buildActionPsbtRequest).toHaveBeenCalledTimes(1);
        resolveBuild({ psbtHex: '70736274ff00', chainId: 'bitcoin-mainnet' });
        expect(await screen.findByLabelText('Unsigned transaction code')).toBeTruthy();
    });
});
