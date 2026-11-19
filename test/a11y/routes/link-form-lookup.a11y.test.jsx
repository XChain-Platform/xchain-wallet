// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Link actions with both lookups settled: Action 1's read-only summary card,
// Action 2's "No action with this number" field error, and the linked-cards
// badge between them. The route sweep (routes-a-l) only sees the empty form.

import React from 'react';
import { afterEach, describe, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const SENDER = 'bc1qsenderaddressforthelinkforma11ytest00000';
const addr = (id, chainId) => ({
    id, address: `${chainId}-address`, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's',
});

afterEach(cleanup);

describe('Link actions with its lookups settled', () => {
    it('has no serious axe violations with a summary, a field error and the badge on screen', async () => {
        const btc = addr('btc-1', BTC);
        const ltc = addr('ltc-1', LTC);
        const client = {
            getAddressesByChain: async () => ({ [BTC]: [btc], [LTC]: [ltc] }),
            getActiveAddresses: async () => ({ [BTC]: btc, [LTC]: ltc }),
            getSettings: async () => ({ walletMode: 'full' }),
            signerReady: async () => ({ ready: true }),
            getActionByIndex: async ({ chainId }) => (chainId === BTC
                ? { action: 'FILE', block_index: 902311, name: 'pepe.png', type: 'image/png', source: SENDER }
                : null),
        };
        let utils;
        await act(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={client}>
                    <LinkForm walletId="w" onBack={() => {}} />
                </MessagingProvider>,
            );
        });
        const [input1, input2] = await screen.findAllByLabelText('Action number');
        fireEvent.change(input1, { target: { value: '10' } });
        fireEvent.blur(input1);
        fireEvent.change(input2, { target: { value: '77' } });
        fireEvent.blur(input2);
        await screen.findByText('Image upload');
        await screen.findByText('No action with this number');
        await waitFor(() => screen.getByRole('img', { name: 'Action 1 is linked to Action 2' }));
        await expectNoSeriousAxeViolations(utils.container);
    });
});
