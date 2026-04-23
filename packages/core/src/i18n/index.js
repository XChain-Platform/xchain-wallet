// i18n helper — §54.
//
// Tiny runtime with no dependencies. API surface:
//
//   t(key, vars?)            — lookup + interpolate
//   setLocale(locale)        — switch dictionary at runtime (triggers
//                              onChange callbacks)
//   onLocaleChange(fn)       — subscribe; returns an unsubscribe fn
//   registerLocale(code, d)  — add a dictionary at runtime
//   getLocale()              — current locale code
//   availableLocales()       — codes of registered dictionaries
//
// Interpolation: `{name}` placeholders are replaced from the `vars`
// object. Missing placeholders render literally so translators can
// spot them.
//
// Fallback: missing keys fall back to English. Missing English keys
// return the key itself (so dev sees the missing-string token
// visually). No exception thrown.

import { en } from './en.js';

/** @typedef {Record<string, string>} Dictionary */

const DICTIONARIES = /** @type {Record<string, Dictionary>} */ ({ en });
let currentLocale = 'en';
const subscribers = new Set();

/**
 * Register (or replace) a locale dictionary at runtime.
 * @param {string} locale
 * @param {Dictionary} dictionary
 */
export function registerLocale(locale, dictionary) {
    if (typeof locale !== 'string' || locale.length === 0) {
        throw new Error('registerLocale: locale must be a non-empty string');
    }
    if (!dictionary || typeof dictionary !== 'object') {
        throw new Error('registerLocale: dictionary must be an object');
    }
    DICTIONARIES[locale] = dictionary;
}

/** @returns {string[]} */
export function availableLocales() {
    return Object.keys(DICTIONARIES).sort();
}

/** @returns {string} */
export function getLocale() {
    return currentLocale;
}

/** @param {string} locale */
export function setLocale(locale) {
    if (!DICTIONARIES[locale]) {
        throw new Error(`setLocale: unknown locale "${locale}"`);
    }
    if (locale === currentLocale) return;
    currentLocale = locale;
    for (const fn of subscribers) {
        try { fn(locale); } catch (_err) { /* sub errors never bubble */ }
    }
}

/**
 * @param {(locale: string) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onLocaleChange(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}

/**
 * Look up + interpolate a string. Missing keys fall back to English,
 * then to the key itself.
 *
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
    const dict = DICTIONARIES[currentLocale] ?? DICTIONARIES.en;
    const raw = dict[key] ?? DICTIONARIES.en[key] ?? key;
    if (!vars) return raw;
    return format(raw, vars);
}

/**
 * Pure substitution helper — exported separately for callers that
 * already have a template string in hand (e.g. from an error envelope).
 *
 * @param {string} template
 * @param {Record<string, string | number>} vars
 * @returns {string}
 */
export function format(template, vars) {
    return template.replace(/\{(\w+)\}/g, (_match, name) => {
        if (Object.prototype.hasOwnProperty.call(vars, name)) {
            return String(vars[name]);
        }
        return `{${name}}`;
    });
}

export { en } from './en.js';
