// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Opening Issue token fills the network, source and switch values on its
// own, so the autosave always had something to write. An untouched visit
// left a draft behind, the next visit offered it back with a Restore banner,
// and while that banner waits the form does not autosave, so what the user
// typed next was lost to the first lock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';

const ADDRESSES = {
    'bitcoin-regtest': [{
        id: 'addr-1',
        address: 'bcrt1qexampleexampleexampleexampleexample0',
        publicKey: '02ab',
        derivationPath: "m/84'/1'/0'/0/0",
        source: 'hd',
    }],
};

function mount() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', network: 'regtest' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listContacts: vi.fn().mockResolvedValue([]),
    };
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(IssueTokenForm, { walletId: 'w-empty', onBack() {} }),
    ));
}

const draftKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('xc:formdraft:issue-token:'));

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('Issue token draft with nothing typed', () => {
    it('saves nothing for an untouched form and offers nothing on the next visit', async () => {
        mount();
        await screen.findByLabelText('From');
        // Let the source pick and the autosave settle.
        await new Promise((r) => setTimeout(r, 50));
        expect(draftKeys()).toEqual([]);

        cleanup();
        mount();
        await screen.findByLabelText('From');
        expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    });

    it('saves what is typed after an untouched visit, so a lock cannot lose it', async () => {
        mount();
        await screen.findByLabelText('From');
        await new Promise((r) => setTimeout(r, 50));
        cleanup();

        mount();
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'KEPT' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '77' } });
        await waitFor(() => expect(draftKeys()).toHaveLength(1));
        cleanup();

        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
        expect(screen.getByLabelText('Ticker').value).toBe('KEPT');
        expect(screen.getByLabelText('Supply').value).toBe('77');
    });

    it('drops the draft when the typed values are cleared again', async () => {
        mount();
        const ticker = await screen.findByLabelText('Ticker');
        fireEvent.change(ticker, { target: { value: 'GONE' } });
        await waitFor(() => expect(draftKeys()).toHaveLength(1));
        fireEvent.change(ticker, { target: { value: '' } });
        await waitFor(() => expect(draftKeys()).toEqual([]));
    });
});
