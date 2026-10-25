// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';
import { livenessMessage } from '../../../packages/core/src/flows/inputLiveness.js';

const OWN = 'bcrt1qexampleexampleexampleexampleexample';
const PSBT = '70736274ff01020304';
const SPENT = { verdict: 'spent', spent: [{ txid: '00'.repeat(32), vout: 0 }], unknown: [] };

const ADDRESSES = {
    'bitcoin-regtest': [{
        id: 'btc-address', address: OWN, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
    }],
};

function setup(liveness) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        parsePsbtRequest: vi.fn().mockResolvedValue({
            decomposed: {
                inputs: [{ address: OWN, value: 1000, prevTxHash: '00'.repeat(32), prevTxIndex: 0 }],
                outputs: [{ address: 'bc1qrecipient', value: 900 }],
            },
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        }),
        checkInputLiveness: vi.fn().mockResolvedValue(liveness),
        signPsbtUserInitiated: vi.fn().mockResolvedValue({ signedPsbtHex: PSBT }),
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

async function openReview() {
    await screen.findByRole('button', { name: /Network: Bitcoin/ });
    fireEvent.change(screen.getByLabelText(/Unsigned transaction/), { target: { value: PSBT } });
    await waitFor(() => expect(screen.getAllByTestId('psbt-sign-output')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Sign transaction' }));
    return screen.findByTestId('confirm-approve');
}

afterEach(cleanup);

describe('pasted PSBT with spent inputs', () => {
    it('shows the spent-input notice first and signs nothing', async () => {
        const target = setup(SPENT);
        const approve = await openReview();
        await waitFor(() => expect(approve.disabled).toBe(false));
        fireEvent.click(approve);

        const notice = await screen.findByTestId('confirm-error');
        expect(notice.textContent).toContain(livenessMessage(SPENT));
        expect(screen.getByTestId('confirm-modal').firstElementChild).toBe(notice);
        expect(target.checkInputLiveness).toHaveBeenCalledTimes(1);
        expect(target.signPsbtUserInitiated).not.toHaveBeenCalled();
    });

    it('signs when every input is live', async () => {
        const target = setup({ verdict: 'live', spent: [], unknown: [] });
        const approve = await openReview();
        await waitFor(() => expect(approve.disabled).toBe(false));
        fireEvent.click(approve);

        await waitFor(() => expect(target.signPsbtUserInitiated).toHaveBeenCalledTimes(1));
        expect(target.checkInputLiveness).toHaveBeenCalledTimes(1);
    });
});
