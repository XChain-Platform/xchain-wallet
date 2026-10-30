// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm, psbtFeeShareWarnings } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';

// The PSBT review warns about a network fee on the same terms the Send form
// does: a fee above 10% of the amount the transaction sends is unusual and
// gets a warning before the signer approves.

const OWN = 'bcrt1qexampleexampleexampleexampleexample';
const RECIPIENT = 'bcrt1qrecipientrecipientrecipientrecipient';
const PSBT_A = '70736274ff01020304';
const PSBT_B = '70736274ff01020305';
const SHARE_LINE = 'The network fee is more than 10% of the amount this transaction sends.';

const ADDRESSES = {
    'bitcoin-regtest': [{
        id: 'btc-address', address: OWN, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
    }],
};

function decomposedWith({ input, outputs }) {
    return {
        inputs: [{ address: OWN, value: input, prevTxHash: '00'.repeat(32), prevTxIndex: 0 }],
        outputs,
    };
}

function payment(input, sent, change = 0) {
    const outputs = [{ address: RECIPIENT, value: sent }];
    if (change > 0) outputs.push({ address: OWN, value: change });
    return decomposedWith({ input, outputs });
}

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

function renderForm(parsePsbtRequest) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        parsePsbtRequest,
    };
    const messaging = new Proxy(target, {
        get: (v, p) => (p in v ? v[p] : vi.fn().mockResolvedValue({})),
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PsbtSignForm walletId="wallet" onBack={() => {}} />
        </MessagingProvider>,
    );
}

async function pasteAndReview(decomposed) {
    const parsePsbtRequest = vi.fn().mockResolvedValue({ decomposed, action: null, actionDecodeReason: 'NO_OP_RETURN' });
    renderForm(parsePsbtRequest);
    await screen.findByRole('button', { name: /Network: Bitcoin/ });
    fireEvent.change(screen.getByLabelText(/Unsigned transaction/), { target: { value: PSBT_A } });
    await waitFor(() => expect(screen.getAllByTestId('psbt-sign-output').length).toBeGreaterThan(0));
    return parsePsbtRequest;
}

afterEach(cleanup);

describe('psbtFeeShareWarnings', () => {
    it('warns above the Send form share and stays quiet at or under it', () => {
        expect(psbtFeeShareWarnings(payment(100_000, 1_000), new Set([OWN]))).toEqual([
            SHARE_LINE,
            'The network fee is 99% of the coins this transaction spends.',
            'The network fee is more than the total this transaction sends.',
        ]);
        expect(psbtFeeShareWarnings(payment(11_001, 10_000), new Set([OWN]))).toEqual([
            SHARE_LINE,
            'The network fee is 9% of the coins this transaction spends.',
        ]);
        expect(psbtFeeShareWarnings(payment(11_000, 10_000), new Set([OWN]))).toEqual([]);
        expect(psbtFeeShareWarnings(payment(10_999, 10_000), new Set([OWN]))).toEqual([]);
    });

    it('measures the share against what leaves the wallet, not against change', () => {
        // 1,000 of fee on a 5,000 payment with 94,000 of change is 20% of what is sent.
        expect(psbtFeeShareWarnings(payment(100_000, 5_000, 94_000), new Set([OWN]))[0]).toBe(SHARE_LINE);
        // The same fee on a 94,000 payment with 5,000 of change is about 1% of what is sent.
        const changeOnly = decomposedWith({
            input: 100_000,
            outputs: [{ address: RECIPIENT, value: 94_000 }, { address: OWN, value: 5_000 }],
        });
        expect(psbtFeeShareWarnings(changeOnly, new Set([OWN]))).toEqual([]);
    });

    it('measures a self transfer against its total output', () => {
        const consolidation = decomposedWith({ input: 100_000, outputs: [{ address: OWN, value: 1_000 }] });
        expect(psbtFeeShareWarnings(consolidation, new Set([OWN]))[0]).toBe(SHARE_LINE);
    });

    it('names a fee larger than everything the transaction sends', () => {
        const lines = psbtFeeShareWarnings(payment(3_000, 1_000), new Set([OWN]));
        expect(lines.join(' ')).toMatch(/more than the total this transaction sends/);
    });

    it('stays quiet when the fee cannot be verified', () => {
        const unknown = { inputs: [{ address: OWN, value: null }], outputs: [{ address: RECIPIENT, value: 1 }] };
        expect(psbtFeeShareWarnings(unknown, new Set([OWN]))).toEqual([]);
        expect(psbtFeeShareWarnings(null, new Set([OWN]))).toEqual([]);
    });
});

