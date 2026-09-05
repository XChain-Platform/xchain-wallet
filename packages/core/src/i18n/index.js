// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// i18n helper: §54.
//
// Small runtime built on formatjs (`intl-messageformat`). API surface:
//
//   t(key, vars?)            - lookup + interpolate
//   setLocale(locale)        - switch dictionary at runtime (triggers
//                              onChange callbacks); async when the target
//                              locale must be lazily loaded first
//   onLocaleChange(fn)       - subscribe; returns an unsubscribe fn
//   registerLocale(code, d)  - add a dictionary at runtime
//   getLocale()              - current locale code
//   getDirection(locale?)    - 'rtl' | 'ltr' for the given (or current) code
//   availableLocales()       - codes of registered + lazily-discoverable
//                              dictionaries
//
// Interpolation is full ICU MessageFormat via `intl-messageformat`:
//   {name}                                       - simple substitution
//   {count, plural, one {…} other {…}}           - ICU plural
//   {kind, select, mainnet {…} other {…}}        - ICU select
//   {n, number, ::currency/USD}                  - number / currency
//   {d, date, medium}                            - date / time
//   {n, selectordinal, one {#st} other {#th}}    - ordinal plural
// plus nested patterns and `#` inside plural/select cases.
//
// The pre-v0.334 build shipped a hand-rolled ICU subset. formatjs is
// the drop-in successor the dictionaries were authored against, so the
// swap needs no dictionary changes. Two behaviours the old helper had
// are preserved on top of formatjs so callers and translators see the
// same thing:
//   - a var referenced by the template but missing from `vars` renders
//     as its bare `{name}` token (visible to translators) instead of
//     throwing, which is what raw formatjs does on a missing arg;
//   - a malformed template never throws at render: it degrades to a
//     legacy best-effort substitution.
//
// Fallback: missing keys fall back to English. Missing English keys
// return the key itself (so dev sees the missing-string token
// visually). No exception thrown.

import { IntlMessageFormat } from 'intl-messageformat';

import { en } from './locales/en/index.js';

/** @typedef {Record<string, string>} Dictionary */

const DICTIONARIES = /** @type {Record<string, Dictionary>} */ ({ en });
let currentLocale = 'en';
const subscribers = new Set();

// --- lazy locale discovery (§54 FOLLOWUP 5) --------------------------
//
// Under Vite, `import.meta.glob` compiles to a static map of dynamic
// importers keyed by module path, so locale chunks are code-split and
// only fetched when a user actually switches to them. Under plain Node
// (smoke scripts) `import.meta.glob` doesn't exist, so LAZY_LOADERS is
// an empty object and only statically-registered locales are visible.
let LAZY_LOADERS = {};
try {
    // Vite rewrites this call to a static importer map at build time, so
    // the guard cannot be a runtime `typeof` check (Vite leaves the bare
    // `import.meta.glob` reference undefined and only transforms the
    // call). Under plain Node there is no bundler: the call throws and we
    // keep the empty map, so only statically-registered locales show up.
    LAZY_LOADERS = import.meta.glob('./locales/*/index.js', { import: 'default' });
} catch (_err) { /* no bundler present: lazy discovery disabled */ }

const LOCALE_PATH_RE = /\/locales\/([^/]+)\/index\.js$/;

/** Return the lazy importer for `code`, or null when none is known. */
function lazyLoaderFor(code) {
    for (const path in LAZY_LOADERS) {
        const m = LOCALE_PATH_RE.exec(path);
        if (m && m[1] === code) return LAZY_LOADERS[path];
    }
    return null;
}

// --- text direction (§54 FOLLOWUP 3) ---------------------------------
//
// Base-language codes whose script is right-to-left. `pseudo-rtl` is a
// developer-only mirror locale (English copy wrapped in brackets) used
// to flip the whole UI to `dir="rtl"` for visual inspection.
const RTL_LANGS = new Set([
    'ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi', 'dv', 'ckb', 'ug', 'nqo',
]);

/**
 * @param {string} [locale] defaults to the current locale
 * @returns {'rtl' | 'ltr'}
 */
export function getDirection(locale = currentLocale) {
    const code = String(locale).toLowerCase();
    if (code === 'pseudo-rtl') return 'rtl';
    const base = code.split('-')[0];
    return RTL_LANGS.has(base) ? 'rtl' : 'ltr';
}

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

/** @returns {string[]} registered plus lazily-discoverable locale codes */
export function availableLocales() {
    const codes = new Set(Object.keys(DICTIONARIES));
    for (const path in LAZY_LOADERS) {
        const m = LOCALE_PATH_RE.exec(path);
        if (m) codes.add(m[1]);
    }
    return [...codes].sort();
}

