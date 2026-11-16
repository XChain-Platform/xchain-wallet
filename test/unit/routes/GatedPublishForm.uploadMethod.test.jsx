// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Gated publish's Upload method field: options and order, the Cheapest mark,
// the default, the disabled reasons, one fee per option for the encrypted
// payload, the ceiling and compose request following the pick, the confirm
// screen naming the method, and a read count that does not grow with typing.

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
const { GatedPublishForm } = await import('../../../packages/core/src/shared/routes/GatedPublishForm.jsx');

const registry = defaultRegistry();
const OWNER = {
    id: 'owner-1',
    address: 'bc1qgateownergateownergateownergateowner0',
    publicKey: `02${'22'.repeat(32)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const FILE_BYTES = 2000;
const FILE_LABEL = /^File \(up to [\d,]+ bytes\)$/;
const TICKERS = { 'bitcoin-mainnet': 'BTC', 'litecoin-mainnet': 'LTC', 'dogecoin-mainnet': 'DOGE' };

afterEach(() => {
    cleanup();
    uploadMethodLib.estimateUploadMethodFees.mockClear();
});

function messagingFor({ chainId = 'bitcoin-mainnet', owner = OWNER, walletMode = 'full', overrides = {} } = {}) {
    const reads = { count: 0 };
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [owner] }),
        getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'GATE' }]),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listGatedKeys: vi.fn().mockResolvedValue([]),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: owner.address, divisibility: 8 }),
        ...overrides,
    };
    const messaging = new Proxy(target, {
        get(value, property) {
            const fn = property in value ? value[property] : vi.fn().mockResolvedValue([]);
            if (typeof fn !== 'function') return fn;
            return (...args) => { reads.count += 1; return fn(...args); };
        },
    });
    return { messaging, reads, chainId, owner };
}

function mount(client) {
    render(
        <MessagingProvider shell="web" messaging={client.messaging}>
            <GatedPublishForm
                walletId="wallet-1"
                chainId={client.chainId}
                tick="GATE"
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
// Develop's file labels name the ceiling in bytes.
function capOf(field) {
    const [, n] = field.labels[0].textContent.match(/([\d,]+) bytes/);
    return Number(n.replace(/,/g, ''));
}
async function ready() {
    await waitFor(() => expect(screen.getByRole('button', { name: /^Token: GATE/ })).toBeEnabled());
    return screen.getByLabelText(FILE_LABEL);
}
async function pickFile(size = FILE_BYTES) {
    fireEvent.change(screen.getByLabelText('File to publish'), {
        target: { files: [new File([new Uint8Array(size)], 'members.bin', { type: 'application/octet-stream' })] },
    });
    // Develop names the picked file in one metadata line under the chooser.
    await screen.findByText((text) => text.startsWith('members.bin'));
}
// Develop asks for the permanence acknowledgement before any publish.
function ackForever() {
    fireEvent.click(screen.getByRole('checkbox', { name: /forever|permanent/i }));
}
function pickFastFee() {
    fireEvent.click(document.querySelector('button[aria-label="Fast"]'));
}
function expectedFees(chainId, { title = '', tier = 'normal' } = {}) {
    const compiledBytes = uploadMethodLib.gatedFileCompiledBytes({
        name: 'members.bin', type: 'application/octet-stream', title, memo: '',
        gateTicker: 'GATE', coin: TICKERS[chainId], address: OWNER.address, gateMinAmount: null,
    }, FILE_BYTES);
    const feeEstimate = estimateNativeSendFeeTiers({ chainId, chainRegistry: registry })[tier];
    const fees = uploadMethodLib.estimateUploadMethodFees({ compiledBytes, descriptor: registry.get(chainId), feeEstimate });
    uploadMethodLib.estimateUploadMethodFees.mockClear();
    return fees;
}

describe('GatedPublishForm upload method', () => {
    it('offers Taproot upload first, marked Cheapest and picked by default, then Standard, each with its fee', async () => {
        mount(messagingFor());
        await ready();
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
        ['a hardware wallet', { owner: { ...OWNER, source: 'trezor' } }, "Hardware wallets can't sign the reveal transaction yet."],
        ['another phone signing', { walletMode: 'watcher' }, "Not available when another phone signs: it can't sign the reveal."],
        ['Litecoin', { chainId: 'litecoin-mainnet', owner: { ...OWNER, address: 'ltc1qgateownergateownergateownergateowner' } },
            'Not on Litecoin until the wallet turns on Taproot addresses.'],
        ['Dogecoin', { chainId: 'dogecoin-mainnet', owner: { ...OWNER, address: 'DGateOwnerGateOwnerGateOwnerGateOwn' } },
            'Dogecoin has no Taproot.'],
    ])('disables Taproot upload with its reason for %s', async (_name, opts, reason) => {
        mount(messagingFor(opts));
        const field = await ready();
        await waitFor(() => expect(trigger()).toHaveAccessibleName('Upload method: Standard'));
        fireEvent.click(trigger());
        const [taproot, standard] = screen.getAllByRole('option');
        expect(taproot).toHaveAttribute('aria-disabled', 'true');
        expect(taproot).toHaveTextContent(reason);
        expect(standard).not.toHaveAttribute('aria-disabled');
        expect(capOf(field)).toBeLessThan(8192);
    });

    it('sizes the encrypted file ceiling by the picked method', async () => {
        mount(messagingFor());
        const field = await ready();
        expect(capOf(field)).toBeGreaterThan(300_000);
        pickMethod('Standard');
        expect(capOf(screen.getByLabelText(FILE_LABEL))).toBeLessThan(8192);
    });

    it.each([
        ['Taproot upload', 'AUTO'],
        ['Standard', undefined],
    ])('composes with the %s request and names the method on the confirm screen', async (method, encoding) => {
        const composeGatedPublishForConfirm = vi.fn().mockResolvedValue({
            psbt: 'aa00',
            encoding: 'psbt',
            version: 1,
            chainId: 'bitcoin-mainnet',
            actionString: 'encoded action',
            decoded: { summary: 'Review action', details: [], warnings: [] },
            gatedPublish: { actionData: {}, keyHash: 'k'.repeat(64), ciphertextLength: 10 },
        });
        mount(messagingFor({
            overrides: { composeGatedPublishForConfirm, preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }) },
        }));
        await ready();
        await pickFile();
        if (method === 'Standard') pickMethod('Standard');
        ackForever();
        fireEvent.click(screen.getByRole('button', { name: 'Publish file' }));
        await waitFor(() => expect(composeGatedPublishForConfirm).toHaveBeenCalledTimes(1));
        expect(composeGatedPublishForConfirm.mock.calls[0][0].encoding).toBe(encoding);
        await screen.findByTestId('confirm-modal');
        expect(await screen.findByText(new RegExp(`^Upload method: ${method}\\.`))).toBeInTheDocument();
        // Until the composed transactions state their exact fee, the facts
        // card's network fee row shows the picked method's estimate.
        const fees = expectedFees('bitcoin-mainnet');
        expect(screen.getByTestId('confirm-modal'))
            .toHaveTextContent(`Network fee: ${fees[encoding ? 'taproot' : 'standard'].coinAmount} BTC (estimate)`);
    });

    it('re-prices each option when the fee tier changes', async () => {
        mount(messagingFor());
        await ready();
        await pickFile();
        const fast = expectedFees('bitcoin-mainnet', { tier: 'fast' });
        pickFastFee();
        fireEvent.click(trigger());
        const [taproot, standard] = screen.getAllByRole('option');
        expect(taproot).toHaveTextContent(`Network fee about ${fast.taproot.coinAmount} BTC`);
        expect(standard).toHaveTextContent(`Network fee about ${fast.standard.coinAmount} BTC`);
    });

    it('builds the watcher PSBT on Standard with no encoding', async () => {
        const buildGatedPublishPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: '70736274ff' });
        mount(messagingFor({ walletMode: 'watcher', overrides: { buildGatedPublishPsbtRequest } }));
        await ready();
        await pickFile();
        ackForever();
        fireEvent.click(await screen.findByRole('button', { name: /^Create transaction for signing$/i }));
        await waitFor(() => expect(buildGatedPublishPsbtRequest).toHaveBeenCalledTimes(1));
        expect(buildGatedPublishPsbtRequest.mock.calls[0][0]).not.toHaveProperty('encoding');
    });

    it('re-estimates once per pause in typing, whatever the length, and reads nothing while typing', async () => {
        const client = messagingFor();
        mount(client);
        await ready();
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
