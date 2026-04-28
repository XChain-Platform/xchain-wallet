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
// Interpolation supports:
//
//   {name}                                       — simple substitution
//   {count, plural, one {…} other {…}}           — ICU plural (Intl.PluralRules)
//   {kind, select, mainnet {…} other {…}}        — ICU select (exact match)
//
// Inside plural / select cases, `#` is replaced by the value of the
// argument. Nested ICU patterns are NOT supported — that's a deferred
// piece per §54 / G173. The full ICU grammar can be swapped in later
// (formatjs is the obvious choice) without changing the dictionary
// shape, so dictionaries authored against this subset will keep
// rendering correctly.
//
// Fallback: missing keys fall back to English. Missing English keys
// return the key itself (so dev sees the missing-string token
// visually). No exception thrown.

import { en } from './locales/en/index.js';

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
    return format(raw, vars, currentLocale);
}

/**
 * Pure substitution helper — exported separately for callers that
 * already have a template string in hand (e.g. from an error envelope).
 *
 * Implements a pragmatic ICU MessageFormat subset:
 *   {name}                                  → vars.name
 *   {arg, plural, one {…} other {…}}        → Intl.PluralRules
 *   {arg, select, key {…} other {…}}        → exact match
 *
 * Inside cases, `#` substitutes the argument's stringified value.
 *
 * @param {string} template
 * @param {Record<string, string | number>} vars
 * @param {string} [locale]   default 'en' (used by Intl.PluralRules)
 * @returns {string}
 */
export function format(template, vars, locale = 'en') {
    if (typeof template !== 'string') return String(template);
    let i = 0;
    const out = [];
    while (i < template.length) {
        const ch = template[i];
        if (ch !== '{') { out.push(ch); i += 1; continue; }
        const block = readBalancedBraces(template, i);
        if (!block) { out.push(ch); i += 1; continue; }
        const inner = template.slice(i + 1, block.endIndex);
        out.push(renderArg(inner, vars, locale));
        i = block.endIndex + 1;
    }
    return out.join('');
}

/**
 * Find the matching closing brace for an opening brace at `start`.
 * Returns `{ endIndex }` or null when the braces don't balance.
 */
function readBalancedBraces(s, start) {
    let depth = 0;
    for (let i = start; i < s.length; i += 1) {
        const c = s[i];
        if (c === '{') depth += 1;
        else if (c === '}') {
            depth -= 1;
            if (depth === 0) return { endIndex: i };
        }
    }
    return null;
}

function renderArg(inner, vars, locale) {
    // Simple substitution: {name}
    if (!inner.includes(',')) {
        return getVar(inner.trim(), vars);
    }
    // Typed arg: {name, type, ...cases}
    const firstComma = inner.indexOf(',');
    const name = inner.slice(0, firstComma).trim();
    const rest = inner.slice(firstComma + 1);
    const secondComma = rest.indexOf(',');
    const type = secondComma === -1 ? rest.trim() : rest.slice(0, secondComma).trim();
    const body = secondComma === -1 ? '' : rest.slice(secondComma + 1);
    const value = getVar(name, vars);
    if (type === 'plural') return resolvePlural(name, value, body, vars, locale);
    if (type === 'select') return resolveSelect(value, body, vars);
    // Unknown type — fall back to plain substitution.
    return value;
}

function getVar(name, vars) {
    if (vars && Object.prototype.hasOwnProperty.call(vars, name)) {
        return String(vars[name]);
    }
    return `{${name}}`;
}

/**
 * Parse a sequence of `key {body}` cases out of a plural / select body.
 * Returns a Map keyed by case label (e.g. 'one', 'other', 'mainnet').
 */
function parseCases(body) {
    const cases = new Map();
    let i = 0;
    while (i < body.length) {
        // Skip whitespace.
        while (i < body.length && /\s/.test(body[i])) i += 1;
        if (i >= body.length) break;
        // Read case key (ICU supports `=N` for exact-match plural; we
        // honour that too).
        let keyEnd = i;
        while (keyEnd < body.length && !/\s|\{/.test(body[keyEnd])) keyEnd += 1;
        const key = body.slice(i, keyEnd);
        i = keyEnd;
        // Skip whitespace before `{`.
        while (i < body.length && /\s/.test(body[i])) i += 1;
        if (body[i] !== '{') break;
        const block = readBalancedBraces(body, i);
        if (!block) break;
        const inner = body.slice(i + 1, block.endIndex);
        cases.set(key, inner);
        i = block.endIndex + 1;
    }
    return cases;
}

function resolvePlural(name, valueStr, body, vars, locale) {
    const num = Number(valueStr);
    const cases = parseCases(body);
    // ICU exact match `=N` wins over plural-rules category match.
    if (cases.has(`=${num}`)) {
        return formatCase(cases.get(`=${num}`), name, valueStr, vars, locale);
    }
    let category = 'other';
    if (Number.isFinite(num)) {
        try {
            category = new Intl.PluralRules(locale).select(num);
        } catch {
            category = num === 1 ? 'one' : 'other';
        }
    }
    const chosen = cases.get(category) ?? cases.get('other') ?? '';
    return formatCase(chosen, name, valueStr, vars, locale);
}

function resolveSelect(valueStr, body, vars) {
    const cases = parseCases(body);
    const chosen = cases.get(valueStr) ?? cases.get('other') ?? '';
    return formatCase(chosen, undefined, valueStr, vars, undefined);
}

function formatCase(template, argName, valueStr, vars, locale) {
    if (!template) return '';
    // Inside cases, `#` is the argument value.
    const expanded = template.replace(/#/g, valueStr);
    return format(expanded, vars, locale ?? 'en');
}

export { en } from './locales/en/index.js';
