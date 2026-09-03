// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Driven: the ticker grammar gap is CLOSED, and this file is the
// record of it on a real venue.
//
// WHAT THIS FILE MEASURED. A delta: the set of names the chain
// admitted and the wallet would not let anybody type. Both authoring surfaces
// gated on `/^[A-Za-z0-9]+$/` (TokenWizard.jsx, IssueTokenForm.jsx) and both
// inputs uppercased on every keystroke, so symbol-bearing ticks were refused
// with a message and lowercase ones were silently rewritten under the user's
// cursor. Every assertion was of the form "the chain says yes and the form says
// no", both halves driven in the same run against the same venue.
//
// THE OPERATOR RULING, 2026-08-29: widen to the SYMBOL class and drop the
// uppercase coercion on both surfaces; leave the caret closed until its
// admission path is settled. So the delta this file measured is now the delta
// it DEFENDS, and every leg that once asserted a refusal asserts an
// acceptance, in the same shape and against the same authority.
//
// THE TWO RULES AS THEY STAND, QUOTED FROM HEAD.
//
//   CHAIN (xchain-indexer/src/config.js):
//     TICK_CHARACTERS  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ
//                       0123456789~!@#$%^&*()_+-={}[]:<>.?'
//     MIN_TICK_LENGTH  1
//     MAX_TICK_LENGTH  250
//   enforced in `issue.js` as an allowlist loop ("invalid: TICK (character)")
//   plus a length band ("invalid: TICK (length)"). `xchain-sdk/src/validator.js`
//   mirrors it byte for byte (TICK_REGEX, MAX_TICK_LENGTH 250).
//
//   WALLET, both authoring surfaces, now reading ONE module:
//     packages/core/src/shared/utils/tickerGrammar.js
//   which is TICK_CHARACTERS minus `^` and the same 1..250 band. No case
//   coercion anywhere: the input keeps what was typed and the params builder
//   passes it through. The dot stays out of the fields that COIN a name,
//   because `issue.js` reads `A.B` as a child of `A` and answers "parent
//   unknown" only after the miner fee is spent; the wizard's Parent ticker
//   field, which references a token that already exists, takes it.
//
// WHY THE CARET IS STILL REFUSED, and it is the one place this file still
// measures a deliberate narrowing rather than agreement. `^999999` quotes
// `valid` at the venue, but `db.js createTicker` never inserts a literal `^…`
// row (issue.js:295-305), so a caret ISSUE can land valid with a NULL ticker
// id, and the dotted caret form is only refused above the BATCH_ISSUANCE_LIMITS
// v2 flag. The wallet refusing a shape whose admission path is unsettled is a
// decision, not a defect, and the caret step below pins it as one so that
// opening it later is a deliberate edit to this file rather than a silent drift.
//
// WHAT WOULD BE FALSE IF THIS PASSED VACUOUSLY. Three things, each with a
// control in the run:
//   - "the chain accepts these" is asserted against the venue's own /feequote,
//     not against the config file above, so a chain that had quietly narrowed
//     fails here rather than being argued with.
//   - "the form accepts these" is asserted by reaching the confirm screen, and
//     the SAME helper is asserted to find the grammar refusal on the caret. A
//     helper that could never reach a confirm screen would fail the acceptance
//     legs; one that never found a refusal would fail the caret leg.
//   - a plain alphanumeric CONTROL tick is driven through both sides first, so
//     a venue that refuses everything, or a form that refuses everything,
//     cannot produce a green.
//
// ONE LEG BROADCASTS, and it is the point of the file: a symbol-bearing tick is
// issued for real and its balance is read back off the explorer, because
// "the form let me type it" and "the chain took it" are different claims and
// only the second one closes the item. Every other leg stops at the confirm
// screen or earlier.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/tokens/ticker-grammar.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal,
    fundAddress,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
    warmFeeQuote,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** One leg here pays a real protocol fee on top of the miner fees. */
const FUNDING = 4;
const SUPPLY = 1000;
const STAMP = Date.now().toString().slice(-6);

/**
 * The native ticker of the chain this run drives, derived from the explorer
 * coin code rather than hardcoded: RBTC -> BTC, RLTC -> LTC, RDOGE -> DOGE.
 *
 * The wallet labels its fee row with this (`PROTOCOL_COIN_TICKER[coin]`, which
 * is the MAINNET ticker on every network), so a spec that read `REGTEST_COIN`
 * straight would look for "RLTC" in copy that says "LTC".
 */
const NATIVE_TICKER = REGTEST_COIN.replace(/^R/, '');

/**
 * Whether this chain's protocol fee can ONLY be settled with a native-coin
 * output. Mirrors `registry/nativeFee.js` isNativeFeeMandatory, which is
 * `ticker !== 'BTC'` for every protocol coin, and the indexer's own
 * `utility.detectFeePaymentMode` ("LTC/DOGE: native coin is the only option;
 * missing fee output = rejected").
 */
const NATIVE_FEE_MANDATORY = NATIVE_TICKER !== 'BTC';

