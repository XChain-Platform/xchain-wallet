// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G122: a fiat currency is chosen with the Fiat currency field and its picker
// page (code, full name and a description line per row, with a search), never
// a dropdown, and the label always says Fiat currency.

import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FiatCurrencyField } from '../../../packages/core/src/shared/components/FiatCurrencyField.jsx';
import { FiatCurrencyPicker } from '../../../packages/core/src/shared/components/FiatCurrencyPicker.jsx';
import { FIAT_CURRENCIES } from '../../../packages/core/src/shared/components/settings/LanguageRegionSection.jsx';
import {
    PROTOCOL_FIAT_CODES,
    fiatCurrencies,
    fiatCurrency,
} from '../../../packages/core/src/shared/utils/fiatCurrencies.js';

afterEach(cleanup);

describe('fiat currency catalog', () => {
    it('names every Settings display currency exactly as Settings does', () => {
        for (const { code, name } of FIAT_CURRENCIES) {
            expect(fiatCurrency(code)?.name, code).toBe(name);
        }
    });

    it('knows every protocol currency, with a name and a description', () => {
        expect(PROTOCOL_FIAT_CODES).toEqual(['USD', 'CAD', 'AUD', 'MXN', 'GBP', 'JPY', 'CNY', 'CHF', 'BRL', 'INR', 'EUR', 'KRW']);
        for (const entry of fiatCurrencies(PROTOCOL_FIAT_CODES)) {
            expect(entry.name, entry.code).not.toBe(entry.code);
            expect(entry.description, entry.code).toBeTruthy();
        }
    });
});

describe('FiatCurrencyField', () => {
    it('is labelled Fiat currency and shows the chosen code, name and symbol', () => {
        render(<FiatCurrencyField value="EUR" onOpenPicker={() => {}} />);
        expect(screen.getByText('Fiat currency')).toBeInTheDocument();
        const field = screen.getByRole('button', { name: 'Fiat currency: EUR, Euro' });
        expect(field).toHaveTextContent('EUR');
        expect(field).toHaveTextContent('Euro');
        expect(field).toHaveTextContent('€');
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('opens the picker on tap, and an optional empty field shows its placeholder', () => {
        const onOpenPicker = vi.fn();
        render(<FiatCurrencyField value="" optional placeholder="None, coin-paid" onOpenPicker={onOpenPicker} />);
        const field = screen.getByRole('button', { name: 'Fiat currency: None, coin-paid' });
        expect(screen.getByText('Optional')).toBeInTheDocument();
        fireEvent.click(field);
        expect(onOpenPicker).toHaveBeenCalledOnce();
    });
});

describe('FiatCurrencyPicker', () => {
    function openSearch() {
        fireEvent.click(screen.getByRole('button', { name: 'Filter currencies' }));
        return screen.getByRole('searchbox', { name: 'Search currencies' });
    }

    it('lists each currency with its code, full name and a description line', () => {
        render(<FiatCurrencyPicker codes={PROTOCOL_FIAT_CODES} value="USD" onSelect={() => {}} onBack={() => {}} />);
        expect(screen.getByRole('heading', { name: 'Select Currency' })).toBeInTheDocument();
        const list = screen.getByRole('list', { name: 'Fiat currencies' });
        const rows = within(list).getAllByRole('button');
        expect(rows).toHaveLength(12);
        expect(rows[0]).toHaveTextContent('USD');
        expect(rows[0]).toHaveTextContent('US Dollar');
        expect(rows[0]).toHaveTextContent('Official currency of the United States');
        expect(rows[0]).toHaveAttribute('aria-current', 'true');
        expect(rows.at(-1)).toHaveTextContent('KRW');
        expect(rows.at(-1)).toHaveTextContent('South Korean Won');
        // The chosen row alone carries the check.
        expect(list.querySelectorAll('[data-fiat-currency-check]')).toHaveLength(1);
        expect(rows[0].querySelector('[data-fiat-currency-check]')).not.toBeNull();
    });

    it('narrows the list by code, name or description and hands back the code', () => {
        const onSelect = vi.fn();
        render(<FiatCurrencyPicker codes={PROTOCOL_FIAT_CODES} value="USD" onSelect={onSelect} onBack={() => {}} />);
        fireEvent.change(openSearch(), { target: { value: 'korea' } });
        const rows = within(screen.getByRole('list', { name: 'Fiat currencies' })).getAllByRole('button');
        expect(rows).toHaveLength(1);
        fireEvent.click(rows[0]);
        expect(onSelect).toHaveBeenCalledWith('KRW');
    });

    it('says when nothing matches and clears the search', () => {
        render(<FiatCurrencyPicker codes={PROTOCOL_FIAT_CODES} value="USD" onSelect={() => {}} onBack={() => {}} />);
        fireEvent.change(openSearch(), { target: { value: 'zzz' } });
        expect(screen.getByText('No matching currencies')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }));
        expect(within(screen.getByRole('list', { name: 'Fiat currencies' })).getAllByRole('button')).toHaveLength(12);
    });

    it('offers a None row first for an optional field, picked as an empty code', () => {
        const onSelect = vi.fn();
        render(
            <FiatCurrencyPicker
                codes={PROTOCOL_FIAT_CODES}
                value=""
                noneOption={{ label: 'None, coin-paid' }}
                onSelect={onSelect}
                onBack={() => {}}
            />,
        );
        const rows = within(screen.getByRole('list', { name: 'Fiat currencies' })).getAllByRole('button');
        expect(rows).toHaveLength(13);
        expect(rows[0]).toHaveTextContent('None, coin-paid');
        expect(rows[0]).toHaveAttribute('aria-current', 'true');
        fireEvent.click(rows[0]);
        expect(onSelect).toHaveBeenCalledWith('');
    });

    it('returns to a field that then shows the pick', () => {
        function Host() {
            const [code, setCode] = useState('USD');
            const [open, setOpen] = useState(false);
            if (open) {
                return (
                    <FiatCurrencyPicker
                        codes={PROTOCOL_FIAT_CODES}
                        value={code}
                        onSelect={(next) => { setCode(next); setOpen(false); }}
                        onBack={() => setOpen(false)}
                    />
                );
            }
            return <FiatCurrencyField value={code} onOpenPicker={() => setOpen(true)} />;
        }
        render(<Host />);
        fireEvent.click(screen.getByRole('button', { name: /^Fiat currency: USD/ }));
        fireEvent.click(within(screen.getByRole('list', { name: 'Fiat currencies' })).getByRole('button', { name: /JPY/ }));
        expect(screen.getByRole('button', { name: 'Fiat currency: JPY, Japanese Yen' })).toBeInTheDocument();
    });
});
