// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Create token" -> the TICKER GRAMMAR GAP: the set of
// names the chain will accept and the wallet will not let anybody type.
//
// WHY IT IS WORTH A RUN, AND WHAT IT DELIBERATELY DOES NOT DO. Row 21 asks
// whether the wallet SHOULD widen its ticker rule. That is a product decision
// and it is not this spec's; row 43 asks only for the measurable half, so this
// file measures the delta and refuses to argue about it. Every assertion here
// is of the form "the chain says X and the form does Y", both sides driven in
// the same run against the same venue at the same block.
//
// THE TWO RULES, QUOTED FROM HEAD RATHER THAN FROM THE COVERAGE ROW.
//
//   CHAIN (xchain-indexer/src/config.js):
//     TICK_CHARACTERS  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ
//                       0123456789~!@#$%^&*()_+-={}[]:<>.?'
//     MIN_TICK_LENGTH  1
//     MAX_TICK_LENGTH  250
//   enforced in `issue.js` as an allowlist loop ("invalid: TICK (character)")
//   plus a length band ("invalid: TICK (length)"). `xchain-sdk/src/validator.js`
//   mirrors it byte for byte (TICK_REGEX, MAX_TICK_LENGTH 250), so the SDK is
//   NOT the narrowing.
//
//   WALLET, both authoring surfaces, and they are the whole narrowing:
//     TokenWizard.jsx      /^[A-Za-z0-9]+$/   "Token name must be A-Z, 0-9."
//     IssueTokenForm.jsx   /^[A-Za-z0-9]+$/   "Ticker must be A-Z, 0-9 only."
//
// AND THE COVERAGE ROW IS WRONG ABOUT HALF OF IT, which is the reason this file
// earns its runtime rather than restating a known gap. The row names four
// classes as unauthorable: 1-character, lowercase, symbol-bearing, over-long.
// Read the regex: `+` is one-or-more, so a 1-character tick PASSES; the
// character class contains `a-z`, so lowercase PASSES; and neither ticker input
// carries a `maxLength` (the Description and Image URL inputs beside them do,
// at 250), so a 250-character alphanumeric tick PASSES too. Only the
// SYMBOL-BEARING class is actually refused.
//
// Lowercase is unreachable all the same, and by a different mechanism worth
// pinning on its own: both fields uppercase on every keystroke
// (`onChange={(e) => setName(e.target.value.toUpperCase())}`), so a lowercase
// tick is not refused with a message, it is silently rewritten under the
// user's cursor. A spec that only looked for an error message would have
// reported that class as authorable.
//
// WHAT WOULD BE FALSE IF THIS PASSED VACUOUSLY. Three things, and each has a
// control in the run:
//   - "the chain accepts these" is asserted against the venue's own /feequote,
//     not against the config file above, so a chain that had quietly narrowed
//     fails here rather than being argued with.
//   - "the form refuses these" is asserted against the exact grammar message,
//     and the SAME helper is asserted to NOT produce it on the classes the
//     regex allows. A helper that could never find the message would fail the
//     refusal legs; one that always found it would fail the acceptance legs.
//   - a plain alphanumeric CONTROL tick is driven through both sides first, so
//     a venue that refuses everything, or a form that refuses everything,
//     cannot produce a green.
//
// NOTHING HERE BROADCASTS. Every leg stops at the confirm screen or earlier, so
// the run spends miner fees on nothing and no protocol fee is paid; the only
// on-chain writes are the funding this needs to make a compose possible at all.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/tokens/ticker-grammar.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    fundAddress,
    mintXchain,
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
/** No leg here broadcasts, so this only has to make a COMPOSE possible. */
const FUNDING = 2;
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
 * The grammar refusals, matched WITHOUT the dash character.
 *
 * The product copy spells the ranges with an en dash ("A-Z, 0-9" with U+2013),
 * and hardcoding that byte makes the spec fail on a typographic edit that
 * changed nothing about the rule. A wildcard for the dash keeps the assertion
 * on the sentence rather than on its punctuation.
 */
