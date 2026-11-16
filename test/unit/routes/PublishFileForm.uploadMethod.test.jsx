// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Publish file's Upload method field (Public mode): options and order, the
// Cheapest mark, the default, the disabled reasons, one fee per option, the
// ceiling and compose request following the pick, the review rows, and a
// read count that does not grow with typing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { estimateNativeSendFeeTiers } from '../../../packages/core/src/flows/feeEstimate.js';

vi.mock('../../../packages/core/src/flows/uploadMethod.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, estimateUploadMethodFees: vi.fn(actual.estimateUploadMethodFees) };
});

const uploadMethodLib = await import('../../../packages/core/src/flows/uploadMethod.js');
const { PublishFileForm } = await import('../../../packages/core/src/shared/routes/PublishFileForm.jsx');

const registry = defaultRegistry();
const HD = {
    id: 'address-1',
    address: 'bc1qpublishpublishpublishpublishpublishpub',
    publicKey: `02${'11'.repeat(32)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const FILE_BYTES = 2000;
const FILE_LABEL = /^File \(up to [\d,]+ bytes\)$/;

afterEach(() => {
    cleanup();
    uploadMethodLib.estimateUploadMethodFees.mockClear();
});

// A messaging stub that counts every call the form makes, so a test can say
// typing reads nothing.
function messagingFor({ chainId = 'bitcoin-mainnet', address = HD, walletMode = 'full', overrides = {} } = {}) {
    const reads = { count: 0 };
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [address] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [chainId]: { id: address.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        ...overrides,
    };
    const messaging = new Proxy(target, {
        get(value, property) {
            const fn = property in value ? value[property] : vi.fn().mockResolvedValue({});
            if (typeof fn !== 'function') return fn;
            return (...args) => { reads.count += 1; return fn(...args); };
        },
    });
    return { messaging, target, reads };
}

function mount(client) {
    render(
        <MessagingProvider shell="web" messaging={client.messaging}>
            <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
        </MessagingProvider>,
    );
}

const trigger = () => screen.getByRole('button', { name: /^Upload method: / });
function pickMethod(name) {
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: (n) => n.startsWith(name) }));
}
// Develop's file labels name the ceiling in bytes.
function capOf(field) {
    const [, n] = field.labels[0].textContent.match(/([\d,]+) bytes/);
    return Number(n.replace(/,/g, ''));
}
async function pickFile(size = FILE_BYTES) {
    fireEvent.change(await screen.findByLabelText(FILE_LABEL), {
        target: { files: [new File([new Uint8Array(size)], 'art.bin', { type: 'application/octet-stream' })] },
    });
    await screen.findByText('art.bin');
}
// Develop asks for the permanence acknowledgement before review.
function ackForever() {
    fireEvent.click(screen.getByRole('checkbox'));
}
function pickFastFee() {
    fireEvent.click(document.querySelector('button[aria-label="Fast"]'));
}
function expectedFees(chainId, { title = '', memo = '', tier = 'normal' } = {}) {
    const compiledBytes = uploadMethodLib.publicFileCompiledBytes(
        { name: 'art.bin', type: 'application/octet-stream', title, memo }, FILE_BYTES,
    );
    const feeEstimate = estimateNativeSendFeeTiers({ chainId, chainRegistry: registry })[tier];
    const fees = uploadMethodLib.estimateUploadMethodFees({ compiledBytes, descriptor: registry.get(chainId), feeEstimate });
    uploadMethodLib.estimateUploadMethodFees.mockClear();
    return fees;
}

describe('PublishFileForm upload method', () => {
    it('offers Taproot upload first, marked Cheapest and picked by default, then Standard, each with its fee', async () => {
        mount(messagingFor());
        await pickFile();
        expect(trigger()).toHaveAccessibleName('Upload method: Taproot upload');
        const fees = expectedFees('bitcoin-mainnet');
        fireEvent.click(trigger());
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(2);
        expect(options[0]).toHaveTextContent(/^Taproot upload/);
        expect(options[1]).toHaveTextContent(/^Standard/);
        expect(within(options[0]).getByText('Cheapest')).toBeInTheDocument();
        expect(options[0]).toHaveTextContent(`Network fee about ${fees.taproot.coinAmount} BTC`);
        expect(options[1]).toHaveTextContent(`Network fee about ${fees.standard.coinAmount} BTC`);
        expect(fees.taproot.sats).toBeLessThan(fees.standard.sats);
    });

    it.each([
        ['a hardware wallet', { address: { ...HD, source: 'trezor' } }, "Hardware wallets can't sign the reveal transaction yet."],
        ['another phone signing', { walletMode: 'watcher' }, "Not available when another phone signs: it can't sign the reveal."],
        ['Dogecoin', { chainId: 'dogecoin-mainnet', address: { ...HD, address: 'DPublishPublishPublishPublishPublish' } },
            'Dogecoin has no Taproot.'],
    ])('disables Taproot upload with its reason for %s', async (_name, opts, reason) => {
        mount(messagingFor(opts));
        await screen.findByLabelText(FILE_LABEL);
        await waitFor(() => expect(trigger()).toHaveAccessibleName('Upload method: Standard'));
        fireEvent.click(trigger());
        const [taproot, standard] = screen.getAllByRole('option');
        expect(taproot).toHaveAttribute('aria-disabled', 'true');
        expect(taproot).toHaveTextContent(reason);
        expect(standard).not.toHaveAttribute('aria-disabled');
        // The Standard ceiling applies.
        expect(capOf(screen.getByLabelText(FILE_LABEL))).toBeLessThan(8192);
    });

    it('sizes the file ceiling by the picked method', async () => {
        mount(messagingFor());
        const field = await screen.findByLabelText(FILE_LABEL);
        expect(capOf(field)).toBeGreaterThan(300_000);
        pickMethod('Standard');
        expect(capOf(screen.getByLabelText(FILE_LABEL))).toBeLessThan(8192);
        expect(capOf(screen.getByLabelText(FILE_LABEL))).toBeGreaterThan(7000);
        pickMethod('Taproot upload');
        expect(capOf(screen.getByLabelText(FILE_LABEL))).toBeGreaterThan(300_000);
    });

    it('refuses a file over the Standard ceiling while Standard is picked', async () => {
        mount(messagingFor());
        await screen.findByLabelText(FILE_LABEL);
        pickMethod('Standard');
        fireEvent.change(screen.getByLabelText(FILE_LABEL), {
            target: { files: [new File([new Uint8Array(20_000)], 'big.bin', { type: 'application/octet-stream' })] },
        });
        expect(await screen.findByText(/^That file is 20,000 bytes; with this metadata the on-chain ceiling is [\d,]+ bytes\.$/))
            .toBeInTheDocument();
    });

    it.each([
        ['Taproot upload', { encoding: 'AUTO', options: { signerSupportsTapscript: true } }],
        ['Standard', null],
    ])('composes with the %s request and names the method on the confirm screen', async (method, request) => {
        const composeForConfirm = vi.fn().mockResolvedValue({
            psbt: 'aa00',
            encoding: 'psbt',
            version: 1,
            chainId: 'bitcoin-mainnet',
            actionString: 'encoded action',
            decoded: { summary: 'Review action', details: [], warnings: [] },
        });
        mount(messagingFor({
            overrides: { composeForConfirm, preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }) },
        }));
        await pickFile();
        if (method === 'Standard') pickMethod('Standard');
        ackForever();
        fireEvent.click(screen.getByRole('button', { name: 'Publish file' }));
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        const { encoderOpts } = composeForConfirm.mock.calls[0][0];
        if (request) {
            expect(encoderOpts).toMatchObject(request);
        } else {
            expect(encoderOpts).not.toHaveProperty('encoding');
            expect(encoderOpts).not.toHaveProperty('options');
        }
        await screen.findByTestId('confirm-modal');
        expect(await screen.findByText(new RegExp(`^Upload method: ${method}\\.`))).toBeInTheDocument();
        // Until the composed transactions state their exact fee, the facts
        // card's network fee row shows the picked method's estimate.
        const fees = expectedFees('bitcoin-mainnet');
        expect(screen.getByTestId('confirm-modal'))
            .toHaveTextContent(`Network fee: ${fees[request ? 'taproot' : 'standard'].coinAmount} BTC (estimate)`);
    });

    it('re-prices each option when the fee tier changes', async () => {
        mount(messagingFor());
        await pickFile();
        const fast = expectedFees('bitcoin-mainnet', { tier: 'fast' });
        pickFastFee();
        fireEvent.click(trigger());
        const [taproot, standard] = screen.getAllByRole('option');
        expect(taproot).toHaveTextContent(`Network fee about ${fast.taproot.coinAmount} BTC`);
        expect(standard).toHaveTextContent(`Network fee about ${fast.standard.coinAmount} BTC`);
    });

    it('names the method and its fee on the watcher review', async () => {
        mount(messagingFor({ walletMode: 'watcher' }));
        await pickFile();
        ackForever();
        fireEvent.click(screen.getByRole('button', { name: 'Publish file' }));
        await screen.findByRole('form', { name: 'Review publish' });
        const fees = expectedFees('bitcoin-mainnet');
        expect(screen.getByTestId('review-upload-method')).toHaveTextContent('Standard');
        expect(screen.getByTestId('review-upload-fee')).toHaveTextContent(`${fees.standard.coinAmount} BTC`);
    });

    it('re-estimates once per pause in typing, whatever the length, and reads nothing while typing', async () => {
        const client = messagingFor();
        mount(client);
        await pickFile();
        await waitFor(() => expect(uploadMethodLib.estimateUploadMethodFees).toHaveBeenCalled());

        const typeTitle = async (text) => {
            const estimatesBefore = uploadMethodLib.estimateUploadMethodFees.mock.calls.length;
            const readsBefore = client.reads.count;
            const field = screen.getByLabelText('Title');
            let value = field.value;
            for (const ch of text) {
                value += ch;
                fireEvent.change(field, { target: { value } });
            }
            // Nothing re-estimates mid-typing; once it settles, exactly one does.
            expect(uploadMethodLib.estimateUploadMethodFees.mock.calls.length).toBe(estimatesBefore);
            await waitFor(
                () => expect(uploadMethodLib.estimateUploadMethodFees.mock.calls.length).toBe(estimatesBefore + 1),
                { timeout: 3000 },
            );
            return {
                estimates: uploadMethodLib.estimateUploadMethodFees.mock.calls.length - estimatesBefore,
                reads: client.reads.count - readsBefore,
            };
        };

        const one = await typeTitle('a');
        const forty = await typeTitle('b'.repeat(40));
        expect(one).toEqual({ estimates: 1, reads: 0 });
        expect(forty).toEqual(one);
        // The estimate followed the typed title.
        const fees = expectedFees('bitcoin-mainnet', { title: `a${'b'.repeat(40)}` });
        fireEvent.click(trigger());
        expect(screen.getAllByRole('option')[0]).toHaveTextContent(`Network fee about ${fees.taproot.coinAmount} BTC`);
    });

    it('carries the pick into Encrypted mode', async () => {
        mount(messagingFor({
            overrides: {
                getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'GATE', chainId: 'bitcoin-mainnet', ownerAddress: HD.address }]),
                listGatedKeys: vi.fn().mockResolvedValue([]),
                getTokenInfo: vi.fn().mockResolvedValue({ creator: HD.address, divisibility: 8 }),
            },
        }));
        await screen.findByLabelText(FILE_LABEL);
        pickMethod('Standard');
        fireEvent.click(screen.getByRole('radio', { name: 'Encrypted & token-gated' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Token: Select a token' }));
        fireEvent.click((await screen.findAllByRole('listitem')).find((row) => row.textContent.includes('GATE')));
        fireEvent.click(await screen.findByRole('button', { name: 'Continue to file' }));
        await screen.findByRole('button', { name: /^Token: GATE/ });
        expect(trigger()).toHaveAccessibleName('Upload method: Standard');
    });
});
