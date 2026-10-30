// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The To field's dropdown renders at most 50 contact suggestions, so a large
// address book does not put thousands of options on screen on focus and on
// every keystroke. Recent sends after the contacts stay listed, and typing
// still reaches any contact.

import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddressCombobox } from '../../../packages/core/src/ui/AddressCombobox.jsx';

const contacts = Array.from({ length: 5000 }, (_, i) => ({
    address: `bc1qcontact${String(i).padStart(5, '0')}`,
    label: `Person ${String(i).padStart(5, '0')}`,
    source: 'contact',
}));
const recent = [
    { address: 'bc1qrecentone', label: 'bc1qre...ntone', sublabel: 'Previously sent', source: 'history' },
    { address: 'bc1qrecenttwo', label: 'bc1qre...nttwo', sublabel: 'Sent 2 times', source: 'history' },
];

function Field() {
    const [value, setValue] = useState('');
    return (
        <AddressCombobox
            label="To"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            suggestions={[...contacts, ...recent]}
        />
    );
}

describe('<AddressCombobox> with a large address book', () => {
    it('lists 50 contacts and every recent send when the empty field opens', () => {
        render(<Field />);
        const input = screen.getByLabelText('To');
        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: 'ArrowDown' });

        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(52);
        expect(options[49]).toHaveTextContent('Person 00049');
        expect(options[50]).toHaveTextContent('bc1qre...ntone');
        expect(options[51]).toHaveTextContent('bc1qre...nttwo');
    });

    it('reaches a contact past the first 50 by typing', () => {
        render(<Field />);
        const input = screen.getByLabelText('To');
        fireEvent.change(input, { target: { value: 'Person 04999' } });

        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(1);
        expect(options[0]).toHaveTextContent('Person 04999');
    });

    it('caps a broad query at 50 contacts', () => {
        render(<Field />);
        const input = screen.getByLabelText('To');
        fireEvent.change(input, { target: { value: 'person' } });

        expect(screen.getAllByRole('option')).toHaveLength(50);
    });
});
