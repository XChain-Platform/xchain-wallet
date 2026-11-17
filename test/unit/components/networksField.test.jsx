// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// G117: a multi-network choice is one picker field that shows the selection and
// opens a picker page; forms never list every network inline. Covers the
// NetworksField states (none, one, many, the count form) and a round trip
// through NetworksPickerScreen with a host that owns the selection.

import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import {
    NETWORKS_FIELD_NAMES_BUDGET,
    NetworksField,
    networksFieldText,
} from '../../../packages/core/src/shared/components/NetworksField.jsx';
import { NetworksPickerScreen } from '../../../packages/core/src/shared/components/NetworksPickerScreen.jsx';

afterEach(cleanup);

const OPTIONS = [
    { value: 'BTC', chainId: 'bitcoin-mainnet', title: 'Bitcoin', ticker: 'BTC', description: 'BTC · Mainnet' },
    { value: 'DOGE', chainId: 'dogecoin-mainnet', title: 'Dogecoin', ticker: 'DOGE', description: 'DOGE · Mainnet' },
    { value: 'LTC', chainId: 'litecoin-mainnet', title: 'Litecoin', ticker: 'LTC', description: 'LTC · Mainnet' },
];

function renderField(selected, extra = {}) {
    const onOpenPicker = vi.fn();
    render(
        <NetworksField
            label="Destination networks"
            help="Where a copy can go."
            options={OPTIONS}
            selected={selected}
            placeholder="None set"
            onOpenPicker={onOpenPicker}
            {...extra}
        />,
    );
    return { onOpenPicker, field: screen.getByRole('button', { name: /^Destination networks: / }) };
}

describe('NetworksField', () => {
    it('reads None set when nothing is chosen', () => {
        const { field } = renderField([]);
        expect(field).toHaveAccessibleName('Destination networks: None set');
        expect(field).toHaveTextContent('None set');
        expect(field.querySelectorAll('[data-network-value]')).toHaveLength(0);
    });

    it('shows one chosen network as its icon and name, with the list icon at the end', () => {
        const { field } = renderField(['LTC']);
        expect(field).toHaveAccessibleName('Destination networks: Litecoin');
        const rows = field.querySelectorAll('[data-network-value]');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveTextContent('Litecoin');
        expect(rows[0].querySelector('img')).toBeTruthy();
        // The trailing list icon, as on every picker field.
        expect(field.lastElementChild?.querySelector('svg')).toBeTruthy();
    });

    it('shows two short names as icons and names, in the options order', () => {
        const { field } = renderField(['LTC', 'BTC']);
        expect(field).toHaveAccessibleName('Destination networks: Bitcoin, Litecoin');
        const rows = [...field.querySelectorAll('[data-network-value]')];
        expect(rows.map((row) => row.getAttribute('data-network-value'))).toEqual(['BTC', 'LTC']);
        expect(field.querySelector('[data-networks-summary]')).toBeNull();
    });

    // Operator 2026-11-15: past the names budget the field shows the chosen
    // networks' icons (at most five, then "+N more"; see
    // NetworksField.iconCap.test.jsx), while the name still lists them all.
    it('switches to the icon form once the names pass the budget', () => {
        expect('Bitcoin, Dogecoin, Litecoin'.length).toBeGreaterThan(NETWORKS_FIELD_NAMES_BUDGET);
        const { field } = renderField(['BTC', 'DOGE', 'LTC']);
        const summary = field.querySelector('[data-networks-summary]');
        expect(summary).toBeTruthy();
        expect(summary.getAttribute('title')).toBe('3 networks: Bitcoin, Dogecoin, Litecoin');
        expect([...field.querySelectorAll('[data-network-value]')].map((el) => el.getAttribute('data-network-value')))
            .toEqual(['BTC', 'DOGE', 'LTC']);
        expect(field.querySelector('[data-networks-more]')).toBeNull();
        expect(field).toHaveAccessibleName('Destination networks: Bitcoin, Dogecoin, Litecoin');
    });

    it('ignores a stored value no option offers', () => {
        const { field } = renderField(['ltc']);
        expect(field).toHaveAccessibleName('Destination networks: None set');
    });

    it('opens the picker on a press and not while disabled', () => {
        const { onOpenPicker, field } = renderField(['BTC']);
        fireEvent.click(field);
        expect(onOpenPicker).toHaveBeenCalledTimes(1);
        cleanup();
        const disabled = renderField(['BTC'], { disabled: true });
        expect(disabled.field).toBeDisabled();
        fireEvent.click(disabled.field);
        expect(disabled.onOpenPicker).not.toHaveBeenCalled();
    });

    it('keeps its text rule free of layout', () => {
        expect(networksFieldText([])).toEqual({ text: '', summary: false });
        expect(networksFieldText(['Bitcoin'])).toEqual({ text: 'Bitcoin', summary: false });
        expect(networksFieldText(['Bitcoin', 'Litecoin'])).toEqual({ text: 'Bitcoin, Litecoin', summary: false });
        expect(networksFieldText(['Bitcoin', 'Dogecoin', 'Litecoin']).summary).toBe(true);
    });
});

function Host() {
    const [picks, setPicks] = useState(/** @type {string[]} */ (['BTC']));
    const [open, setOpen] = useState(false);
    if (open) {
        return (
            <NetworksPickerScreen
                title="Destination Networks"
                options={OPTIONS}
                selected={picks}
                onToggle={(value, on) => setPicks((prev) => (on
                    ? [...new Set([...prev, value])]
                    : prev.filter((v) => v !== value)))}
                onBack={() => setOpen(false)}
            />
        );
    }
    return (
        <NetworksField
            label="Destination networks"
            options={OPTIONS}
            selected={picks}
            placeholder="None set"
            onOpenPicker={() => setOpen(true)}
        />
    );
}

describe('NetworksPickerScreen round trip', () => {
    it('lists every network as a switch row and returns the new choice to the field', () => {
        render(<Host />);
        fireEvent.click(screen.getByRole('button', { name: 'Destination networks: Bitcoin' }));

        expect(screen.getByRole('heading', { name: 'Destination Networks' })).toBeInTheDocument();
        const list = screen.getByRole('group', { name: 'Destination Networks' });
        const switches = within(list).getAllByRole('switch');
        expect(switches).toHaveLength(3);
        expect(within(list).getByLabelText('Bitcoin')).toBeChecked();
        expect(within(list).getByLabelText('Dogecoin')).not.toBeChecked();
        expect(within(list).getByText('LTC · Mainnet')).toBeInTheDocument();
        // Each row draws the network's mark beside its name.
        for (const input of switches) {
            expect(input.closest('label').querySelector('[aria-hidden="true"]')).toBeTruthy();
        }

        fireEvent.click(within(list).getByLabelText('Bitcoin'));
        fireEvent.click(within(list).getByLabelText('Litecoin'));
        expect(within(list).getByLabelText('Bitcoin')).not.toBeChecked();
        expect(within(list).getByLabelText('Litecoin')).toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByRole('button', { name: 'Destination networks: Litecoin' })).toBeInTheDocument();
    });

    it('keeps every switch disabled when the host disables the choice', () => {
        render(
            <NetworksPickerScreen
                title="Destination Networks"
                options={OPTIONS}
                selected={[]}
                disabled
                onToggle={vi.fn()}
                onBack={vi.fn()}
            />,
        );
        for (const input of screen.getAllByRole('switch')) expect(input).toBeDisabled();
    });
});
