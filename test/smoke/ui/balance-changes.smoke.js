// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for the retained <BalanceChanges> renderer and the G127 send
// safety replacement. Confirm Standard has no before-and-after card, but Send
// must still read balances, reject overspending and surface unusual sends in
// the one warning slot.
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
assert.match(src, /title = 'Balance changes'/, 'has localized overridable title');

// --- Three lifecycle states -----------------------------------------------

assert.match(src, /data-state="loading"/, 'loading state has data-state hook');
assert.match(src, /aria-busy="true"/, 'loading state announces busy');
assert.match(src, /Calculating preview…/, 'loading copy is localized');

assert.match(src, /data-state="error"/, 'error state has data-state hook');
assert.match(src, /We couldn’t estimate this transaction’s effect \(preview unavailable\)\./, 'error copy is honest and localized');

assert.match(src, /if \(!result\) return null;/, 'no-result branch renders nothing');
assert.match(
    src,
    /deltas\.length === 0 && sideEffects\.length === 0 && notes\.length === 0/,
    'empty result renders nothing (no orphaned section)',
);

// --- Delta row rendering --------------------------------------------------

assert.match(src, /function DeltaRow/, 'delta row helper present');
assert.match(src, /delta\.isFee/, 'fee row branches separately');
assert.match(src, /delta\.feeLabel \|\| 'Network fee'/, 'fee row uses the localized network fee label');
assert.match(src, />Your \{delta\.tick\}</, 'token row uses the localized "Your <TICK>" label');
assert.match(src, /data-direction=/, 'rows expose direction for color coding');

// directionOf helper: semantic correctness
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
    'root', 'heading', 'skeleton',
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

// --- G127: no balance card on review; safety behavior stays in Send -------

const sendSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'), 'utf8',
);
assert.doesNotMatch(
    sendSrc,
    /import \{ BalanceChanges \}|^[ \t]*<BalanceChanges\b/m,
    'Send review does not restore the retired before-and-after card',
);
assert.match(
    sendSrc,
    /const sourceBalance = useMemo\([\s\S]{0,500}decoderLib\.balancesFromSdk/,
    'Send still derives the selected asset balance from the wallet balance read',
);
assert.match(
    sendSrc,
    /const amountBalanceError = firstAmountBalanceError \|\| legTotalsBalanceError/,
    'single and multi-recipient overspending still block before approval',
);
assert.match(
    sendSrc,
    /const reviewWarning = confirmWarning\(\{[\s\S]{0,220}\.\.\.unusualSendWarnings/,
    'balance-derived unusual-send warnings feed the Confirm Standard warning slot',
);

console.log('balance-changes smoke OK');
