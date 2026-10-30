// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One list bound as both the allow-list and the block-list of a token admits
// nobody: every address the allow-list accepts, the block-list refuses. The
// dispenser forms stop that pairing; the token Access lists form stops it too.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('TokenAdminForm access lists', () => {
    it('refuses one list in both the allow and block slots', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: '70736274ff00', chainId: CHAIN });
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            getTokenInfo: vi.fn().mockResolvedValue({
                chainId: CHAIN, tick: 'TOKEN', creator: SOURCE.address, locks: {}, allowList: '42', blockList: null,
            }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getListsForSource: vi.fn().mockResolvedValue([{ action_index: '42', type: '2', block_index: 1 }]),
            getListByActionIndex: vi.fn().mockResolvedValue({ type: '2', list: ['a', 'b'] }),
            buildActionPsbtRequest,
        };
        const proxy = new Proxy(messaging, {
            get(target, property) {
                return property in target ? target[property] : vi.fn().mockResolvedValue({});
            },
        });
        render(
            <MessagingProvider shell="web" messaging={proxy}>
                <TokenAdminForm
                    walletId="w"
                    mode="access-lists"
                    initialChainId={CHAIN}
                    initialTick="TOKEN"
                    initialFromAddress={SOURCE.address}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Choose block-list/ }));
        fireEvent.click(await screen.findByText(/Address list #42/));
        const preview = await screen.findByRole('button', { name: 'Preview' });
        await waitFor(() => expect(preview).toBeEnabled());
        fireEvent.click(preview);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'both the allow-list and the block-list',
        );
        expect(screen.queryByRole('form', { name: /Review/ })).toBeNull();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});
