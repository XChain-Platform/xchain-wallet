// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';

function address(id, chainId) {
    return {
        id,
        address: `${chainId}-address`,
        publicKey: '02aa',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    };
}

afterEach(cleanup);

describe('LinkForm action layout', () => {
    it('uses the form network for a LINK composed from two action cards', async () => {
        const btc = address('btc-1', BTC);
        const ltc = address('ltc-1', LTC);
        const composeForConfirm = vi.fn(() => new Promise(() => {}));
        const client = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [btc], [LTC]: [ltc] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: btc, [LTC]: ltc }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getActionByIndex: vi.fn(({ chainId }) => Promise.resolve(chainId === BTC
                ? { action: 'SEND', amount: '10', tick: 'PEPE', block_index: 902311 }
                : { action: 'ISSUE', tick: 'PEPE', block_index: 5401220 })),
            composeForConfirm,
            preflight: vi.fn(),
        };

        render(
            <MessagingProvider shell="web" messaging={client}>
                <LinkForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('heading', { level: 1, name: 'Link actions' }))
            .toBeInTheDocument();
        const networkPickers = await screen.findAllByRole('button', { name: /^Network:/ });
        const from = await screen.findByLabelText('From');
        expect(from).toHaveAttribute('readonly');
        expect(screen.getByRole('button', { name: 'Choose source address' })).toBeInTheDocument();
        const cards = [
            screen.getByText('Action 1').closest('fieldset'),
            screen.getByText('Action 2').closest('fieldset'),
        ];
        expect(cards.every(Boolean)).toBe(true);
        expect(networkPickers[0].compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        expect(from.compareDocumentPosition(cards[0]) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        expect(cards[0].compareDocumentPosition(cards[1]) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();

        expect(within(cards[0]).getByText('Action 1')).toBeInTheDocument();
        expect(within(cards[1]).getByText('Action 2')).toBeInTheDocument();
        expect(within(cards[0]).getByRole('button', { name: /^Network:/ })).toBeInTheDocument();
        expect(within(cards[1]).getByRole('button', { name: /^Network:/ })).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/Network A|Network B|Submit on/);

        // The Network field opens the full network-picker screen (U59).
        fireEvent.click(networkPickers[0]);
        fireEvent.click(await screen.findByRole('button', { name: /^Select Litecoin/ }));
        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(ltc.address));

        const actionInputs = screen.getAllByLabelText('Action number');
        expect(actionInputs).toHaveLength(2);

        fireEvent.change(actionInputs[0], { target: { value: '10' } });
        fireEvent.change(actionInputs[1], { target: { value: '20' } });
        expect(await screen.findByText('Found: SEND 10 PEPE, block 902,311'))
            .toBeInTheDocument();
        expect(screen.getByText('Found: ISSUE PEPE, block 5,401,220')).toBeInTheDocument();

        fireEvent.click(await screen.findByRole('button', { name: 'Link actions' }));
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            chainId: LTC,
            actionData: {
                action: 'LINK',
                params: expect.objectContaining({
                    COIN1: 'BTC',
                    COIN1_ACTION_INDEX: '10',
                    COIN2: 'LTC',
                    COIN2_ACTION_INDEX: '20',
                }),
            },
        }));
    });
});
