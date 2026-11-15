// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PairPartnerWallet } from '../../../packages/core/src/shared/routes/PairPartnerWallet.jsx';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

afterEach(() => {
    cleanup();
    globalThis.localStorage?.clear?.();
});

function fill(label, value) {
    fireEvent.change(
        screen.getByLabelText(label, { selector: 'input, textarea' }),
        { target: { value } },
    );
}

describe('PairPartnerWallet error copy', () => {
    it('hides pairing-code builder details', async () => {
        const messaging = {
            importMnemonic: vi.fn(async () => ({ wallet: { id: 'wallet-1' } })),
            pairingPayloadRequest: vi.fn(async () => {
                throw new Error(
                    'pairPartner: collectPairingKeys: none of the requested chains resolved a derivation path',
                );
            }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PairPartnerWallet />
            </MessagingProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: /pair a signer/i }));
        fill(/Shared recovery phrase/i, PHRASE);
        fill(/^Password for this device$/i, PASSWORD);
        fill(/Confirm password/i, PASSWORD);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
        });

        expect(await screen.findByText("Could not build this wallet's pairing code.")).toBeTruthy();
        expect(screen.queryByText(/collectPairingKeys|pairPartner:/)).toBeNull();
    });
});
