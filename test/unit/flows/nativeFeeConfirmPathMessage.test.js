// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : a fee-bearing form must map NativeFeeForfeitError on the path it ACTUALLY takes.
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
// using that test counted six broken forms as correct. The invariant is per-PATH, which is
// what this pins: the catch attached to each confirm run must do the mapping.
//
// Source-level rather than behavioural on purpose. The behavioural harness
// (action-forms-confirm.test.jsx) drives these forms one at a time; this catches the case a
// NEW form is added and its confirm catch forgets the mapping, which is the way every one of
// these six regressed in the first place.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED = join(HERE, '..', '..', '..', 'packages', 'core', 'src', 'shared');

// Every surface that mounts NativeFeeToggle AND submits through the confirm pipeline, so a
// NativeFeeForfeitError can surface from its confirm catch. Forms that never map the error at
// all are the other half of  and are listed in the campaign's D-99(b), not here.
const CONFIRM_PATH_FEE_FORMS = [
    'components/PlaceOrderPanel.jsx',
    'routes/AdvancedActionsForm.jsx',
    'routes/BetFeedDetail.jsx',
    'routes/CreateBetFeedForm.jsx',
    'routes/DeployContractForm.jsx',
    'routes/DispenserForm.jsx',
    'routes/DividendForm.jsx',
    'routes/ExecuteContractForm.jsx',
    'routes/IssueTokenForm.jsx',
    'routes/SwapForm.jsx',
    'routes/TokenWizard.jsx',
];

// The catch block attached to the confirm run: from the `.run(` call, the first
// `} catch (err) {` that follows, plus its body up to the closing brace.
function confirmCatchBody(src) {
    const run = src.search(/(?:actionConfirm|confirm)\.run\(/);
    if (run < 0) return null;
    const rest = src.slice(run);
    const catchAt = rest.search(/\}\s*catch\s*\(\s*err\s*\)\s*\{/);
    if (catchAt < 0) return null;
    const from = rest.slice(catchAt);
    const end = from.indexOf('\n        }');
    return end < 0 ? from.slice(0, 800) : from.slice(0, end);
}

describe(': native-fee refusals are translated on the confirm path', () => {
    for (const rel of CONFIRM_PATH_FEE_FORMS) {
        it(`${rel} maps NativeFeeForfeitError in its confirm catch`, () => {
            const src = readFileSync(join(SHARED, rel), 'utf8');
            const body = confirmCatchBody(src);

            expect(body, `${rel}: no confirm-run catch block found`).toBeTruthy();
            // Either the inline ternary the majority use, or a form-local helper that wraps it
            // (DividendForm's nativeFeeAwareMessage). Both end in nativeFeeErrorMessage.
            const maps = /nativeFeeErrorMessage|nativeFeeAwareMessage/.test(body);
            expect(maps, `${rel}: confirm catch shows the raw error, which is wire wording ` +
                `("native-coin fee pre-flight failed (dust): ...") rather than a sentence a ` +
                `user can act on. Map it through nativeFeeErrorMessage as the sign path does.`)
                .toBe(true);
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
