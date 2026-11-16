// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Attach artwork's Upload method field (the FILE leg): options and order, the
// Cheapest mark, the default, the disabled reasons, one fee per option, the
// ceiling and compose request following the pick, the review page and confirm
// screen naming the method, and a read count that does not grow with typing.
// Attach refuses another-phone (watcher) wallets outright, so that reason is
// covered on Publish file and Gated publish instead.

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
const { AttachContentForm } = await import('../../../packages/core/src/shared/routes/AttachContentForm.jsx');

const registry = defaultRegistry();
const OWNER = {
    id: 'addr-owner',
    // A dev-SDK placeholder the address check accepts, so Review is reached.
    address: 'bc1qdevmock03aa',
    publicKey: `02${'33'.repeat(32)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const FILE_BYTES = 2000;
// Develop names the artwork ceiling in the hint under the chooser.
const FILE_LIMIT = /^Up to [\d,]+ bytes with the current title and memo\.$/;

afterEach(() => {
    cleanup();
    uploadMethodLib.estimateUploadMethodFees.mockClear();
});

function messagingFor({ chainId = 'bitcoin-mainnet', owner = OWNER, overrides = {} } = {}) {
    const reads = { count: 0 };
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [owner] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [chainId]: owner }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 7 }),
        ...overrides,
    };
    const messaging = new Proxy(target, {
        get(value, property) {
            const fn = property in value ? value[property] : vi.fn().mockResolvedValue({});
            if (typeof fn !== 'function') return fn;
            return (...args) => { reads.count += 1; return fn(...args); };
        },
    });
    return { messaging, reads, chainId, owner };
}

function mount(client) {
    render(
        <MessagingProvider shell="web" messaging={client.messaging}>
            <AttachContentForm
                walletId="wallet-1"
                chainId={client.chainId}
                tick="ART"
                issuerAddress={client.owner.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

const trigger = () => screen.getByRole('button', { name: /^Upload method: / });
function pickMethod(name) {
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: (n) => n.startsWith(name) }));
}
function capOf(hint) {
    const [, n] = hint.textContent.match(/([\d,]+) bytes/);
    return Number(n.replace(/,/g, ''));
}
const limitHint = () => screen.getByText(FILE_LIMIT);
async function ready(client) {
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(client.owner.address));
    return limitHint();
}
async function pickFile(size = FILE_BYTES) {
    fireEvent.change(screen.getByLabelText('Choose file to attach'), {
        target: { files: [new File([new Uint8Array(size)], 'art.png', { type: 'image/png' })] },
    });
    await screen.findByText('art.png');
}
function pickFastFee() {
    fireEvent.click(document.querySelector('button[aria-label="Fast"]'));
}
function expectedFees(chainId, { title = '', tier = 'normal' } = {}) {
    const compiledBytes = uploadMethodLib.publicFileCompiledBytes(
        { name: 'art.png', type: 'image/png', title, memo: '' }, FILE_BYTES,
    );
    const feeEstimate = estimateNativeSendFeeTiers({ chainId, chainRegistry: registry })[tier];
    const fees = uploadMethodLib.estimateUploadMethodFees({ compiledBytes, descriptor: registry.get(chainId), feeEstimate });
    uploadMethodLib.estimateUploadMethodFees.mockClear();
    return fees;
}

describe('AttachContentForm upload method', () => {
    it('offers Taproot upload first, marked Cheapest and picked by default, then Standard, each with its fee', async () => {
        const client = messagingFor();
        mount(client);
        await ready(client);
        await pickFile();
        expect(trigger()).toHaveAccessibleName('Upload method: Taproot upload');
        const fees = expectedFees('bitcoin-mainnet');
        fireEvent.click(trigger());
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(2);
        expect(options[0]).toHaveTextContent(/^Taproot upload/);
        expect(within(options[0]).getByText('Cheapest')).toBeInTheDocument();
        expect(options[1]).toHaveTextContent(/^Standard/);
        expect(options[0]).toHaveTextContent(`Network fee about ${fees.taproot.coinAmount} BTC`);
        expect(options[1]).toHaveTextContent(`Network fee about ${fees.standard.coinAmount} BTC`);
        expect(fees.taproot.sats).toBeLessThan(fees.standard.sats);
    });

    it.each([
        ['a hardware wallet', { owner: { ...OWNER, source: 'ledger' } }, "Hardware wallets can't sign the reveal transaction yet."],
        ['Litecoin', { chainId: 'litecoin-mainnet', owner: { ...OWNER, address: 'ltc1qartownerartownerartownerartownerartow' } },
            'Not on Litecoin until the wallet turns on Taproot addresses.'],
        ['Dogecoin', { chainId: 'dogecoin-mainnet', owner: { ...OWNER, address: 'DArtOwnerArtOwnerArtOwnerArtOwnerAr' } },
            'Dogecoin has no Taproot.'],
    ])('disables Taproot upload with its reason for %s', async (_name, opts, reason) => {
        const client = messagingFor(opts);
        mount(client);
        const field = await ready(client);
        await waitFor(() => expect(trigger()).toHaveAccessibleName('Upload method: Standard'));
        fireEvent.click(trigger());
        const [taproot, standard] = screen.getAllByRole('option');
        expect(taproot).toHaveAttribute('aria-disabled', 'true');
        expect(taproot).toHaveTextContent(reason);
        expect(standard).not.toHaveAttribute('aria-disabled');
        expect(capOf(field)).toBeLessThan(8192);
    });

    it('sizes the artwork ceiling by the picked method', async () => {
        const client = messagingFor();
        mount(client);
        const field = await ready(client);
        expect(capOf(field)).toBeGreaterThan(300_000);
        pickMethod('Standard');
        expect(capOf(limitHint())).toBeLessThan(8192);
    });

    it.each([
        ['Taproot upload', { encoding: 'AUTO', options: { signerSupportsTapscript: true } }, 'taproot'],
        ['Standard', null, 'standard'],
    ])('reviews and composes the file leg with the %s request', async (method, request, key) => {
        const composeForConfirm = vi.fn().mockResolvedValue({
            psbt: 'aa00',
            encoding: 'psbt',
            version: 1,
            chainId: 'bitcoin-mainnet',
            actionString: 'encoded action',
            decoded: { summary: 'Review action', details: [], warnings: [] },
        });
        const client = messagingFor({
            overrides: { composeForConfirm, preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }) },
        });
        mount(client);
        await ready(client);
        await pickFile();
        if (method === 'Standard') pickMethod('Standard');
        fireEvent.click(screen.getByRole('button', { name: 'Attach artwork' }));

        // The review page names the method and its estimated fee.
        const form = await screen.findByRole('form', { name: 'Review artwork upload' });
        const fees = expectedFees('bitcoin-mainnet');
        expect(within(form).getByTestId('review-upload-method')).toHaveTextContent(method);
        expect(within(form).getByTestId('review-upload-fee')).toHaveTextContent(`${fees[key].coinAmount} BTC`);

        fireEvent.click(within(form).getByRole('button', { name: 'Upload file' }));
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        const { encoderOpts } = composeForConfirm.mock.calls[0][0];
        if (request) {
            expect(encoderOpts).toMatchObject(request);
        } else {
            expect(encoderOpts).not.toHaveProperty('encoding');
            expect(encoderOpts).not.toHaveProperty('options');
        }
        await screen.findByTestId('confirm-modal');
        expect(await screen.findByText(`Upload method: ${method}.`)).toBeInTheDocument();
        // No confirm-fee-network row on develop: the estimate rides feeText.
        expect(screen.getByTestId('confirm-modal')).toHaveTextContent(`Network fee: ${fees[key].coinAmount} BTC (estimate)`);
    });

    it('re-prices each option when the fee tier changes', async () => {
        const client = messagingFor();
        mount(client);
        await ready(client);
        await pickFile();
        const fast = expectedFees('bitcoin-mainnet', { tier: 'fast' });
        pickFastFee();
        fireEvent.click(trigger());
        const [taproot, standard] = screen.getAllByRole('option');
        expect(taproot).toHaveTextContent(`Network fee about ${fast.taproot.coinAmount} BTC`);
        expect(standard).toHaveTextContent(`Network fee about ${fast.standard.coinAmount} BTC`);
    });

    it('re-estimates once per pause in typing, whatever the length, and reads nothing while typing', async () => {
        const client = messagingFor();
        mount(client);
        await ready(client);
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
        const fees = expectedFees('bitcoin-mainnet', { title: `a${'b'.repeat(40)}` });
        fireEvent.click(trigger());
        expect(screen.getAllByRole('option')[0]).toHaveTextContent(`Network fee about ${fees.taproot.coinAmount} BTC`);
    });
});
