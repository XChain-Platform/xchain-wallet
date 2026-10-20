// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qpublishpublishpublishpublishpublishpub',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(cleanup);

describe('PublishFileForm rendering', () => {
    it('loads owned tokens only after gated publishing is selected', async () => {
        const getOwnedTokens = vi.fn().mockResolvedValue([{ tick: 'GATE' }]);
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getOwnedTokens,
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('heading', { name: 'Publish file' })).toBeInTheDocument();
        const publicMode = screen.getByRole('radio', { name: /^Public\s*:/ });
        const gatedMode = screen.getByRole('radio', { name: /^Encrypted & token-gated\s*:/ });
        expect(publicMode).toBeChecked();
        expect(getOwnedTokens).not.toHaveBeenCalled();

        fireEvent.click(gatedMode);

        await waitFor(() => expect(getOwnedTokens).toHaveBeenCalledWith({
            chainId: CHAIN,
            address: ADDRESS.address,
        }));
        expect(await screen.findByRole('listitem')).toHaveTextContent('GATE');
        expect(gatedMode).toBeChecked();
    });

    it('returns from review without submitting the compose form again', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        const fileInput = await screen.findByLabelText('Choose file to publish');
        fireEvent.change(fileInput, {
            target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('note.txt'));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Review publish' }));
        expect(await screen.findByRole('form', { name: 'Review publish' })).toBeTruthy();

        const clickAllowed = fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(clickAllowed).toBe(false);
        expect(screen.getByRole('form', { name: 'Publish file' })).toBeTruthy();
        expect(screen.queryByRole('form', { name: 'Review publish' })).toBeNull();
    });

    it('never signs a fresh build from the review stage after leaving watcher mode', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            fileAction: vi.fn().mockResolvedValue({ txid: 'a'.repeat(64) }),
            fileActionHw: vi.fn().mockResolvedValue({ txid: 'b'.repeat(64) }),
            buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbt: 'unsigned' }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );
        const fileInput = await screen.findByLabelText('Choose file to publish');
        fireEvent.change(fileInput, {
            target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('note.txt'));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Review publish' }));
        const review = await screen.findByRole('form', { name: 'Review publish' });

        window.dispatchEvent(new CustomEvent('xc:settings-changed', { detail: { walletMode: 'full' } }));
        await screen.findByRole('button', { name: 'Sign and publish' });
        fireEvent.submit(review);

        await waitFor(() => expect(document.body.textContent).toMatch(/confirm screen/i));
        expect(messaging.fileAction).not.toHaveBeenCalled();
        expect(messaging.fileActionHw).not.toHaveBeenCalled();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});