/**
 * The two refusals the widened grammar still produces, matched on their
 * distinguishing clause rather than on the whole sentence.
 *
 * Both surfaces now share one module, so the copy is identical apart from the
 * field noun ("Token name" in the wizard, "Ticker" in the direct form). The
 * noun is what tells the two surfaces apart, and the direct-form step below
 * asserts on it for exactly that reason.
 */
const CARET_REFUSAL = /reserved for token IDs/;
const CHARACTER_REFUSAL = /can only use letters, numbers/;

/**
 * The symbol classes: ticks the chain's allowlist accepts, and the wallet ought not
 * to refuse outright.
 *
 * Every symbol here is a literal member of TICK_CHARACTERS. Measured at the
 * venue's own /feequote on 2026-08-27, each reads `status: valid`.
 */
// Five, not the whole symbol set, and the ceiling is the run's own clock rather
// than taste: each class costs a full wizard walk (reload, unlock, template,
// chain, details) and a seeded venue price lives 1800s of CHAIN time that every
// one of those walks burns. Five spans the shapes that differ mechanically
// (leading-position symbol, trailing symbol, symbols the encoder must not treat
// as delimiters) and leaves headroom for the broadcast leg. The exhaustive
// per-character sweep is `test/unit/utils/tickerGrammar.test.js`, which needs
// no venue at all.
const SYMBOL_CLASSES = [
    { klass: 'hyphen', tick: `TGR${STAMP}-1` },
    { klass: 'underscore', tick: `TGR${STAMP}_1` },
    { klass: 'percent', tick: `TGR${STAMP}%1` },
    { klass: 'dollar', tick: `TGR${STAMP}$` },
    { klass: 'tilde inside', tick: `TGR${STAMP}~1` },
];

/**
 * The one tick this file actually issues.
 *
 * A dollar sign, because it is the class the ledger entry named first and it
 * survives every hop it has to cross to get here: the action string's own
 * delimiters are `|` and `;`, neither of which is on the allowlist at all.
 */
const ISSUED_TICK = `TGI${STAMP}$`;

/**
 * The tick-ID form, held closed on purpose. See the header.
 *
 * It is asserted REFUSED here rather than left out of the file, because "the
 * wallet does not author this yet" is a decision with a reason and an unpinned
 * decision is indistinguishable from an oversight.
 */
const CARET_TICK = '^999999';

/** The control: plainly alphanumeric, so both sides must say yes. */
const CONTROL_TICK = `TGC${STAMP}`;

/**
 * A 250-character tick, which is exactly MAX_TICK_LENGTH.
 *
 * Alphanumeric on purpose: the point is the LENGTH, and mixing a symbol in
 * would let the character rule take the credit for a refusal this step
 * attributes to length.
 */
const OVERLONG_TICK = `TGL${STAMP}`.padEnd(250, 'Z');

/**
 * Six single-character candidates, spread across the alphabet and rotated by
 * the run's stamp.
 *
 * There are only 36 single-character ticks in existence and this venue is
 * shared, so any ONE of them may already be issued. Probing a handful and
 * taking the first free one keeps the leg about the grammar instead of about
 * who got here first; needing all six to be taken would itself be a venue
 * fact worth failing on.
 */
const SINGLE_CHAR_CANDIDATES = (() => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const start = Number(STAMP) % alphabet.length;
    return Array.from({ length: 6 }, (_, i) => alphabet[(start + i * 7) % alphabet.length]);
})();

/**
 * The chain's own verdict on an ISSUE of `tick`, with no wallet involved.
 *
 * `warmFeeQuote` rather than a bare fetch, because the explorer's fee-quote hop
 * intermittently 502s on its 5s indexer timeout and a single cold read at the
 * top of a spec is the worst possible moment to find that out (see the helper's
 * own header).
 */
