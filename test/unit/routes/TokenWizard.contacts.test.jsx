// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wizard's two recipient fields open the address book exactly as the same
// fields on Issue token do, and a picked entry fills the field that opened it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

const OWNER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const HOLDER = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const ADDRESSES = {
    'bitcoin-mainnet': [{
        id: 'addr-1',
        address: 'bc1qexampleexampleexampleexampleexampleex',
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
};

afterEach(() => cleanup());

function mountWizard() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 900000 }),
        getTokenInfo: vi.fn().mockResolvedValue({ divisibility: null }),
        listContacts: vi.fn().mockResolvedValue([
            { name: 'Alice', entries: [{ address: OWNER }] },
            { name: 'Bob', entries: [{ address: HOLDER }] },
        ]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenWizard walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

async function openCustomDetails() {
    fireEvent.click(await screen.findByText('Custom'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByLabelText('Token name (ticker)')).toBeTruthy());
}


describe('TokenWizard recipient fields', () => {
    it('fills each recipient field from the address book', async () => {
        const messaging = mountWizard();
        await openCustomDetails();
        await waitFor(() => expect(messaging.listContacts).toHaveBeenCalled());

        expect(screen.getAllByRole('button', { name: 'Open address book' })).toHaveLength(2);

        fireEvent.click(screen.getAllByRole('button', { name: 'Open address book' })[0]);
        fireEvent.click(await screen.findByText('Alice'));
        expect(await screen.findByLabelText('Transfer ownership to (optional)')).toHaveValue(OWNER);

        fireEvent.click(screen.getAllByRole('button', { name: 'Open address book' })[1]);
        fireEvent.click(await screen.findByText('Bob'));
        expect(await screen.findByLabelText('Send the initial mint to (optional)')).toHaveValue(HOLDER);
        expect(screen.getByLabelText('Transfer ownership to (optional)')).toHaveValue(OWNER);
    });
});
