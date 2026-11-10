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
// the address-load error, loading line, and message result all render inside
// a FormPage. None of them draws straight into the bare Screen.

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
let composeForConfirm;
let broadcastAction;

function mountForm({ getAddressesByChain } = {}) {
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    broadcastAction = vi.fn().mockResolvedValue({ txid: 'deadbeef' });
    const target = {
        getAddressesByChain: getAddressesByChain || vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        broadcastAction,
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

    it('shows the address-load error as the FormPage status', async () => {
        const container = mountForm({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) });
        await waitFor(() => expect(container.querySelector('[data-form-status]')).not.toBeNull());
        const status = container.querySelector('[data-form-status]');
        expect(status.textContent).toContain('Address store unavailable');
        const page = formPageOf(status);
        expect(page).not.toBeNull();
        expect(screen.queryByText('What do you want to broadcast?')).toBeNull();
    });

    it('puts the message broadcast result and its Done action inside a FormPage', async () => {
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

});
