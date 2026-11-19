// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// One catalog of the fiat currencies the wallet names anywhere: the Settings
// display currencies and the currencies the protocol prices in. Each entry is
// the ISO code, its full name and a one-line description, so the Fiat currency
// field, its picker page and Settings all read the same words.

import { SUPPORTED_DISPLAY_CURRENCIES } from './displayCurrency.js';

/** @typedef {{ code: string, name: string, description: string }} FiatCurrency */

/** @type {Readonly<Record<string, FiatCurrency>>} */
const CATALOG = Object.freeze({
    USD: { code: 'USD', name: 'US Dollar', description: 'Official currency of the United States' },
    EUR: { code: 'EUR', name: 'Euro', description: 'Shared currency of the euro area' },
    GBP: { code: 'GBP', name: 'British Pound', description: 'Official currency of the United Kingdom' },
    JPY: { code: 'JPY', name: 'Japanese Yen', description: 'Official currency of Japan' },
    CNY: { code: 'CNY', name: 'Chinese Yuan', description: 'Official currency of mainland China' },
    AUD: { code: 'AUD', name: 'Australian Dollar', description: 'Official currency of Australia' },
    CAD: { code: 'CAD', name: 'Canadian Dollar', description: 'Official currency of Canada' },
    CHF: { code: 'CHF', name: 'Swiss Franc', description: 'Official currency of Switzerland' },
    INR: { code: 'INR', name: 'Indian Rupee', description: 'Official currency of India' },
    BRL: { code: 'BRL', name: 'Brazilian Real', description: 'Official currency of Brazil' },
    MXN: { code: 'MXN', name: 'Mexican Peso', description: 'Official currency of Mexico' },
    ZAR: { code: 'ZAR', name: 'South African Rand', description: 'Official currency of South Africa' },
    KRW: { code: 'KRW', name: 'South Korean Won', description: 'Official currency of South Korea' },
});

// The 12 fiats the protocol prices in (xchain-indexer config FIATS, mirrored
// in the SDK's VALID_FIAT_CODES), in the order the forms have always offered
// them. A PRICE or DISPENSER naming anything else is refused on chain.
export const PROTOCOL_FIAT_CODES = Object.freeze([
    'USD', 'CAD', 'AUD', 'MXN', 'GBP', 'JPY', 'CNY', 'CHF', 'BRL', 'INR', 'EUR', 'KRW',
]);

/** The catalog entry for a code, or null when the wallet does not know it. */
export function fiatCurrency(code) {
    const key = String(code || '').trim().toUpperCase();
    return CATALOG[key] || null;
}

/**
 * The catalog entries for `codes`, in that order; unknown codes still list,
 * named by their code, so a caller's set is never silently narrowed.
 *
 * @param {readonly string[]} [codes] defaults to the Settings display currencies
 * @returns {FiatCurrency[]}
 */
export function fiatCurrencies(codes = SUPPORTED_DISPLAY_CURRENCIES) {
    return codes.map((code) => fiatCurrency(code) || { code, name: code, description: '' });
}

/** The currency's narrow symbol ("$", "€", "¥"), or the code when Intl has none. */
export function fiatCurrencySymbol(code) {
    try {
        const parts = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: code,
            currencyDisplay: 'narrowSymbol',
        }).formatToParts(0);
        return parts.find((part) => part.type === 'currency')?.value || code;
    } catch {
        return code;
    }
}

/** True when the currency matches a search by code, name or description. */
export function fiatCurrencyMatches(currency, query) {
    const q = String(query || '').trim().toLocaleLowerCase();
    if (!q) return true;
    return [currency.code, currency.name, currency.description]
        .some((text) => String(text || '').toLocaleLowerCase().includes(q));
}