/** @returns {string} */
export function getLocale() {
    return currentLocale;
}

/** Flip the live locale, sync `document` direction, notify subscribers. */
function applyLocale(locale) {
    currentLocale = locale;
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.dir = getDirection(locale);
        // `pseudo-rtl` is English copy, so advertise `en` to assistive
        // tech / spellcheckers; real locales advertise themselves.
        document.documentElement.lang = locale === 'pseudo-rtl' ? 'en' : locale;
    }
    for (const fn of subscribers) {
        try { fn(locale); } catch (_err) { /* sub errors never bubble */ }
    }
}

/**
 * Switch the active locale.
 *
 * Synchronous (and returns a resolved promise) when the target is
 * already registered. When the target is only known as a lazily-loadable
 * chunk, returns a promise that resolves after the chunk loads and the
 * locale is applied; a chunk-load failure keeps the current locale
 * (falling back to English's always-present dictionary) rather than
 * rejecting. Throws synchronously only when the locale is neither
 * registered nor lazily discoverable.
 *
 * @param {string} locale
 * @returns {Promise<string>} the locale actually in effect afterwards
 */
export function setLocale(locale) {
    if (locale === currentLocale) return Promise.resolve(locale);
    if (DICTIONARIES[locale]) {
        applyLocale(locale);
        return Promise.resolve(locale);
    }
    const loader = lazyLoaderFor(locale);
    if (!loader) {
        throw new Error(`setLocale: unknown locale "${locale}"`);
    }
    return loader()
        .then((mod) => {
            // `{ import: 'default' }` hands back the default export
            // directly, but tolerate a namespace object too.
            DICTIONARIES[locale] = mod && mod.default ? mod.default : mod;
            applyLocale(locale);
            return locale;
        })
        .catch((err) => {
            if (typeof console !== 'undefined') {
                console.warn(
                    `setLocale: failed to load "${locale}"; keeping "${currentLocale}"`,
                    err,
                );
            }
            return currentLocale;
        });
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
    // Every lookup goes through format(), vars or not. An `if (!vars)
    // return raw` shortcut here made t(k) and t(k, {}) two different
    // functions for an ICU plural/select key: the vars-less call handed
    // the dictionary's own SOURCE text to the UI while the `{}` call
    // rendered legacyFormat's bare tokens. format() already normalises a
    // missing args object and already fast-paths a template with no `{`,
    // so the equivalence holds by construction rather than by a second
    // brace check here that could drift from the one in format().
    return format(raw, vars, currentLocale);
}

// --- formatjs message formatting -------------------------------------

// `Intl` rejects a structurally invalid BCP-47 tag with a RangeError,
// and every Intl call on the render path sits inside a catch that
// degrades to legacyFormat, so an unusable locale code silently
// disables formatjs for the whole dictionary. `pseudo-rtl` is exactly
// that shape: `pseudo` is a legal language subtag but the following
// `rtl` is 3 alpha, which is neither a script (4), a region (2 alpha /
// 3 digit) nor a variant (5-8 alphanum). Resolving the code once, here,
// keeps the dictionary key, `getLocale()` and `getDirection()` on the
// original string while the formatting boundary sees a tag Intl accepts.
const FORMAT_LOCALE_CACHE = new Map();

/** True when `Intl` accepts `code` as a structurally valid tag. */
function isUsableTag(code) {
    try {
        new Intl.NumberFormat(code);
        return true;
    } catch (_err) {
        return false;
    }
}

/**
 * Map a locale code to the nearest tag `Intl` accepts: the code itself
 * when it is structurally valid (so every real locale is untouched),
 * else its base subtag when that names a locale Intl actually knows,
 * else 'en'. A structurally valid but unknown base is NOT used: Intl
 * silently resolves it to the host default, so 'pseudo' would render
 * English copy under whatever plural rules the user's device carries.
 *
 * @param {string} code
 * @returns {string}
 */
function resolveFormatLocale(code) {
    const key = String(code);
    const cached = FORMAT_LOCALE_CACHE.get(key);
    if (cached !== undefined) return cached;
    let resolved = 'en';
    if (isUsableTag(key)) {
        resolved = key;
    } else {
        const base = key.split('-')[0];
        if (base !== key && isUsableTag(base)
            && Intl.NumberFormat.supportedLocalesOf(base).length > 0) {
            resolved = base;
        }
    }
    if (resolved !== key && typeof console !== 'undefined') {
        console.warn(
            `i18n: locale "${key}" is not a tag Intl accepts; formatting as "${resolved}"`,
        );
    }
    FORMAT_LOCALE_CACHE.set(key, resolved);
    return resolved;
}

