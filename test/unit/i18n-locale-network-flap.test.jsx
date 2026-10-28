// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Locale switching while the network flaps. The pseudo-rtl chunk is the
// only lazily loaded locale, so its importer is replaced by a gate the
// test opens, fails or holds, standing in for a chunk fetch that is
// offline, slow or out of order.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const chunk = {
    mode: 'ok',
    pending: [],
    calls: 0,
};

function release(index = 0) {
    const entry = chunk.pending.splice(index, 1)[0];
    entry.resolve();
}

async function pseudoRtlChunk() {
    chunk.calls += 1;
    const mode = chunk.mode;
    if (mode === 'offline') throw new TypeError('Failed to fetch dynamically imported module');
    if (mode === 'slow' || mode === 'slow-offline') {
        await new Promise((resolve) => { chunk.pending.push({ resolve }); });
    }
    if (mode === 'slow-offline') throw new TypeError('Failed to fetch dynamically imported module');
    const { en } = await vi.importActual('../../packages/core/src/i18n/locales/en/index.js');
    const dict = {};
    for (const [key, value] of Object.entries(en)) dict[key] = `‏⟦${value}⟧`;
    return { default: dict };
}

// Wait on real time for the importer to reach its gate; the chunk sits
// behind a few module hops, so it lands a macrotask or two after the call.
async function chunkRequested() {
    for (let i = 0; i < 100 && chunk.pending.length === 0; i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    expect(chunk.pending).toHaveLength(1);
}

let settings;
const update = vi.fn(async (patch) => { settings = { ...settings, ...patch }; });

vi.mock('../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));

let getLocale;
let getFormatLocale;
let registerLocale;
let setLocale;
let t;
let LanguageRegionSection;
let MessagingProvider;
let AmountField;

// Each case starts from a fresh module graph so a chunk one case loaded
// is never already registered for the next.
async function loadModules() {
    vi.resetModules();
    // A fresh registration drops the cached chunk so this case loads it again.
    vi.doUnmock('../../packages/core/src/i18n/locales/pseudo-rtl/index.js');
    vi.doMock('../../packages/core/src/i18n/locales/pseudo-rtl/index.js', () => pseudoRtlChunk());
    const i18n = await import('../../packages/core/src/i18n/index.js');
    ({ getLocale, getFormatLocale, registerLocale, setLocale, t } = i18n);
    // A retry after a failed chunk imports it under a fresh URL; both paths go through the same gate.
    i18n.__setLazyLocaleLoadersForTests({ './locales/pseudo-rtl/index.js': () => pseudoRtlChunk() }, () => pseudoRtlChunk());
    ({ LanguageRegionSection } = await import('../../packages/core/src/shared/components/settings/LanguageRegionSection.jsx'));
    ({ MessagingProvider } = await import('../../packages/core/src/shared/MessagingProvider.jsx'));
    ({ AmountField } = await import('../../packages/core/src/shared/components/AmountField.jsx'));
}

beforeEach(async () => {
    chunk.mode = 'ok';
    chunk.pending = [];
    chunk.calls = 0;
    localStorage.clear();
    await loadModules();
    document.documentElement.dir = 'ltr';
    document.documentElement.lang = 'en';
    settings = { language: 'en', fiatCurrency: 'USD', developerMode: true };
    update.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
    cleanup();
    while (chunk.pending.length) release();
    // Let a released chunk finish evaluating before the next case resets
    // the module graph, so it never settles inside the next case.
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    await setLocale('en');
    vi.restoreAllMocks();
});

function expectEnglishLtr() {
    expect(getLocale()).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
    expect(t('common.back')).toBe('Back');
}

describe('locale chunk offline', () => {
    it('keeps the previous locale, direction and copy when the RTL chunk rejects', async () => {
        chunk.mode = 'offline';
        const applied = await setLocale('pseudo-rtl');
        expect(applied).toBe('en');
        expectEnglishLtr();
        expect(document.querySelectorAll('[dir="rtl"]')).toHaveLength(0);
    });

    it('applies the RTL locale on a retry after the network returns', async () => {
        chunk.mode = 'offline';
        expect(await setLocale('pseudo-rtl')).toBe('en');
        chunk.mode = 'ok';
        expect(await setLocale('pseudo-rtl')).toBe('pseudo-rtl');
        expect(document.documentElement.dir).toBe('rtl');
        expect(t('common.back')).toBe('‏⟦Back⟧');
    });

    it('the picker does not persist a language whose chunk fails, and shows one error', async () => {
        chunk.mode = 'offline';
        render(<LanguageRegionSection />);
        const picker = screen.getByRole('combobox', { name: 'Language' });
        await act(async () => {
            fireEvent.change(picker, { target: { value: 'pseudo-rtl' } });
        });
        await waitFor(() => expect(chunk.calls).toBeGreaterThan(0));
        expect(update).not.toHaveBeenCalled();
        expectEnglishLtr();
        expect(picker).toHaveValue('en');
        expect(await screen.findAllByRole('alert')).toHaveLength(1);
    });

    it('the picker applies and persists the language on a retry after reconnect', async () => {
        chunk.mode = 'offline';
        render(<LanguageRegionSection />);
        const picker = screen.getByRole('combobox', { name: 'Language' });
        await act(async () => {
            fireEvent.change(picker, { target: { value: 'pseudo-rtl' } });
        });
        await screen.findByRole('alert');
        chunk.mode = 'ok';
        await act(async () => {
            fireEvent.change(picker, { target: { value: 'pseudo-rtl' } });
        });
        await waitFor(() => expect(update).toHaveBeenCalledWith({ language: 'pseudo-rtl' }));
        expect(getLocale()).toBe('pseudo-rtl');
        expect(document.documentElement.dir).toBe('rtl');
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('out-of-order chunk loads', () => {
    it('the last choice wins when a slow RTL chunk resolves after a newer pick', async () => {
        registerLocale('fr-test', { 'common.back': 'Retour' });
        chunk.mode = 'slow';
        const first = setLocale('pseudo-rtl');
        await chunkRequested();
        expect(await setLocale('fr-test')).toBe('fr-test');
        release();
        expect(await first).toBe('fr-test');
        expect(getLocale()).toBe('fr-test');
        expect(document.documentElement.dir).toBe('ltr');
        expect(document.documentElement.lang).toBe('fr-test');
        expect(t('common.back')).toBe('Retour');
    });

    it('the picker persists only the last choice when the first chunk lands late', async () => {
        registerLocale('fr-test', { 'common.back': 'Retour' });
        chunk.mode = 'slow';
        render(<LanguageRegionSection />);
        const picker = screen.getByRole('combobox', { name: 'Language' });
        await act(async () => {
            fireEvent.change(picker, { target: { value: 'pseudo-rtl' } });
        });
        await chunkRequested();
        await act(async () => {
            fireEvent.change(picker, { target: { value: 'fr-test' } });
        });
        await act(async () => { release(); });
        await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
        expect(update).toHaveBeenCalledWith({ language: 'fr-test' });
        expect(getLocale()).toBe('fr-test');
        expect(document.documentElement.dir).toBe('ltr');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('the picker shows no alert when an older pick fails after a newer pick applies', async () => {
        registerLocale('fr-test', { 'common.back': 'Retour' });
        chunk.mode = 'slow-offline';
        render(<LanguageRegionSection />);
        const picker = screen.getByRole('combobox', { name: 'Language' });
        await act(async () => {
            fireEvent.change(picker, { target: { value: 'pseudo-rtl' } });
        });
        await chunkRequested();
        await act(async () => {
            fireEvent.change(picker, { target: { value: 'fr-test' } });
        });
        await act(async () => { release(); });
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({ language: 'fr-test' });
        expect(getLocale()).toBe('fr-test');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a pick back to the active locale cancels a pending RTL chunk', async () => {
        chunk.mode = 'slow';
        const first = setLocale('pseudo-rtl');
        await chunkRequested();
        expect(await setLocale('en')).toBe('en');
        release();
        expect(await first).toBe('en');
        expectEnglishLtr();
    });
});

describe('mid-form switch while the chunk is slow', () => {
    const STORED_AMOUNT = 1234.5;

    function SendLikeForm() {
        const [amount, setAmount] = useState('');
        const [label, setLabel] = useState('');
        const shown = new Intl.NumberFormat(getFormatLocale()).format(STORED_AMOUNT);
        return (
            <div>
                <AmountField amount={amount} tick="BTC" onAmountFieldChange={(raw) => setAmount(raw)} />
                <label>
                    Label
                    <input aria-label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
                </label>
                <output data-testid="stored">{shown}</output>
                <output data-testid="amount-state">{amount}</output>
                <output data-testid="back">{t('common.back')}</output>
            </div>
        );
    }

    it('typed values survive and only the display reformats when the late chunk applies', async () => {
        render(
            <MessagingProvider shell="web" messaging={{}}>
                <SendLikeForm />
                <LanguageRegionSection />
            </MessagingProvider>,
        );
        const amountInput = screen.getByRole('textbox', { name: 'Amount (BTC)' });
        fireEvent.change(amountInput, { target: { value: '0.12345678' } });
        fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'rent' } });
        expect(screen.getByTestId('stored').textContent).toBe('1,234.5');

        chunk.mode = 'slow';
        const picker = screen.getByRole('combobox', { name: 'Language' });
        await act(async () => {
            fireEvent.change(picker, { target: { value: 'pseudo-rtl' } });
        });
        await chunkRequested();
        // Still mid-load: nothing has flipped, and typing keeps working.
        expect(document.documentElement.dir).toBe('ltr');
        fireEvent.change(amountInput, { target: { value: '0.123456789' } });
        expect(screen.getByTestId('amount-state').textContent).toBe('0.123456789');
        fireEvent.change(amountInput, { target: { value: '0.12345678' } });

        await act(async () => { release(); });
        await waitFor(() => expect(getLocale()).toBe('pseudo-rtl'));
        expect(document.documentElement.dir).toBe('rtl');
        expect(screen.getByTestId('back').textContent).toBe('‏⟦Back⟧');
        expect(screen.getByRole('textbox', { name: /Amount/ })).toHaveValue('0.12345678');
        expect(screen.getByTestId('amount-state').textContent).toBe('0.12345678');
        expect(screen.getByLabelText('Label')).toHaveValue('rent');
        // pseudo-rtl formats as English, so the stored number reads the same
        // and is never rewritten by the switch.
        expect(screen.getByTestId('stored').textContent).toBe(
            new Intl.NumberFormat(getFormatLocale()).format(STORED_AMOUNT),
        );
    });
});
