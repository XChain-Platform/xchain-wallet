// Smoke for §26 Lock & Panic — Step 1 — G067 — Caps-Lock warning in Input.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const inputSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'ui', 'Input.jsx'),
    'utf8',
);
const cssSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'ui', 'Input.module.css'),
    'utf8',
);

// --- caps-lock state hooks --------------------------------------------

assert.match(inputSrc, /useState/, 'imports useState for capsLock state');
assert.match(inputSrc, /capsLockOn/, 'has capsLockOn state slot');
assert.match(inputSrc, /focused/, 'tracks focused state for password fields');

// --- detection gated on password fields -------------------------------

assert.match(
    inputSrc,
    /const isPassword = type === 'password'/,
    'gates detection on password type',
);
assert.match(
    inputSrc,
    /if \(!isPassword\) return/,
    'readCapsLock skips non-password fields',
);

// --- modifier-state read ---------------------------------------------

assert.match(
    inputSrc,
    /event\.getModifierState\('CapsLock'\)/,
    'reads CapsLock via getModifierState',
);
assert.match(
    inputSrc,
    /typeof event\.getModifierState !== 'function'/,
    'guards on missing getModifierState',
);

// --- chained handlers ------------------------------------------------

for (const handler of ['onKeyDown', 'onKeyUp', 'onFocus', 'onBlur']) {
    assert.match(
        inputSrc,
        new RegExp(`${handler}\\?\\.\\(event\\)`),
        `${handler} caller handler chained, not replaced`,
    );
}

// --- warning element + a11y ------------------------------------------

assert.match(inputSrc, /showCapsLock/, 'computes showCapsLock visibility flag');
assert.match(
    inputSrc,
    /isPassword && focused && capsLockOn/,
    'showCapsLock requires password + focused + caps-on',
);
assert.match(
    inputSrc,
    /role="status"/,
    'warning element uses status role',
);
assert.match(
    inputSrc,
    /aria-live="polite"/,
    'warning element is aria-live polite',
);
assert.match(
    inputSrc,
    /Caps Lock is on/,
    'warning copy present',
);

// --- aria-describedby includes capsLockId when shown -----------------

assert.match(
    inputSrc,
    /showCapsLock \? capsLockId : undefined/,
    'aria-describedby includes capsLockId only when warning shown',
);

// --- CSS slot ---------------------------------------------------------

assert.match(cssSrc, /\.capsLock\b/, 'capsLock style class present');
assert.match(cssSrc, /⇪/, 'capsLock icon glyph present in CSS');

console.log('input-capslock-warning smoke OK');
