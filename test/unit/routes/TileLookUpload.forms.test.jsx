// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Edit Account, Edit Wallet and Add Account each take an uploaded icon image:
// picking a PNG in the Icon image field shows it on the preview tile, a second
// pick replaces it, X removes it, and saving stores the image with the look.
// jsdom has no image decoder or canvas, so the 64x64 scale is stubbed to a
// fixed data URL per file name.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

vi.mock('../../../packages/core/src/shared/routes/SignerSelectForm.jsx', () => ({
    SignerSelectForm: () => null,
}));

const { RenameAccountForm } = await import('../../../packages/core/src/shared/routes/RenameAccountForm.jsx');
const { RenameWalletForm } = await import('../../../packages/core/src/shared/routes/RenameWalletForm.jsx');
const { AddAccountForm } = await import('../../../packages/core/src/shared/routes/AddAccountForm.jsx');
const { readWalletTile } = await import('../../../packages/core/src/shared/utils/walletTile.js');

// The stubbed canvas returns a data URL naming the last drawn file.
let lastObjectUrl = '';
const scaledFor = (name) => `data:image/png;base64,${btoa(`scaled:${name}`)}`;

class FakeImage {
    constructor() { this.onload = null; this.onerror = null; this.naturalWidth = 0; this.naturalHeight = 0; }
    set src(url) {
        this._src = url;
        this.naturalWidth = 200; this.naturalHeight = 100;
        setTimeout(() => this.onload?.(), 0);
    }
    get src() { return this._src; }
}

beforeEach(() => {
    vi.stubGlobal('Image', FakeImage);
    URL.createObjectURL = vi.fn((file) => { lastObjectUrl = `blob:${file.name}`; return lastObjectUrl; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => scaledFor(lastObjectUrl.slice(5)));
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
});

const png = (name) => new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, { type: 'image/png' });

function pick(file) {
    fireEvent.change(screen.getByLabelText('Icon image file'), { target: { files: [file] } });
}

function previewSrc() {
    const img = document.querySelector('[data-xc-avatar] img');
    return img ? img.getAttribute('src') : null;
}

// Uploads one image (the look fields are always shown), replaces it with a
// second, removes it, and uploads the second again; the preview follows each step.
async function uploadReplaceRemove() {
    expect(screen.getByRole('button', { name: 'Choose an image' })).toBeEnabled();
    expect(previewSrc()).toBeNull();

    pick(png('first.png'));
    await waitFor(() => expect(previewSrc()).toBe(scaledFor('first.png')));
    const field = screen.getByLabelText(/^Icon image/, { selector: 'input:not([type="file"])' });
    expect(field).toHaveValue('Image set');

    // With an image set there is no separate Replace button: the field's own X
    // clears and a click on the field replaces.
    expect(screen.queryByRole('button', { name: 'Replace Image' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload Image' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeEnabled();
    pick(png('second.png'));
    await waitFor(() => expect(previewSrc()).toBe(scaledFor('second.png')));

    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    await waitFor(() => expect(previewSrc()).toBeNull());
    expect(field).toHaveValue('');

    pick(png('second.png'));
    await waitFor(() => expect(previewSrc()).toBe(scaledFor('second.png')));
}

describe('Edit Account icon image', () => {
    beforeEach(() => {
        messaging = {
            listAccounts: vi.fn().mockResolvedValue([{ id: 'account-1', name: 'Primary account' }]),
            renameAccount: vi.fn().mockResolvedValue({ account: { id: 'account-1', name: 'Primary account' } }),
        };
    });

    it('uploads, replaces and removes an image on the preview, and Save stores it', async () => {
        const onRenamed = vi.fn();
        const { unmount } = render(
            <RenameAccountForm accountId="account-1" walletId="wallet-1" initialName="Primary account" onBack={() => {}} onRenamed={onRenamed} />,
        );
        await uploadReplaceRemove();

        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(onRenamed).toHaveBeenCalled());
        expect(readWalletTile('account-1')).toEqual({ colour: '#7B2C8F', image: scaledFor('second.png'), shape: 'circle' });

        // The next open shows the saved image.
        unmount();
        render(<RenameAccountForm accountId="account-1" walletId="wallet-1" initialName="Primary account" onBack={() => {}} onRenamed={() => {}} />);
        expect(previewSrc()).toBe(scaledFor('second.png'));
    });
});

describe('Edit Wallet icon image', () => {
    beforeEach(() => {
        messaging = {
            listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Primary wallet' }]),
            listAccounts: vi.fn().mockResolvedValue([]),
            renameWallet: vi.fn().mockResolvedValue({ wallet: { id: 'wallet-1', name: 'Primary wallet' } }),
        };
    });

    it('uploads, replaces and removes an image on the preview, and Save stores it', async () => {
        const onRenamed = vi.fn();
        render(<RenameWalletForm walletId="wallet-1" initialName="Primary wallet" onBack={() => {}} onRenamed={onRenamed} />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' }).disabled).toBe(false));
        await uploadReplaceRemove();

        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(messaging.renameWallet).toHaveBeenCalled());
        expect(readWalletTile('wallet-1')).toEqual({ colour: '#7B2C8F', image: scaledFor('second.png'), shape: 'circle' });
    });
});

describe('Add Account icon image', () => {
    beforeEach(() => {
        messaging = {
            listAccounts: vi.fn().mockResolvedValue([]),
            createAccount: vi.fn().mockResolvedValue({ account: { id: 'account-new', name: 'Account 1' }, addresses: [] }),
        };
    });

    it('uploads, replaces and removes an image on the preview, and Add stores it on the new account', async () => {
        const onCreated = vi.fn();
        render(<AddAccountForm walletId="wallet-1" onBack={() => {}} onCreated={onCreated} />);
        await uploadReplaceRemove();

        fireEvent.submit(screen.getByLabelText('Account name', { selector: 'input' }).closest('form'));
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'account-new', name: 'Account 1' }));
        expect(readWalletTile('account-new')).toEqual({ colour: '#7B2C8F', image: scaledFor('second.png'), shape: 'circle' });
    });
});
