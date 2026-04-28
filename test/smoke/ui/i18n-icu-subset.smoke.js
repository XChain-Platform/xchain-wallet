// Smoke for §54 / G173 ICU subset + locales directory layout. The
// smoke runs the format helper at runtime — unlike most other smokes
// which are static-text only — because the ICU interpreter is the
// load-bearing piece and small parser bugs would slip past a regex.

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ─── Layout ────────────────────────────────────────────────────────

const localesDir = join(root, 'packages/core/src/i18n/locales');
assert.ok(
    existsSync(localesDir) && statSync(localesDir).isDirectory(),
    'i18n/locales directory exists',
);
const enDir = join(localesDir, 'en');
assert.ok(
    existsSync(enDir) && statSync(enDir).isDirectory(),
    'i18n/locales/en directory exists',
);
assert.ok(
    existsSync(join(enDir, 'index.js')),
    'i18n/locales/en/index.js exists',
);

// Back-compat shim still re-exports the dict so existing consumers
// don't have to be touched in one step.
const shimSrc = read('packages/core/src/i18n/en.js');
assert.match(
    shimSrc,
    /export \{ en \} from '\.\/locales\/en\/index\.js'/,
    'i18n/en.js still re-exports from the new path',
);

// ─── ICU interpreter ──────────────────────────────────────────────

const { format, t } = await import(
    join(root, 'packages/core/src/i18n/index.js')
);

// 1. Plain substitution.
assert.strictEqual(format('Hello {name}!', { name: 'world' }), 'Hello world!');

// 2. Plural — singular vs other.
const tmpl = '{count, plural, one {# address} other {# addresses}}';
assert.strictEqual(format(tmpl, { count: 1 }), '1 address');
assert.strictEqual(format(tmpl, { count: 2 }), '2 addresses');
assert.strictEqual(format(tmpl, { count: 0 }), '0 addresses');

// 3. Plural — `=N` exact match wins over the plural category.
const exactTmpl = '{count, plural, =0 {none} one {one} other {many}}';
assert.strictEqual(format(exactTmpl, { count: 0 }), 'none');
assert.strictEqual(format(exactTmpl, { count: 1 }), 'one');
assert.strictEqual(format(exactTmpl, { count: 5 }), 'many');

// 4. Select — exact match with fallback to `other`.
const selTmpl = '{kind, select, mainnet {Live} testnet {Testnet} other {Other}}';
assert.strictEqual(format(selTmpl, { kind: 'mainnet' }), 'Live');
assert.strictEqual(format(selTmpl, { kind: 'testnet' }), 'Testnet');
assert.strictEqual(format(selTmpl, { kind: 'regtest' }), 'Other');

// 5. Mixed — substitution alongside ICU plural in the same string.
const mixed = '{name}: {count, plural, one {# address} other {# addresses}}';
assert.strictEqual(
    format(mixed, { name: 'BTC', count: 3 }),
    'BTC: 3 addresses',
);

// 6. Missing var renders the bare placeholder so translators can spot
//    it. (Same behaviour as the original simple-substitution helper.)
assert.strictEqual(format('Hi {missing}', {}), 'Hi {missing}');

// 7. The dictionary picked up the ICU plural for home.addressCount.
assert.strictEqual(t('home.addressCount', { count: 1 }), '1 address');
assert.strictEqual(t('home.addressCount', { count: 7 }), '7 addresses');

// 8. The legacy (non-ICU) substitution path still works on existing
//    keys that use `{name}` placeholders — guards against regressions
//    in keys we haven't migrated yet.
assert.strictEqual(
    t('home.balanceUnavailable', { reason: 'offline' }),
    'Balance unavailable — offline',
);

console.log('OK — ICU subset (plural / select / mixed) + locales layout smoke');
