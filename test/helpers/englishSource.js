// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { en } from '../../packages/core/src/i18n/locales/en/index.js';

// Source-reading contract tests match the English copy a component renders.
// Copy now lives in the locale dictionary, so this swaps every plain
// t('key') call back to its English text: `{t('k')}` in JSX content becomes the
// bare text, `attr={t('k')}` becomes `attr="text"` and a lazy
// `get label() { return t('k'); }` table entry becomes `label: 'text'`. Calls
// with arguments are left as written, and `prop: t('k')` in a table becomes
// `prop: 'text'`.
export function withEnglishCopy(source) {
    return source
        .replace(/get (\w+)\(\) \{ return t\('([^']+)'\); \}/g, (match, prop, key) => (key in en ? `${prop}: '${en[key]}'` : match))
        .replace(/(\w+): t\('([^']+)'\)/g, (match, prop, key) => (key in en ? `${prop}: '${en[key]}'` : match))
        .replace(/=\{t\('([^']+)'\)\}/g, (match, key) => (key in en ? `="${en[key]}"` : match))
        .replace(/\{t\('([^']+)'\)\}/g, (match, key) => (key in en ? en[key] : match));
}
