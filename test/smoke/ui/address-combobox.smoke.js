// Smoke for §29 Send/Receive — Step 1 — AddressCombobox primitive.
//
// Source-level static checks: imports, exports, ARIA hooks, keyboard
// nav, callback wiring, CSS hooks. No jsdom — pure file inspection.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const cmp = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'ui', 'AddressCombobox.jsx'),
    'utf8',
);
const cmpCss = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'ui', 'AddressCombobox.module.css'),
    'utf8',
);
const indexJs = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'ui', 'index.js'),
    'utf8',
);

// --- public API surface --------------------------------------------------

assert.match(
    cmp,
    /export const AddressCombobox = forwardRef/,
    'forwardRef-wrapped named export',
);
assert.match(
    indexJs,
    /export \{ AddressCombobox \} from '\.\/AddressCombobox\.jsx'/,
    'ui/index.js re-exports AddressCombobox',
);
assert.match(
    cmp,
    /import \{ filterSuggestions \} from '\.\.\/flows\/recentDestinations\.js'/,
    'pulls filterSuggestions from the flow helper',
);
assert.match(
    cmp,
    /import \{ Input \} from '\.\/Input\.jsx'/,
    'wraps the existing Input primitive',
);

// --- ARIA combobox semantics ---------------------------------------------

assert.match(cmp, /role="combobox"/, 'input has combobox role');
assert.match(cmp, /aria-expanded=/, 'aria-expanded is bound');
assert.match(cmp, /aria-controls=\{listboxId\}/, 'aria-controls points at the listbox');
assert.match(cmp, /aria-autocomplete="list"/, 'aria-autocomplete=list');
assert.match(cmp, /aria-activedescendant=/, 'aria-activedescendant is bound');
assert.match(cmp, /role="listbox"/, 'dropdown has listbox role');
assert.match(cmp, /role="option"/, 'options have option role');
assert.match(cmp, /aria-selected=/, 'options carry aria-selected');

// --- keyboard navigation -------------------------------------------------

for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    assert.match(cmp, new RegExp(`'${key}'`), `handles ${key}`);
}
assert.match(cmp, /onKeyDown=/, 'onKeyDown wired on the input');

// --- selection wiring ----------------------------------------------------

assert.match(
    cmp,
    /onChange\(\{\s*target:\s*\{\s*value:\s*s\.address\s*\}\s*\}\)/,
    'select() fires onChange with the picked address',
);
assert.match(cmp, /onMouseDown=/, 'mousedown selects (preempts blur)');
assert.match(
    cmp,
    /e\.preventDefault\(\)/,
    'mousedown preventDefault keeps focus / lets state settle',
);

// --- onPaste pass-through (§29.5) ----------------------------------------

assert.match(cmp, /onPaste=\{onPaste\}/, 'onPaste passed through to <Input>');

// --- CSS module hooks ----------------------------------------------------

for (const cls of ['wrap', 'dropdown', 'option', 'label', 'sublabel', 'badge']) {
    assert.match(cmpCss, new RegExp(`\\.${cls}\\s*\\{`), `CSS hook .${cls}`);
}

console.log('address-combobox smoke OK');
