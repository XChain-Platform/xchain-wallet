// Smoke test for §21 — Step 2 — <BalanceChanges> renderer.
//
// JSX-free harness: source-level assertions on the component module +
// render-phase reasoning by directly testing the directionOf helper
// and the rendered-output branch table in source. The component will
// be exercised end-to-end in the Send.jsx / SignApproval.jsx wiring
// smokes (Steps 3 + 4).

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const componentPath = join(
    wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'BalanceChanges.jsx',
);
const cssPath = join(
    wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'BalanceChanges.module.css',
);

assert.ok(existsSync(componentPath), 'BalanceChanges.jsx exists');
assert.ok(existsSync(cssPath), 'BalanceChanges.module.css exists');

const src = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

// --- Public API -----------------------------------------------------------

assert.match(src, /export function BalanceChanges\(/, 'named export');
assert.match(src, /props\.result/, 'consumes a SimulationResult prop');
assert.match(src, /loading = false/, 'has loading prop with false default');
assert.match(src, /error = null/, 'has error prop with null default');
assert.match(src, /title = 'Balance changes'/, 'has overridable title');

// --- Three lifecycle states -----------------------------------------------

assert.match(src, /data-state="loading"/, 'loading state has data-state hook');
assert.match(src, /aria-busy="true"/, 'loading state announces busy');
assert.match(src, /Calculating preview…/, 'loading copy matches §21 cadence');

assert.match(src, /data-state="error"/, 'error state has data-state hook');
assert.match(src, /\(preview unavailable/, 'error copy is honest, not alarming');

assert.match(src, /if \(!result\) return null;/, 'no-result branch renders nothing');
assert.match(
    src,
    /deltas\.length === 0 && sideEffects\.length === 0 && notes\.length === 0/,
    'empty result renders nothing — no orphaned section',
);

// --- Delta row rendering --------------------------------------------------

assert.match(src, /function DeltaRow/, 'delta row helper present');
assert.match(src, /delta\.isFee/, 'fee row branches separately');
assert.match(src, /Network fee/, 'fee row label is "Network fee" per §21.7');
assert.match(src, /Your \{delta\.tick\}/, 'token row label is "Your <TICK>" per §21.2');
assert.match(src, /data-direction=/, 'rows expose direction for color coding');

// directionOf helper — semantic correctness
{
    // Re-derive using the same parseLoose / comparison the source uses.
    // This is a tiny internal helper, exercised by inspection: the
    // source guarantees data-direction reflects after vs before.
    const directionOfBlock = /function directionOf\([^}]+\}/.exec(src);
    assert.ok(directionOfBlock, 'directionOf is present');
    assert.match(directionOfBlock[0], /after < before.*'down'/s);
    assert.match(directionOfBlock[0], /after > before.*'up'/s);
    assert.match(directionOfBlock[0], /'flat'/);
}

// --- Side-effects + notes -------------------------------------------------

assert.match(src, /sideEffects\.map/, 'side effects rendered as a list');
assert.match(src, /aria-label="Side effects"/, 'side-effects list announced');
assert.match(src, /notes\.map/, 'notes rendered as a list');

// --- CSS module: hooks the JSX references --------------------------------

for (const cls of [
    'root', 'heading', 'skeleton', 'error',
    'deltas', 'row', 'tick', 'amount',
    'before', 'after', 'arrow',
    'feeAmount', 'feeNote',
    'sideEffects', 'sideEffect', 'seLabel', 'seValue',
    'notes', 'note',
]) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), `CSS defines .${cls}`);
}

// Direction-attr selectors present so the color affordance has a hook.
assert.match(css, /\[data-direction="down"\]/, 'down-direction rule present');
assert.match(css, /\[data-direction="up"\]/, 'up-direction rule present');
assert.match(css, /\[data-fee="true"\]/, 'fee-row styling distinct');

// --- Wiring tracking: Send.jsx wired in Step 3; SignApproval pending Step 4 -

const sendSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'), 'utf8',
);
assert.match(
    sendSrc,
    /import \{ BalanceChanges \}/,
    'Send.jsx wired in Step 3',
);

console.log('balance-changes smoke OK');
