// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every state of the Broadcast screen lays out through the FormPage template:
// the address-load error is FormPage's status with the kind picker as its
// body, the loading line sits inside a FormPage, and both result panels (a
// token broadcast and a raw signed transaction, sent or queued) render inside
// a FormPage too. None of them draws straight into the bare Screen.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';

const CHAIN = 'litecoin-regtest';
const ADDRESSES = {
    [CHAIN]: [
        {
            id: 'addr-ltc',
            address: 'rltc1qexampleexampleexampleexampleexampleex',
            publicKey: '02cd',
            derivationPath: "m/84'/2'/0'/0/0",
            source: 'hd',
        },
    ],
};
const LEGACY_TX = '0200000001aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03000000474830450221001111111111111111111111111111111111111111111111111111111111110121023333333333333333333333333333333333333333333333333333333333333333fdffffff0240e20100000000001976a914444444444444444444444444444444444444444488ac00000000000000001c6a1a58434841494eabababababababababababababababababababab00000000';

let composeForConfirm;
let broadcastAction;
let broadcastSignedTxRequest;

function mountForm({ getAddressesByChain } = {}) {
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    broadcastAction = vi.fn().mockResolvedValue({ txid: 'deadbeef' });
    broadcastSignedTxRequest = vi.fn().mockResolvedValue({ txid: 'deadbeef' });
    const target = {
        getAddressesByChain: getAddressesByChain || vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getTokenInfo: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        broadcastAction,
        broadcastSignedTxRequest,
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BroadcastForm walletId="w" initialChainId={CHAIN} onBack={() => {}} />
        </MessagingProvider>,
    );
    return container;
}

/** The FormPage root (a form, or a labelled group for a div FormPage) that holds the node. */
function formPageOf(node) {
    return node.closest('form, [role="group"][aria-label]');
}

async function openRawTransaction() {
    fireEvent.click(await screen.findByRole('radio', { name: 'Signed transaction' }));
    fireEvent.change(screen.getByLabelText('Signed transaction code'), { target: { value: LEGACY_TX } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview transaction' }));
    await screen.findByText(/spends 1 input/);
}

afterEach(cleanup);

describe('BroadcastForm lays out every page state through FormPage', () => {
    it('puts the loading line inside a FormPage', () => {
        const container = mountForm({ getAddressesByChain: () => new Promise(() => {}) });
        const loading = Array.from(container.querySelectorAll('p')).find((p) => p.textContent.includes('Loading'));
        expect(loading).toBeTruthy();
        const page = formPageOf(loading);
        expect(page).not.toBeNull();
        expect(page.getAttribute('aria-label')).toBe('Broadcast');
    });

    it('shows the address-load error as the FormPage status with the kind picker as its body', async () => {
        const container = mountForm({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) });
        await waitFor(() => expect(container.querySelector('[data-form-status]')).not.toBeNull());
        const status = container.querySelector('[data-form-status]');
        expect(status.textContent).toContain('Address store unavailable');
        const page = formPageOf(status);
        expect(page).not.toBeNull();
        expect(page.contains(screen.getByRole('radio', { name: 'Signed transaction' }))).toBe(true);
    });

    it('puts the token broadcast result and its Done action inside a FormPage', async () => {
        mountForm();
        fireEvent.change(await screen.findByLabelText(/^Message/), { target: { value: 'hello chain' } });
        fireEvent.click(screen.getByRole('button', { name: 'Broadcast' }));
        await screen.findByTestId('confirm-modal');
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test password' } });
        const approve = screen.getByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        const title = await screen.findByRole('heading', { name: 'Broadcast pending' });
        const page = formPageOf(title);
        expect(page).not.toBeNull();
        expect(page.getAttribute('aria-label')).toBe('Broadcast result');
        expect(page.textContent).toContain('deadbeef');
        expect(page.contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
    });

    it('puts the raw transaction result and its Done action inside a FormPage', async () => {
        mountForm();
        await openRawTransaction();
        fireEvent.click(screen.getByRole('button', { name: 'Broadcast transaction' }));
        const title = await screen.findByRole('heading', { name: 'Broadcast pending' });
        const page = formPageOf(title);
        expect(page).not.toBeNull();
        expect(page.getAttribute('aria-label')).toBe('Broadcast result');
        expect(page.contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
        expect(screen.getAllByRole('status')).toHaveLength(1);
    });

    it('puts the queued raw transaction result inside a FormPage', async () => {
        mountForm();
        await openRawTransaction();
        broadcastSignedTxRequest.mockResolvedValueOnce({ queued: true, persisted: true });
        fireEvent.click(screen.getByRole('button', { name: 'Broadcast transaction' }));
        const done = await screen.findByRole('button', { name: 'Done' });
        const page = formPageOf(done);
        expect(page).not.toBeNull();
        expect(page.getAttribute('aria-label')).toBe('Broadcast result');
    });
});
