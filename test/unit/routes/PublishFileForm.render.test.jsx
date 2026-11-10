// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OTHER_CHAIN = 'litecoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qpublishpublishpublishpublishpublishpub',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const OTHER_ADDRESS = {
    ...ADDRESS,
    id: 'address-2',
    address: 'ltc1qpublishpublishpublishpublishpublishpu',
};

afterEach(cleanup);

describe('PublishFileForm rendering', () => {
    it('orders Network and From before the mode choice in both modes', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'GATE' }]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        const network = await screen.findByRole('button', { name: /^Network:/ });
        const from = screen.getByLabelText('From');
        const modes = screen.getByRole('radiogroup', { name: 'Publish mode' });
        const follows = (earlier, later) => Boolean(
            earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
        );

        expect(follows(network, from)).toBe(true);
        expect(follows(from, modes)).toBe(true);

        fireEvent.click(screen.getByRole('radio', { name: /^Encrypted & token-gated\s*:/ }));
        await screen.findByRole('button', { name: /^Token:/ });
        expect(follows(network, from)).toBe(true);
        expect(follows(from, modes)).toBe(true);
    });

    it('uses one labelled public file field without a separate chooser button', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        const file = await screen.findByLabelText(/^File \(up to [\d,]+ bytes\)$/);
        expect(file).toHaveAttribute('type', 'file');
        expect(screen.queryByRole('button', { name: /Choose a file/i })).toBeNull();
    });

    it('refuses hostile file metadata before watcher review', async () => {
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

        fireEvent.change(await screen.findByLabelText(/^File \(up to [\d,]+ bytes\)$/), {
            target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('note.txt'));
        fireEvent.change(screen.getByLabelText('Title (optional)'), {
            target: { value: 'safe\u200bunsafe' },
        });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Review publish' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Title cannot contain zero-width characters.');
        expect(screen.queryByRole('form', { name: 'Review publish' })).toBeNull();
    });

    it('picks an owned token from list rows in a CSS-module card', async () => {
        const getOwnedTokens = vi.fn(({ chainId }) => Promise.resolve([
            { tick: chainId === OTHER_CHAIN ? 'LITE' : 'GATE' },
        ]));
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [ADDRESS],
                [OTHER_CHAIN]: [OTHER_ADDRESS],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({
                [CHAIN]: { id: ADDRESS.id },
                [OTHER_CHAIN]: { id: OTHER_ADDRESS.id },
            }),
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
        const tokenField = await screen.findByRole('button', { name: 'Token: Select a token' });
        fireEvent.click(tokenField);

        expect(await screen.findByRole('heading', { name: 'Choose a token' })).toBeInTheDocument();
        const card = screen.getByRole('list');
        expect(card.className).toMatch(/tokenPickerCard/);
        expect(card).not.toHaveAttribute('style');
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        fireEvent.click(rows.find((row) => row.textContent.includes('LITE')));

        expect(await screen.findByRole('button', { name: /^Token: LITE on Litecoin/ })).toHaveTextContent('LITE');
        expect(screen.getByRole('button', { name: /^Network: Litecoin/ })).toBeInTheDocument();
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

        const fileInput = await screen.findByLabelText(/^File \(up to [\d,]+ bytes\)$/);
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
        const fileInput = await screen.findByLabelText(/^File \(up to [\d,]+ bytes\)$/);
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