const WIZARD_GRAMMAR_MESSAGE = /Token name must be A.Z, 0.9/;
const DIRECT_GRAMMAR_MESSAGE = /Ticker must be A.Z, 0.9 only/;

/**
 * Ticks the chain's allowlist accepts and the wallet's regex does not.
 *
 * Every symbol here is a literal member of TICK_CHARACTERS. The caret case is
 * the tick-ID wire form: `issue.js` accepts `^<numeric>` outright (it only
 * rejects a non-numeric tail as "invalid: TICK (id)"), and no literal `^...`
 * row is ever created, so the name cannot be taken by an earlier run.
 */
const REFUSED_BY_WALLET = [
    { klass: 'hyphen', tick: `TGR${STAMP}-1` },
    { klass: 'underscore', tick: `TGR${STAMP}_1` },
    { klass: 'percent', tick: `TGR${STAMP}%1` },
    { klass: 'hash', tick: `TGR${STAMP}#1` },
    // NOT the tick-ID form (`^999999`). It was in this list until it was driven
    // on 2026-08-27, and the venue REFUSED it: `chainVerdict` came back
    // undefined where every other class here came back `valid`, on a run whose
    // plain-alphanumeric control passed in the same step. So `^` being a member
    // of TICK_CHARACTERS does not make `^`-prefixed numerics issuable, and the
    // wallet refusing them is AGREEMENT with the chain rather than a gap. That
    // is the whole reason this spec asks the chain first: listed as a gap it
    // would have been a defect report against the wallet for enforcing a rule
    // the chain also enforces.
];

/** The control: plainly alphanumeric, so both sides must say yes. */
const CONTROL_TICK = `TGC${STAMP}`;

/**
 * A 250-character tick, which is exactly MAX_TICK_LENGTH.
 *
 * Alphanumeric on purpose: the point is the LENGTH, and mixing a symbol in
 * would let the wallet's character rule take the credit for a refusal the
 * coverage row attributes to length.
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
    return String(quote?.status);
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
 * Returns what the FIELD held after filling as well as the verdict, because on
 * this surface the two are different questions: the input uppercases on change,
 * so "what the user typed" and "what the form validated" are not the same
 * string.
 */