async function chainVerdict(tick, source) {
    const quote = await warmFeeQuote({ action: 'ISSUE', params: `0|${tick}`, source });

    // AN ABSENT STATUS IS NOT A VERDICT, AND CONFLATING THE TWO COST THIS SPEC
    // FOUR RUNS OF WRONG CONCLUSIONS.
    //
    // `String(quote?.status)` handed back the literal "undefined" here,
    // which every caller then compared against 'valid' and reported as
    // "the venue refuses the <class> class". Four ticker classes were written up
    // that way, and one of them escalated into a claim that the indexer's own
    // config constants do not describe what this venue admits. Probed directly
    // on 2026-08-27, every one of those classes reads `status: valid`, and a
    // genuine refusal always carries a NAMED reason (`invalid: TICK (length)`,
    // `invalid: issued by another address`). The venue never answers
    // `undefined`.
    //
    // What produces it is the VENUE PRICE LAPSING MID-RUN. A seeded price lives
    // `ORACLE_MAX_PRICE_AGE_SECONDS` (1800s) of CHAIN time, this spec's budget
    // is 2400s of wall time, and every wizard action it drives mines blocks that
    // burn that chain time - so a long run outlives its own price and
    // `warmFeeQuote` starts returning an error body with a `code` and no
    // `status`. The tell is which steps fail: the early classes pass and the
    // late ones "get refused", which is a clock, not a grammar rule.
    //
    // So: re-seed once and ask again, because a lapsed price is a venue state
    // this spec can repair rather than a fact about the wallet. If it is still
    // unreadable after that, throw loudly and quote what came back. A spec that
    // cannot read the chain's answer must say so rather than answer for it.
    if (!quote || typeof quote.status !== 'string') {
        await seedPrices();
        const retry = await warmFeeQuote({ action: 'ISSUE', params: `0|${tick}`, source });
        if (retry && typeof retry.status === 'string') return retry.status;
        throw new Error(
            `the venue returned no verdict for ISSUE of "${tick}" - this is NOT a refusal and must `
            + 'never be recorded as one. The usual cause is the seeded venue price having lapsed '
            + `mid-run (it lives ${'1800'}s of CHAIN time and every action here mines blocks), which `
            + 'makes the action unpriceable rather than invalid. Re-seed the price and re-run. '
            + `Raw quote: ${JSON.stringify(quote)}`,
        );
    }
    return quote.status;
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Closes an open confirm screen, if one is open, without signing anything.
 *
 * THIS FILE NEEDS IT AND NO OTHER TOKEN SPEC DOES, because every other spec
 * Approves what it composes. Here the accepted cases exist only to prove the
 * grammar rule let them through, so each one leaves a confirm screen standing
 * that the NEXT case has to get out of. It cannot be left to a reload: the
 * shell restores the route it was on, so a reload from the confirm screen
 * unlocks and then waits out `unlockAfterReload`'s whole budget on Home's
 * balance hero, which never renders.
 *
 * Reject, not the header chevron, though both are wired to the same handler
 * (`PageHeader onBack={onReject}`): the footer pair is what the campaign's own
 * ruling names as the only two confirm buttons, and it is rendered
 * unconditionally whenever the screen is, so its presence is a reliable proxy
 * for "a confirm screen is up". Nothing is signed at this point, so rejecting
 * costs nothing and spends nothing.
 */
async function dismissConfirmIfOpen(page) {
    const reject = page.getByTestId('confirm-reject');
    if (await reject.count() === 0) return;
    await reject.first().click();
    await expect(page.getByTestId('confirm-modal'),
        'Reject did not close the confirm screen, so the next case cannot navigate')
        .toBeHidden({ timeout: 30_000 });
}

/**
 * Reloads onto a clean, unlocked Home.
 *
 * Navigating to Home FIRST is load-bearing: the shell restores the route it was
 * on and `unlockAfterReload` waits for Home's balance hero, so a reload from
 * anywhere else unlocks correctly and then times out on a healthy wallet
 * (campaign §3.5, Session 32).
 */
async function reloadToHome(page) {
    await dismissConfirmIfOpen(page);
    await gotoPalette(page, 'Home');
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
}

/**
 * Walks the Create-token wizard to its details stage on the Custom template and
 * returns the `main` scope.
 *
 * Custom because it is the template with a bare `Supply` field and no extra
 * required inputs, so nothing but the ticker can be the reason a submit is
 * refused.
 *
 * `selectVenueChain` is NOT optional here even though `switchToRegtest` has
 * already run: that only flips the NETWORK, and every form defaults to Bitcoin.
 * A wizard driven without this composes on the wrong chain while the fixture
 * reads this one's explorer.
 */
async function openWizardDetails(page) {
    await reloadToHome(page);
    await gotoPalette(page, 'Create a token');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: /^Custom/ }).click();
    await selectVenueChain(main);
    await main.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(main.getByLabel('Token name (ticker)'),
        'the wizard never reached its details stage, so no ticker was ever offered to it')
        .toBeVisible({ timeout: 30_000 });
    return main;
}

/**
 * Types `tick` into the wizard's name field, submits, and reports what the form
 * did about it.
 *
 * A FRESH STAGE PER CASE, and that is not tidiness. `formError` is only cleared
 * by a SUCCESSFUL submit (`setFormError(null)` immediately before
 * `openConfirmScreen`), so the error banner is sticky: a second case driven on
 * the same stage would read the first case's message and every refusal after
 * the first would be unattributable.
 *
 * Returns what the FIELD held after filling as well as the verdict, because the
 * two were different questions on this surface: the input uppercased on
 * change, so "what the user typed" and "what the form validated" were not the
 * same string. The grammar module removed the coercion, and `held` is what proves it.
 */
/**
 * The shared confirm wait, with the venue's rate limit turned into a SKIP.
 *
 * When the shared explorer refuses a read mid-compose the wallet says
 * so in its own words ("The service that reads the chain is temporarily
 * unavailable (error 429). Nothing was signed or sent") and correctly never
 * opens the confirm screen. Every leg here that broadcasts goes through this,
 * because a red carrying that sentence is about the venue's rate limit and not
 * about a ticker grammar rule - the file's own messages already say so, and a
 * reader still has to re-derive it before ignoring the failure.
 */
