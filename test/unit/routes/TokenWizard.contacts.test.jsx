// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Issue Token form's two recipient fields (new owner, initial mint
// destination) each open the address book, and a picked entry fills the field
// that opened it, never the other one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
// The Create a token route: TokenWizard renders the one Issue Token form.
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

// The address book button of the field inside the section `title`, opening
// that section first (closed sections hide their buttons).
function addressBookIn(title) {
    const header = screen.getByRole('button', { name: new RegExp(`^${title}`) });
    if (header.getAttribute('aria-expanded') !== 'true') fireEvent.click(header);
    const section = header.closest('[data-form-section]');
    return within(section).getByRole('button', { name: 'Open address book' });
}

describe('Issue Token recipient fields', () => {
    it('fills each recipient field from the address book', async () => {
        const messaging = mountWizard();
        await screen.findByLabelText('Ticker');
        await waitFor(() => expect(messaging.listContacts).toHaveBeenCalled());

        fireEvent.click(addressBookIn('Transfer ownership'));
        fireEvent.click(await screen.findByText('Alice'));
        expect(await screen.findByLabelText('New owner address')).toHaveValue(OWNER);

        fireEvent.click(addressBookIn('Initial mint'));
        fireEvent.click(await screen.findByText('Bob'));
        expect(await screen.findByLabelText('Send initial mint to')).toHaveValue(HOLDER);
        expect(screen.getByLabelText('New owner address')).toHaveValue(OWNER);
    });
});
