// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the PC-51 sweep: every quotable authoring form mounts the shared
// NativeFeeToggle through the useNativeFee hook and threads the flag into its
// flow, and every quotable flow forwards it into submitAction's encoderOpts.
// Guards the "one form forgot one lane" regression class the hook exists to
// prevent, and pins the NativeFeeToggle doc to the quotable-set rule (the
// stale ISSUE/ORDER/SWAP/DISPENSER-only claim must not come back).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');
const routes = (f) => read('packages', 'core', 'src', 'shared', 'routes', f);
const flows = (f) => read('packages', 'core', 'src', 'flows', f);

// ---- forms newly threaded by the sweep: toggle mounted via the hook, flag
// present in every payload it builds ----
const SWEEP_FORMS = [
    'CreateOrderForm.jsx', 'DividendForm.jsx', 'AirdropForm.jsx',
    'BroadcastForm.jsx', 'ListCreateForm.jsx', 'ListForkForm.jsx',
    'DestroyForm.jsx', 'LinkForm.jsx', 'SleepForm.jsx',
    'PublishFileForm.jsx', 'AttachContentForm.jsx', 'OracleForm.jsx',
    'CallbackForm.jsx', 'SweepForm.jsx', 'TokenAdminForm.jsx',
    // , added 2026-08-01. It was on NEITHER list, so this smoke passed
    // while the one authoring surface for an ownership sale composed ORDER and
    // DISPENSER with no fee output at all: on LTC/DOGE the transaction
    // confirmed and the indexer answered "insufficient fee (native coin output
    // required)" while the form reported the sale as open. Measured as ORDER
    // 2127 (invalid, fee null) against 2130 (valid, payment_mode 1) after the
    // fix, on the same venue minutes apart.
    'SellOwnershipForm.jsx',
];
for (const f of SWEEP_FORMS) {
    const src = routes(f);
    assert.match(src, /import \{ useNativeFee \}/, `${f} uses the useNativeFee hook`);
    assert.match(src, /<NativeFeeToggle/, `${f} renders the toggle`);
    assert.match(src, /payFeeInNativeCoin: nativeFee\.flag/, `${f} threads nativeFee.flag into its payloads`);
    // : the spread is what carries `mandatory` to the toggle; hand-picking
    // checked/onChange instead would silently drop it and re-open the opt-in on
    // a chain that has no other fee lane.
    assert.match(src, /\{\.\.\.nativeFee\.toggleProps\}/, `${f} spreads the whole toggleProps`);
}