async function confirmOrSkipOnRateLimit(page, what = 'this action', timeoutMs = 60_000) {
    try {
        return await expectConfirmModal(page, what, timeoutMs);
    } catch (err) {
        test.skip(/error 429/i.test(String(err?.message || '')),
            `the shared explorer rate-limited the wallet mid-compose - ${err?.message || err}`);
        throw err;
    }
}

async function submitWizardName(page, tick) {
    const main = await openWizardDetails(page);
    const field = main.getByLabel('Token name (ticker)');
    await field.fill(tick);
    const held = await field.inputValue();
    await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();

    const grammar = page.getByRole('alert')
        .filter({ hasText: /Token name (?:cannot|can only use|is required)/ });
    const confirm = page.getByTestId('confirm-modal');
    // Raced rather than waited on in sequence: a refused submit never composes
    // and an accepted one never shows a grammar error, so whichever appears IS
    // the verdict. The catch matters for the over-long leg, where a compose can
    // legitimately fail for a reason that is not the grammar rule - that is
    // still a form that got PAST the rule, which is all this measures.
    let settled = true;
    await grammar.or(confirm).first().waitFor({ state: 'visible', timeout: 150_000 })
        .catch(() => { settled = false; });

    const refusedOnGrammar = await grammar.count() > 0;
    const reachedConfirm = await confirm.count() > 0;
    const alerts = page.getByRole('alert');
    const alertText = await alerts.count() > 0
        ? String(await alerts.first().innerText()).trim()
        : '';
    return { held, refusedOnGrammar, reachedConfirm, settled, alertText };
}

