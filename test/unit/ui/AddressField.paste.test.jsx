// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Address fields rely on the native paste event. The host's onPaste handler
// runs first, then unconsumed text is normalized through onChange.

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
                value={value}
                onChange={(event) => { setValue(event.target.value); onChange(event.target.value); }}
                {...props}
            />
        );
    }

    it('sets the field through onChange with trimmed native paste text', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.paste(screen.getByLabelText('Address'), {
            clipboardData: { getData: () => '\n bc1qclipboard \t' },
        });
        expect(screen.getByLabelText('Address')).toHaveValue('bc1qclipboard');
        expect(onChange).toHaveBeenCalledWith('bc1qclipboard');
    });

    it('refuses native paste text with hidden characters and shows why on the field', () => {
        render(<Harness />);
        fireEvent.paste(screen.getByLabelText('Address'), {
            clipboardData: { getData: () => 'bc1q‮evil' },
        });
        expect(screen.getByText('Pasted text contains hidden characters. Check it and try again.')).toBeTruthy();
        expect(screen.getByLabelText('Address')).toHaveValue('');
    });

    it('lets the host consume the native paste first, as Send does for payment links', () => {
        const onChange = vi.fn();
        const onPaste = vi.fn((event) => event.preventDefault());
        render(<Harness onChange={onChange} onPaste={onPaste} />);
        fireEvent.paste(screen.getByLabelText('Address'), {
            clipboardData: { getData: () => 'bitcoin:bc1qfromuri' },
        });
        expect(onPaste).toHaveBeenCalledOnce();
        expect(onPaste.mock.calls[0][0].clipboardData.getData('text')).toBe('bitcoin:bc1qfromuri');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows no Paste button on editable or read-only fields', () => {
        render(
            <>
                <AddressField label="From" readOnly value={BTC} onChange={() => {}} />
                <AddressField label="Plain" value="" onChange={() => {}} />
            </>,
        );
        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('New contact', () => {
    const messaging = {
        listContacts: vi.fn(async () => []),
        saveContact: vi.fn(),
        deleteContact: vi.fn(),
    };

    it('accepts native paste in the New contact address field', async () => {
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ContactsList walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Create first contact' }));
        await screen.findByRole('heading', { level: 1, name: 'New contact' });
        fireEvent.paste(screen.getByLabelText('Address'), {
            clipboardData: { getData: () => `  ${BTC}\n` },
        });
        expect(screen.getByLabelText('Address')).toHaveValue(BTC);
        // The pasted value runs the same network detection as typing it.
        expect(screen.getByText(/Bitcoin/)).toBeTruthy();
    });
});
