// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const OWN = 'bcrt1qexampleexampleexampleexampleexample';
const PSBT = '70736274ff01020304';

function setup() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-regtest': [{
                id: 'btc-address',
                address: OWN,
                publicKey: '02aa',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        parsePsbtRequest: vi.fn().mockResolvedValue({
            decomposed: {
                inputs: [{
                    address: OWN,
                    value: 1_000,
                    prevTxHash: '00'.repeat(32),
                    prevTxIndex: 0,
                }],
                outputs: [{ address: 'bc1qrecipient', value: 990 }],
            },
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [], unknown: [] }),
        signPsbtUserInitiated: vi.fn().mockResolvedValue({
            signedPsbtHex: PSBT,
            txHex: 'aa',
            txid: 'signed-id',
        }),
        broadcastSignedTxRequest: vi.fn().mockResolvedValue({ txid: 'broadcast-id' }),
    };
    const messaging = new Proxy(target, {
        get: (value, property) => (property in value
            ? value[property]
            : vi.fn().mockResolvedValue({})),
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PsbtSignForm walletId="wallet" onBack={() => {}} />
        </MessagingProvider>,
    );
    return target;
}

function greenButtons() {
    return [...document.querySelectorAll('button')]
        .filter((button) => button.classList.contains(buttonStyles.success));
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('PSBT sign form UI rulings', () => {
    it('adds form-specific help and uses an upload icon for the file picker', async () => {
        setup();
        await screen.findByRole('button', { name: /Network: Bitcoin/ });

        const signingHelp = screen.getByRole('button', { name: 'About Signing address' });
        fireEvent.click(signingHelp);
        expect(screen.getByRole('tooltip')).toHaveTextContent(
            'Choose the wallet address whose keys will sign this transaction. It must hold the inputs being signed because only the keys controlling an input can authorize spending it.',
        );
        fireEvent.click(signingHelp);

        fireEvent.click(screen.getByRole('button', { name: 'About Unsigned transaction code' }));
        expect(screen.getAllByRole('tooltip').some((tooltip) => tooltip.textContent === (
            'A PSBT is a partially signed Bitcoin transaction. Paste PSBT hex starting with 70736274ff, base64 starting with cHNid, scan the code, or drop a .psbt file.'
        ))).toBe(true);

        const browse = screen.getByRole('button', { name: 'Browse for .psbt file' });
        expect(browse.querySelector('svg path[d="m17 8-5-5-5 5"]')).toBeTruthy();
    });

    it('keeps exactly one green main action through entry, review, and result stages', async () => {
        setup();
        await screen.findByRole('button', { name: /Network: Bitcoin/ });

        expect(greenButtons()).toEqual([screen.getByRole('button', { name: 'Sign transaction' })]);
        expect(screen.getByRole('button', { name: 'Sign transaction' }).querySelector('svg')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Unsigned transaction code'), {
            target: { value: PSBT },
        });
        await screen.findByTestId('psbt-sign-output');

        fireEvent.click(screen.getByRole('button', { name: 'Sign transaction' }));
        const approve = await screen.findByTestId('confirm-approve');
        expect(greenButtons()).toEqual([approve]);
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        await screen.findByTestId('signed-psbt-hex');
        const broadcast = screen.getByRole('button', { name: 'Broadcast' });
        expect(greenButtons()).toEqual([broadcast]);
        for (const button of screen.getAllByRole('button')) {
            expect(button.querySelector('svg'), button.textContent || button.getAttribute('aria-label')).toBeTruthy();
        }

        fireEvent.click(broadcast);
        await screen.findByText('Broadcast (pending)');
        expect(greenButtons()).toEqual([
            screen.getByRole('button', { name: 'Sign another transaction' }),
        ]);
    });
});
