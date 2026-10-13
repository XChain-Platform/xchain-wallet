// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    normalizePsbtFile,
    normalizePsbtInput,
    PsbtSignForm,
    psbtInputError,
} from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';
import { encodeBbqrPsbtFrames } from '../../../packages/core/src/uri/bbqrPsbt.js';

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        QrScanner: ({ onFrame }) => (
            <button type="button" data-testid="fake-psbt-scan" onClick={() => onFrame(globalThis.__PSBT_SCAN_FRAME__)}>
                Read frame
            </button>
        ),
    };
});

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const PSBT_HEX = '70736274ff01020304';
const PSBT_BASE64 = 'cHNidP8BAgME';

const ADDRESSES = Object.freeze({
    [BTC]: [{
        id: 'btc-address',
        address: 'bc1qexampleexampleexampleexampleexampleex',
        publicKey: '02aa',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
    [LTC]: [{
        id: 'ltc-address',
        address: 'ltc1qexampleexampleexampleexampleexamplex',
        publicKey: '02bb',
        derivationPath: "m/84'/2'/0'/0/0",
        source: 'hd',
    }],
});

function messagingFor(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        parsePsbtRequest: vi.fn().mockResolvedValue({
            decomposed: { inputs: [], outputs: [] },
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        }),
        ...overrides,
    };
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mount(messaging = messagingFor()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PsbtSignForm walletId="wallet" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => {
    cleanup();
    delete globalThis.__PSBT_SCAN_FRAME__;
});

describe('PSBT text and file input', () => {
    it('normalizes equivalent hex and base64 PSBTs only when magic bytes are present', () => {
        expect(normalizePsbtInput(`  ${PSBT_HEX.toUpperCase()}\n`)).toBe(PSBT_HEX);
        expect(normalizePsbtInput(`cHNidP8B\nAgME`)).toBe(PSBT_HEX);
        expect(normalizePsbtInput('deadbeef')).toBe(null);
        expect(normalizePsbtInput('cHNidA==')).toBe(null);
        expect(normalizePsbtInput('cHNidP8!')).toBe(null);
    });

    it('gives specific errors for malformed hex, non-PSBT hex, and malformed base64', () => {
        expect(psbtInputError(`${PSBT_HEX}0`)).toMatch(/complete byte pairs/i);
        expect(psbtInputError('deadbeef')).toContain('starts with 70736274ff');
        expect(psbtInputError('cHNidP8!')).toMatch(/base64 is incomplete or malformed/i);
    });

    it('imports binary, hex-text, and base64-text files and rejects unrelated bytes', () => {
        const raw = Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, 1, 2, 3, 4]).buffer;
        expect(normalizePsbtFile(raw)).toBe(PSBT_HEX);
        expect(normalizePsbtFile(new TextEncoder().encode(`\uFEFF${PSBT_HEX}\n`).buffer)).toBe(PSBT_HEX);
        expect(normalizePsbtFile(new TextEncoder().encode(`${PSBT_BASE64}\n`).buffer)).toBe(PSBT_HEX);
        expect(normalizePsbtFile(new TextEncoder().encode('not a transaction').buffer)).toBe(null);
    });
});

describe('PSBT form input controls', () => {
    it('lets the user change the chain and parses the paste for that chain', async () => {
        const messaging = mount();
        const picker = await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.click(picker);
        fireEvent.click(screen.getByRole('option', { name: /Litecoin/ }));
        fireEvent.change(screen.getByLabelText(/Unsigned transaction/), {
            target: { value: PSBT_BASE64 },
        });

        await waitFor(() => expect(messaging.parsePsbtRequest).toHaveBeenCalledWith({
            chainId: LTC,
            psbtHex: PSBT_HEX,
        }));
    });

    it('counts unique BBQr frames and closes the scanner after assembly', async () => {
        mount();
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.click(screen.getByRole('button', { name: 'Scan transaction' }));
        const frames = encodeBbqrPsbtFrames(PSBT_HEX, { payloadBytes: 3 });

        globalThis.__PSBT_SCAN_FRAME__ = frames[0];
        fireEvent.click(screen.getByTestId('fake-psbt-scan'));
        expect(screen.getByRole('status').textContent).toContain(`BBQr frames received: 1 of ${frames.length}`);

        fireEvent.click(screen.getByTestId('fake-psbt-scan'));
        expect(screen.getByRole('status').textContent).toContain(`BBQr frames received: 1 of ${frames.length}`);

        for (const frame of frames.slice(1)) {
            globalThis.__PSBT_SCAN_FRAME__ = frame;
            fireEvent.click(screen.getByTestId('fake-psbt-scan'));
        }

        await waitFor(() => expect(screen.queryByTestId('fake-psbt-scan')).toBe(null));
        expect(screen.getByLabelText(/Unsigned transaction/).value).toBe(PSBT_HEX);
    });
});
