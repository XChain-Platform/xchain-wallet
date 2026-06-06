// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// LanguageRegionSection — §35.1 Language & Region panel.
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

import { useSettings } from '../../hooks/useSettings.js';
import { availableLocales, setLocale as setI18nLocale } from '../../../i18n/index.js';

// Friendly display names for known locales — we extend this map as
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

// Curated short list of widely-used quote currencies. The schema
// stores any non-empty string, so a "Custom" entry is wired below for
// users who want a less-common code. Keep the list short — long
// dropdowns are noise for what is overwhelmingly USD / EUR / locale.
const FIAT_CURRENCIES = /** @type {const} */ ([
    { value: 'USD', label: 'US Dollar (USD)' },
    { value: 'EUR', label: 'Euro (EUR)' },
    { value: 'GBP', label: 'British Pound (GBP)' },
    { value: 'JPY', label: 'Japanese Yen (JPY)' },
    { value: 'CNY', label: 'Chinese Yuan (CNY)' },
    { value: 'AUD', label: 'Australian Dollar (AUD)' },
    { value: 'CAD', label: 'Canadian Dollar (CAD)' },
    { value: 'CHF', label: 'Swiss Franc (CHF)' },
    { value: 'INR', label: 'Indian Rupee (INR)' },
    { value: 'BRL', label: 'Brazilian Real (BRL)' },
    { value: 'MXN', label: 'Mexican Peso (MXN)' },
    { value: 'ZAR', label: 'South African Rand (ZAR)' },
]);
const CUSTOM_CURRENCY_VALUE = '__custom__';

const ROW = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    fontSize: 'var(--xc-text-sm)',
    gap: 'var(--xc-space-3)',
};
const STACK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-1)',
};
const CONTROLS = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'var(--xc-space-2)',
};
const SELECT = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
};
const INPUT = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
    width: 80,
    textTransform: 'uppercase',
};

export function LanguageRegionSection() {
    const { settings, loading, error, update } = useSettings();

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const knownCurrency = FIAT_CURRENCIES.some((c) => c.value === settings.fiatCurrency);
    const selectorValue = knownCurrency ? settings.fiatCurrency : CUSTOM_CURRENCY_VALUE;
    const LANGUAGES = buildLanguageOptions();

    const onLanguageChange = async (next) => {
        // Flip the live i18n locale first so the UI updates immediately;
        // the settings.update is the durable persistence that survives
        // a restart. setLocale throws on unknown code — guard with the
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
    const onCurrencyChange = async (next) => {
        if (next === CUSTOM_CURRENCY_VALUE) return; // wait for user to type a code
        try { await update({ fiatCurrency: next }); } catch (err) {
            // eslint-disable-next-line no-console
            console.error('fiatCurrency.update failed:', err);
        }
    };
    const onCustomCurrencyCommit = async (raw) => {
        const code = String(raw || '').toUpperCase().trim();
        if (!code) return;
        try { await update({ fiatCurrency: code }); } catch (err) {
            // eslint-disable-next-line no-console
            console.error('fiatCurrency.update failed:', err);
        }
    };

    return (
        <div style={STACK}>
            <div style={ROW}>
                <span style={{ color: 'var(--xc-text-muted)' }}>Language</span>
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
                <span style={{ color: 'var(--xc-text-muted)' }}>Fiat currency</span>
                <div style={CONTROLS}>
                    <select
                        value={selectorValue}
                        onChange={(e) => onCurrencyChange(e.target.value)}
                        aria-label="Fiat currency"
                        style={SELECT}
                    >
                        {FIAT_CURRENCIES.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                        <option value={CUSTOM_CURRENCY_VALUE}>Custom…</option>
                    </select>
                    {selectorValue === CUSTOM_CURRENCY_VALUE ? (
                        <input
                            type="text"
                            defaultValue={knownCurrency ? '' : settings.fiatCurrency}
                            onBlur={(e) => onCustomCurrencyCommit(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.currentTarget.blur();
                                }
                            }}
                            placeholder="ISO code"
                            aria-label="Custom currency code"
                            maxLength={6}
                            style={INPUT}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function Status({ text, tone }) {
    return (
        <div style={{
            padding: 'var(--xc-space-3) var(--xc-space-4)',
            background: 'var(--xc-surface-raised)',
            border: tone === 'error'
                ? '1px solid var(--xc-error, #c33)'
                : '1px dashed var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
            color: tone === 'error' ? 'var(--xc-error, #c33)' : 'var(--xc-text-muted)',
            fontSize: 'var(--xc-text-sm)',
        }}>
            {text}
        </div>
    );
}