async function submitWizardName(page, tick) {
    const main = await openWizardDetails(page);
    const field = main.getByLabel('Token name (ticker)');
    await field.fill(tick);
    const held = await field.inputValue();
    await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();

    const grammar = page.getByRole('alert').filter({ hasText: WIZARD_GRAMMAR_MESSAGE });
    const confirm = page.getByTestId('confirm-modal');
    // Raced rather than waited on in sequence: a refused submit never composes
    // and an accepted one never shows a grammar error, so whichever appears IS
    // the verdict. The catch matters for the over-long leg, where a compose can
    // legitimately fail for a reason that is not the grammar rule - that is
    // still a form that got PAST the regex, which is all this measures.
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

    // FIXME'd 2026-08-27, AND THE FOUR RUNS THAT GOT IT HERE ARE THE FINDING.
    // This pins no wallet defect. It very nearly reported four.
    //
    // The coverage row this spec was written for names four ticker classes the
    // chain supposedly accepts and the wallet refuses. Driven against the venue,
    // one at a time, each class in turn failed the CHAIN half of its own claim:
    //
    //   `^999999` (tick-ID form)  the venue refused it, though `^` is a literal
    //                            member of TICK_CHARACTERS.
    //   1 character              all six candidates refused, though
    //                            MIN_TICK_LENGTH is 1.
    //   250 characters           refused at exactly MAX_TICK_LENGTH. Plausibly
    //                            the chunked-encoding lane rather than grammar;
    //                            250 chars is far past a bare OP_RETURN.
    //   lowercase                refused, and this one explains itself: ticks
    //                            resolve CASE-INSENSITIVELY, so a lowercase
    //                            tick reads as already-taken the moment the
    //                            uppercase form exists. The wallet silently
    //                            uppercasing it is therefore agreement, and
    //                            arguably just correct.
    //
    // So the wallet is largely AGREEING with the chain, and the config constants
    // (TICK_CHARACTERS, MIN_TICK_LENGTH, MAX_TICK_LENGTH) do not describe what
    // this venue actually admits. That gap is the real question and it is bigger
    // than ticker grammar; it belongs to whoever owns the admission path, not to
    // the wallet. Only the SYMBOL class is still a candidate for a genuine gap,
    // and it has not been shown green yet.
    //
    // Committed fixme rather than deleted because the structure is right and the
    // measurements are worth keeping: every step asks the chain FIRST, which is
    // the only reason this did not become four defect reports against the wallet
    // for enforcing rules the chain enforces too.
    test.fixme('the chain accepts ticker shapes the Create token form will not let anybody type', async ({ page }) => {
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
            expect(verdict.refusedOnGrammar,
                'the wizard refused a plainly alphanumeric ticker, so the grammar matcher below '
                + 'would report a "gap" on every name in existence')
                .toBe(false);
            expect(verdict.reachedConfirm,
                `a plain ISSUE of ${CONTROL_TICK} never reached the confirm screen `
                + `(${verdict.alertText || 'no alert either'}). Venue state, not a grammar rule`)
                .toBe(true);
        });

        await test.step('THE GAP: five shapes the chain allows and the form refuses outright', async () => {
            for (const { klass, tick } of REFUSED_BY_WALLET) {
                // The chain's half first, so the refusal below is measured
                // against something rather than believed. Every one of these
                // characters is a literal member of TICK_CHARACTERS, and this
                // is the venue agreeing.
                expect(await chainVerdict(tick, source),
                    `the venue refuses the ${klass} class (${tick}), so the wallet refusing it is `
                    + 'agreement rather than a gap. TICK_CHARACTERS has narrowed, or this venue '
                    + 'runs an older indexer')
                    .toBe('valid');

                const verdict = await submitWizardName(page, tick);
                expect(verdict.refusedOnGrammar,
                    `the wizard did NOT refuse the ${klass} class (${tick}) on grammar, so the `
                    + 'narrowing this spec measures is no longer in force. If the rule was widened '
                    + `on purpose, this row is the record of it (last alert: ${verdict.alertText})`)
                    .toBe(true);
                expect(verdict.reachedConfirm,
                    `a ticker the wizard refused still reached the confirm screen (${klass})`)
                    .toBe(false);
            }
        });

        await test.step('THE CORRECTION, part 1: a 1-character tick is authorable after all', async () => {
            // The coverage row lists this class as unauthorable. The regex says
            // otherwise (`+` is one-or-more), and the run says otherwise.
            let single = null;
            const seen = [];
            for (const candidate of SINGLE_CHAR_CANDIDATES) {
                const status = await chainVerdict(candidate, source);
                seen.push(`${candidate}:${status}`);
                if (status === 'valid') { single = candidate; break; }
            }
            // MEASURED 2026-08-27 AND IT IS A CONTRADICTION, recorded rather
            // than asserted past. `MIN_TICK_LENGTH` is 1 in the indexer's own
            // config, and this venue answered `undefined` for all six
            // candidates (1, 8, F, M, T, 0) in the same run where multi-
            // character alphanumerics answered `valid`. So something between
            // the config constant and the admission path refuses one-character
            // ticks, and until that is named it is NOT safe to call the
            // wallet's refusal a gap: it may be agreement, exactly as the
            // tick-ID class turned out to be.
            //
            // Failing here would report a wallet defect on the strength of a
            // premise the chain just declined to confirm, so the step records
            // what it saw and stands down. Give this a venue with a free
            // one-character tick and it runs.
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
                `the wizard refused the 1-character tick ${single}. That contradicts its own `
                + 'regex, so a length rule has been added somewhere since this was measured')
                .toBe(false);
            expect(verdict.reachedConfirm,
                `a 1-character ISSUE of ${single} never reached the confirm screen `
                + `(${verdict.alertText || 'no alert either'})`)
                .toBe(true);
        });

        await test.step('THE CORRECTION, part 2: a 250-character tick clears the grammar rule too', async () => {
            expect(OVERLONG_TICK.length, 'the over-long fixture is not MAX_TICK_LENGTH').toBe(250);

            // THE THIRD CONTRADICTION, measured 2026-08-27 and recorded rather
            // than asserted past, for the same reason as the 1-character class
            // above: the venue answered `undefined` for a tick at exactly
            // MAX_TICK_LENGTH, which the indexer's own config says is legal.
            //
            // There is a plausible mechanical cause that is NOT a protocol
            // rule, and it has to be ruled out before anyone calls the wallet's
            // refusal a gap: a 250-character tick is far past the ~80 bytes a
            // bare OP_RETURN carries, so an ISSUE naming one needs the chunked
            // multisig encoding lane. "The encoder could not fit it" and "the
            // protocol forbids it" are different findings with different
            // owners, and this step cannot tell them apart.
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
            // question (it is far past the 80-byte bare-OP_RETURN limit, so it
            // needs the multisig lane), and row 43 asks about the wallet's
            // ticker rule, not about that.
            expect(verdict.refusedOnGrammar,
                'the wizard refused a 250-character alphanumeric ticker on grammar. Its regex has '
                + 'no length bound, so a length rule has been added since this was measured')
                .toBe(false);
        });

        await test.step('THE COERCION: lowercase is not refused, it is silently rewritten', async () => {
            // A different mechanism from every case above, and the reason it
            // gets its own step: `/^[A-Za-z0-9]+$/` ACCEPTS lowercase. What
            // makes the class unreachable is the input's own
            // `onChange={(e) => setName(e.target.value.toUpperCase())}`, so
            // there is no message, no warning, and nothing to appeal to. A
            // spec that only looked for an error would have called this class
            // authorable.
            const lower = `tgw${STAMP}`;
            expect(await chainVerdict(lower, source),
                'the venue refuses a lowercase tick, so the wallet uppercasing it is agreement. '
                + 'Note the chain resolves ticks CASE-INSENSITIVELY, so this reads "another '
                + 'address" once the uppercase form exists')
                .toBe('valid');

            const main = await openWizardDetails(page);
            const field = main.getByLabel('Token name (ticker)');
            await field.fill(lower);
            expect(await field.inputValue(),
                'the name field kept the lowercase characters, so the silent uppercasing this '
                + 'step pins is gone and the class is now authorable')
                .toBe(lower.toUpperCase());
            // The hint says so out loud, and that is the only disclosure a user
            // gets, so it is worth an assertion: it is the difference between a
            // rule and a surprise. Dash-agnostic for the same reason the
            // grammar matchers are.
            await expect(main.getByText(/A.Z, 0.9\. Uppercase\./).first(),
                'the ticker field no longer discloses that it uppercases')
                .toBeVisible({ timeout: 15_000 });
        });

        await test.step('the DIRECT Issue form narrows identically, so a widening has two sites', async () => {
            // Row 21 has to move both surfaces or neither, so the second one is
            // measured here rather than assumed from a matching regex. Its
            // message is its OWN string ("Ticker must be ...", not "Token name
            // must be ..."), which is what proves this leg drove the other form.
            const { tick } = REFUSED_BY_WALLET[0];
            await reloadToHome(page);
            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByLabel('Ticker').fill(tick);
            await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            const alert = page.getByRole('alert').filter({ hasText: DIRECT_GRAMMAR_MESSAGE });
            await expect(alert,
                'the direct Issue form no longer refuses a symbol-bearing ticker, so the two '
                + 'authoring surfaces have drifted apart on the ticker rule')
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
     * UNFINISHED, AND IT PINS NO DEFECT. Marked `fixme` rather than deleted or
     * dressed up as a skip, because the body is right and the VENUE is what is
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
     * TO FINISH IT: bring RBTC back, run this file with XC_REGTEST_COIN=RBTC,
     * and drop the `.fixme`. The `NATIVE_FEE_MANDATORY` guard above already
     * asserts the precondition this needs (the switch exists and is unchecked,
     * so the wizard composes in the XCHAIN lane by default).
     */
    test.fixme('a protocol fee settles from an XCHAIN balance, and the balance moves', async ({ page }) => {
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

            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 90_000 });
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
