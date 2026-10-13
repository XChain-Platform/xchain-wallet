// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// LanguageRegionSection: §35.1 Language & Region panel.
//
// Surfaces:
//   - Language picker driven by `availableLocales()` so a registered
//     pseudo / additional locale shows up automatically (Cluster R
//     FOLLOWUP 4). On change, persists `settings.language` and calls
//     `i18n.setLocale(next)` so the live UI flips immediately.
//   - Fiat currency picker for fiat-denominated balance / quote
//     surfaces. Persisted to `settings.fiatCurrency`.
//
// Both fields exist on the v1 Settings schema; no migration needed.

import { useState } from 'react';
import { useSettings } from '../../hooks/useSettings.js';
import {
    ROW,
    ROW_HINT,
    ROW_VALUE,
    SELECT,
    SettingsLoadError,
    STACK,
    Status,
} from './_settingsPrimitives.jsx';
import { availableLocales, setLocale as setI18nLocale } from '../../../i18n/index.js';

// Friendly display names for known locales; we extend this map as
// translations land. Unknown registered locales fall back to their
// bcp47 code so a developer-registered pseudo locale still shows up.
const LANGUAGE_LABELS = /** @type {Record<string, string>} */ ({
    en: 'English',
});

function buildLanguageOptions() {
    const codes = availableLocales();
    return codes.map((code) => ({
        value: code,
        label: LANGUAGE_LABELS[code] || code,
    }));
}

// This list matches the quote currencies offered by the picker. Keeping it
// explicit prevents a valid-looking ISO code from being saved when the price
// source cannot return rates for it.
const FIAT_CURRENCIES = /** @type {const} */ ([
    { code: 'USD', name: 'US Dollar' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'British Pound' },
    { code: 'JPY', name: 'Japanese Yen' },
    { code: 'CNY', name: 'Chinese Yuan' },
    { code: 'AUD', name: 'Australian Dollar' },
    { code: 'CAD', name: 'Canadian Dollar' },
    { code: 'CHF', name: 'Swiss Franc' },
    { code: 'INR', name: 'Indian Rupee' },
    { code: 'BRL', name: 'Brazilian Real' },
    { code: 'MXN', name: 'Mexican Peso' },
    { code: 'ZAR', name: 'South African Rand' },
]);

function currencySymbol(code) {
    const parts = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        currencyDisplay: 'symbol',
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value || code;
}

function currencyLabel(currency) {
    return `${currency.name} (${currency.code}) · ${currencySymbol(currency.code)}`;
}

const CONTROLS = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: 'min(100%, 280px)',
};
const CURRENCY_INPUT = {
    ...SELECT,
    width: '100%',
};
const CURRENCY_LIST = {
    position: 'absolute',
    zIndex: 2,
    top: 'calc(100% + var(--xc-space-1))',
    right: 0,
    width: '100%',
    maxHeight: 240,
    overflowY: 'auto',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    boxShadow: 'var(--xc-shadow-md)',
};
const CURRENCY_OPTION = {
    display: 'block',
    width: '100%',
    padding: 'var(--xc-space-2)',
    color: 'var(--xc-text)',
    background: 'transparent',
    border: 0,
    textAlign: 'left',
    font: 'inherit',
    cursor: 'pointer',
};

export function LanguageRegionSection() {
    const { settings, loading, error, update } = useSettings();
    const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
    const [currencyQuery, setCurrencyQuery] = useState('');
    const [currencyError, setCurrencyError] = useState(/** @type {string | null} */ (null));

    if (loading) return <Status text="Loading…" />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const selectedCurrency = FIAT_CURRENCIES.find((currency) => currency.code === settings.fiatCurrency);
    const normalizedQuery = currencyQuery.trim().toLocaleLowerCase();
    const filteredCurrencies = FIAT_CURRENCIES.filter((currency) =>
        !normalizedQuery
        || currency.code.toLocaleLowerCase().includes(normalizedQuery)
        || currency.name.toLocaleLowerCase().includes(normalizedQuery));
    const LANGUAGES = buildLanguageOptions();

    const onLanguageChange = async (next) => {
        // Flip the live i18n locale first so the UI updates immediately;
        // the settings.update is the durable persistence that survives
        // a restart. setLocale throws on unknown code; guard with the
        // current `availableLocales()` set so a stale settings record
        // can't crash the panel.
        try {
            if (availableLocales().includes(next)) {
                setI18nLocale(next);
            }
        } catch (_err) { /* never bubble */ }
        try { await update({ language: next }); } catch (err) {
            // eslint-disable-next-line no-console
            console.error('language.update failed:', err);
        }
    };
    const onCurrencySelect = async (next) => {
        setCurrencyError(null);
        setCurrencyPickerOpen(false);
        setCurrencyQuery('');
        try { await update({ fiatCurrency: next }); } catch (err) {
            // eslint-disable-next-line no-console
            console.error('fiatCurrency.update failed:', err);
            setCurrencyError('Could not save the currency. Try again.');
        }
    };

    return (
        <div style={STACK}>
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={ROW_VALUE}>Language</span>
                    <span style={ROW_HINT}>Choose the language used for wallet navigation, settings, and messages.</span>
                </div>
                <select
                    value={settings.language}
                    onChange={(e) => onLanguageChange(e.target.value)}
                    aria-label="Language"
                    style={SELECT}
                >
                    {LANGUAGES.map((l) => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                </select>
            </div>
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={ROW_VALUE}>Fiat currency</span>
                    <span style={ROW_HINT}>Show estimated wallet values in this currency. Asset balances are unchanged.</span>
                </div>
                <div style={CONTROLS}>
                    <input
                        type="search"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-controls="fiat-currency-options"
                        aria-expanded={currencyPickerOpen}
                        aria-label="Fiat currency"
                        placeholder="Search by code or name"
                        value={currencyPickerOpen
                            ? currencyQuery
                            : selectedCurrency ? currencyLabel(selectedCurrency) : ''}
                        onFocus={() => {
                            setCurrencyPickerOpen(true);
                            setCurrencyQuery('');
                        }}
                        onChange={(e) => {
                            setCurrencyPickerOpen(true);
                            setCurrencyQuery(e.target.value);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') setCurrencyPickerOpen(false);
                            if (e.key === 'Enter' && filteredCurrencies.length === 1) {
                                e.preventDefault();
                                onCurrencySelect(filteredCurrencies[0].code);
                            }
                        }}
                        onBlur={(e) => {
                            if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) {
                                setCurrencyPickerOpen(false);
                            }
                        }}
                        style={CURRENCY_INPUT}
                    />
                    {currencyPickerOpen ? (
                        <div id="fiat-currency-options" role="listbox" aria-label="Supported fiat currencies" style={CURRENCY_LIST}>
                            {filteredCurrencies.map((currency) => (
                                <button
                                    key={currency.code}
                                    type="button"
                                    role="option"
                                    aria-selected={currency.code === selectedCurrency?.code}
                                    onClick={() => onCurrencySelect(currency.code)}
                                    title={currencyLabel(currency)}
                                    style={CURRENCY_OPTION}
                                >
                                    {currencyLabel(currency)}
                                </button>
                            ))}
                            {filteredCurrencies.length === 0 ? (
                                <Status text="No supported currencies match." />
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
            {currencyError ? <Status text={currencyError} tone="error" /> : null}
        </div>
    );
}