// Compiled IntlMessageFormat instances are immutable and reusable, so
// memoise per (locale, template). Bounded to keep long-running shells
// from growing the cache without limit.
const MF_CACHE = new Map();
const MF_CACHE_MAX = 500;

function messageFormatFor(template, locale) {
    const cacheKey = `${locale}\u0000${template}`;
    let mf = MF_CACHE.get(cacheKey);
    if (mf) return mf;
    mf = new IntlMessageFormat(template, locale);
    if (MF_CACHE.size >= MF_CACHE_MAX) MF_CACHE.clear();
    MF_CACHE.set(cacheKey, mf);
    return mf;
}

// formatjs AST element types whose argument formatjs coerces to a
// number or date before rendering: 2 number, 3 date, 4 time, 6 plural
// and selectordinal. A bare `{name}` string fed to one of these renders
// "NaN" / "$NaN" / "NaNth" (the date ones throw) instead of the token,
// so a template missing such an arg is routed to legacyFormat, whose
// getVar emits the token for every type. 1 argument and 5 select take
// the string as-is and keep the pre-fill.
const COERCING_ARG_TYPES = new Set([2, 3, 4, 6]);

/**
 * Walk a parsed ICU AST collecting every argument name it references
 * (including args nested inside plural / select cases and tags), mapped
 * to whether any of its uses is a coercing type.
 */
function collectArgNames(ast, out) {
    for (const el of ast) {
        // 0 = literal, 7 = pound (`#`): neither names an argument.
        if (el.type === 0 || el.type === 7) continue;
        // 8 = tag: `el.value` is the tag name, not an arg.
        if (el.type !== 8 && typeof el.value === 'string') {
            out.set(el.value, out.get(el.value) || COERCING_ARG_TYPES.has(el.type));
        }
        if (el.options) {
            for (const selector in el.options) {
                collectArgNames(el.options[selector].value, out);
            }
        }
        if (el.children) collectArgNames(el.children, out);
    }
    return out;
}

/**
 * Interpolate an ICU MessageFormat template.
 *
 * Delegates to formatjs. Preserves two behaviours of the pre-formatjs
 * helper: an argument the template references but the caller omits
 * renders as its bare `{name}` token (rather than throwing), and a
 * malformed template degrades to a best-effort substitution instead of
 * throwing at render time.
 *
 * @param {string} template
 * @param {Record<string, string | number>} vars
 * @param {string} [locale]   default 'en'
 * @returns {string}
 */
export function format(template, vars, locale = 'en') {
    if (typeof template !== 'string') return String(template);
    const values = vars || {};
    // Fast path: no ICU markup at all.
    if (!template.includes('{')) return template;
    // Resolve once for the whole render: the compile below, the plural
    // rules inside legacyFormat, and the MF_CACHE key all have to agree.
    const fmtLocale = resolveFormatLocale(locale);
    try {
        const mf = messageFormatFor(template, fmtLocale);
        // Pre-fill any referenced-but-missing arg with its bare token so
        // formatjs doesn't throw on a missing value; translators still
        // see the untranslated placeholder in the rendered output.
        const filled = fillMissingArgs(mf, values);
        // A missing plural / number / date arg cannot be pre-filled: the
        // token would render as NaN, so the legacy path renders the
        // whole template with bare tokens instead.
        if (filled === null) return legacyFormat(template, values, fmtLocale);
        return String(mf.format(filled));
    } catch (_err) {
        // Malformed ICU (or an unsupported construct): never throw at
        // render; fall back to the legacy substitution.
        return legacyFormat(template, values, fmtLocale);
    }
}

/**
 * Return a values object with every arg the template requires present:
 * caller-supplied values win; anything missing gets its bare `{name}`
 * token so the rendered string shows the untranslated placeholder.
 * Returns null when a missing arg is of a coercing type (see
 * COERCING_ARG_TYPES), which the token string cannot stand in for.
 */
function fillMissingArgs(mf, values) {
    const names = collectArgNames(mf.getAst(), new Map());
    let filled = values;
    for (const [name, coercing] of names) {
        if (!Object.prototype.hasOwnProperty.call(values, name)) {
            if (coercing) return null;
            if (filled === values) filled = { ...values };
            filled[name] = `{${name}}`;
        }
    }
    return filled;
}

// --- legacy fallback substitution ------------------------------------
//
// The pre-formatjs hand-rolled ICU subset, kept only as a last-resort
// path for templates formatjs refuses to parse. It handles simple
// substitution, plural, select, `=N` exact match, and `#`.

function legacyFormat(template, vars, locale = 'en') {
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
    // Unknown type: fall back to plain substitution.
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
    return legacyFormat(expanded, vars, locale ?? 'en');
}

export { en } from './locales/en/index.js';
