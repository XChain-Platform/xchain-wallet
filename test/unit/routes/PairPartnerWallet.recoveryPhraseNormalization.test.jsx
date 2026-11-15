// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PairPartnerWallet } from '../../../packages/core/src/shared/routes/PairPartnerWallet.jsx';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

afterEach(() => cleanup());

function fill(label, value) {
    fireEvent.change(screen.getByLabelText(label, { selector: 'input, textarea' }), {
        target: { value },
    });
}

async function submitPhrase(candidate) {
    const messaging = {
        importMnemonic: vi.fn(async () => ({ wallet: { id: 'wallet-1' } })),
        pairingPayloadRequest: vi.fn(async () => ({
            encoded: 'XCW-PAIR:ZmFrZQ', payload: { keys: [] },
        })),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PairPartnerWallet />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /pair a signer/i }));
    fill(/Shared recovery phrase/i, candidate);
    fill(/^Password for this device$/i, PASSWORD);
    fill(/Confirm password/i, PASSWORD);
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    });
    return messaging;
}

describe('PairPartnerWallet recovery phrase normalization', () => {
    it.each([
        ['capital letters', PHRASE.toUpperCase()],
        ['an invisible format character', PHRASE.replace('abandon', 'aban\u200Bdon')],
        ['complete word numbering', PHRASE.split(' ').map((word, i) => `${i + 1}. ${word}`).join(' ')],
    ])('imports a BIP39 phrase containing %s in canonical form', async (_name, candidate) => {
        const messaging = await submitPhrase(candidate);

        expect(messaging.importMnemonic).toHaveBeenCalledWith(expect.objectContaining({
            mnemonic: PHRASE,
            format: 'bip39',
        }));
    });
});
