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
    psbtReviewError,
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
// A bitcoinjs-serialized PSBT with one finalScriptWitness input field.
const FINALIZED_PSBT_HEX = '70736274ff010052020000000101010101010101010101010101010101010101010101010101010101010101010000000000ffffffff0184030000000000001600142222222222222222222222222222222222222222000000000001011fe803000000000000160014111111111111111111111111111111111111111101080201000000';

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
        signPsbtUserInitiated: vi.fn().mockResolvedValue({ signedPsbtHex: PSBT_HEX }),
        ...overrides,
    };
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function decomposedFor(address) {
    return {
        inputs: [{
            address,
            value: 1_000,
            prevTxHash: '00'.repeat(32),
            prevTxIndex: 0,
        }],
        outputs: [{ address: 'bc1qrecipient', value: 900 }],
    };
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

describe('PSBT review validation', () => {
    const valid = {
        inputs: [{ address: 'input-address', value: 100 }],
        outputs: [{ address: 'output-address', value: 90 }],
    };

    it.each([
        [{ inputs: [], outputs: valid.outputs }, /no inputs/i],
        [{ inputs: valid.inputs, outputs: [] }, /no outputs/i],
        [{ ...valid, inputs: [{ address: 'input-address', value: 0 }] }, /greater than zero/i],
        [{ ...valid, inputs: [{ address: 'input-address', value: -1 }] }, /invalid amount/i],
        [{ ...valid, outputs: [{ address: 'output-address', value: '1.5' }] }, /invalid amount/i],
        [{ ...valid, outputs: [{ address: 'output-address', value: 101 }] }, /more than its inputs/i],
        [{ ...valid, outputs: [{ address: '', value: 90 }] }, /invalid address/i],
    ])('rejects malformed parser output before review', (decomposed, message) => {
        expect(psbtReviewError(decomposed)).toMatch(message);
    });

    it('allows a zero-value data output while still verifying the exact fee', () => {
        expect(psbtReviewError({
            inputs: [{ address: 'input-address', value: 100 }],
            outputs: [
                { address: 'output-address', value: 90 },
                { address: null, value: 0 },
            ],
        })).toBeNull();
    });

    it('shows a plain parser-output error and keeps signing disabled', async () => {
        mount(messagingFor({
            parsePsbtRequest: vi.fn().mockResolvedValue({
                decomposed: {
                    inputs: [{ address: ADDRESSES[BTC][0].address, value: 100 }],
                    outputs: [{ address: 'recipient', value: 101 }],
                },
                action: null,
                actionDecodeReason: 'NO_OP_RETURN',
            }),
        }));
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.change(screen.getByLabelText(/Unsigned transaction/), {
            target: { value: PSBT_HEX },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This transaction spends more than its inputs contain.',
        );
        expect(screen.getByRole('button', { name: 'Sign transaction' })).toBeDisabled();
    });
});

describe('PSBT form input controls', () => {
    it.each([
        [`${PSBT_HEX}0`, /complete byte pairs/i],
        ['cHNidP8!', /base64 is incomplete or malformed/i],
    ])('shows one plain error for malformed pasted input %s and never signs', async (value, copy) => {
        const messaging = mount();
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });

        fireEvent.change(screen.getByLabelText(/Unsigned transaction/), { target: { value } });

        const alerts = screen.getAllByRole('alert');
        expect(alerts).toHaveLength(1);
        expect(alerts[0].textContent).toMatch(copy);
        expect(messaging.parsePsbtRequest).not.toHaveBeenCalled();
        expect(messaging.signPsbtUserInitiated).not.toHaveBeenCalled();
    });

    it.each([
        [`${PSBT_HEX}0`, /complete byte pairs/i],
        ['cHNidP8!', /base64 is incomplete or malformed/i],
    ])('shows one plain error for malformed PSBT-like QR input %s and never signs', async (value, copy) => {
        const messaging = mount();
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.click(screen.getByRole('button', { name: 'Scan transaction' }));
        globalThis.__PSBT_SCAN_FRAME__ = value;

        fireEvent.click(screen.getByTestId('fake-psbt-scan'));

        const alerts = screen.getAllByRole('alert');
        expect(alerts).toHaveLength(1);
        expect(alerts[0].textContent).toMatch(copy);
        expect(messaging.parsePsbtRequest).not.toHaveBeenCalled();
        expect(messaging.signPsbtUserInitiated).not.toHaveBeenCalled();
    });

    it.each([
        [`${PSBT_HEX}0`, 'bad-hex.psbt'],
        ['cHNidP8!', 'bad-base64.psbt'],
    ])('shows one plain error for malformed transaction file %s and never signs', async (value, name) => {
        const messaging = mount();
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        const input = screen.getByLabelText(/Unsigned transaction/);

        fireEvent.drop(input, {
            dataTransfer: {
                files: [new File([value], name, { type: 'application/octet-stream' })],
            },
        });
        await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
        expect(screen.getByRole('alert').textContent).toMatch(/does not contain a valid PSBT/i);
        expect(messaging.parsePsbtRequest).not.toHaveBeenCalled();
        expect(messaging.signPsbtUserInitiated).not.toHaveBeenCalled();
    });

    it('rejects an oversized transaction file before reading or signing it', async () => {
        const messaging = mount();
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        const input = screen.getByLabelText(/Unsigned transaction/);
        fireEvent.change(input, { target: { value: PSBT_HEX } });
        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/this transaction has no inputs/i));

        fireEvent.drop(input, {
            dataTransfer: {
                files: [new File([new Uint8Array((2 * 1024 * 1024) + 1)], 'huge.psbt', {
                    type: 'application/octet-stream',
                })],
            },
        });
        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/file is too large/i));
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(messaging.signPsbtUserInitiated).not.toHaveBeenCalled();
    });

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

    it('rejects a PSBT parsed on another network when this wallet owns no inputs', async () => {
        const messaging = mount(messagingFor({
            parsePsbtRequest: vi.fn().mockResolvedValue({
                decomposed: decomposedFor(ADDRESSES[BTC][0].address),
                action: null,
                actionDecodeReason: 'NO_OP_RETURN',
            }),
        }));
        const picker = await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.click(picker);
        fireEvent.click(screen.getByRole('option', { name: /Litecoin/ }));
        fireEvent.change(screen.getByLabelText(/Unsigned transaction/), {
            target: { value: PSBT_HEX },
        });

        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/no inputs this wallet can sign/i));
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(true);
        expect(messaging.signPsbtUserInitiated).not.toHaveBeenCalled();
    });

    it('rejects a PSBT with no wallet-owned inputs with one message', async () => {
        const messaging = mount(messagingFor({
            parsePsbtRequest: vi.fn().mockResolvedValue({
                decomposed: decomposedFor('bc1qsomeoneelse'),
                action: null,
                actionDecodeReason: 'NO_OP_RETURN',
            }),
        }));
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.change(screen.getByLabelText(/Unsigned transaction/), {
            target: { value: PSBT_HEX },
        });

        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/no inputs this wallet can sign/i));
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(true);
        expect(messaging.signPsbtUserInitiated).not.toHaveBeenCalled();
    });

    it('rejects an already finalized PSBT with one message', async () => {
        const messaging = mount(messagingFor({
            parsePsbtRequest: vi.fn().mockResolvedValue({
                decomposed: decomposedFor(ADDRESSES[BTC][0].address),
                action: null,
                actionDecodeReason: 'NO_OP_RETURN',
            }),
        }));
        await screen.findByRole('button', { name: /Chain: Bitcoin/ });
        fireEvent.change(screen.getByLabelText(/Unsigned transaction/), {
            target: { value: FINALIZED_PSBT_HEX },
        });

        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/already finalized/i));
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(true);
        expect(messaging.signPsbtUserInitiated).not.toHaveBeenCalled();
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
