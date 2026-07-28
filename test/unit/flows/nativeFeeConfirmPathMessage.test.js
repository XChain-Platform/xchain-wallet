// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : a fee-bearing form must map NativeFeeForfeitError on EVERY path it can take.
//
// Found by driving Create-token on Litecoin regtest (campaign §11.4): the form showed
// "native-coin fee pre-flight failed (dust): 0.00002000 is below the dust threshold" - the
// error's own wire wording - while DividendForm, refusing for the identical reason on the
// identical venue, showed the sentence a user can act on. The difference was not whether the
// form knew about nativeFeeErrorMessage: TokenWizard imports it and maps it correctly in
// handleSign. It maps it on the LEGACY sign path only, and the  confirm path - the one
// the wallet takes - had a bare `setFormError(err?.message)`.
//
// So "the file references nativeFeeErrorMessage" is NOT the invariant; a read-derived audit
// using that test counted six broken forms as correct, and the same audit's count of the forms
// that mapped it nowhere at all was low by six. The invariant is per-PATH, which is what this
// pins: EVERY submit catch in a fee-bearing form must do the mapping.
//
// "Submit catch" is recognised structurally rather than by a hand-kept list, because a
// hand-kept list is exactly what went stale: a catch that handles a rejected confirm
// (isUserRejection / UserRejectedError) or a bad password (InvalidPasswordError) AND writes the
// form's error state is a submit catch, on either the confirm lane or the legacy sign lane.
// A catch that does neither (a background re-check, a gated-key scan) is not, and is skipped.
//
// Source-level rather than behavioural on purpose. The behavioural harness
// (action-forms-confirm.test.jsx) drives these forms one at a time; this catches the case a
// NEW form is added, or a NEW path added to an old one, and its catch forgets the mapping -
// which is how every one of these regressed in the first place. Run against the commit before
// the sweep it reports 33 unmapped catches across 16 forms; that is its falsifiability check.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED = join(HERE, '..', '..', '..', 'packages', 'core', 'src', 'shared');

// Any surface that mounts NativeFeeToggle can surface a NativeFeeForfeitError, so the roster is
// derived from the tree rather than listed here: a new fee-bearing form is covered the day it
// mounts the toggle.
function feeBearingForms() {
    const out = [];
    for (const dir of ['components', 'routes']) {
        for (const file of readdirSync(join(SHARED, dir))) {
            if (!file.endsWith('.jsx')) continue;
            const rel = `${dir}/${file}`;
            const src = readFileSync(join(SHARED, rel), 'utf8');
            if (src.includes('NativeFeeToggle')) out.push({ rel, src });
        }
    }
    return out;
}

// Every catch block in the file, brace-matched so a nested block does not truncate the body.
function catchBlocks(src) {
    const out = [];
    const re = /catch\s*\(\s*\w+\s*\)\s*\{/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        let i = m.index + m[0].length;
        let depth = 1;
        while (i < src.length && depth > 0) {
            const c = src[i];
            if (c === '{') depth += 1;
            else if (c === '}') depth -= 1;
            i += 1;
        }
        out.push({ line: src.slice(0, m.index).split('\n').length, body: src.slice(m.index, i) });
    }
    return out;
}

const HANDLES_A_SUBMIT = /isUserRejection\(|UserRejectedError|InvalidPasswordError|user-rejected/;
const WRITES_FORM_ERROR = /setFormError|setSubmitError/;
// The inline ternary most forms use, the shared helper the  sweep introduced, or a
// form-local wrapper around either (DividendForm's nativeFeeAwareMessage).
const MAPS = /submitFailureMessage|nativeFeeErrorMessage|nativeFeeAwareMessage/;

describe(': native-fee refusals are translated on every submit path', () => {
    const forms = feeBearingForms();

    it('finds the fee-bearing forms to check (guards against an empty sweep)', () => {
        expect(forms.length).toBeGreaterThan(20);
    });

    for (const { rel, src } of forms) {
        const submitCatches = catchBlocks(src)
            .filter((c) => HANDLES_A_SUBMIT.test(c.body) && WRITES_FORM_ERROR.test(c.body));
        if (submitCatches.length === 0) continue;   // e.g. NativeFeeToggle itself
        it(`${rel} maps NativeFeeForfeitError in all ${submitCatches.length} of its submit catches`, () => {
            const unmapped = submitCatches.filter((c) => !MAPS.test(c.body)).map((c) => c.line);
            expect(unmapped, `${rel}: the catch at line ${unmapped.join(', ')} shows the raw error, `
                + 'which is wire wording ("native-coin fee pre-flight failed (dust): ...") rather '
                + 'than a sentence a user can act on. Route it through submitFailureMessage, as '
                + 'the swept forms do.').toEqual([]);
        });
    }

    it('the helper still produces a chain-appropriate sentence for a dust refusal', async () => {
        const { nativeFeeErrorMessage, NativeFeeForfeitError } =
            await import('../../../packages/core/src/sdk/nativeFeePreflight.js');
        // Reconstructed the way it reaches a form through the messaging boundary, which keeps
        // only { name, message } - the D-98 constraint the wording has to survive.
        const wire = new NativeFeeForfeitError({
            reason: 'dust', quote: { requiredFeeNative: '0.00002000' },
        });
        const crossed = { name: wire.name, message: wire.message };

        // Off Bitcoin there is no XCHAIN lane, so "turn it off" would be wrong advice.
        const ltc = nativeFeeErrorMessage(crossed, { coinTicker: 'LTC', mandatory: true });
        expect(ltc).toContain('0.00002000 LTC');
        expect(ltc).toContain('cannot be submitted here');
        expect(ltc).not.toContain('Turn off');

        // On Bitcoin it is the fix, so it must still be offered.
        const btc = nativeFeeErrorMessage(crossed, { coinTicker: 'BTC', mandatory: false });
        expect(btc).toContain('Turn off BTC fee payment');
    });
});
