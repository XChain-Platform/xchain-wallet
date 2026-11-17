// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const address = (id, chain) => ({
    id,
    address: `${chain}-address`,
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

// Every case here runs as a watch-only wallet. The mode comes from the wallet
// list, not from settings.
beforeEach(() => {
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
});
afterEach(() => { cleanup(); resetWalletModes(); });

describe('LinkForm with an action number the explorer does not hold', () => {
    it('says no action was found instead of printing the explorer request', async () => {
        const btc = address('btc-1', BTC);
        const ltc = address('ltc-1', LTC);
        const client = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [btc], [LTC]: [ltc] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: btc, [LTC]: ltc }),
            getSettings: vi.fn().mockResolvedValue({}),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getActionByIndex: vi.fn(({ chainId }) => (chainId === BTC
                ? Promise.reject(new Error('Explorer returned HTTP 404 for /BTC/api/action/10'))
                : Promise.resolve({ action: 'SEND', tick: 'TOKEN', amount: '1' }))),
            buildActionPsbtRequest: vi.fn(),
        };

        render(
            <MessagingProvider shell="web" messaging={client}>
                <LinkForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        const inputs = await screen.findAllByLabelText('Action number');
        fireEvent.change(inputs[0], { target: { value: '10' } });
        fireEvent.change(inputs[1], { target: { value: '20' } });

        // The field's own error, stated once: no banner repeats it.
        await waitFor(() => expect(screen.getByRole('alert'))
            .toHaveTextContent('No action with this number'));
        expect(screen.getAllByText('No action with this number')).toHaveLength(1);
        expect(inputs[0]).toHaveAttribute('aria-invalid', 'true');
        expect(inputs[0].getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
        expect(inputs[1]).not.toHaveAttribute('aria-invalid', 'true');
        expect(document.body.textContent).not.toMatch(/HTTP 404|\/api\/action/);

        // Review stops on the missing number and puts the cursor in its field.
        fireEvent.click(await screen.findByRole('button', { name: 'Link Actions' }));
        expect(screen.queryByText('Review Link')).not.toBeInTheDocument();
        await waitFor(() => expect(inputs[0]).toHaveFocus());
    });

    it('shows the error again for a second missing number after typing dismissed the first', async () => {
        const btc = address('btc-1', BTC);
        const ltc = address('ltc-1', LTC);
        const client = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [btc], [LTC]: [ltc] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: btc, [LTC]: ltc }),
            getSettings: vi.fn().mockResolvedValue({}),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getActionByIndex: vi.fn().mockResolvedValue(null),
        };

        render(
            <MessagingProvider shell="web" messaging={client}>
                <LinkForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        const [input] = await screen.findAllByLabelText('Action number');
        fireEvent.change(input, { target: { value: '77' } });
        fireEvent.blur(input);
        expect(await screen.findByText('No action with this number')).toBeInTheDocument();
        fireEvent.change(input, { target: { value: '78' } });
        expect(screen.queryByText('No action with this number')).not.toBeInTheDocument();
        fireEvent.blur(input);
        expect(await screen.findByText('No action with this number')).toBeInTheDocument();
        expect(client.getActionByIndex).toHaveBeenCalledTimes(2);
    });
});
