// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
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
        const modes = screen.getByRole('radiogroup', { name: 'Publish as' });
        const follows = (earlier, later) => Boolean(
            earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
        );

        expect(follows(network, from)).toBe(true);
        expect(follows(from, modes)).toBe(true);

        fireEvent.click(screen.getByRole('radio', { name: 'Encrypted & token-gated' }));
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
        expect(screen.queryByText('Protocol fee')).toBeNull();
    });

    it('uses field-specific help tips and keeps optional state on each label line', async () => {
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

        await screen.findByLabelText(/^File \(up to [\d,]+ bytes\)$/);
        const fileLabel = screen.getByText(/^File \(up to [\d,]+ bytes\)$/, { selector: 'label' });
        const assertTip = (label, copy) => {
            fireEvent.click(screen.getByRole('button', { name: label }));
            expect(screen.getByRole('tooltip')).toHaveTextContent(copy);
            fireEvent.keyDown(document, { key: 'Escape' });
        };

        expect(screen.getByRole('radiogroup', { name: 'Publish as' })).toBeInTheDocument();
        expect(screen.getByText('Anyone can read the file straight from the chain.')).toBeInTheDocument();
        expect(screen.getByText('Only holders of a token you own can unlock the encrypted file.')).toBeInTheDocument();
        assertTip(
            'About Publish as',
            'Choose whether this file is readable by everyone or encrypted for holders of a token you own.',
        );
        assertTip(
            'About From',
            "The wallet address that pays the network fee and is recorded as the file's publisher.",
        );
        assertTip(
            `About ${fileLabel.textContent}`,
            'The ceiling is exact per upload',
        );
        assertTip('About Title', 'A short label stored on-chain with the published file.');
        assertTip('About Memo', 'An optional note stored on-chain with the published file.');

        expect(screen.queryByText(/The ceiling is exact per upload/, { selector: 'p' })).toBeNull();

        const titleRow = screen.getByText('Title', { selector: 'label' }).parentElement;
        expect(within(titleRow).getByText('Optional')).toBeInTheDocument();
        expect(within(titleRow).getByText('0 / 100')).toBeInTheDocument();
        const memoRow = screen.getByText('Memo', { selector: 'label' }).parentElement;
        expect(within(memoRow).getByText('Optional')).toBeInTheDocument();
        expect(within(memoRow).getByText('0 / 250')).toBeInTheDocument();
    });

    it.each(['full', 'watcher'])('keeps Publish file as the success action in %s mode', async (walletMode) => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        const action = await screen.findByRole('button', { name: 'Publish file' });
        expect(action.className).toMatch(/success/);
        expect(action.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Review publish' })).toBeNull();
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
        fireEvent.change(screen.getByLabelText('Title'), {
            target: { value: 'safe\u200bunsafe' },
        });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Publish file' }));

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
        const publicMode = screen.getByRole('radio', { name: 'Public' });
        const gatedMode = screen.getByRole('radio', { name: 'Encrypted & token-gated' });
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
        expect(readFileSync('packages/core/src/shared/routes/PublishFileForm.module.css', 'utf8'))
            .toMatch(/\.tokenPickerCard > :not\(:last-child\)\s*\{[^}]*border-block-end:\s*1px solid var\(--xc-border\)/s);
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        fireEvent.click(rows.find((row) => row.textContent.includes('LITE')));

        expect(await screen.findByRole('button', { name: /^Token: LITE on Litecoin/ })).toHaveTextContent('LITE');
        expect(screen.getByRole('button', { name: /^Network: Litecoin/ })).toBeInTheDocument();
        expect(gatedMode).toBeChecked();
        const continueButton = screen.getByRole('button', { name: 'Continue to file' });
        expect(continueButton.className).toMatch(/success/);
        expect(continueButton.querySelector('svg')).not.toBeNull();
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
        fireEvent.click(screen.getByRole('button', { name: 'Publish file' }));
        expect(await screen.findByRole('form', { name: 'Review publish' })).toBeTruthy();
        const reviewAction = screen.getByRole('button', { name: 'Create unsigned transaction' });
        expect(reviewAction.className).toMatch(/success/);
        expect(reviewAction.querySelector('svg')).not.toBeNull();

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
        fireEvent.click(screen.getByRole('button', { name: 'Publish file' }));
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
