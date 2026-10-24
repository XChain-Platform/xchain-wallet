// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractStakeForm } from '../../../packages/core/src/shared/routes/ContractStakeForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const KEY = 'c'.repeat(64);

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('ContractStakeForm submitted twice before the confirm page opens', () => {
    it('composes once and shows no error for the second press', async () => {
        let finishCompose;
        const composeForConfirm = vi.fn(() => new Promise((resolve) => { finishCompose = resolve; }));
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'addr-1', address: ADDRESS, publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", source: 'hd' }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getContractByActionIndex: vi.fn().mockResolvedValue({ row: { cooldown_blocks: 10 } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            composeForConfirm,
        };
        const messaging = new Proxy(target, {
            get: (object, property) => (property in object ? object[property] : () => Promise.resolve({})),
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ContractStakeForm
                    walletId="w"
                    chainId={CHAIN}
                    contractActionIndex="2048"
                    initialMode="unstake"
                    initialTick="PEPECASH"
                    initialSigningPubkey={KEY}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );
        const input = await screen.findByLabelText(/signing public key/i);
        await waitFor(() => expect(input.value).toBe(KEY));
        await screen.findByLabelText('From');
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