// ---- pre-PC-51 toggle forms migrated onto the shared hook ----
const MIGRATED = [
    ['routes', 'IssueTokenForm.jsx'], ['routes', 'SwapForm.jsx'],
    ['routes', 'DispenserForm.jsx'], ['routes', 'TokenWizard.jsx'],
    ['routes', 'AdvancedActionsForm.jsx'], ['routes', 'MintForm.jsx'],
    ['components', 'PlaceOrderPanel.jsx'],
];
for (const [dir, f] of MIGRATED) {
    const src = read('packages', 'core', 'src', 'shared', dir, f);
    assert.match(src, /useNativeFee\(/, `${f} state comes from useNativeFee`);
    assert.doesNotMatch(
        src, /useState\(false\);?\s*\/\/.*native/i,
        `${f} no longer hand-rolls the toggle state`,
    );
    // : a form that hides `mandatory` would render an unticked opt-in on
    // LTC/DOGE, which is the pre-fix bug wearing the post-fix hook.
    assert.match(src, /mandatory=\{nativeFeeMandatory\}/, `${f} passes mandatory to the toggle`);
}

// ---- : no form may call the hook without naming its chain ----
// A bare useNativeFee() cannot know whether the native fee is an opt-in (BTC)
// or the only fee lane (LTC/DOGE), so it defaults to Bitcoin's answer and every
// fee-bearing action composed on LTC/DOGE indexes `insufficient fee (native
// coin output required)` after paying a real miner fee.
const HOOK_CALLERS = [
    ...SWEEP_FORMS.map((f) => ['routes', f]),
    ...MIGRATED,
];
for (const [dir, f] of HOOK_CALLERS) {
    const src = read('packages', 'core', 'src', 'shared', dir, f);
    assert.doesNotMatch(src, /useNativeFee\(\s*\)/, `${f} passes its chain to useNativeFee`);
}

// ---- the hook and the rule it reads ----
const hook = read('packages', 'core', 'src', 'shared', 'hooks', 'useNativeFee.js');
assert.match(hook, /isNativeFeeMandatory/, 'useNativeFee derives the default from the chain');
const rule = read('packages', 'core', 'src', 'registry', 'nativeFee.js');
assert.match(rule, /detectFeePaymentMode/, 'the rule cites the indexer function it mirrors');

// ---- flows: the encoder opt reaches submitAction ----
const SWEEP_FLOWS = [
    'dividendAction.js', 'airdropAction.js', 'broadcastAction.js',
    'createList.js', 'destroyToken.js', 'linkAction.js', 'sleepAction.js',
    'fileAction.js', 'oraclePriceAction.js', 'callbackAction.js', 'sweepToken.js',
];
for (const f of SWEEP_FLOWS) {
    assert.match(
        flows(f),
        /opts\.payFeeInNativeCoin !== undefined && \{ payFeeInNativeCoin: opts\.payFeeInNativeCoin \}/,
        `${f} forwards payFeeInNativeCoin into encoderOpts`,
    );
}

// ---- component doc pinned to the quotable-set rule ----
const toggle = read('packages', 'core', 'src', 'shared', 'components', 'NativeFeeToggle.jsx');
assert.match(toggle, /classifyFeeQuoteAction/, 'NativeFeeToggle doc cites the indexer classifier');
assert.doesNotMatch(
    toggle, /Only mount this on create actions the indexer can price \(ISSUE/,
    'stale four-action mount rule removed',
);

// A form "explains a refused native-fee quote in chain-aware wording" if it
// calls nativeFeeErrorMessage with the chain context, OR if it routes its catch
// through submitFailureMessage - the  helper whose whole purpose is to be
// the one place a form turns a failed submit into a sentence, and which calls
// nativeFeeErrorMessage with exactly those options. Pinning only the literal
// call would fail a form for adopting the helper, which is backwards: D-118
// moved the betting surfaces onto it precisely because hand-rolled ternaries
// mapped ONE error shape and let every other one through as a log line.
//
// WIDENED AGAIN (D-121): the first widening still pinned the ARGUMENT LAYOUT -
// it required `coinTicker, mandatory: nativeFee.mandatory` on one line, so the
//  sweep failed this smoke by adopting the same helper with the argument
// object spread over separate lines. That is a whitespace opinion wearing a
// correctness assertion, and it punishes exactly the change the rule wants.
// What is actually being asserted is: the catch hands `err` to a mapper that
// knows the coin and whether the chain has an XCHAIN lane. So match the call
// and its two named arguments in either order of line breaks, and nothing else.
const CHAIN_AWARE_REFUSAL =
    /(?:nativeFeeErrorMessage|submitFailureMessage)\(\s*err,\s*\{[\s\S]{0,200}?\bcoinTicker\b[\s\S]{0,200}?\bmandatory:\s*nativeFee\.mandatory/;

// ---- : the BET lane, which the PC-51 sweep never covered ----
//
// BET is fee-bearing on two of its four formats and sits in COMMON_ACTIONS, so
// it is offered on LTC/DOGE, where the native output is the ONLY fee lane. Its
// two authoring surfaces had no toggle, no hook and no encoderOpts at all, so
// every market opened and every bet placed on those chains was guaranteed
// invalid. The wiring is a background/messaging-layer change as well as a form
// one, which is why the flow and the host route are asserted here too.
const BET_FORMS = ['CreateBetFeedForm.jsx', 'BetFeedDetail.jsx'];
for (const f of BET_FORMS) {
    const src = routes(f);
    assert.match(src, /import \{ useNativeFee \}/, `${f} uses the useNativeFee hook`);
    assert.doesNotMatch(src, /useNativeFee\(\s*\)/, `${f} passes its chain to useNativeFee`);
    assert.match(src, /<NativeFeeToggle \{\.\.\.nativeFee\.toggleProps\}/,
        `${f} renders the toggle with the whole toggleProps (so `
        + 'mandatory survives)');
    // BOTH lanes: the flag has to be in the composed PSBT the user approves AND
    // in the submit that signs it. A form that threaded only one would preview
    // a fee output it never pays for, or pay for one nobody previewed.
    const composeIdx = src.indexOf('messaging.composeBetForConfirm({');
    assert.ok(composeIdx !== -1, `${f} composes through the BET route`);
    const both = src.slice(composeIdx, composeIdx + 900);
    assert.equal(
        (both.match(/payFeeInNativeCoin: nativeFee\.flag/g) || []).length, 2,
        `${f} threads the flag into BOTH compose and submit`,
    );
    // The LTC/DOGE-aware wording, not the BTC-era "turn it off" advice.
    assert.match(src, CHAIN_AWARE_REFUSAL,
        `${f} explains a refused native-fee quote in chain-aware wording`);
}

// The two FREE formats stay toggle-free: resolve (v3) and cancel (v1) emit only
// credits that were pre-funded at place time, so the chain charges nothing and a
// toggle there would ask for a fee that does not exist.
const oracleConsole = routes('OracleConsole.jsx');
assert.doesNotMatch(oracleConsole, /<NativeFeeToggle/,
    'OracleConsole (resolve/cancel, both free) has no toggle');
assert.match(oracleConsole, //,
    'OracleConsole records WHY it has no toggle, so a later sweep does not add one');

assert.match(
    flows('betActions.js'),
    /opts\.payFeeInNativeCoin !== undefined && \{ payFeeInNativeCoin: opts\.payFeeInNativeCoin \}/,
    'betActions forwards payFeeInNativeCoin into encoderOpts',
);
{
    // BET composes host-side through its own route (the builder runs there), so
    // that route is the only place the flag can enter the previewed PSBT.
    const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
    const idx = host.indexOf("host.register('action.bet.composeForConfirm'");
    assert.ok(idx !== -1, 'the BET compose route exists');
    assert.match(
        host.slice(idx, idx + 3000),
        /req\?\.payFeeInNativeCoin !== undefined && \{ payFeeInNativeCoin: req\.payFeeInNativeCoin \}/,
        'action.bet.composeForConfirm threads payFeeInNativeCoin into encoderOpts',
    );
}

// ---- : the contract lane (DEPLOY/EXECUTE) ----
//
// These two were the last fee-bearing forms with no lane at all, for a reason
// that expired: BTC could always settle their fee from an XCHAIN balance, and
// they were unquotable everywhere else.  gave them a schedule-priced
// quote with no verdict (`valid:null`), which is payable, so the lane has to
// exist BEFORE BTC_EXCLUSIVE_ACTIONS can open them to LTC/DOGE, where the
// native output is the only fee lane there is.
const CONTRACT_FORMS = ['DeployContractForm.jsx', 'ExecuteContractForm.jsx'];
for (const f of CONTRACT_FORMS) {
    const src = routes(f);
    assert.match(src, /import \{ useNativeFee \}/, `${f} uses the useNativeFee hook`);
    assert.doesNotMatch(src, /useNativeFee\(\s*\)/, `${f} passes its chain to useNativeFee`);
    assert.match(src, /<NativeFeeToggle \{\.\.\.nativeFee\.toggleProps\}/,
        `${f} renders the toggle with the whole toggleProps (so mandatory survives)`);
    // The valid:null caveat. Without `unverified` the row promises a pre-flight
    // verdict these two never get, which is the one thing their user must know
    // before spending a non-refundable fee.
    assert.match(src, /<NativeFeeToggle \{\.\.\.nativeFee\.toggleProps\} coinTicker=\{coinTicker\} unverified/,
        `${f} marks the quote unverified (DEPLOY/EXECUTE are priced without a dry-run)`);
    assert.match(src, /NATIVE_FEE_UNVERIFIED_NOTICE/,
        `${f} states the unverified caveat on its review stage too`);
    assert.match(src, CHAIN_AWARE_REFUSAL,
        `${f} explains a refused native-fee quote in chain-aware wording`);
    // Three submit lanes, and a form that threaded only some of them would
    // preview a fee output it never pays for, or pay for one nobody previewed.
    // Compose (confirm page), submit (deploy/executeAction) and the watcher
    // encode-only build each carry it.
    assert.ok(
        (src.match(/payFeeInNativeCoin: nativeFee\.flag/g) || []).length >= 4,
        `${f} threads the flag into compose, approve-submit, legacy submit and the watcher build`,
    );
    const watcherIdx = src.indexOf('messaging.buildActionPsbtRequest({');
    assert.ok(watcherIdx !== -1, `${f} has a watcher encode-only lane`);
    assert.match(src.slice(watcherIdx, watcherIdx + 500), /payFeeInNativeCoin: nativeFee\.flag/,
        `${f} threads the flag into the watcher-mode build`);
}

// The chunked DEPLOY run is N+1 separate priced DEPLOYs, so the flag has to
// reach that lane as well; funding only the assembler buys paid chunks and no
// contract.
{
    const deploySrc = routes('DeployContractForm.jsx');
    const idx = deploySrc.indexOf('const chunkedBase = {');
    assert.ok(idx !== -1, 'DeployContractForm has a chunked lane');
    assert.match(deploySrc.slice(idx, idx + 900), /payFeeInNativeCoin: nativeFee\.flag/,
        'the chunked deploy run carries the fee mode');
}

for (const f of ['deployAction.js', 'executeAction.js', 'deployChunked.js']) {
    assert.match(
        flows(f),
        /opts\.payFeeInNativeCoin !== undefined && \{ payFeeInNativeCoin: opts\.payFeeInNativeCoin \}/,
        `${f} forwards payFeeInNativeCoin into encoderOpts`,
    );
}

// The toggle's own doc must not still call DEPLOY/EXECUTE unquotable: that
// claim is what justified leaving these two forms lane-less.
assert.doesNotMatch(
    read('packages', 'core', 'src', 'shared', 'components', 'NativeFeeToggle.jsx'),
    /denied set \{DEPLOY, EXECUTE/,
    'NativeFeeToggle no longer lists DEPLOY/EXECUTE as unquotable ( prices them)',
);

// ---- the gated (BATCH) lane stays toggle-free: BATCH is fee-quote DENIED ----
const gated = routes('GatedPublishForm.jsx');
assert.doesNotMatch(gated, /<NativeFeeToggle/, 'GatedPublishForm (BATCH lane) has no toggle');
const batchComposer = routes('BatchComposerForm.jsx');
assert.doesNotMatch(batchComposer, /<NativeFeeToggle/, 'BatchComposerForm (BATCH) has no toggle');

// ---- DISCOVERY GUARD : a curated list can only ever miss the NEXT
// omission, which is exactly how SellOwnershipForm survived the PC-51 sweep and
// §11.3's audit of it. Rather than trust the lists above to stay complete, scan
// every route for one that BUILDS a quotable action payload and does not thread
// the flag. Anything genuinely exempt has to say so here, by name and reason.
const { readdirSync } = await import('node:fs');
const routesDir = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes');

// Quotable actions that must carry a native-coin fee output off Bitcoin. BATCH
// is deliberately absent: it is fee-quote DENIED (see the gated lane above).
const QUOTABLE = /\b(?:action|ACTION)\s*[:=]\s*'(ORDER|DISPENSER|ISSUE|SWAP|DIVIDEND|BROADCAST)'/;

const EXEMPT = new Map([
    // Composes nothing itself; it delegates each leg to the form that owns it,
    // and those forms are asserted above.
    ['ParallelComposer.jsx', 'delegates every leg to an already-swept form'],
    // BATCH lane, fee-quote denied.
    ['BatchComposerForm.jsx', 'BATCH is fee-quote denied'],
    ['GatedPublishForm.jsx', 'BATCH lane, fee-quote denied'],
    // NOT a clean exemption: this one is , a real instance of the same
    // gap this guard exists to catch. It is listed rather than fixed because
    // the cross-chain SWAP lane cannot currently be broadcast (§9.1, blocked by
    // the  encoder bug), so the fix could not be driven and an untested
    // change to a money path should not ship. Remove this line when  is
    // closed - do not let it become furniture.
    ['CrossChainSwapForm.jsx', ': real gap, unverifiable while  blocks the lane'],
    // Also NOT clean: . Narrower than first filed - the v1 CLOSE this
    // file composes owes no fee at all (formats[1] has no EXPIRATION and is not
    // format 0, so fees.AMOUNT stays 0), but the v2 EDIT path sets EXPIRATION,
    // which IS priced. Drivable today. Remove this line when  is closed.
    ['DispenserDetail.jsx', ': v2 edit path is fee-bearing and unthreaded'],
]);

for (const file of readdirSync(routesDir).filter((f) => f.endsWith('.jsx'))) {
    const src = routes(file);
    if (!QUOTABLE.test(src)) continue;                 // not an authoring surface
    if (EXEMPT.has(file)) continue;
    assert.match(
        src, /payFeeInNativeCoin/,
        `${file} builds a quotable action but never threads payFeeInNativeCoin. Off Bitcoin the `
        + 'native-coin fee is MANDATORY , so the action confirms on chain and is then '
        + 'rejected "insufficient fee (native coin output required)" while the form reports '
        + 'success. Give it the useNativeFee treatment, or add it to EXEMPT with a reason.',
    );
}

console.log(
    'native-fee-sweep smoke: all assertions passed (PC-51 sweep +  mandatory-chain '
    + 'derivation +  BET lane, form/flow/host +  contract lane +  discovery)',
);
