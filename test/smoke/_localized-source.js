// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shared helper for source-reading smokes on screens whose copy moved into
// the English locale.
//
// A screen that renders `{t('home.markets')}` no longer carries the word
// "Markets" in its source, so a smoke that greps the source for the copy
// would fail even though the screen still shows it. withEnglishCopy() puts
// the English text back where each t() call sits, in the shape the
// pre-localization source had:
//
//   {t('k')}        as a JSX child      ->  the text itself
//   attr={t('k')}   as a JSX attribute  ->  attr="text"
//   t('k', {...})   anywhere else       ->  'text'
//
// A key missing from the dictionary is left as written, so an assertion on
// its copy still fails. The copy has to be in the locale AND wired by key
// for the smoke to pass, which is what the old grep proved.

import { en } from '../../packages/core/src/i18n/locales/en/index.js';

// t('key') or t('key', { ...one level of nested parens... })
const CALL = String.raw`\bt\(\s*'([^']+)'(?:\s*,(?:[^()]|\([^()]*\))*)?\)`;

export function withEnglishCopy(source, dictionary = en) {
    const lookup = (key) => (key in dictionary ? dictionary[key] : null);
    return source
        .replace(new RegExp(String.raw`(\s[\w:-]+)=\{\s*${CALL}\s*\}`, 'g'), (whole, attr, key) => {
            const text = lookup(key);
            return text === null ? whole : `${attr}="${text.replace(/"/g, '&quot;')}"`;
        })
        .replace(new RegExp(String.raw`\{\s*${CALL}\s*\}`, 'g'), (whole, key) => {
            const text = lookup(key);
            return text === null ? whole : text;
        })
        .replace(new RegExp(CALL, 'g'), (whole, key) => {
            const text = lookup(key);
            return text === null ? whole : `'${text.replace(/'/g, "\\'")}'`;
        });
}
