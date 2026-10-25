// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A second submit of the review form while the confirm page is still composing
// joins the first run: one compose, no failure banner for the action in flight.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const FROM = {
    id: 'address-1', address: 'bc1qbatchsender000000000000000000000000000',
    publicKey: '02'.padEnd(66, 'a'), derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
};

afterEach(() => cleanup());

describe('BatchComposerForm double sign', () => {
    it('composes once and shows no failure when Sign is submitted twice', async () => {
        const composeForConfirm = vi.fn(() => new Promise(() => {}));
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [FROM] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: FROM }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            listActions: vi.fn().mockResolvedValue(['SEND', 'BROADCAST']),
            validateAction: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
            getAddressBalances: vi.fn().mockResolvedValue({ native: { tick: 'BTC', quantity: '1', divisibility: 8 }, tokens: [] }),
            buildBatchCommand: vi.fn().mockResolvedValue({ command: 'BROADCAST|0|1|hello', subStrings: [] }),
            composeForConfirm,
        };
        render(<MessagingProvider shell="web" messaging={messaging}><BatchComposerForm walletId="w" onBack={() => {}} /></MessagingProvider>);
        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        const sign = await screen.findByRole('button', { name: 'Sign batch' });
        await waitFor(() => expect(sign).not.toBeDisabled());
        const form = sign.closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);
        await new Promise((r) => setTimeout(r, 100));
        expect(composeForConfirm).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).not.toMatch(/Batch failed|already in progress/);
    });
});
