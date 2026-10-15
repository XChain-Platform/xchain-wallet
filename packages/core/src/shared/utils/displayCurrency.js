// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export const SUPPORTED_DISPLAY_CURRENCIES = Object.freeze([
    'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD',
    'CAD', 'CHF', 'INR', 'BRL', 'MXN', 'ZAR',
]);

const SUPPORTED = new Set(SUPPORTED_DISPLAY_CURRENCIES);

/**
 * Returns an effective settings snapshot and the unsupported saved code, if any.
 * Every fiat consumer reads the effective snapshot, keeping labels and rates in
 * the same currency while Settings can explain the USD fallback.
 */
export function normalizeDisplayCurrency(settings) {
    if (!settings || typeof settings !== 'object') {
        return { settings, unsupportedFiatCurrency: null };
    }
    const saved = typeof settings.fiatCurrency === 'string'
        ? settings.fiatCurrency.trim()
        : '';
    const normalized = saved.toUpperCase();
    if (!saved) {
        return {
            settings: settings.fiatCurrency === 'USD'
                ? settings
                : { ...settings, fiatCurrency: 'USD' },
            unsupportedFiatCurrency: null,
        };
    }
    if (SUPPORTED.has(normalized)) {
        return {
            settings: settings.fiatCurrency === normalized
                ? settings
                : { ...settings, fiatCurrency: normalized },
            unsupportedFiatCurrency: null,
        };
    }
    return {
        settings: { ...settings, fiatCurrency: 'USD' },
        unsupportedFiatCurrency: saved,
    };
}
