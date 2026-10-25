// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DelegationActionForm } from '../../../packages/core/src/shared/routes/DelegationActionForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const KEY = 'c'.repeat(64);

afterEach(cleanup);

describe('DelegationActionForm submitted twice before the confirm page opens', () => {
    it('composes once and shows no error for the second press', async () => {
        let finishCompose;
        const composeForConfirm = vi.fn(() => new Promise((resolve) => { finishCompose = resolve; }));
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    id: 'addr-1', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
                    publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
                }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            composeForConfirm,
        };
        const messaging = new Proxy(target, {
            get: (object, property) => (property in object ? object[property] : () => Promise.resolve({})),
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DelegationActionForm mode="delegate" walletId="wallet-1" chainId={CHAIN} onBack={() => {}} />
            </MessagingProvider>,
        );
        const input = await screen.findByLabelText('New signing pubkey');
        fireEvent.change(input, { target: { value: KEY } });
        const form = input.closest('form');

        await act(async () => {
            fireEvent.submit(form);
            fireEvent.submit(form);
        });

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
        expect(composeForConfirm).toHaveBeenCalledTimes(1);
        expect(document.body).not.toHaveTextContent(/Couldn.t complete this/);
        await act(async () => { finishCompose?.(undefined); });
    });
});
