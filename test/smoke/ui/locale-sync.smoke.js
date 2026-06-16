// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Cluster R FOLLOWUP 4 — locale picker + LocaleSync bootstrap.
//
// Pins:
//   - LocaleSync.jsx exists and reads useSettings + i18n surface
//   - MessagingProvider mounts <LocaleSync /> alongside PrivacyBlurGate
//   - LanguageRegionSection imports availableLocales + setLocale from
//     the core i18n module and calls them on change
//   - Runtime round-trip: registerLocale + setLocale honors the saved
//     language code

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');

// --- 1. LocaleSync component shape ------------------------------------

const lsPath = join(core, 'src', 'shared', 'LocaleSync.jsx');
const ls = readFileSync(lsPath, 'utf8');
assert.match(ls, /export function LocaleSync\b/, 'LocaleSync is a named export');
assert.match(ls, /import \{ useSettings \} from '\.\/hooks\/useSettings\.js'/,
    'LocaleSync reads settings via useSettings');
assert.match(ls, /import \{[\s\S]*?availableLocales[\s\S]*?getLocale[\s\S]*?setLocale[\s\S]*?\} from '\.\.\/i18n\/index\.js'/,
    'LocaleSync imports availableLocales/getLocale/setLocale from the core i18n module');
assert.match(ls, /availableLocales\(\)\.includes\(language\)/,
    'LocaleSync ignores unknown / unregistered locale codes');
assert.match(ls, /getLocale\(\) === language/,
    'LocaleSync no-ops when the live locale already matches the saved one');
assert.match(ls, /setLocale\(language\)/, 'LocaleSync calls setLocale(language)');

// --- 2. MessagingProvider mounts LocaleSync ---------------------------

const mpPath = join(core, 'src', 'shared', 'MessagingProvider.jsx');
const mp = readFileSync(mpPath, 'utf8');
assert.match(mp, /import \{ LocaleSync \} from '\.\/LocaleSync\.jsx'/,
    'MessagingProvider imports LocaleSync');
assert.match(mp, /<LocaleSync \/>/,
    'MessagingProvider renders <LocaleSync /> inside the context provider');

// --- 3. LanguageRegionSection wiring ----------------------------------

const lrPath = join(core, 'src', 'shared', 'components', 'settings', 'LanguageRegionSection.jsx');
const lr = readFileSync(lrPath, 'utf8');
assert.match(lr, /import \{ availableLocales, setLocale as setI18nLocale \} from '\.\.\/\.\.\/\.\.\/i18n\/index\.js'/,
    'LanguageRegionSection imports availableLocales + setLocale (aliased)');
assert.match(lr, /buildLanguageOptions/,
    'LanguageRegionSection derives picker options dynamically');
assert.match(lr, /setI18nLocale\(next\)/,
    'onLanguageChange flips the live i18n locale immediately');

// --- 4. i18n round-trip pin -------------------------------------------

const { availableLocales, registerLocale, setLocale, getLocale, t } = await import(
    '../../../packages/core/src/i18n/index.js'
);
const before = getLocale();
assert.equal(before, 'en', 'default locale is en');

registerLocale('xx-test', { 'common.back': '⏪' });
assert.ok(availableLocales().includes('xx-test'),
    'registerLocale exposes the new code via availableLocales()');
setLocale('xx-test');
assert.equal(t('common.back'), '⏪', 't() picks up overrides under the new locale');
setLocale('en');
assert.equal(t('common.back'), 'Back', 'switching back restores English');

console.log('locale-sync smoke OK');
