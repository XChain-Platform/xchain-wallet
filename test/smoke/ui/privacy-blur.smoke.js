// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §26 Lock & Panic — Step 3 — G069 — Privacy blur on window
// blur. Asserts hook + gate + CSS + provider wiring.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const hookSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'hooks', 'usePrivacyBlur.js'),
    'utf8',
);
const gateSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'PrivacyBlurGate.jsx'),
    'utf8',
);
const providerSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'MessagingProvider.jsx'),
    'utf8',
);
const tokensCss = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'ui', 'tokens.css'),
    'utf8',
);

// --- hook: enabled gating ---------------------------------------------

assert.match(
    hookSrc,
    /if \(!enabled\)/,
    'hook short-circuits when disabled',
);
assert.match(
    hookSrc,
    /applyAttr\(false\)/,
    'hook clears attribute when disabled',
);

// --- hook: focus + visibility listeners --------------------------------

assert.match(
    hookSrc,
    /window\.addEventListener\('blur', sync\)/,
    'subscribes to window blur',
);
assert.match(
    hookSrc,
    /window\.addEventListener\('focus', sync\)/,
    'subscribes to window focus',
);
assert.match(
    hookSrc,
    /document\.addEventListener\('visibilitychange', sync\)/,
    'subscribes to visibilitychange',
);

// --- hook: cleanup on unmount + when disabled --------------------------

assert.match(
    hookSrc,
    /window\.removeEventListener\('blur', sync\)/,
    'detaches blur listener on cleanup',
);
assert.match(
    hookSrc,
    /window\.removeEventListener\('focus', sync\)/,
    'detaches focus listener on cleanup',
);
assert.match(
    hookSrc,
    /document\.removeEventListener\('visibilitychange', sync\)/,
    'detaches visibilitychange listener on cleanup',
);

// --- hook: hidden-state composition ------------------------------------

assert.match(
    hookSrc,
    /document\.visibilityState === 'hidden'/,
    'reads visibilityState',
);
assert.match(
    hookSrc,
    /document\.hasFocus\(\)/,
    'falls back to document.hasFocus()',
);

// --- hook: SSR / non-DOM safety ----------------------------------------

assert.match(hookSrc, /typeof document === 'undefined'/, 'document guard');
assert.match(hookSrc, /typeof window === 'undefined'/, 'window guard');

// --- hook: data-attribute name ----------------------------------------

assert.match(
    hookSrc,
    /const ATTR = 'xcPrivacyBlur'/,
    'data attribute name pinned',
);
assert.match(
    hookSrc,
    /root\.dataset\[ATTR\] = TRUE/,
    'sets attribute via dataset',
);
assert.match(
    hookSrc,
    /delete root\.dataset\[ATTR\]/,
    'removes attribute when not blurred',
);

// --- gate: reads settings + invokes hook ------------------------------

assert.match(gateSrc, /useSettings/, 'gate consumes useSettings');
assert.match(gateSrc, /usePrivacyBlur/, 'gate calls usePrivacyBlur');
assert.match(
    gateSrc,
    /Boolean\(settings\?\.privacy\?\.blurOnBlur\)/,
    'gate derives enabled from settings.privacy.blurOnBlur',
);
assert.match(gateSrc, /return null/, 'gate renders nothing');

// --- provider: mounts the gate next to children -----------------------

assert.match(
    providerSrc,
    /import \{ PrivacyBlurGate \}/,
    'MessagingProvider imports PrivacyBlurGate',
);
assert.match(
    providerSrc,
    /<PrivacyBlurGate \/>/,
    'MessagingProvider renders PrivacyBlurGate',
);

// --- CSS rule keyed off the data attribute ---------------------------

assert.match(
    tokensCss,
    /html\[data-xc-privacy-blur="true"\] body/,
    'CSS targets the data attribute',
);
assert.match(tokensCss, /filter: blur\(/, 'applies a blur filter');
assert.match(tokensCss, /transition: filter var\(--xc-transition\)/, 'transition uses motion token');

console.log('privacy-blur smoke OK');
