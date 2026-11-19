// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The transaction file field: its dialog opens on .psbt files with every
// file one choice away, a PSBT saved under any name still loads, and the
// field stops naming the file once the code box no longer holds it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm, psbtDialogAccept } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';

// The camera scanner has no place in a jsdom run.
vi.mock('@xchain-wallet/core/ui', async (importOriginal) => ({
    ...(await importOriginal()),
    QrScanner: () => null,
}));

const BTC = 'bitcoin-regtest';
const PSBT_HEX = '70736274ff01020304';

function messagingFor() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BTC]: [{
                id: 'btc-address',
                address: 'bcrt1qexampleexampleexampleexampleexample',
                publicKey: '02aa',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
            'litecoin-testnet': [{
                id: 'ltc-address',
                address: 'tltc1qexampleexampleexampleexampleexample',
                publicKey: '02bb',
                derivationPath: "m/84'/2'/0'/0/0",
                source: 'hd',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        parsePsbtRequest: vi.fn().mockResolvedValue({
            decomposed: { inputs: [], outputs: [] },
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        }),
        signPsbtUserInitiated: vi.fn(),
    };
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue({});
        },
    });
}

async function mount() {
    const messaging = messagingFor();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PsbtSignForm walletId="wallet" onBack={() => {}} />
        </MessagingProvider>,
    );
    await screen.findByRole('button', { name: /Network: Bitcoin/, hidden: true });
    // Wrapped: the messaging proxy answers every property, `then` included,
    // so awaiting it bare would never settle.
    return { messaging };
}

function hiddenFileInput() {
    return screen.getByLabelText('Upload transaction file', { selector: 'input[type="file"]' });
}

const realUserAgent = navigator.userAgent;

function setUserAgent(value) {
    Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true });
}

afterEach(() => {
    cleanup();
    setUserAgent(realUserAgent);
    delete window.Capacitor;
});

describe('PSBT transaction file dialog', () => {
    it('opens the dialog on .psbt files while the drop zone and picker still take any file', async () => {
        const { messaging } = await mount();
        const input = hiddenFileInput();
        expect(input).toHaveAttribute('accept', '.psbt');

        // A PSBT saved as text under another extension still loads.
        fireEvent.change(input, {
            target: { files: [new File([PSBT_HEX], 'from-coordinator.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(screen.getByLabelText(/^Transaction file/)).toHaveValue('from-coordinator.txt'));
        expect(screen.getByLabelText('Unsigned transaction code')).toHaveValue(PSBT_HEX);
        await waitFor(() => expect(messaging.parsePsbtRequest).toHaveBeenCalledWith({ chainId: BTC, psbtHex: PSBT_HEX }));
        expect(screen.queryByText(/File type not accepted/)).toBeNull();
    });

    it('lists every file where the dialog cannot offer an All files choice', () => {
        setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15');
        expect(psbtDialogAccept()).toBe('');
        setUserAgent(realUserAgent);
        window.Capacitor = { isNativePlatform: () => true };
        expect(psbtDialogAccept()).toBe('');
        delete window.Capacitor;
        setUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0');
        expect(psbtDialogAccept()).toBe('.psbt');
    });

    it('drops the file name once the code box no longer holds what the file loaded', async () => {
        await mount();
        fireEvent.change(hiddenFileInput(), {
            target: { files: [new File([PSBT_HEX], 'cosign.psbt', { type: 'application/octet-stream' })] },
        });
        const field = await screen.findByDisplayValue('cosign.psbt');
        expect(screen.getByRole('button', { name: 'Remove transaction file' })).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Unsigned transaction code'), { target: { value: `${PSBT_HEX}05` } });

        expect(field).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Choose a transaction file' })).toBeInTheDocument();
    });
});
