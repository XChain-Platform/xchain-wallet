// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';

const OWN = 'bcrt1qexampleexampleexampleexampleexample';
const PSBT_A = '70736274ff01020304';
const PSBT_B = '70736274ff01020305';

const ADDRESSES = {
    'bitcoin-regtest': [{
        id: 'btc-address', address: OWN, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
    }],
};

function decomposedFor(outAddress) {
    return {
        inputs: [{ address: OWN, value: 1000, prevTxHash: '00'.repeat(32), prevTxIndex: 0 }],
        outputs: [{ address: outAddress, value: 900 }],
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

afterEach(cleanup);

describe('PSBT review while a new parse is pending', () => {
    it('drops the previous review and keeps signing disabled until the new paste parses', async () => {
        const second = deferred();
        const parsePsbtRequest = vi.fn()
            .mockResolvedValueOnce({ decomposed: decomposedFor('bc1qfirstrecipient'), action: null, actionDecodeReason: 'NO_OP_RETURN' })
            .mockReturnValueOnce(second.promise);
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            parsePsbtRequest,
            signPsbtUserInitiated: vi.fn().mockResolvedValue({ signedPsbtHex: PSBT_B }),
        };
        const messaging = new Proxy(target, {
            get: (v, p) => (p in v ? v[p] : vi.fn().mockResolvedValue({})),
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PsbtSignForm walletId="wallet" onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByRole('button', { name: /Network: Bitcoin/ });
        const box = screen.getByLabelText(/Unsigned transaction/);

        fireEvent.change(box, { target: { value: PSBT_A } });
        await waitFor(() => expect(screen.getAllByTestId('psbt-sign-output')).toHaveLength(1));
        expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(false);

        fireEvent.change(box, { target: { value: PSBT_B } });
        await waitFor(() => expect(parsePsbtRequest).toHaveBeenCalledTimes(2));

        // The second parse has not answered: no review of the first transaction may stay up.
        expect(screen.queryAllByTestId('psbt-sign-output')).toHaveLength(0);
        expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(true);

        second.resolve({ decomposed: decomposedFor('bc1qsecondrecipient'), action: null, actionDecodeReason: 'NO_OP_RETURN' });
        await waitFor(() => expect(screen.getAllByTestId('psbt-sign-output')).toHaveLength(1));
        expect(screen.getByRole('button', { name: 'Sign transaction' }).disabled).toBe(false);
    });
});
