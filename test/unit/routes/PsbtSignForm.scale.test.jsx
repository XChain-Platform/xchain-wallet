// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm, normalizePsbtInput } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';

const OWN = 'bcrt1qexampleexampleexampleexampleexample';
const ADDRESSES = {
    'bitcoin-regtest': [{
        id: 'btc-address', address: OWN, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
    }],
};

afterEach(cleanup);

describe('PSBT paste at scale', () => {
    it('normalizes a 1 MB base64 paste quickly', () => {
        const bytes = new Uint8Array(1024 * 1024 * 3 / 4);
        bytes.set([0x70, 0x73, 0x62, 0x74, 0xff]);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
        const b64 = btoa(bin);
        const start = performance.now();
        const hex = normalizePsbtInput(b64);
        const elapsed = performance.now() - start;
        expect(hex.length).toBe(bytes.length * 2);
        expect(elapsed).toBeLessThan(2000);
    });

    it('renders hundreds of inputs and outputs', async () => {
        const n = 1500;
        const decomposed = {
            inputs: Array.from({ length: n }, (_, i) => ({ address: OWN, value: 10_000, prevTxHash: String(i).padStart(64, '0'), prevTxIndex: 0 })),
            outputs: Array.from({ length: n }, (_, i) => ({ address: `bc1qrecipient${i}`, value: 9_000 })),
        };
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            parsePsbtRequest: vi.fn().mockResolvedValue({ decomposed, action: null, actionDecodeReason: 'NO_OP_RETURN' }),
        };
        const messaging = new Proxy(target, { get: (v, p) => (p in v ? v[p] : vi.fn().mockResolvedValue({})) });
        render(<MessagingProvider shell="web" messaging={messaging}><PsbtSignForm walletId="w" onBack={() => {}} /></MessagingProvider>);
        await screen.findByRole('button', { name: /Network: Bitcoin/ });
        fireEvent.change(screen.getByLabelText(/Unsigned transaction/), { target: { value: '70736274ff01020304' } });
        await waitFor(() => expect(screen.getAllByTestId('psbt-sign-output')).toHaveLength(n), { timeout: 20000 });
        fireEvent.click(screen.getByRole('button', { name: 'Sign transaction' }));
        await waitFor(() => expect(screen.getAllByText(/Approve|Sign/).length).toBeGreaterThan(0), { timeout: 20000 });
    }, 60000);
});
