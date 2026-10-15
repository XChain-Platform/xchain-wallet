// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The address fields put Paste inside the field by ruling. AddressField
// takes the same in-field Paste as Send's recipient field (AddressCombobox):
// the same clipboard check, the host's onPaste first, then onChange. The
// New contact form's address field had none.

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';
import { AddressField } from '../../../packages/core/src/ui/AddressField.jsx';

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

afterEach(() => {
    cleanup();
    delete navigator.clipboard;
});

describe('AddressField in-field Paste', () => {
    function Harness({ onChange = () => {}, ...props }) {
        const [value, setValue] = useState('');
        return (
            <AddressField
                label="Address"
                paste
                value={value}
                onChange={(event) => { setValue(event.target.value); onChange(event.target.value); }}
                {...props}
            />
        );
    }

    it('sets the field through onChange with the trimmed clipboard text', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: vi.fn().mockResolvedValue('\n bc1qclipboard \t') },
        });
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
        await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue('bc1qclipboard'));
        expect(onChange).toHaveBeenCalledWith('bc1qclipboard');
    });

    it('refuses text with hidden characters and shows why on the field', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: vi.fn().mockResolvedValue('bc1q‮evil') },
        });
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
        expect(await screen.findByText('Pasted text contains hidden characters. Check it and try again.')).toBeTruthy();
        expect(screen.getByLabelText('Address')).toHaveValue('');
    });

    it('lets the host consume the paste first, as Send does for payment links', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: vi.fn().mockResolvedValue('bitcoin:bc1qfromuri') },
        });
        const onChange = vi.fn();
        const onPaste = vi.fn((event) => event.preventDefault());
        render(<Harness onChange={onChange} onPaste={onPaste} />);
        fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
        await waitFor(() => expect(onPaste).toHaveBeenCalledOnce());
        expect(onPaste.mock.calls[0][0].clipboardData.getData()).toBe('bitcoin:bc1qfromuri');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows no Paste on a read-only field or when not asked for', () => {
        render(
            <>
                <AddressField label="From" paste readOnly value={BTC} onChange={() => {}} />
                <AddressField label="Plain" value="" onChange={() => {}} />
            </>,
        );
        expect(screen.queryByRole('button', { name: 'Paste from clipboard' })).toBeNull();
    });
});

describe('New contact', () => {
    const messaging = {
        listContacts: vi.fn(async () => []),
        saveContact: vi.fn(),
        deleteContact: vi.fn(),
    };

    it('gives the New contact address field the in-field Paste', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: vi.fn().mockResolvedValue(`  ${BTC}\n`) },
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ContactsList walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Create first contact' }));
        await screen.findByRole('heading', { level: 1, name: 'New contact' });
        fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
        await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue(BTC));
        // The pasted value runs the same network detection as typing it.
        expect(screen.getByText(/Bitcoin/)).toBeTruthy();
    });
});
