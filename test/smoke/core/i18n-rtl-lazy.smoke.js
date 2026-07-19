// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §54 FOLLOWUP 3 (pseudo-RTL test locale + dir switching) and
// FOLLOWUP 5 (lazy locale loading). Covers:
//   1. getDirection() classifies real RTL langs, LTR, and pseudo-rtl.
//   2. Registering + selecting pseudo-rtl flips document.documentElement
//      to dir="rtl", and switching back to en restores dir="ltr".
//   3. The pseudo-rtl dictionary mirrors every English key, wrapped so
//      hard-coded strings are visible, with ICU placeholders intact.
//   4. The lazy loader is wired via import.meta.glob and availableLocales
//      merges lazily-discoverable codes.
//
// This smoke runs under plain Node (no Vite, no jsdom), so it installs a
// minimal document stub and registers pseudo-rtl by hand; the runtime
// lazy-load path under Vite is exercised by test/unit/i18n-lazy-locale.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Minimal document stub so applyLocale() can set dir/lang. Installed
// before importing the i18n module (it reads `document` lazily, but set
// it up first regardless).
globalThis.document = { documentElement: { dir: '', lang: '' } };

const i18n = await import(join(root, 'packages/core/src/i18n/index.js'));
const { getDirection, registerLocale, setLocale, t, availableLocales } = i18n;

// ─── 1. Direction classification ──────────────────────────────────
assert.strictEqual(getDirection('en'), 'ltr', 'en is ltr');
assert.strictEqual(getDirection('en-US'), 'ltr', 'en-US is ltr');
assert.strictEqual(getDirection('ar'), 'rtl', 'ar is rtl');
assert.strictEqual(getDirection('he-IL'), 'rtl', 'he-IL is rtl (region stripped)');
assert.strictEqual(getDirection('fa'), 'rtl', 'fa is rtl');
assert.strictEqual(getDirection('ur'), 'rtl', 'ur is rtl');
assert.strictEqual(getDirection('pseudo-rtl'), 'rtl', 'pseudo-rtl is rtl');

// ─── 3. Pseudo-rtl dictionary shape ───────────────────────────────
const pseudoMod = await import(
    join(root, 'packages/core/src/i18n/locales/pseudo-rtl/index.js')
);
const pseudo = pseudoMod.default;
const { en } = await import(
    join(root, 'packages/core/src/i18n/locales/en/index.js')
);
assert.ok(pseudo && typeof pseudo === 'object', 'pseudo-rtl has a default export');
assert.deepEqual(
    Object.keys(pseudo).sort(),
    Object.keys(en).sort(),
    'pseudo-rtl mirrors every English key',
);
// Every value is bracketed (visible-clip marker) and preserves any ICU
// placeholder tokens from the English source.
for (const [key, value] of Object.entries(pseudo)) {
    assert.ok(
        value.startsWith('‏⟦') && value.endsWith('⟧'),
        `pseudo-rtl "${key}" is bracket-wrapped`,
    );
    const enPlaceholders = (en[key].match(/\{/g) || []).length;
    const psPlaceholders = (value.match(/\{/g) || []).length;
    assert.strictEqual(
        psPlaceholders, enPlaceholders,
        `pseudo-rtl "${key}" keeps ICU placeholders intact`,
    );
}

// ─── 2. dir flips on locale switch ────────────────────────────────
registerLocale('pseudo-rtl', pseudo);
assert.ok(availableLocales().includes('pseudo-rtl'), 'pseudo-rtl now available');

await setLocale('pseudo-rtl');
assert.strictEqual(
    globalThis.document.documentElement.dir, 'rtl',
    'selecting pseudo-rtl sets dir=rtl',
);
assert.strictEqual(
    globalThis.document.documentElement.lang, 'en',
    'pseudo-rtl advertises lang=en for assistive tech',
);
// A rendered string comes back wrapped (proves the live dict switched).
const back = t('common.back');
assert.ok(
    back.startsWith('‏⟦') && back.endsWith('⟧'),
    't() returns pseudo-rtl copy while that locale is active',
);

await setLocale('en');
assert.strictEqual(
    globalThis.document.documentElement.dir, 'ltr',
    'switching back to en restores dir=ltr',
);
assert.strictEqual(t('common.back'), 'Back', 'en copy restored');

// ─── 4. Lazy-loader wiring (static) ───────────────────────────────
const src = read('packages/core/src/i18n/index.js');
assert.match(
    src,
    /import\.meta\.glob\('\.\/locales\/\*\/index\.js', \{ import: 'default' \}\)/,
    'i18n/index.js enumerates locale chunks via import.meta.glob',
);
assert.match(
    src,
    /function lazyLoaderFor/,
    'i18n/index.js resolves a lazy importer per locale code',
);

console.log(
    'OK: i18n rtl + lazy smoke (direction classification, dir flip, pseudo-rtl mirror, lazy-loader wiring)',
);