describe('PSBT review fee share warning', () => {
    it('warns on a fee of 99 percent of the input before signing', async () => {
        await pasteAndReview(payment(100_000, 1_000));
        const warning = screen.getByTestId('psbt-fee-share-warning');
        expect(warning.textContent).toMatch(/network fee is more than 10% of the amount this transaction sends/);
        expect(warning.textContent).toMatch(/99% of the coins this transaction spends/);
        expect(warning.textContent).toMatch(/more than the total this transaction sends/);
    });

    it('leaves the transaction the signer reviews unchanged', async () => {
        const parsePsbtRequest = await pasteAndReview(payment(100_000, 1_000));
        expect(screen.getByTestId('psbt-fee-share-warning')).toBeTruthy();
        expect(screen.getByLabelText(/Unsigned transaction/).value).toBe(PSBT_A);
        expect(parsePsbtRequest).toHaveBeenCalledTimes(1);
        expect(parsePsbtRequest.mock.calls[0][0].psbtHex).toBe(PSBT_A);
    });

    it('warns on a fee of 50 percent of the input', async () => {
        await pasteAndReview(payment(2_000, 1_000));
        expect(screen.getByTestId('psbt-fee-share-warning').textContent).toMatch(/50% of the coins/);
    });

    it('warns just over the Send form share', async () => {
        await pasteAndReview(payment(11_001, 10_000));
        expect(screen.getByTestId('psbt-fee-share-warning')).toBeTruthy();
    });

    it('stays quiet just under the Send form share', async () => {
        await pasteAndReview(payment(10_999, 10_000));
        expect(screen.queryByTestId('psbt-fee-share-warning')).toBeNull();
    });

    it('drops the warning with the stale review and re-reads it for the new transaction', async () => {
        const second = deferred();
        const parsePsbtRequest = vi.fn()
            .mockResolvedValueOnce({ decomposed: payment(100_000, 1_000), action: null, actionDecodeReason: 'NO_OP_RETURN' })
            .mockReturnValueOnce(second.promise);
        renderForm(parsePsbtRequest);
        await screen.findByRole('button', { name: /Network: Bitcoin/ });
        const box = screen.getByLabelText(/Unsigned transaction/);

        fireEvent.change(box, { target: { value: PSBT_A } });
        await waitFor(() => expect(screen.getByTestId('psbt-fee-share-warning')).toBeTruthy());

        fireEvent.change(box, { target: { value: PSBT_B } });
        await waitFor(() => expect(parsePsbtRequest).toHaveBeenCalledTimes(2));
        expect(screen.queryByTestId('psbt-fee-share-warning')).toBeNull();

        second.resolve({ decomposed: payment(10_500, 10_000), action: null, actionDecodeReason: 'NO_OP_RETURN' });
        await waitFor(() => expect(screen.getAllByTestId('psbt-sign-output')).toHaveLength(1));
        expect(screen.queryByTestId('psbt-fee-share-warning')).toBeNull();
    });

    it('warns the same way for an imported transaction file', async () => {
        renderForm(vi.fn().mockResolvedValue({ decomposed: payment(100_000, 1_000), action: null, actionDecodeReason: 'NO_OP_RETURN' }));
        await screen.findByRole('button', { name: /Network: Bitcoin/ });
        const bytes = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff, 0x01, 0x02, 0x03, 0x04]);
        const file = new File([bytes], 'fee.psbt', { type: 'application/octet-stream' });
        fireEvent.change(screen.getByLabelText('Upload transaction file'), { target: { files: [file] } });
        await waitFor(() => expect(screen.getByTestId('psbt-fee-share-warning')).toBeTruthy());
    });
});