test.describe(`ticker grammar on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    // THE HISTORY, KEPT BECAUSE HOW THIS WENT WRONG IS THE LESSON.
    //
    // This file spent four runs concluding that the chain refused the classes
    // it was measuring, and therefore that the wallet was AGREEING with the
    // chain rather than narrowing it. That conclusion rested entirely on
    // `chainVerdict` returning `undefined`, which was read as a refusal. It is
    // not one.
    //
    // Probed directly against `/RLTC/api/feequote`, one call per class, with a
    // plain-alphanumeric control in the same batch:
    //
    //   F, 8            (single character)   status=valid
    //   ^999999         (tick-ID form)       status=valid
    //   JDOG$, WOW!, A~B (symbol-bearing)    status=valid
    //   jdogtest        (lowercase)          status=valid
    //   250 x "A"       (at MAX_TICK_LENGTH) status=valid
    //   251 x "A"       (over it)            status=`invalid: TICK (length)`
    //
    // So the endpoint answers a refusal with a NAMED REASON and never with
    // `undefined`, the constants describe the venue correctly, and the
    // `undefined` was this harness returning without a status (a timed-out or
    // busy quote), not the chain saying no. **An absent field is not a verdict**
    // - that is the mistake, and `chainVerdict` treats an unreadable answer as
    // unreadable rather than as "refused".
    //
    // What that restored was the row's original premise, narrower but real, and
    // tracked: symbol-bearing ticks refused with an error and
    // lowercase ones silently rewritten, three shapes the chain admits and
    // nobody could type. The operator ruled on 2026-08-29 to widen to the
    // symbol class and drop the coercion, leaving the caret closed, and this
    // file now defends that outcome.
    test('the Create token form authors every ticker shape the chain accepts', async ({ page }) => {
        /** The wallet's only address on this chain, and the source every quote is taken from. */
        let source;

        await test.step('onboard, and fund the one address so a compose is possible at all', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Ticker Grammar Wallet' });
            await switchToRegtest(page, PASSWORD);

            // Read off the DIRECT Issue form, which is the surface with a
            // "From" field; the wizard auto-picks its signer and shows it only
            // on the subtoken template's chain step.
            await gotoPalette(page, 'Issue token');
            const probe = page.getByRole('main');
            await expect(probe.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(probe);
            source = await probe.getByLabel('From').inputValue();
            expect(source, `the wallet has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await seedPrices();
        });

        await test.step('THE CONTROL: a plain alphanumeric tick passes on both sides', async () => {
            // Without this, every assertion below is satisfiable by a dead
            // venue (refuses everything) or a broken form (refuses everything).
            expect(await chainVerdict(CONTROL_TICK, source),
                'the venue will not price even a plain alphanumeric ISSUE, so nothing below is '
                + 'measuring a grammar rule')
                .toBe('valid');

            const verdict = await submitWizardName(page, CONTROL_TICK);
            // A skip rather than a red: when the shared explorer
            // rate-limits a read mid-compose the wallet says so in its own words
            // and correctly never opens the confirm screen. The control below
            // then reports "never reached the confirm screen", which is true and
            // is about the venue - this spec's own message already says as much,
            // and a red that says "venue state, not a grammar rule" is one the
            // next reader has to re-derive before ignoring.
            test.skip(/error 429/i.test(String(verdict.alertText || '')),
                'the shared explorer rate-limited the wallet mid-compose, so the control '
                + `ISSUE never reached a confirm screen - ${verdict.alertText}`);
            expect(verdict.refusedOnGrammar,
                'the wizard refused a plainly alphanumeric ticker, so every acceptance below '
                + 'would be measuring a form that is broken in some other way')
                .toBe(false);
            expect(verdict.reachedConfirm,
                `a plain ISSUE of ${CONTROL_TICK} never reached the confirm screen `
                + `(${verdict.alertText || 'no alert either'}). Venue state, not a grammar rule`)
                .toBe(true);
        });

        await test.step('THE FIX: five symbol classes the chain allows and the form now authors', async () => {
            for (const { klass, tick } of SYMBOL_CLASSES) {
                // The chain's half first, so the acceptance below is measured
                // against something rather than believed. Every one of these
                // characters is a literal member of TICK_CHARACTERS.
                expect(await chainVerdict(tick, source),
                    `the venue refuses the ${klass} class (${tick}), so the wallet accepting it `
                    + 'would be composing an ISSUE that cannot land. TICK_CHARACTERS has narrowed, '
                    + 'or this venue runs an older indexer')
                    .toBe('valid');

                const verdict = await submitWizardName(page, tick);
                expect(verdict.held,
                    `the name field rewrote the ${klass} class under the user's cursor`)
                    .toBe(tick);
                expect(verdict.refusedOnGrammar,
                    `the wizard refused the ${klass} class (${tick}) on grammar, so the widened grammar has `
                    + `regressed on this surface (alert: ${verdict.alertText})`)
                    .toBe(false);
                expect(verdict.reachedConfirm,
                    `the ${klass} class never reached the confirm screen `
                    + `(${verdict.alertText || 'no alert either'})`)
                    .toBe(true);
            }
        });

        await test.step('THE DRIVE: a symbol-bearing token is issued for real and lands', async () => {
            // The leg that closes the item. Everything above proves the FORM
            // stopped refusing; only this proves the chain takes what the form
            // now composes, which is the claim the ledger entry actually makes.
            //
            // Re-seeded first: this is the only leg that BROADCASTS, and the
            // five walks above have burned chain time against a price that
            // lives 1800s of it. A lapsed price makes the compose unpriceable,
            // which would fail this step for a reason that has nothing to do
            // with the ticker.
            await seedPrices();
            expect(await chainVerdict(ISSUED_TICK, source),
                'the venue will not price the tick this step issues').toBe('valid');

            const main = await openWizardDetails(page);
            await main.getByLabel('Token name (ticker)').fill(ISSUED_TICK);
            await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await confirmOrSkipOnRateLimit(page, 'this action', 90_000);
            const approve = page.getByTestId('confirm-approve');
            await expect(approve).toBeEnabled({ timeout: 120_000 });
            await approve.click();
            const shell = page.getByRole('main');
            await expect(shell, 'no transaction id ever appeared after Approve')
                .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
            const txid = (await shell.innerText()).match(/[0-9a-f]{64}/)?.[0];

            const action = await waitForValidAction(txid);
            // The chain's own record of the name, which is the half that proves
            // no hop between the input and the ledger rewrote it.
            expect(String(action?.tick ?? action?.params?.TICK ?? ''),
                'the settled action does not carry the symbol-bearing tick that was typed')
                .toBe(ISSUED_TICK);
            await waitForTokenBalance(source, ISSUED_TICK, SUPPLY);
        });

        await test.step('THE CARET: still refused, and that is a decision rather than a defect', async () => {
            // `createTicker` never inserts a literal `^…` row, so a caret ISSUE
            // can land valid with a NULL ticker id. The venue prices it all the
            // same, which is exactly why this is asserted against the venue: it
            // is the one class where the wallet is deliberately narrower than
            // the chain, and an unpinned deliberate narrowing is
            // indistinguishable from an oversight.
            expect(await chainVerdict(CARET_TICK, source),
                'the venue no longer prices the caret form, so the reason this class is held '
                + 'closed may have changed. Re-read issue.js before opening it')
                .toBe('valid');

            const verdict = await submitWizardName(page, CARET_TICK);
            expect(verdict.refusedOnGrammar,
                'the wizard now authors a caret ticker. If the admission path was settled, this '
                + `step is the record of it and must be rewritten deliberately (${verdict.alertText})`)
                .toBe(true);
            expect(verdict.alertText,
                'the caret refusal no longer explains itself, so a user reaching for the tick-ID '
                + 'form is told only that some character is wrong')
                .toMatch(CARET_REFUSAL);
            expect(verdict.reachedConfirm,
                'a ticker the wizard refused still reached the confirm screen (caret)')
                .toBe(false);
        });

        await test.step('and what the CHAIN refuses, the form still refuses too', async () => {
            // The other side of the widening: it opened the allowlist, it did
            // not remove the rule. A space is not in TICK_CHARACTERS at all, so
            // letting it through would only move the refusal to a screen that
            // costs a round trip.
            const verdict = await submitWizardName(page, `TG ${STAMP}`);
            expect(verdict.refusedOnGrammar,
                'the wizard composes a ticker with a space in it, which issue.js rejects as '
                + '"invalid: TICK (character)" after the miner fee is spent')
                .toBe(true);
            expect(verdict.alertText).toMatch(CHARACTER_REFUSAL);

            // And the dot, which is the subtler one: it IS on the chain's
            // allowlist, so a character check would let it through, and the
            // ISSUE it composes is a CHILD of a parent this wallet does not
            // own. That is refused as `invalid: TICK (parent unknown)` with the
            // miner fee already spent, so the wizard names its Subtoken
            // template instead.
            const dotted = await submitWizardName(page, `TG${STAMP}.KID`);
            expect(dotted.refusedOnGrammar,
                'the wizard composes a dotted ticker from a name field, which the chain reads as '
                + 'a subtoken issuance and refuses at a cost')
                .toBe(true);
            expect(dotted.alertText).toMatch(/cannot contain a dot/);
        });

        await test.step('a 1-character tick is authorable, as MIN_TICK_LENGTH says', async () => {
            let single = null;
            const seen = [];
            for (const candidate of SINGLE_CHAR_CANDIDATES) {
                const status = await chainVerdict(candidate, source);
                seen.push(`${candidate}:${status}`);
                if (status === 'valid') { single = candidate; break; }
            }
            // Every single-character tick is a name somebody else may already
            // hold, and this venue is shared. A venue with none free is a fact
            // about the venue, not about the wallet, so it is recorded rather
            // than failed on. Give this a free one and the leg runs.
            if (!single) {
                test.info().annotations.push({
                    type: 'venue-limit',
                    description: 'no single-character tick was admitted, though MIN_TICK_LENGTH is 1: '
                        + `${seen.join(', ')}. The 1-character class is UNPROVEN here, in either direction.`,
                });
                return;
            }

            const verdict = await submitWizardName(page, single);
            expect(verdict.refusedOnGrammar,
                `the wizard refused the 1-character tick ${single}, so a length rule has been `
                + 'added somewhere since this was measured')
                .toBe(false);
            expect(verdict.reachedConfirm,
                `a 1-character ISSUE of ${single} never reached the confirm screen `
                + `(${verdict.alertText || 'no alert either'})`)
                .toBe(true);
        });

        await test.step('a 250-character tick clears the grammar rule too', async () => {
            expect(OVERLONG_TICK.length, 'the over-long fixture is not MAX_TICK_LENGTH').toBe(250);

            // A 250-character tick is far past the ~80 bytes a bare OP_RETURN
            // carries, so an ISSUE naming one needs the chunked multisig
            // encoding lane. "The encoder could not fit it" and "the protocol
            // forbids it" are different findings with different owners, and
            // this step cannot tell them apart, so a venue that will not price
            // it is recorded rather than failed on.
            if (await chainVerdict(OVERLONG_TICK, source) !== 'valid') {
                test.info().annotations.push({
                    type: 'venue-limit',
                    description: 'a tick at exactly MAX_TICK_LENGTH (250) was not admitted, though the '
                        + 'indexer config allows it. Likely the chunked-encoding lane rather than a '
                        + 'grammar rule; UNPROVEN in either direction here.',
                });
                return;
            }

            const verdict = await submitWizardName(page, OVERLONG_TICK);
            expect(verdict.held.length,
                'the name field truncated a 250-character ticker, so it has grown a maxLength '
                + 'since this was measured (the Description and Image URL inputs beside it carry '
                + 'one at 250; neither ticker input did)')
                .toBe(250);
            // Asserted on the GRAMMAR rule alone, deliberately. Whether a
            // 250-character OP_RETURN payload then composes is an encoder
            // question, and this file is about the wallet's ticker rule.
            expect(verdict.refusedOnGrammar,
                'the wizard refused a 250-character alphanumeric ticker on grammar, though the '
                + 'rule allows exactly MAX_TICK_LENGTH')
                .toBe(false);
        });

        await test.step('THE COERCION IS GONE: lowercase survives the field and the compose', async () => {
            // The silent half of the defect, and the reason it gets its own
            // step: the old rule ACCEPTED lowercase and the input rewrote it
            // anyway (`onChange={(e) => setName(e.target.value.toUpperCase())}`),
            // so there was no message, no warning and nothing to appeal to. A
            // step that only looked for an error would have called this class
            // authorable both before the fix and after it, which is why this
            // one reads the field back.
            const lower = `tgw${STAMP}`;
            expect(await chainVerdict(lower, source),
                'the venue refuses a lowercase tick, so the wallet keeping the case as typed '
                + 'would be composing an ISSUE that cannot land')
                .toBe('valid');

            const verdict = await submitWizardName(page, lower);
            expect(verdict.held,
                'the name field rewrote a lowercase ticker under the user\'s cursor, so the '
                + 'uppercase coercion the grammar module removed is back')
                .toBe(lower);
            expect(verdict.reachedConfirm,
                `a lowercase ISSUE of ${lower} never reached the confirm screen `
                + `(${verdict.alertText || 'no alert either'})`)
                .toBe(true);

            // The hint is the only disclosure a user gets about the rule, so it
            // is worth an assertion: it once ended "Uppercase.", which was the
            // one place the coercion was admitted to.
            const main = await openWizardDetails(page);
            expect(await main.getByText(/Uppercase\./).count(),
                'the ticker hint still promises to uppercase what is typed, which is the one '
                + 'place the coercion was ever disclosed')
                .toBe(0);
            await expect(main.getByText(/Case is kept exactly as typed/).first(),
                'the ticker field no longer discloses its rule at all')
                .toBeVisible({ timeout: 15_000 });
        });

        await test.step('the DIRECT Issue form widened identically, so the two surfaces agree', async () => {
            // The ruling had to move both surfaces or neither, so the second
            // one is measured here rather than assumed from a shared import.
            // Its refusal copy is its OWN string ("Ticker cannot ...", not
            // "Token name cannot ..."), which is what proves this leg drove the
            // other form.
            const { tick } = SYMBOL_CLASSES[0];
            await reloadToHome(page);
            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            const field = main.getByLabel('Ticker');
            await field.fill(tick.toLowerCase());
            expect(await field.inputValue(),
                'the direct form still uppercases what is typed, so the two surfaces have drifted '
                + 'apart on the coercion')
                .toBe(tick.toLowerCase());

            await field.fill(tick);
            await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expect(page.getByTestId('confirm-modal'),
                'the direct Issue form refused a symbol-bearing ticker, so the two authoring '
                + 'surfaces have drifted apart on the ticker rule')
                .toBeVisible({ timeout: 90_000 });
            await dismissConfirmIfOpen(page);

            // And its caret refusal, named on this surface's own noun.
            await reloadToHome(page);
            await gotoPalette(page, 'Issue token');
            const second = page.getByRole('main');
            await expect(second.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(second);
            await second.getByLabel('Ticker').fill(CARET_TICK);
            await second.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
            await second.getByRole('button', { name: 'Issue token', exact: true }).click();

            const alert = page.getByRole('alert').filter({ hasText: /Ticker cannot contain \^/ });
            await expect(alert,
                'the direct Issue form now authors a caret ticker while the wizard refuses one')
                .toBeVisible({ timeout: 60_000 });
            expect(await page.getByTestId('confirm-modal').count(),
                'a ticker the direct form refused still reached the confirm screen')
                .toBe(0);
        });

        await test.step('the fee lane this chain offers, which is why the XCHAIN-fee leg is unrun here', async () => {
            // Not a grammar assertion, and it is here on purpose: it is the
            // measured reason the second test in this file cannot run on this
            // venue, taken off the screen rather than argued from source.
            const main = await openWizardDetails(page);
            const xchainSwitch = main.getByRole('switch', { name: /instead of XCHAIN/ });

            if (NATIVE_FEE_MANDATORY) {
                await expect(main.getByText(new RegExp(
                    `${NATIVE_TICKER} is the only way to pay a protocol fee on this chain`)),
                    `the Create token form does not tell a ${REGTEST_CHAIN_LABEL} user that the `
                    + 'protocol fee can only be paid in coin here')
                    .toBeVisible({ timeout: 30_000 });
                expect(await xchainSwitch.count(),
                    'the form offers an XCHAIN fee lane on a chain that has none. The indexer '
                    + 'answers "rejected" for a fee-bearing action with no fee output on any coin '
                    + 'but BTC (utility.detectFeePaymentMode), so the transaction would be '
                    + 'broadcast, the miner fee spent, and the action never indexed')
                    .toBe(0);
            } else {
                // The BTC shape, and the precondition the XCHAIN-fee test needs.
                await expect(xchainSwitch,
                    'the form offers no fee-lane choice on the one chain that has one')
                    .toBeVisible({ timeout: 30_000 });
                await expect(xchainSwitch,
                    'the switch defaults ON, so this form composes in the native lane unless a '
                    + 'user intervenes and the XCHAIN lane is the opt-in rather than the default')
                    .not.toBeChecked();
            }
        });
    });

    /**
     * UNFINISHED, AND IT PINS NO DEFECT. Marked skip-off-Bitcoin rather than
     * deleted or dressed up, because the body is right and the VENUE is what is
     * missing.
     *
     * WHY IT CANNOT RUN TODAY, measured 2026-08-27. A protocol fee settles from
     * an XCHAIN balance on exactly one chain:
     *
     *   xchain-indexer/src/utility.js detectFeePaymentMode
     *     "LTC/DOGE: native coin is the only option; missing fee output = rejected"
     *   xchain-wallet packages/core/src/registry/nativeFee.js isNativeFeeMandatory
     *     `return ticker !== 'BTC'`
     *
     * So the XCHAIN fee lane exists only on Bitcoin. XCHAIN itself is mintable
     * on any regtest chain (`issue.js` exempts regtest from the BTC-only rule
     * "so the e2e harness can self-seed play-money gas on any chain"), which is
     * exactly why this looks runnable and is not: the wallet can HOLD XCHAIN on
     * Litecoin and can never spend it on a fee there. The first test's last step
     * drives that from the screen.
     *
     * The only Bitcoin regtest venue on this stack is RBTC, whose decoder is
     * crash-looping on a REORG_HALT marker, and RDOGE is off limits by operator
     * instruction. There is no wallet change that would make this pass, so
     * nothing about the wallet is claimed here either way.
     *
     * TO FINISH IT: bring RBTC back and run this file with XC_REGTEST_COIN=RBTC.
     * The `NATIVE_FEE_MANDATORY` guard above already asserts the precondition
     * this needs (the switch exists and is unchecked, so the wizard composes in
     * the XCHAIN lane by default).
     */
    test('a protocol fee settles from an XCHAIN balance, and the balance moves', async ({ page }) => {
        // SKIPPED off Bitcoin rather than `fixme`d, because a fixme asserts a
        // defect and there is none here: off Bitcoin `isNativeFeeMandatory`
        // makes the coin the only fee lane, so this leg has no subject on
        // Litecoin or Dogecoin at all. A fixme also never runs anywhere, which
        // would leave the body below un-drivable even on the venue it is for;
        // a conditional skip runs it the moment somebody points RBTC at it.
        // Note it has NOT been driven green yet - see the header - so its first
        // Bitcoin run is a measurement, not a regression check.
        test.skip(REGTEST_COIN !== 'RBTC',
            `a protocol fee can only be PAID in XCHAIN on Bitcoin; on ${REGTEST_COIN} the native `
            + 'coin is the mandatory and only lane, so there is no XCHAIN settlement to observe');

        /** Comfortably over one ISSUE's 1.00000000 XCHAIN, so the fee is not the whole balance. */
        const XCHAIN_MINT = 25;
        const TICK = `TGX${STAMP}`;
        let source;

        await test.step('onboard, fund, and mint the play-money gas this leg spends', async () => {
            await createWallet(page, { password: PASSWORD, name: 'XCHAIN Fee Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const probe = page.getByRole('main');
            await expect(probe.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(probe);
            source = await probe.getByLabel('From').inputValue();
            expect(source).toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await seedPrices();

            // Free MINT by any address on regtest, driven through the palette's
            // Advanced action because the friendly Mint form is balance-scoped
            // and will not offer a tick the wallet holds none of.
            await mintXchain(page, XCHAIN_MINT);
            await waitForTokenBalance(source, 'XCHAIN', XCHAIN_MINT);
        });

        await test.step('the venue prices this ISSUE in XCHAIN, and that is the figure to check', async () => {
            const quote = await warmFeeQuote({ action: 'ISSUE', params: `0|${TICK}`, source });
            expect(String(quote?.status),
                'the venue cannot price a plain ISSUE from this address').toBe('valid');
            expect(Number(quote?.xchainFee),
                'the quote carries no XCHAIN fee, so there is no figure to measure the balance '
                + 'movement against')
                .toBeGreaterThan(0);
            test.info().annotations.push({
                type: 'xchainFee', description: String(quote.xchainFee),
            });
        });

        await test.step('the wizard composes in the XCHAIN lane and the chain accepts it', async () => {
            const before = await tokenBalance(source, 'XCHAIN');
            expect(before, 'the mint never landed').toBeGreaterThanOrEqual(XCHAIN_MINT);

            const quote = await warmFeeQuote({ action: 'ISSUE', params: `0|${TICK}`, source });
            const feeXchain = Number(quote.xchainFee);

            const main = await openWizardDetails(page);
            // Left OFF, which is the default (`useNativeFee` seeds optIn false
            // and Bitcoin is the one chain where `mandatory` does not override
            // it), so this is the lane an ordinary Bitcoin user composes in.
            await expect(main.getByRole('switch', { name: /instead of XCHAIN/ })).not.toBeChecked();
            await main.getByLabel('Token name (ticker)').fill(TICK);
            await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await confirmOrSkipOnRateLimit(page, 'this action', 90_000);
            const approve = page.getByTestId('confirm-approve');
            await expect(approve).toBeEnabled({ timeout: 120_000 });
            await approve.click();
            const shell = page.getByRole('main');
            await expect(shell, 'no transaction id ever appeared after Approve')
                .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
            const txid = (await shell.innerText()).match(/[0-9a-f]{64}/)?.[0];

            const action = await waitForValidAction(txid);
            // The chain's own fee record, which is the half that says WHICH
            // lane settled it: a native-lane action carries a coin amount, an
            // XCHAIN-lane one does not.
            expect(String(action?.fee?.tick || 'XCHAIN'),
                'the fee record does not name XCHAIN, so this settled in some other lane')
                .toBe('XCHAIN');
            expect(action?.fee?.native_coin_amount,
                'the action carries a native-coin fee amount, so the wallet paid in coin after '
                + 'composing with the XCHAIN lane selected')
                .toBeFalsy();

            // And the balance moved by exactly the quote. This is the assertion
            // the leg exists for: a fee "paid in XCHAIN" that leaves the
            // balance untouched is a fee that was paid some other way.
            await waitForTokenBalance(source, TICK, SUPPLY);
            const after = await tokenBalance(source, 'XCHAIN');
            expect(before - after,
                `the XCHAIN balance moved by ${before - after} against a quoted fee of ${feeXchain}`)
                .toBeCloseTo(feeXchain, 8);
        });
    });
});
