// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

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

afterEach(() => {
    cleanup();
    resetWalletModes();
});

// A wallet's mode comes from the wallet-mode store, not from settings.
function watcherWallet() {
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode: 'watcher' }], activeWalletId: 'wallet-1' });
}

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

        // Network and From sit in the standard From section, first
        // and closed on load; the field is labelled "From address".
        const network = await screen.findByRole('button', { name: /^Network:/, hidden: true });
        const from = screen.getByLabelText('From address');
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

    it('uses the standard file field: limit label, name in the field, Upload then X', async () => {
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

        const display = await screen.findByLabelText(/^File \(up to [\d,]+ bytes\)$/);
        expect(display).toHaveAttribute('readonly');
        expect(display).toHaveValue('');
        expect(display).toHaveAttribute('placeholder', 'No file chosen');
        const picker = screen.getByLabelText('File to publish');
        expect(picker).toHaveAttribute('type', 'file');
        expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
        expect(screen.queryByText('Protocol fee')).toBeNull();
        // No acknowledgement checkbox gates the publish.
        expect(screen.queryByRole('checkbox')).toBeNull();

        fireEvent.change(picker, {
            target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(display).toHaveValue('note.txt'));
        fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
        expect(display).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
    });

    it('takes a file dropped on the field like a picked one', async () => {
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

        const display = await screen.findByLabelText(/^File \(up to [\d,]+ bytes\)$/);
        const zone = display.closest('[data-file-field]');
        fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
        expect(zone).toHaveAttribute('data-drop-active', 'true');
        fireEvent.drop(zone, {
            dataTransfer: { files: [new File(['hi'], 'dropped.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(display).toHaveValue('dropped.txt'));
        expect(zone).toHaveAttribute('data-drop-active', 'false');
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
        // From and Memo are standard sections, closed on load.
        fireEvent.click(screen.getByRole('button', { name: /^From\b/, expanded: false }));
        fireEvent.click(screen.getByRole('button', { name: /^Memo\b/, expanded: false }));
        assertTip(
            'About From address',
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
        // Memo's Optional tag sits on its optional section's
        // header (the standard drops the field's own tag inside it).
        const memoRow = screen.getByText('Memo', { selector: 'label' }).parentElement;
        expect(within(memoRow).getByText('0 / 250')).toBeInTheDocument();
        const memoHeader = screen.getByRole('button', { name: /^Memo\b/, expanded: true });
        expect(within(memoHeader).getByText('Optional')).toBeInTheDocument();
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

        // The standard action label is Title Case.
        const action = await screen.findByRole('button', { name: 'Publish File' });
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

        fireEvent.change(await screen.findByLabelText('File to publish'), {
            target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('note.txt'));
        fireEvent.change(screen.getByLabelText('Title'), {
            target: { value: 'safe\u200bunsafe' },
        });
        // There is no permanence checkbox; the confirm screen states that fact.
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));

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

        // Page titles are Title Case.
        expect(await screen.findByRole('heading', { name: 'Publish File' })).toBeInTheDocument();
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

        expect(await screen.findByRole('heading', { name: 'Choose a Token' })).toBeInTheDocument();
        const card = screen.getByRole('list');
        expect(card.className).toMatch(/tokenPickerCard/);
        expect(card).not.toHaveAttribute('style');
        expect(readFileSync('packages/core/src/shared/routes/GatedPublishForm.module.css', 'utf8'))
            .toMatch(/\.tokenPickerCard > :not\(:last-child\)\s*\{[^}]*border-block-end:\s*1px solid var\(--xc-border\)/s);
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        fireEvent.click(rows.find((row) => row.textContent.includes('LITE')));

        expect(await screen.findByRole('button', { name: /^Token: LITE on Litecoin/ })).toHaveTextContent('LITE');
        // The picked token decides the network shown in the closed
        // From section; gated mode keeps the one Publish File action and
        // the page keeps its Publish File title.
        expect(screen.getByRole('button', { name: /^Network: Litecoin/, hidden: true })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Encrypted & token-gated' })).toBeChecked();
        expect(screen.getByRole('heading', { name: 'Publish File' })).toBeInTheDocument();
        const continueButton = screen.getByRole('button', { name: 'Publish File' });
        expect(continueButton.className).toMatch(/success/);
        expect(continueButton.querySelector('svg')).not.toBeNull();
    });

    it('keeps title, file and memo across Encrypted and shows the gated ceiling', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'GATE' }]),
            listGatedKeys: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        const publicLabel = await screen.findByLabelText(/^File \(up to [\d,]+ bytes\)$/);
        const publicCap = Number(publicLabel.labels[0].textContent.match(/[\d,]+/)[0].replace(/,/g, ''));
        fireEvent.change(screen.getByLabelText('File to publish'), {
            target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(publicLabel).toHaveValue('note.txt'));
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Members' } });
        fireEvent.click(screen.getByRole('button', { name: /^Memo\b/, expanded: false }));
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'October' } });

        fireEvent.click(screen.getByRole('radio', { name: 'Encrypted & token-gated' }));

        // One page: the same title, the Token field under Publish as, and
        // the draft carried through.
        await screen.findByRole('button', { name: /^Token:/ });
        expect(screen.getByRole('heading', { name: 'Publish File' })).toBeInTheDocument();
        expect(screen.getByLabelText('Title')).toHaveValue('Members');
        const gatedField = screen.getByLabelText(/^File \(up to [\d,]+ bytes\)$/);
        expect(gatedField).toHaveValue('note.txt');
        const gatedCap = Number(gatedField.labels[0].textContent.match(/[\d,]+/)[0].replace(/,/g, ''));
        expect(gatedCap).toBeLessThan(publicCap);
        expect(gatedCap).toBeGreaterThan(7000);
        expect(gatedCap).toBeLessThan(8192);
        fireEvent.click(screen.getByRole('button', { name: /^Memo\b/, expanded: false }));
        expect(screen.getByLabelText('Memo')).toHaveValue('October');

        fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
        expect(await screen.findByLabelText('Title')).toHaveValue('Members');
        expect(screen.getByLabelText(/^File \(up to [\d,]+ bytes\)$/)).toHaveValue('note.txt');
    });

    it('refuses on File a carried file that fits the public ceiling but not the gated one', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'GATE' }]),
            listGatedKeys: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );
        const capOf = (field) => Number(field.labels[0].textContent.match(/[\d,]+/)[0].replace(/,/g, ''));

        const publicCap = capOf(await screen.findByLabelText(/^File \(up to [\d,]+ bytes\)$/));
        fireEvent.click(screen.getByRole('radio', { name: 'Encrypted & token-gated' }));
        await screen.findByRole('button', { name: /^Token:/ });
        const gatedCap = capOf(screen.getByLabelText(/^File \(up to [\d,]+ bytes\)$/));
        // The label's ceiling is sized for a placeholder name, so the file
        // is made clearly larger than it rather than one byte over.
        const size = gatedCap + 100;
        expect(size).toBeLessThanOrEqual(publicCap);
        fireEvent.click(screen.getByRole('radio', { name: 'Public' }));

        fireEvent.change(await screen.findByLabelText('File to publish'), {
            target: { files: [new File([new Uint8Array(size)], 'big.bin', { type: 'application/octet-stream' })] },
        });
        await waitFor(() => expect(screen.getByLabelText(/^File \(up to [\d,]+ bytes\)$/)).toHaveValue('big.bin'));
        fireEvent.click(screen.getByRole('radio', { name: 'Encrypted & token-gated' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            new RegExp(`This file is ${size.toLocaleString()} bytes; an encrypted file can be at most [\\d,]+ bytes`),
        );
    });

    it('builds the unsigned gated publish from Encrypted mode in a watcher wallet with the carried draft', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'GATE' }]),
            listGatedKeys: vi.fn().mockResolvedValue([]),
            getTokenInfo: vi.fn().mockResolvedValue({ creator: ADDRESS.address, divisibility: 8 }),
            buildGatedPublishPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff' }),
            composeGatedPublishForConfirm: vi.fn(),
        };
        watcherWallet();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        fireEvent.change(await screen.findByLabelText('File to publish'), {
            target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('note.txt'));
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Members' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Encrypted & token-gated' }));
        const tokenField = await screen.findByRole('button', { name: /^Token:/ });
        await waitFor(() => expect(tokenField).toBeEnabled());
        fireEvent.click(tokenField);
        fireEvent.click(await screen.findByRole('listitem'));
        await screen.findByRole('button', { name: /^Token: GATE/ });

        fireEvent.click(screen.getByRole('button', { name: /^Create transaction for signing$/i }));
        await waitFor(() => expect(messaging.buildGatedPublishPsbtRequest).toHaveBeenCalledTimes(1));
        expect(messaging.buildGatedPublishPsbtRequest).toHaveBeenCalledWith(expect.objectContaining({
            gateTicker: 'GATE',
            name: 'note.txt',
            title: 'Members',
        }));
        expect(messaging.composeGatedPublishForConfirm).not.toHaveBeenCalled();
    });

    it('marks Token when Encrypted is published with no token, then composes for the confirm screen', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
            getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'GATE' }]),
            listGatedKeys: vi.fn().mockResolvedValue([]),
            getTokenInfo: vi.fn().mockResolvedValue({ creator: ADDRESS.address, divisibility: 8 }),
            composeGatedPublishForConfirm: vi.fn().mockRejectedValue(new Error('Encoder offline')),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        fireEvent.change(await screen.findByLabelText('File to publish'), {
            target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('note.txt'));
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Members' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Encrypted & token-gated' }));
        const tokenField = await screen.findByRole('button', { name: /^Token:/ });
        await waitFor(() => expect(tokenField).toBeEnabled());

        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        expect(await screen.findByText('Pick the token whose holders can unlock this file.')).toBeInTheDocument();
        expect(messaging.composeGatedPublishForConfirm).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /^Token:/ }));
        fireEvent.click(await screen.findByRole('listitem'));
        expect(await screen.findByRole('button', { name: /^Token: GATE/ })).toBeInTheDocument();
        expect(screen.queryByText('Pick the token whose holders can unlock this file.')).toBeNull();

        // The same Publish File press goes straight to the confirm compose
        // with the draft typed before the switch; there is no second page.
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        await waitFor(() => expect(messaging.composeGatedPublishForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeGatedPublishForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            gateTicker: 'GATE',
            name: 'note.txt',
            title: 'Members',
        }));
    });

    it('returns from review without submitting the compose form again', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };
        watcherWallet();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        const fileInput = await screen.findByLabelText('File to publish');
        fireEvent.change(fileInput, {
            target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('note.txt'));
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        expect(await screen.findByRole('form', { name: 'Review publish' })).toBeTruthy();
        const reviewAction = screen.getByRole('button', { name: 'Create Unsigned Transaction' });
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
        watcherWallet();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );
        const fileInput = await screen.findByLabelText('File to publish');
        fireEvent.change(fileInput, {
            target: { files: [new File(['hello'], 'note.txt', { type: 'text/plain' })] },
        });
        await waitFor(() => expect(document.body.textContent).toContain('note.txt'));
        fireEvent.click(screen.getByRole('button', { name: 'Publish File' }));
        const review = await screen.findByRole('form', { name: 'Review publish' });

        act(() => {
            publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode: 'full' }], activeWalletId: 'wallet-1' });
        });
        await screen.findByRole('button', { name: 'Sign and Publish' });
        fireEvent.submit(review);

        await waitFor(() => expect(document.body.textContent).toMatch(/confirm screen/i));
        expect(messaging.fileAction).not.toHaveBeenCalled();
        expect(messaging.fileActionHw).not.toHaveBeenCalled();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});
