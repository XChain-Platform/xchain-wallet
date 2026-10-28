// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';

const OWN = 'bcrt1qexampleexampleexampleexampleexample';
const PSBT = '70736274ff01020304';
const LIVE = { verdict: 'live', spent: [], unknown: [] };

const ADDRESSES = {
    'bitcoin-regtest': [{
        id: 'btc-address', address: OWN, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
    }],
};

function setup({ liveness = () => Promise.resolve(LIVE), sign } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        parsePsbtRequest: vi.fn().mockResolvedValue({
            decomposed: {
                inputs: [{ address: OWN, value: 1000, prevTxHash: '00'.repeat(32), prevTxIndex: 0 }],
                // A one percent fee keeps the fee-share warning out of these repeat-press checks.
                outputs: [{ address: 'bc1qrecipient', value: 990 }],
            },
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        }),
        checkInputLiveness: vi.fn(liveness),
        signPsbtUserInitiated: vi.fn(sign || (() => Promise.resolve({ signedPsbtHex: PSBT, txHex: 'aa' }))),
    };
    const messaging = new Proxy(target, {
        get: (v, p) => (p in v ? v[p] : vi.fn().mockResolvedValue({})),
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PsbtSignForm walletId="wallet" onBack={() => {}} />
        </MessagingProvider>,
    );
    return target;
}

async function pasteAndWaitForReview() {
    await screen.findByRole('button', { name: /Network: Bitcoin/ });
    fireEvent.change(screen.getByLabelText(/Unsigned transaction/), { target: { value: PSBT } });
    await waitFor(() => expect(screen.getAllByTestId('psbt-sign-output')).toHaveLength(1));
    return screen.getByRole('button', { name: 'Sign transaction' });
}

afterEach(cleanup);

describe('PSBT sign repeat presses', () => {
    it('a double press on Sign opens one review and leaves no error behind after Reject', async () => {
        setup();
        const sign = await pasteAndWaitForReview();
        act(() => {
            fireEvent.click(sign);
            fireEvent.click(sign);
        });
        await screen.findByTestId('confirm-approve');
        fireEvent.click(screen.getByTestId('confirm-reject'));
        await screen.findByRole('button', { name: 'Sign transaction' });
        expect(screen.queryByText(/already in progress/i)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a double press on Approve and Enter during the signing await sign once and show one result', async () => {
        let release;
        const target = setup({
            sign: () => new Promise((done) => { release = () => done({ signedPsbtHex: PSBT, txHex: 'aa' }); }),
        });
        fireEvent.click(await pasteAndWaitForReview());
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve.disabled).toBe(false));
        act(() => {
            fireEvent.click(approve);
            fireEvent.click(approve);
        });
        await waitFor(() => expect(target.signPsbtUserInitiated).toHaveBeenCalledTimes(1));
        fireEvent.keyDown(approve, { key: 'Enter', code: 'Enter' });
        fireEvent.click(approve);
        await act(async () => { release(); });
        await screen.findAllByTestId('signed-psbt-hex');
        expect(target.signPsbtUserInitiated).toHaveBeenCalledTimes(1);
        expect(screen.getAllByTestId('signed-psbt-hex')).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Broadcast' })).toHaveLength(1);
    });
});

describe('PSBT sign spent-input check replies', () => {
    it('refuses to sign when the check reports a spent input without a list', async () => {
        const target = setup({ liveness: () => Promise.resolve({ verdict: 'spent' }) });
        fireEvent.click(await pasteAndWaitForReview());
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve.disabled).toBe(false));
        fireEvent.click(approve);
        await waitFor(() => expect(target.checkInputLiveness).toHaveBeenCalledTimes(1));
        await screen.findByTestId('confirm-error');
        expect(target.signPsbtUserInitiated).not.toHaveBeenCalled();
    });
});
