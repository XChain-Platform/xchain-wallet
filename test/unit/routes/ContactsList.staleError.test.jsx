// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A Save error describes the form as it was submitted. On the phone "Name is
// required." stayed under a name the user had since typed.

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';

const messaging = {
    listContacts: () => Promise.resolve([]),
    saveContact: () => Promise.resolve(),
    deleteContact: () => Promise.resolve(),
};

describe('ContactsList new-contact form', () => {
    it('clears the Save error once the user edits the form', async () => {
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ContactsList walletId="w1" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByText(/No contacts yet/)).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /add contact|new contact|^\+$/i }));
        fireEvent.click(await screen.findByRole('button', { name: /save/i }));
        expect(await screen.findByText('Name is required.')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Contact' } });
        await waitFor(() => expect(screen.queryByText('Name is required.')).toBeNull());
    });
});
